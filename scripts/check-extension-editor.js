const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {chromium} = require('playwright-core');
const {matchesNaverWriteUrl} = require('../extension/naver-route');
const {editorCommand} = require('../extension/editor');
const {runWriter} = require('../extension/writer');
const {articlePlan} = require('../extension/article-plan');
const {completeNaverDraft} = require('../extension/naver-draft');
const {tistoryCommand} = require('../extension/tistory');
const {ExtensionBridge} = require('../src/lib/extensionBridge');
const base='https://blog.naver.com';
test('Write matcher accepts same-blog authoring variants and rejects conflicts or Update',()=>{
 const cases=[
  ['/foo/postwrite',true],['/foo/postwrite/',true],['/foo?Redirect=Write',true],
  ['/foo?Redirect=Write&categoryNo=1',true],['/PostWriteForm.naver?blogId=foo',true],
  ['/PostWriteForm.nhn?blogId=foo&Redirect=Write',true],['/bar?Redirect=Write',false],
  ['/foo?Redirect=Update',false],['/foo/postwrite?Redirect=Update',false],
  ['/foo?Redirect=Write&blogId=bar',false],['/foo?Redirect=Write&Redirect=Update',false],
  ['/PostWriteForm.naver?blogId=foo&blogId=bar',false],['/foo',false],
 ];
 for(const [url,want] of cases)assert.equal(matchesNaverWriteUrl(base+url,'foo'),want,url);
 assert.equal(matchesNaverWriteUrl('https://blog.naver.com.evil/foo/postwrite','foo'),false);
});
function backgroundFixture(tabUrl) {
 const state={connection:{blogId:'foo',platform:'naver'},editorTab:7};const updates=[];
 const chrome={storage:{local:{get:async()=>state,set:async x=>Object.assign(state,x),remove:async()=>{}}},
  tabs:{get:async()=>({id:7,windowId:1,url:tabUrl}),query:async()=>[],update:async(id,data)=>{updates.push(JSON.parse(JSON.stringify(data)));return {id,windowId:1,url:tabUrl};},create:async()=>{throw new Error('unexpected new tab');},onUpdated:{addListener(){}}},
  windows:{update:async()=>{}},scripting:{executeScript:async()=>[{frameId:2,result:{status:'valid',editorBuild:'20261008.1',blogId:'foo'}}]},
  alarms:{create(){},onAlarm:{addListener(){}}},action:{onClicked:{addListener(){}}},runtime:{onStartup:{addListener(){}},onInstalled:{addListener(){}},onMessage:{addListener(){}}}};
 const context=vm.createContext({chrome,URL,AbortSignal,crypto:require('node:crypto').webcrypto,importScripts(){},editorCommand(){},matchesNaverWriteUrl,setInterval(){},clearInterval(){},setTimeout,console,fetch:async()=>({ok:true,json:async()=>({})})});
 vm.runInContext(fs.readFileSync(require.resolve('../extension/background.js'),'utf8'),context);
 return {context,updates};
}
test('already open outer Write iframe tab is activated and inspected without URL navigation, including preflight',async()=>{
 const {context,updates}=backgroundFixture(base+'/foo?Redirect=Write');
 assert.equal(await context.editorTab(true,{freshEditor:true}),7);
 assert.deepEqual(updates,[{active:true}]);
 assert.equal((await context.inspect(7)).status,'valid');
});
test('bridge keeps original-image flags without exposing local file paths',()=>{
 const bridge=Object.create(ExtensionBridge.prototype);
 const result=bridge.publicPayload({payload:{titleImagePath:'C:/runtime/image/title.png',titleIsReferenceOriginal:true,bodyImages:[{path:'C:/runtime/image/body.png',sequence:1,isReferenceOriginal:true}]}});
 assert.equal(result.titleIsReferenceOriginal,true);assert.equal(result.bodyImages[0].isReferenceOriginal,true);
 assert.equal(result.bodyImages[0].path,undefined);
});
let browser;
test.before(async()=>{browser=await chromium.launch({channel:'chrome',headless:true});});
test.after(async()=>{await browser?.close();});
async function pageFixture(t,html) {
 const context=await browser.newContext();t.after(()=>context.close());
 await context.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:(route.request().url().includes('.nhn')?html.replace(/<iframe.*?<\/iframe>/g,''):html)+`<script>${editorCommand.toString()}</script>`}));
 const page=await context.newPage();await page.goto(base+'/PostWriteForm.naver?blogId=foo');return page;
}
const run=(page,command,args)=>page.evaluate(({command,args})=>window.editorCommand(command,args),{command,args});
test('real Chrome verifies AI marks only for generated images and keeps reference original untouched',async t=>{
 const html=`<textarea placeholder="제목">제목</textarea><div class="se-section-text"><p class="se-text-paragraph">본문</p></div><div class="se-component-content">본문</div>
 <div id="original" class="se-component se-image"><img alt="original.png"><button class="se-set-ai-mark-button-toggle">AI</button></div>
 <div id="generated" class="se-component se-image"><img alt="generated.png"><button class="se-set-ai-mark-button-toggle">AI</button></div>
 <script>document.querySelectorAll('button').forEach(b=>b.onclick=()=>b.classList.toggle('se-is-selected'));</script>`;
 const page=await pageFixture(t,html);
 const result=await run(page,'imageAi',{imageAiFlags:[false,true]});assert.equal(result.ok,true);
 assert.equal(await page.locator('#original .se-is-selected').count(),0);
 assert.equal(await page.locator('#generated .se-is-selected').count(),1);
 const verified=await run(page,'verify',{title:'제목',article:'본문',imageCount:2,requireAi:true,imageAiFlags:[false,true]});
 assert.equal(verified.ok,true,JSON.stringify(verified));
 await page.locator('#generated button').click();
 assert.equal((await run(page,'verify',{title:'제목',article:'본문',imageCount:2,requireAi:true,imageAiFlags:[false,true]})).ok,false);
});
test('real Chrome Write iframe inspection reports exact target and rejects another blog',async t=>{
 const page=await pageFixture(t,`<iframe src="/PostWriteForm.nhn?blogId=foo"></iframe><textarea placeholder="제목"></textarea><div class="se-section-text"><p class="se-text-paragraph" contenteditable="true"></p></div>`);
 const frame=page.frames()[1];
 assert.equal((await run(frame,'inspect',{blogId:'foo'})).blogId,'foo');
 assert.equal((await run(frame,'inspect',{blogId:'bar'})).status,'account_mismatch');
});
test('writer preserves unrelated content, retries a no-op once and rejects partial input in real Chrome',async t=>{
 const page=await pageFixture(t,'<input id="title"><p id="body"></p>');
 const steps=[{type:'title',text:'제목'},{type:'paragraph',text:'완전한 본문'}];
 const read=()=>page.evaluate(()=>({title:document.querySelector('#title').value,blocks:document.querySelector('#body').textContent?[{id:'body',type:'paragraph',text:document.querySelector('#body').textContent}]:[]}));
 let calls=0;
 const apply=async block=>{calls++;if(calls===1)return;await page.evaluate(b=>{if(b.type==='title')document.querySelector('#title').value=b.text;else document.querySelector('#body').textContent=b.text;},block);};
 assert.equal((await runWriter({steps,read,apply,save:async()=>{},checkCancelled:async()=>{}})).complete,true);
 assert.equal(calls,3);
 await page.locator('#body').evaluate(e=>e.textContent='다른 원고');
 await assert.rejects(runWriter({steps,read,apply,save:async()=>{},checkCancelled:async()=>{},requireEmpty:true}),/비어 있지/);
 assert.equal(await page.locator('#body').textContent(),'다른 원고');
 await page.locator('#title').fill('');await page.locator('#body').evaluate(e=>e.textContent='');
 let partialCalls=0;
 await assert.rejects(runWriter({steps,read,apply:async b=>{partialCalls++;await page.evaluate(b=>{if(b.type==='title')document.querySelector('#title').value=b.text;else document.querySelector('#body').textContent='완전';},b);},save:async()=>{},checkCancelled:async()=>{}}));
 assert.equal(partialCalls,2);assert.equal(await page.locator('#body').textContent(),'완전');
});
test('article layout preserves reference/footer text; verified draft save requires clean editor and second list proof',async()=>{
 const article='첫 문장\n[SECTION - 안내]\n정보 본문\n[IMAGE INSERT - 1]\nhttps://example.com/reference\n제품 안내';
 assert.deepEqual(articlePlan(article).filter(b=>b.type!=='image').map(b=>b.text),['첫 문장','안내','정보 본문','https://example.com/reference','제품 안내']);
 let saved=0,reloaded=0,verified=0;
 const proof={saved:true,verification:'draft-list',title:'제목',savedAt:'2026.10.08 12:00'};
 const result=await completeNaverDraft({title:'제목',save:async()=>{saved++;return proof;},verify:async()=>{verified++;return proof;},ready:async()=>({ready:true}),reload:async()=>{reloaded++;},checkpoint:async()=>{},pause:async()=>{}});
 assert.equal(result.cleanupComplete,true);assert.equal(saved,1);assert.equal(reloaded,1);assert.equal(verified,1);
 await assert.rejects(completeNaverDraft({title:'제목',save:async()=>({saved:true}),checkpoint:async()=>{throw new Error('must not checkpoint');}}),/증거/);
});
test('real Chrome completion proves exact Naver URL and matching reservation title/time',async t=>{
 const page=await pageFixture(t,'<textarea placeholder="제목">새 제목</textarea><div class="se-section-text"><p class="se-text-paragraph"></p></div>');
 await page.goto(base+'/foo/123');
 assert.equal((await run(page,'published',{blogId:'foo',title:'새 제목'})).complete,true);
 assert.equal((await run(page,'published',{blogId:'bar',title:'새 제목'})).complete,false);
 await page.goto(base+'/foo?Redirect=Write');
 await page.locator('body').evaluate(e=>e.insertAdjacentHTML('beforeend',`<button data-click-area="tpb*t.schedulelist"><strong>새 제목</strong><span class="date">2026. 10. 08 12:30</span></button>`));
 const scheduledAt=new Date(2026,9,8,12,30).toISOString();
 const proof=await run(page,'reserved',{blogId:'foo',title:'새 제목',scheduledAt});
 assert.equal(proof.complete,true);assert.equal(proof.verification,'reservation-list');assert.equal(proof.scheduledAt,scheduledAt);
 assert.equal((await run(page,'reserved',{blogId:'foo',title:'다른 제목',scheduledAt})).complete,false);
});
test('real Chrome Tistory completion rejects wrong status and proves reservation row',async t=>{
 const context=await browser.newContext();t.after(()=>context.close());
 await context.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<ul><li><div class="post_cont"><div class="tit_post"><a class="link_cont" title="새 글" href="https://foo.tistory.com/123">새 글<span class="info_status">[예약]</span></a></div><span class="txt_info">2026.10.08 12:30</span></div><div class="post_btn"><button class="btn_opt"></button></div></li></ul><script>${tistoryCommand.toString()}</script>`}));
 const page=await context.newPage();await page.goto('https://foo.tistory.com/manage/posts/');
 const args={blogId:'foo',title:'새 글',publishVisibility:'public',publishScheduleMode:'reserve',scheduledAt:new Date(2026,9,8,12,30).toISOString()};
 const result=await page.evaluate(args=>window.tistoryCommand('published',args),args);
 assert.equal(result.complete,true);assert.equal(result.verification,'reservation-list');
 assert.equal((await page.evaluate(args=>window.tistoryCommand('published',args),{...args,publishScheduleMode:'now'})).complete,false);
});
