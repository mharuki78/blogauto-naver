const test=require('node:test');
const assert=require('node:assert/strict');
const {publishSequence}=require('../src/lib/publishSequence');
const {confirmedPublication,recoverPendingPublication}=require('../src/lib/publishRecovery');
const draft={accountId:'a',blogId:'foo',tistoryBlogId:'bar',title:'제목',article:'본문',publishVisibility:'public',publishToTistoryAfterNaver:true,publications:{}};
const naver={published:true,url:'https://blog.naver.com/foo/123'};
const tistory={published:true,url:'https://bar.tistory.com/456'};
test('Naver success followed by Tistory failure retries Tistory only and preserves both proofs',async()=>{
 let saved,n=0,t=0;
 const options={save:async state=>{saved=structuredClone(state);},naver:async()=>{n++;return naver;},tistory:async()=>{t++;if(t===1)throw new Error('upload failed');return tistory;}};
 await assert.rejects(publishSequence(draft,options),/upload failed/);
 assert.equal(saved.publications.naver.status,'done');assert.equal(saved.publications.tistory.status,'failed');
 const result=await publishSequence(saved,options);assert.equal(n,1);assert.equal(t,2);assert.equal(result.publications.tistory.status,'done');
});
test('wrong post target, missing reservation proof and mismatched draft outcome are uncertain',async()=>{
 for(const result of [{published:true},{published:true,url:'https://blog.naver.com/other/123'},{published:true,url:'https://evil.example/foo/123'},{published:true,scheduled:true,scheduledAt:new Date().toISOString(),managementUrl:'https://blog.naver.com/foo/postwrite'}, {saved:true,published:false,title:'제목',savedAt:'now',verification:'draft-list',cleanupComplete:true}]){
  let saved;
  await assert.rejects(publishSequence({...draft,publishToTistoryAfterNaver:false},{save:async s=>{saved=structuredClone(s);},naver:async()=>result}),{code:'PUBLISH_UNCERTAIN'});
  assert.equal(saved.publications.naver.status,'uncertain');
 }
 assert.equal(confirmedPublication(naver,{platform:'naver',blogId:'foo',title:'제목'}),true);
});
test('running journal after final click never calls publish again',async()=>{
 const pending={...draft,publications:{naver:{status:'running'}}};let calls=0;
 const bridge={tasks:new Map([['one',{type:'publish',accountId:'a',blogId:'foo',platform:'naver',state:'interrupted',stage:'final_publish',payload:draft}]]),request:async()=>{calls++;throw new Error('must not enqueue');}};
 await assert.rejects(recoverPendingPublication(pending,{bridge,save:async()=>{}}),{code:'PUBLISH_UNCERTAIN'});assert.equal(calls,0);
 await assert.rejects(publishSequence(pending,{save:async()=>{},naver:async()=>{calls++;}}),{code:'PUBLISH_UNCERTAIN'});assert.equal(calls,0);
});
test('durable pre-final interruption can resume; absent or legacy journals cannot',async()=>{
 const pending={...draft,publishToTistoryAfterNaver:false,publications:{naver:{status:'running'}}};
 const bridge={tasks:new Map([['one',{type:'publish',accountId:'a',blogId:'foo',platform:'naver',state:'interrupted',stage:'writing',payload:draft}]])};
 const recovered=await recoverPendingPublication(pending,{bridge,save:async()=>{}});assert.equal(recovered.publications.naver.status,'failed');
 bridge.tasks.clear();await assert.rejects(recoverPendingPublication(pending,{bridge,save:async()=>{}}),{code:'PUBLISH_UNCERTAIN'});
 await assert.rejects(recoverPendingPublication({...draft,publications:undefined},{bridge,save:async()=>{}}),{code:'PUBLISH_UNCERTAIN'});
});
test('verified reservation recovery checks the list without publishing and resolves exact journal',async()=>{
 const date='2026-10-08T12:00:00.000Z';
 const task={type:'publish',accountId:'a',blogId:'foo',platform:'naver',state:'interrupted',stage:'final_publish',payload:{...draft,publishScheduleMode:'reserve',scheduledAt:date}};
 const requests=[];
 const bridge={tasks:new Map([['one',task]]),saveTasks(){},request:async(id,type,payload)=>{
  requests.push(type);assert.equal(id,'a');
  if(type==='session')return {status:'valid',blogId:'foo',editorBuild:'20261008.1'};
  assert.equal(payload.scheduledAt,date);return {published:true,scheduled:true,verification:'reservation-list',scheduledAt:date,managementUrl:'https://blog.naver.com/foo/postwrite'};
 }};
 let saved;
 const result=await recoverPendingPublication({...draft,publishScheduleMode:'reserve',publishToTistoryAfterNaver:false,publications:{naver:{status:'uncertain'}}},{bridge,save:async s=>{saved=s;}});
 assert.deepEqual(requests,['session','verifyPublish']);assert.equal(result.publications.naver.status,'done');assert.equal(task.state,'done');assert.equal(saved.title,'제목');
});
test('a done journal with wrong target cannot be recovered as success; done platform state must retain proof',async()=>{
 const bridge={tasks:new Map([['one',{type:'publish',accountId:'a',blogId:'foo',state:'done',payload:draft,result:{published:true,url:'https://blog.naver.com/bar/123'}}]])};
 await assert.rejects(recoverPendingPublication({...draft,publications:{naver:{status:'running'}}},{bridge,save:async()=>{}}),{code:'PUBLISH_UNCERTAIN'});
 await assert.rejects(publishSequence({...draft,publications:{naver:{status:'done'}}},{save:async()=>{},naver:async()=>naver}),{code:'PUBLISH_UNCERTAIN'});
});
test('save failure after final result never downgrades confirmed publication to a retryable failure',async()=>{
 let saves=0;
 await assert.rejects(publishSequence({...draft,publishToTistoryAfterNaver:false},{save:async()=>{if(++saves===2)throw new Error('disk full');},naver:async()=>naver}),{code:'PUBLISH_UNCERTAIN'});
 assert.equal(saves,2);
});
