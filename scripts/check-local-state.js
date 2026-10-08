const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const {writeJsonAtomic}=require('../src/lib/atomicJson');
const {writeSettings,readSettings}=require('../src/lib/settings');
const {writeAccountStore,readAccountStore}=require('../src/lib/accountStore');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'himawari-state-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('failed atomic replacement leaves exact prior settings/account bytes and pending article intact',t=>{
 const root=fixture(t),pending={title:'보류 제목',article:'보류 본문',publications:{naver:{status:'running'}}};
 writeSettings(root,{topicMode:'manual',topic:'직접 주제',publishAfterGenerate:false,productModel:'0424',codexModel:'gpt-6.1-sol',pendingNaverPublishDraft:pending});
 writeAccountStore(root,{accounts:[{id:'a',blogId:'foo',referenceImages:[{id:'i',path:'C:/runtime/photo.png',hash:'hash'}],categories:[{id:'c',name:'정보',keyword:'관심사'}]}]});
 const settingsFile=path.join(root,'user-settings.json'),accountsFile=path.join(root,'account-categories.json');
 const settingsBytes=fs.readFileSync(settingsFile),accountsBytes=fs.readFileSync(accountsFile);
 const rename=fs.renameSync;fs.renameSync=()=>{throw new Error('forced replacement failure');};
 try {
  assert.throws(()=>writeSettings(root,{topic:'changed',pendingNaverPublishDraft:null}),/forced replacement failure/);
  assert.throws(()=>writeAccountStore(root,{accounts:[]}),/forced replacement failure/);
 }finally{fs.renameSync=rename;}
 assert.deepEqual(fs.readFileSync(settingsFile),settingsBytes);assert.deepEqual(fs.readFileSync(accountsFile),accountsBytes);
 const settings=readSettings(root);assert.equal(settings.topic,'직접 주제');assert.equal(settings.publishAfterGenerate,false);assert.equal(settings.productModel,'0424');assert.equal(settings.codexModel,'gpt-6.1-sol');assert.equal(settings.pendingNaverPublishDraft.article,'보류 본문');
 assert.equal(readAccountStore(root).accounts[0].referenceImages[0].hash,'hash');
 assert.equal(fs.readdirSync(root).some(f=>f.endsWith('.tmp')),false);
});
test('atomic JSON cleans only its own temporary file and flushes before replacement',t=>{
 const root=fixture(t),file=path.join(root,'state.json'),other=path.join(root,'unrelated.tmp');fs.writeFileSync(other,'keep');
 writeJsonAtomic(file,{value:'first'});
 const sync=fs.fsyncSync;let flushed=0;fs.fsyncSync=fd=>{flushed++;return sync(fd);};
 try{writeJsonAtomic(file,{value:'second'});}finally{fs.fsyncSync=sync;}
 assert.equal(flushed,1);assert.equal(JSON.parse(fs.readFileSync(file)).value,'second');assert.equal(fs.readFileSync(other,'utf8'),'keep');
});
test('legacy credential cleanup keeps sanitized memory and previous valid disk file on replacement failure',t=>{
 const root=fixture(t),file=path.join(root,'user-settings.json');const bytes=JSON.stringify({blogId:'foo',naverPassword:'legacy',topic:'keep',pendingNaverPublishDraft:{article:'keep article'}});fs.writeFileSync(file,bytes);
 const rename=fs.renameSync;fs.renameSync=()=>{throw new Error('read-only destination');};
 try{const settings=readSettings(root);assert.equal(settings.naverPassword,undefined);assert.equal(settings.pendingNaverPublishDraft.article,'keep article');}finally{fs.renameSync=rename;}
 assert.equal(fs.readFileSync(file,'utf8'),bytes);
});
function usageRunner(root) {
 const file=path.resolve('src/lib/codexRunner.js'),realRequire=createRequire(file);let spawned=0;
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,exports:module.exports,process:{...process,env:{...process.env,CODEX_HOME:root}},Buffer,URL,setTimeout,clearTimeout,console,require:name=>name==='node:child_process'?{spawn:()=>{spawned++;throw new Error('usage display attempted inference');}}:realRequire(name)});
 return {fetch:module.exports.fetchCodexUsageSnapshot,count:()=>spawned};
}
test('empty local usage records return unavailable without spawning inference',async t=>{
 const root=fixture(t),runner=usageRunner(root);
 const snapshot=await runner.fetch({codexCmdPath:'must-not-run.cmd'});
 assert.equal(snapshot.source,'unavailable');assert.equal(snapshot.rateLimits,null);assert.equal(runner.count(),0);
});
test('existing local session rate limits are returned without any child process',async t=>{
 const root=fixture(t);fs.mkdirSync(path.join(root,'sessions'));
 fs.writeFileSync(path.join(root,'sessions','session.jsonl'),JSON.stringify({timestamp:'2026-10-08T10:00:00Z',type:'event_msg',payload:{type:'token_count',rate_limits:{primary:{used_percent:25,window_minutes:300,resets_at:1791500400},secondary:{used_percent:40,window_minutes:10080,resets_at:1792000000}}}})+'\n');
 const runner=usageRunner(root),snapshot=await runner.fetch();assert.equal(snapshot.source,'codex-session');assert.equal(snapshot.rateLimits.primary.usedPercent,25);assert.equal(runner.count(),0);
});
