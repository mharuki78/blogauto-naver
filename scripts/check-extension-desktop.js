const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const {EventEmitter}=require('node:events');
const desktop=require('../src/lib/desktopPublisher');
const {prepareExtension}=require('../src/lib/extensionSetup');
const {revokeChangedConnections,writeAccountStore}=require('../src/lib/accountStore');
const disconnected={snapshot:()=>({connected:false,status:'disconnected'}),clientFor:()=>null,request:()=>{throw new Error('must not enqueue');}};
test('desktop never accepts a stored session/context without a live account connection',async()=>{
 assert.equal((await desktop.checkNaverSession({accountId:'a',blogId:'foo',bridge:disconnected,preparedContext:{}})).status,'disconnected');
 await assert.rejects(desktop.publishToNaver({accountId:'a',blogId:'foo',bridge:disconnected}),{code:'EXTENSION_DISCONNECTED'});
});
test('account target mismatch and incompatible editor stop before publishing/generation',async()=>{
 let count=0;
 const bridge={snapshot:()=>({connected:true}),clientFor:()=>({platform:'naver',blogId:'bar'}),request:async()=>{count++;return {status:'valid',blogId:'foo',editorBuild:'20261008.1'};}};
 await assert.rejects(desktop.checkNaverSession({bridge,accountId:'a',blogId:'foo'}),{code:'ACCOUNT_TARGET_CHANGED'});assert.equal(count,0);
 bridge.clientFor=()=>({platform:'naver',blogId:'foo'});
 bridge.request=async()=>({status:'valid',blogId:'foo',editorBuild:'20260928.3'});
 await assert.rejects(desktop.checkNaverSession({bridge,accountId:'a',blogId:'foo'}),{code:'EXTENSION_UPDATE_REQUIRED'});
 bridge.request=async(_id,type,payload)=>{assert.equal(type,'session');assert.equal(payload.preflightTitle,true);return {status:'valid',blogId:'foo',editorBuild:'20261008.1'};};
 const prepared=await desktop.checkNaverSession({bridge,accountId:'a',blogId:'foo',preflightTitle:true});
 assert.deepEqual(prepared.preparedSession,{accountId:'a',connection:true});
});
test('Blog ID change and deletion revoke old connections while category edits keep them',()=>{
 const revoked=[];const bridge={revoke:id=>revoked.push(id)};
 const previous={accounts:[{id:'a',blogId:'foo'},{id:'b',blogId:'bar'},{id:'c',blogId:'same'}]};
 revokeChangedConnections(bridge,previous,{accounts:[{id:'a',blogId:'new'},{id:'c',blogId:'same',categories:['new']}]});
 assert.deepEqual(revoked,['a','b']);
});
test('extension update uses stable folder and copies only extension resources',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'himawari-setup-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const target=path.join(root,'extension');
 assert.equal(prepareExtension(path.resolve('extension'),target),target);
 fs.writeFileSync(path.join(target,'local-placeholder.txt'),'keep');
 assert.equal(prepareExtension(path.resolve('extension'),target),target);
 assert.equal(JSON.parse(fs.readFileSync(path.join(target,'manifest.json'))).version,'0.3.17');
 assert.ok(fs.existsSync(path.join(target,'icons','icon-128.png')));
 assert.equal(fs.existsSync(path.join(target,'extension-connections.json')),false);
});
async function mainFixture(t, options={}) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'himawari-main-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const source=path.resolve('src/main.js'), realRequire=createRequire(source), handlers=new Map(),events=new Map(),emitted=[];
 let generated=0,ready;
 const bridge=new EventEmitter();Object.assign(bridge,disconnected,{start:async()=>{},stop(){},revoke(){},cancelAccount(){},tasks:new Map()},options.bridge || {});
 const app={isPackaged:false,setPath(){},getPath:()=>root,getAppPath:()=>path.resolve('.'),requestSingleInstanceLock:()=>true,disableHardwareAcceleration(){},commandLine:{appendSwitch(){}},whenReady:()=>({then:fn=>{ready=fn;}}),on:(name,fn)=>events.set(name,fn),quit(){}};
 class Window {constructor(){this.webContents={send:(channel,payload)=>emitted.push({channel,payload}),on(){}};}loadFile(){}isDestroyed(){return false;}static getAllWindows(){return [];}}
 const context=vm.createContext({__dirname:path.dirname(source),Buffer,console,URL,setTimeout,clearTimeout,setInterval,clearInterval,process:{...process,env:{...process.env,BLOGAUTO_RUNTIME_ROOT:root,BLOGAUTO_USER_DATA:root,BLOGAUTO_AUTOSTART:'0',BLOGAUTO_SKIP_CODEX_USAGE_REFRESH:'1'}},require:name=>{
  if(name==='electron')return {app,BrowserWindow:Window,ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},shell:{},dialog:{}};
  if(name==='./lib/extensionBridge')return {configureBridge:()=>bridge,getBridge:()=>bridge};
  if(name==='./lib/desktopPublisher')return Object.fromEntries(Object.entries(desktop).map(([name,fn])=>[name,typeof fn==='function'?options=>fn({...options,bridge}):fn]));
  if(name==='./lib/codexRunner')return {runCodexGeneration:async args=>{generated++;if(options.generation)return options.generation(args,generated);throw new Error('unexpected generation');},fetchCodexUsageSnapshot:async()=>({})};
  if(name==='./lib/productReference' && options.generation)return {...realRequire(name),resolveProductReference:async()=>null};
  return realRequire(name);
 }});
 vm.runInContext(fs.readFileSync(source,'utf8'),context);await ready();
 return {root,handlers,context,emitted,generated:()=>generated};
}
test('fresh publication records success and clears pending state before the next automatic account',async t=>{
 const published=[];
 const {root,handlers,emitted,generated}=await mainFixture(t,{generation:async(_args,n)=>({status:'success',title:n===1?'배드민턴 셔틀콕':'은하 우주 망원경',article:'실제 생성 경계를 대신하는 검증용 원고 본문입니다.',bodyImages:[]}),bridge:{snapshot:()=>({connected:true}),clientFor:id=>({platform:'naver',blogId:id==='a'?'foo':'bar'}),request:async(id,type,payload)=>{
  if(type==='session')return {status:'valid',blogId:id==='a'?'foo':'bar',editorBuild:'20261008.1'};
  published.push(payload.title);return {published:true,url:`https://blog.naver.com/${id==='a'?'foo':'bar'}/123`};
 }}});
 writeAccountStore(root,{selectedAccountId:'a',accounts:[{id:'a',blogId:'foo',categories:[]},{id:'b',blogId:'bar',categories:[]}]});
 const {readSettings}=require('../src/lib/settings');
 const form={accountId:'a',blogId:'foo',category:'정보',keyword:'배드민턴',productModel:'V3',topic:'배드민턴',topicMode:'manual',publishAfterGenerate:true,includeTitleImage:false,maxBodyImages:1,referenceUrls:''};
 assert.equal((await handlers.get('job:start')(null,form)).status,'success',JSON.stringify(emitted.filter(e=>e.channel==='job:log').slice(-4)));
 assert.equal(readSettings(root).pendingNaverPublishDraft,null);
 assert.equal(require('../src/lib/history').readHistory(root).filter(row=>row.status==='success').length,1);
 assert.equal((await handlers.get('job:start')(null,{...form,accountId:'b',blogId:'bar',topicMode:'auto',topic:'',keyword:'우주'})).status,'success');
 assert.equal(generated(),2);assert.equal(published.length,2);assert.equal(readSettings(root).pendingNaverPublishDraft,null);
});
test('actual desktop IPC reports old valid account disconnected and blocks model calls before generation',async t=>{
 const {root,handlers,generated}=await mainFixture(t);
 writeAccountStore(root,{selectedAccountId:'a',accounts:[{id:'a',blogId:'foo',sessionStatus:'valid',categories:[{id:'c',name:'정보',keyword:'배드민턴'}]}]});
 const initial=await handlers.get('app:getInitialData')();
 assert.equal(initial.accountStore.accounts[0].connection.status,'disconnected');
 assert.equal(initial.accountStore.accounts[0].sessionStatus,'unknown');
 const result=await handlers.get('job:start')(null,{accountId:'a',blogId:'foo',category:'정보',keyword:'배드민턴',productModel:'V3',topic:'정보',topicMode:'manual',publishAfterGenerate:true});
 assert.equal(result.status,'extension_disconnected');assert.equal(generated(),0);
 for(const name of ['extension:setup','extension:pair','extension:cancel','extension:revoke','chrome:openAccount','tistory:open','tistory:pair','extension:connections','codex:startLogin','accounts:chooseSampleImage','settings:save'])assert.equal(typeof handlers.get(name),'function',name);
 assert.ok(initial.codexModels.some(m=>(m.value||m.id||m)==='gpt-6.1-sol'));
});
test('legacy pending article blocks fresh generation until explicit manual archive preserves it',async t=>{
 const {root,handlers,generated}=await mainFixture(t);
 const {writeSettings,readSettings}=require('../src/lib/settings');
 const draft={accountId:'a',blogId:'foo',title:'이전 원고',article:'기존 본문',bodyImages:[],status:'pending_naver_publish'};
 writeSettings(root,{pendingNaverPublishDraft:draft});
 const result=await handlers.get('job:start')(null,{accountId:'a',blogId:'foo',category:'정보',keyword:'배드민턴',productModel:'V3',topic:'정보',topicMode:'manual',publishAfterGenerate:true});
 assert.equal(result.status,'publish_uncertain');assert.equal(generated(),0);
 assert.equal((await handlers.get('pending:get')()).article,'기존 본문');
 const archived=await handlers.get('pending:archive')();
 assert.equal(JSON.parse(fs.readFileSync(archived.file)).article,'기존 본문');
 assert.equal(readSettings(root).pendingNaverPublishDraft,null);
});
