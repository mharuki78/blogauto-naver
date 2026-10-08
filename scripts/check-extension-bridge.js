const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const {ExtensionBridge} = require('../src/lib/extensionBridge');
const {launchSpec,openAccountChrome} = require('../src/lib/chromeLauncher');
const {normalizeTistoryBlogId} = require('../src/lib/tistoryTarget');
const origin = 'chrome-extension://'+'a'.repeat(32);
function call(bridge,route,body={},token='',headers={}) {
 return new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port:bridge.port,path:route,method:route.startsWith('/asset')?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} : {}),...headers}},res=>{
   let raw='';res.on('data',c=>raw+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(raw)}));
  });req.on('error',reject);req.end(route.startsWith('/asset')?undefined:JSON.stringify(body));
 });
}
async function fixture(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'himawari-bridge-'));
 const bridge=new ExtensionBridge(root,0);await bridge.start();
 t.after(()=>{bridge.stop();fs.rmSync(root,{recursive:true,force:true});});
 const pair=async(id)=>{
  const {code}=bridge.pairCode(id,id,id);
  const response=await call(bridge,'/pair',{code,deviceId:`device-${id}-01234567890123456789`});
  assert.equal(response.status,200);return response.body.token;
 };
 return {root,bridge,pair};
}
test('pairing code is single use; external origins and forged Host cannot pair',async t=>{
 const {bridge}=await fixture(t); const {code}=bridge.pairCode('a','a','a');
 const body={code,deviceId:'device-a-01234567890123456789'};
 assert.equal((await call(bridge,'/pair',body,'',{Origin:'https://evil.example'})).status,403);
 assert.equal((await call(bridge,'/pair',body,'',{Host:'evil.example'})).status,403);
 assert.equal((await call(bridge,'/pair',body)).status,200);
 assert.equal((await call(bridge,'/pair',body)).status,403);
});
test('disconnected account cannot enqueue work',async t=>{
 const {bridge}=await fixture(t);
 await assert.rejects(bridge.request('a','publish',{}),{code:'EXTENSION_DISCONNECTED'});
 assert.equal(bridge.tasks.size,0);
});
test('failed result journal replacement can be retransmitted and settles the app exactly once',async t=>{
 const {bridge,pair}=await fixture(t);const token=await pair('a');
 let settled=0;
 const pending=bridge.request('a','publish',{title:'title',article:'body'}).then(result=>{settled++;return result;});pending.catch(()=>{});
 const task=(await call(bridge,'/poll',{},token)).body.task;
 await call(bridge,'/stage',{id:task.id,stage:'final_publish'},token);
 const save=bridge.saveTasks.bind(bridge);let saves=0;
 bridge.saveTasks=()=>{if(++saves===1)throw Object.assign(new Error('EPERM fixture'),{code:'EPERM'});return save();};
 const body={id:task.id,result:{published:true,url:'https://blog.naver.com/a/123'}};
 assert.equal((await call(bridge,'/result',body,token)).status,400);
 assert.equal(bridge.tasks.get(task.id).state,'running');assert.equal(settled,0);
 assert.equal((await call(bridge,'/result',body,token)).status,200);
 assert.equal((await Promise.race([pending,new Promise((_,reject)=>setTimeout(()=>reject(Error('waiter never settled')),500))])).published,true);
 assert.equal(saves,2);assert.equal(settled,1);
 assert.equal(JSON.parse(fs.readFileSync(bridge.journal))[0].state,'done');
 assert.equal((await call(bridge,'/result',body,token)).status,200);assert.equal(settled,1);
});
test('durable session result retry settles the waiter even after connection metadata save fails',async t=>{
 const {bridge,pair}=await fixture(t);const token=await pair('a');
 const pending=bridge.request('a','session',{});pending.catch(()=>{});
 const task=(await call(bridge,'/poll',{},token)).body.task;
 const save=bridge.save.bind(bridge);let saves=0;
 bridge.save=()=>{if(++saves===1)throw Error('metadata EPERM fixture');return save();};
 const body={id:task.id,result:{status:'valid',blogId:'a',editorBuild:'20261008.1'}};
 assert.equal((await call(bridge,'/result',body,token)).status,400);
 assert.equal((await call(bridge,'/result',body,token)).status,200);
 const result=await Promise.race([pending,new Promise((_,reject)=>setTimeout(()=>reject(Error('metadata failure strands waiter')),500))]);
 assert.equal(result.status,'valid');
});
test('account tokens cannot finish another task or read its image; runtime secrets cannot be assets',async t=>{
 const {root,bridge,pair}=await fixture(t);const a=await pair('a'),b=await pair('b');
 const dir=path.join(root,'jobs','one');fs.mkdirSync(dir,{recursive:true});
 const image=path.join(dir,'title.png');fs.writeFileSync(image,Buffer.from('image bytes'));
 const waiting=bridge.request('a','publish',{title:'title',article:'body',titleImagePath:image});
 waiting.catch(()=>{});
 const task=(await call(bridge,'/poll',{},a)).body.task;
 assert.equal((await call(bridge,'/result',{id:task.id,result:{published:true}},b)).status,404);
 assert.equal((await call(bridge,`/asset?task=${task.id}&index=0`,{},b)).status,403);
 assert.equal((await call(bridge,`/asset?task=${task.id}&index=0`,{},a)).body.data,Buffer.from('image bytes').toString('base64'));
 const secret=path.join(root,'token.png');fs.writeFileSync(secret,'secret');
 bridge.tasks.get(task.id).payload.titleImagePath=secret;
 assert.equal((await call(bridge,`/asset?task=${task.id}&index=0`,{},a)).status,400);
 bridge.cancelAccount('a');await assert.rejects(waiting,{code:'JOB_CANCELLED'});
 assert.equal(bridge.snapshot('b').connected,true);
});
test('final publish stage is durable before acknowledgment; stop and restart cannot replay it',async t=>{
 const {root,bridge,pair}=await fixture(t);const token=await pair('a');
 const payload={title:'unique title',article:'unique article'};
 const pending=bridge.request('a','publish',payload);pending.catch(()=>{});
 const task=(await call(bridge,'/poll',{},token)).body.task;
 assert.equal((await call(bridge,'/stage',{id:task.id,stage:'final_publish'},token)).status,200);
 assert.equal(JSON.parse(fs.readFileSync(bridge.journal))[0].stage,'final_publish');
 bridge.stop();await assert.rejects(pending,{code:'PUBLISH_UNCERTAIN'});
 const restarted=new ExtensionBridge(root,0);await restarted.start();
 await call(restarted,'/heartbeat',{},token);
 await assert.rejects(restarted.request('a','publish',payload),{code:'PUBLISH_UNCERTAIN'});
 restarted.stop();
});
test('revoke invalidates unspent pairing codes and affects only that account',async t=>{
 const {bridge,pair}=await fixture(t);await pair('a');const b=await pair('b');
 const {code}=bridge.pairCode('a','a','a');bridge.revoke('a');
 assert.equal((await call(bridge,'/pair',{code,deviceId:'device-new-01234567890123456789'})).status,403);
 assert.equal((await call(bridge,'/heartbeat',{},b)).status,200);
});
test('waiting for login does not strand a task after Chrome disconnects',async t=>{
 const {bridge,pair}=await fixture(t);const token=await pair('a');
 const promise=bridge.request('a','session',{interactive:true});promise.catch(()=>{});
 assert.equal(bridge.snapshot('a').busy,true);
 const task=(await call(bridge,'/poll',{},token)).body.task;
 await call(bridge,'/waiting',{id:task.id,status:'expired',reason:'login required'},token);
 bridge.lastSeen.set(token,Date.now()-130000);bridge.checkDisconnectedTasks();
 await assert.rejects(promise,{code:'EXTENSION_DISCONNECTED'});
 assert.equal(bridge.snapshot('a').busy,false);
});
test('invalid publication proof is acknowledged as uncertain and final stage cannot move backward',async t=>{
 const {bridge,pair}=await fixture(t);const token=await pair('a');
 const promise=bridge.request('a','publish',{title:'제목',article:'본문',publishVisibility:'public'});promise.catch(()=>{});
 const task=(await call(bridge,'/poll',{},token)).body.task;
 await call(bridge,'/stage',{id:task.id,stage:'final_publish'},token);
 assert.equal((await call(bridge,'/stage',{id:task.id,stage:'writing'},token)).status,400);
 assert.equal((await call(bridge,'/result',{id:task.id,result:{published:true,url:'https://blog.naver.com/other/123'}},token)).status,200);
 await assert.rejects(promise,{code:'PUBLISH_UNCERTAIN'});
 assert.equal(bridge.tasks.get(task.id).code,'PUBLISH_UNCERTAIN');
});
test('launcher separates stable account profiles and opens ordinary Chrome via shortcut',async t=>{
 const {root}=await fixture(t);const a=launchSpec(root,{id:'acct1',blogId:'foo'},'win32','C:/chrome.exe');
 const same=launchSpec(root,{id:'acct1',blogId:'foo'},'win32','C:/chrome.exe');
 const b=launchSpec(root,{id:'acct2',blogId:'foo'},'win32','C:/chrome.exe');
 assert.equal(a.dataDir,same.dataDir);assert.notEqual(a.dataDir,b.dataDir);
 assert.deepEqual(a.args,[`--user-data-dir=${a.dataDir}`,'https://blog.naver.com/foo/postwrite']);
 let opened='';let shortcutData;
 const spec=await openAccountChrome(root,{id:'acct1',blogId:'foo'}, {writeShortcutLink:(_p,_m,d)=>{shortcutData=d;return true;},openPath:async p=>{opened=p;return '';}},{platform:'win32',chrome:'C:/chrome.exe'});
 assert.equal(opened,spec.shortcut);assert.equal(shortcutData.target,'C:/chrome.exe');
 assert.equal(normalizeTistoryBlogId('https://My-Blog.tistory.com/'),'my-blog');
 assert.throws(()=>normalizeTistoryBlogId('evil.tistory.com/path'));
});
