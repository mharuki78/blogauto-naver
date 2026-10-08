importScripts('naver-route.js','naver-draft.js','editor.js','article-plan.js','writer.js','tistory.js','tistory-writer.js');
const API = 'http://127.0.0.1:46321';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let busy = false;
let refreshSession = false;
const stored = () => chrome.storage.local.get(['connection','deviceId','session','editorTab','completedEditorTab','activeTask','pendingResult','connectionError']);
async function api(route, body = {}, override) {
  const c = override || (await stored()).connection;
  const response = await fetch(API + route, { method: 'POST', headers: { 'Content-Type':'application/json', ...(c ? {Authorization:`Bearer ${c.token}`} : {}) }, body:JSON.stringify(body), signal:AbortSignal.timeout(10000) });
  const data = await response.json(); if (!response.ok) throw Object.assign(new Error(data.error || '앱 연결 오류'),{httpStatus:response.status}); return data;
}
async function preserveRevokedWork() {
  const state=await stored();
  if(state.activeTask || state.pendingResult)await chrome.storage.local.set({revokedWork:{activeTask:state.activeTask,pendingResult:state.pendingResult,revokedAt:new Date().toISOString()}});
  await chrome.storage.local.remove(['connection','session','editorTab','activeTask','pendingResult']);
}
async function frameResults(tabId, command, args = {}) {
  const results = await chrome.scripting.executeScript({target:{tabId,allFrames:true},func:editorCommand,args:[command,args]});
  return results.map(item=>({...item.result,frameId:item.frameId,...(!item.result?{status:'unknown',reason:'확장 페이지 응답 없음 · frame '+item.frameId}:{} )}));
}
async function tistoryRun(tabId,command,args) {
  const results=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:tistoryCommand,args:[command,args]});
  return results[0]?.result || {error:'티스토리 페이지 응답 없음'};
}
async function inspect(tabId) {
  const state=await stored();
  if(state.connection?.platform==='tistory')return tistoryRun(tabId,'inspect',{blogId:state.activeTask?.blogId || state.connection.blogId});
  const {connection} = await stored(); const tab = await chrome.tabs.get(tabId); const url = new URL(tab.url);
  if (url.hostname !== 'nid.naver.com' && !matchesNaverWriteUrl(tab.url,connection.blogId)) return {status:'unknown',reason:'대상 블로그 글쓰기 화면으로 이동해 주세요.'};
  const results = await frameResults(tabId,'inspect',{blogId:connection.blogId});
  return results.find(r=>['security_check','expired','account_mismatch'].includes(r.status)) || results.find(r=>r.status==='valid') || results.find(r=>r.diagnostics?.componentCount) || results[0];
}
async function editorTab(interactive = false,task) {
  const current=await stored();
  const tistory=current.connection?.platform==='tistory';
  const blogId=task?.blogId || current.connection.blogId;
  const host=tistory?blogId+'.tistory.com':'blog.naver.com';
  const url=tistory?`https://${host}/manage/post`:`https://${host}/${encodeURIComponent(blogId)}/postwrite`;
  const kind=tab=>{
    let u;try{u=new URL(tab.url || 'about:blank');}catch{return '';}
    if(!tistory && u.hostname==='nid.naver.com')return 'login';
    if(u.hostname!==host)return '';
    if(tistory){
      if(/^\/manage\/(?:post|newpost)\/?$/.test(u.pathname))return 'editor';
      if(/^\/$|^\/\d+\/?$|^\/manage\/?$|^\/manage\/posts\/?$/.test(u.pathname))return 'read';
      return '';
    }
    if(matchesNaverWriteUrl(tab.url,blogId))return 'editor';
    const queryIds=u.searchParams.getAll('blogId');
    if(queryIds.length>1 || queryIds.some(id=>id!==blogId) || u.searchParams.has('Redirect'))return '';
    const own=u.pathname.split('/')[1]===blogId || u.searchParams.get('blogId')===blogId;
    if(!own)return '';
    if(u.pathname===`/${blogId}` || new RegExp('^/'+blogId.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'/\\d+/?$').test(u.pathname) || /^\/(PostView|PostList)\.naver$/i.test(u.pathname))return 'read';
    return '';
  };
  let tab=current.editorTab?await chrome.tabs.get(current.editorTab).catch(()=>null):null;
  // Tistory shares one login across destinations. Only our tracked read-only
  // tab may cross blogs; never navigate an editor with another blog's draft.
  let sharedRead=false;
  if(tistory && tab){
    try{const u=new URL(tab.url);sharedRead=/^[a-zA-Z0-9-]+\.tistory\.com$/.test(u.hostname) && /^\/$|^\/\d+\/?$|^\/manage\/?$|^\/manage\/posts\/?$/.test(u.pathname);}catch{}
  }
  if(tab && !kind(tab) && !sharedRead)tab=null;
  if(!tab){
    const tabs=await chrome.tabs.query({url:`https://${host}/*`});
    tab=tabs.find(t=>kind(t)==='editor') || tabs.find(t=>kind(t)==='read');
  }
  if(!tab)tab=await chrome.tabs.create({url,active:interactive});
  else {
    // Only completed authoring or a read-only blog page can be navigated.
    // An unfinished editor stays intact for writer-prefix recovery.
    let completed=false;
    if(!task?.freshEditor && kind(tab)==='editor' && current.completedEditorTab?.id===tab.id && current.completedEditorTab?.url===tab.url && current.completedEditorTab.snapshot){
      const snapshot=await command(tab.id,'snapshot',{blogId}).catch(()=>null);
      completed=Boolean(snapshot && JSON.stringify(snapshot)===JSON.stringify(current.completedEditorTab.snapshot));
    }
    if(sharedRead || kind(tab)==='read' || (kind(tab)==='editor' && completed)){
      tab=await chrome.tabs.update(tab.id,{url,active:interactive});
      await chrome.storage.local.remove('completedEditorTab');
    }else if(interactive)await chrome.tabs.update(tab.id,{active:true});
    if(interactive)await chrome.windows.update(tab.windowId,{focused:true});
  }
  await chrome.storage.local.set({editorTab:tab.id}); return tab.id;
}
async function inspectSession(tabId) {
  let result;
  for (let n=0;n<6;n++) {result=await inspect(tabId).catch(error=>({status:'unknown',reason:`편집기 확인 실패: ${error.message}`})); if(result.status!=='unknown')break; await sleep(500);}
  const diagnostic=await chrome.storage.local.get('titleProbeBuild');
  if((await stored()).connection?.platform!=='tistory' && result?.status==='valid' && diagnostic.titleProbeBuild!=='20260927.7' && !(await stored()).activeTask){
    const probe=(await chrome.scripting.executeScript({target:{tabId,frameIds:[result.frameId]},func:editorCommand,args:['probeTitle',{}]}).catch(()=>[]))[0]?.result;
    if(probe?.ok){result.reason=probe.reason;await chrome.storage.local.set({titleProbeBuild:'20260927.7'});}
  }
  const session={...result,checkedAt:new Date().toISOString()}; await chrome.storage.local.set({session});return session;
}
async function command(tabId,command,args={}) {
  const state=await stored();
  if(state.connection?.platform==='tistory'){
    const result=await tistoryRun(tabId,command,{...args,blogId:args.blogId || state.activeTask?.blogId || state.connection.blogId});
    if(!result.ok)throw new Error(result.error || result.reason || '티스토리 작업 실패');return result;
  }
  const editor=await inspect(tabId);
  if(editor.status!=='valid')throw new Error(editor.reason || '글쓰기 계정을 확인할 수 없습니다.');
  const injected=await chrome.scripting.executeScript({target:{tabId,frameIds:[editor.frameId]},func:editorCommand,args:[command,args]});
  const results=injected.map(r=>r.result || {error:command+': 확장 페이지 응답 없음 · frame '+r.frameId+' · '+(r.error?.message || '주입 도중 예외 또는 페이지 이동')}); const success=results.find(r=>r.ok);
  if(!success)throw new Error(results.find(r=>r.error)?.error || `${command}: 편집기 반영을 확인하지 못했습니다.`); return success;
}
async function finish(result) {
  if(result.result?.published===true){
    const state=await stored();
    const tab=state.activeTask?.tabId?await chrome.tabs.get(state.activeTask.tabId).catch(()=>null):null;
    if(tab){
      const snapshot=await command(tab.id,'snapshot',{blogId:state.activeTask.blogId}).catch(()=>null);
      await chrome.storage.local.set({completedEditorTab:{id:tab.id,url:tab.url,snapshot}});
    }
  }
  await chrome.storage.local.set({pendingResult:result}); await api('/result',result);
  await chrome.storage.local.remove(['pendingResult','activeTask']);
}
async function verifyReservation(task) {
  if(task.payload.publishScheduleMode!=='reserve')throw new Error('예약 발행 확인 요청이 아닙니다.');
  const isTistory=task.platform==='tistory';
  const tab=await chrome.tabs.create({url:isTistory?`https://${task.blogId}.tistory.com/manage/posts/`:`https://blog.naver.com/${encodeURIComponent(task.blogId)}/postwrite`,active:false});
  let reason='예약 목록을 확인하지 못했습니다.';
  try {
    for(let n=0;n<30;n++){
      await sleep(500);
      const args={blogId:task.blogId,title:task.payload.title,scheduledAt:task.payload.scheduledAt,publishScheduleMode:'reserve',publishVisibility:task.payload.publishVisibility || 'public'};
      const results=isTistory
        ? [await tistoryRun(tab.id,'published',args).catch(()=>null)].filter(Boolean)
        : await frameResults(tab.id,'reserved',args).catch(()=>[]);
      const done=results.find(r=>r.complete);
      if(done){const {complete,frameId,...result}=done;return {...result,published:true};}
      reason=results.find(r=>r.reason)?.reason || reason;
    }
    throw Object.assign(new Error(reason+' 자동으로 재발행하지 않습니다.'),{code:'PUBLISH_UNCERTAIN'});
  }finally{await chrome.tabs.remove(tab.id).catch(()=>{});}
}
async function saveNaverDraft(task,resumeOnly=false) {
  const run=async action=>{
    const editor=await inspect(task.tabId);
    if(editor.status!=='valid')throw new Error(editor.reason || '임시저장 편집기를 확인하지 못했습니다.');
    const results=await chrome.scripting.executeScript({target:{tabId:task.tabId,frameIds:[editor.frameId]},func:draftEditorCommand,args:[action,{title:task.payload.title}]});
    const r=results[0]?.result;if(!r?.ok)throw new Error(r?.error || '임시저장 편집기 응답 없음');return r;
  };
  await api('/stage',{id:task.id,stage:'final_publish'});
  await chrome.storage.local.set({activeTask:{...task,stage:resumeOnly?'draft_saved':'final_publish'}});
  return completeNaverDraft({title:task.payload.title,
    save:resumeOnly?null:()=>run('save'),verify:()=>run('verifySaved'),ready:()=>run('ready'),pause:sleep,
    checkpoint:async proof=>{await chrome.storage.local.set({activeTask:{...task,stage:'draft_saved',draftProof:proof}});await api('/progress',{id:task.id,message:'네이버 임시저장 목록 확인 완료 · 새로고침 후 이어쓰기 취소'});},
    reload:async()=>{await chrome.scripting.executeScript({target:{tabId:task.tabId},world:'MAIN',func:reloadSavedDraftPage});await chrome.tabs.reload(task.tabId);}
  });
}
async function publish(task) {
  if(task.platform==='tistory')return publishTistory(task);
  const tabId=task.tabId, p=task.payload;
  const plan=articlePlan(p.article);
  const steps=[{type:'title',text:p.title},{type:'quote',text:p.title,style:'default'}];
  if(p.titleImageIndex!==null)steps.push({type:'image',index:p.titleImageIndex,name:p.titleImageName || 'blog_img_title.png',aiGenerated:p.titleIsReferenceOriginal!==true});
  for(const block of plan){
    if(block.type==='image'){const asset=p.bodyImages.find(i=>Number(i.sequence)===block.sequence);if(asset?.index>=0)steps.push({type:'image',index:asset.index,name:asset.name || 'blog_img_'+block.sequence+'.png',aiGenerated:asset.isReferenceOriginal!==true});}
    else steps.push({...block,type:block.type==='section'?'quote':'paragraph'});
  }
  if(steps.filter(s=>s.type==='image').length!==p.bodyImages.filter(i=>i.index>=0).length+(p.titleImageIndex!==null?1:0))throw new Error('본문 이미지와 원고의 이미지 위치가 일치하지 않습니다. 원고를 보존합니다.');
  await runWriter({steps,requireEmpty:true,
    read:()=>command(tabId,'snapshot'),
    apply:async(block,anchor)=>{
      if(block.type==='image'){
        const {connection}=await stored();const response=await fetch(API+'/asset?task='+task.id+'&index='+block.index,{headers:{Authorization:'Bearer '+connection.token},signal:AbortSignal.timeout(15000)});
        if(!response.ok)throw new Error('이미지를 가져오지 못했습니다.');return command(tabId,'image',{...await response.json(),...anchor,aiGenerated:block.aiGenerated});
      }
      return command(tabId,block.type,{...block,...anchor,breakSentences:p.breakSentencesInBody});
    },
    save:checkpoint=>chrome.storage.local.set({authoringCheckpoint:{...checkpoint,blogId:task.blogId,title:p.title,taskId:task.id}}),
    onProgress:(done,total,type)=>type==='paragraph' && done!==total ? undefined : api('/progress',{id:task.id,message:`네이버 ${done}/${total} · ${type==='image'?'이미지':type==='quote'?'제목·섹션':'본문'} 입력 확인 완료`}),
    checkCancelled:async()=>{if((await api('/task/status',{id:task.id})).state!=='running')throw new Error('작업이 취소되었습니다. 입력한 내용은 보존됩니다.');}
  });
  const imageAiFlags=steps.filter(s=>s.type==='image').map(s=>s.aiGenerated);
  await command(tabId,'imageAi',{imageAiFlags});
  await command(tabId,'verify',{title:p.title,article:p.article,plan,titleQuote:true,requireAi:true,imageAiFlags,sectionStyle:'quotation_line',imageCount:imageAiFlags.length});
  if(p.publishVisibility==='draft')return saveNaverDraft(task);
  await command(tabId,'click',{selector:'button[data-click-area="tpb.publish"], button[class*="publish_btn__"]',skipIfSelector:'button[data-testid="seOnePublishBtn"]'}); await sleep(400);
  await command(tabId,'settings',p);
  if((await inspect(tabId)).status!=='valid')throw new Error('로그인 상태가 변경되었습니다. 작성된 글을 확인하세요.');
  await api('/stage',{id:task.id,stage:'final_publish'});
  await chrome.storage.local.set({activeTask:{...task,stage:'final_publish'}});
  await command(tabId,'click',{selector:'button[data-testid="seOnePublishBtn"], button[data-click-area="tpb*i.publish"]'});
  if(p.publishScheduleMode==='reserve')return verifyReservation(task);
  let refreshed=false;
  for(let n=0;n<45;n++){
    await sleep(1000);
    const results=await frameResults(tabId,'published',{blogId:task.blogId,title:p.title}).catch(()=>[]);
    const done=results.find(r=>r.complete);if(done)return {published:true,url:done.url};
    const stale=results.find(r=>r.refreshUrl);
    if(stale && !refreshed){refreshed=true;await chrome.tabs.update(tabId,{url:stale.refreshUrl});}
  }
  throw Object.assign(new Error('발행 결과가 불확실합니다. 예약 목록 또는 게시글을 확인하세요. 자동 재발행하지 않습니다.'),{code:'PUBLISH_UNCERTAIN'});
}
async function prepareFreshNaver(task) {
  if(!task.editorResetStarted){
    task.tabId=await editorTab(Boolean(task.payload.interactive || task.type==='publish'),{...task,freshEditor:true});
    task.editorResetStarted=true;
    await chrome.storage.local.remove(['authoringCheckpoint','completedEditorTab']);
    await chrome.storage.local.set({activeTask:{...task,stage:'waiting_login'}});
    await api('/progress',{id:task.id,message:'글쓰기 화면을 새로 열어 처음부터 입력할 준비를 합니다. 저장된 본문과 이미지를 재사용합니다.'});
    await sleep(700);
  }
  for(let n=0;n<40;n++){
    if((await api('/task/status',{id:task.id})).state!=='running')throw new Error('작업이 취소되었습니다.');
    const tab=await chrome.tabs.get(task.tabId);
    if(tab.status==='loading'){await sleep(500);continue;}
    try {
      const dialogs=await frameResults(task.tabId,'dismissResume');
      const blocked=dialogs.find(r=>r.error);if(blocked)throw Object.assign(new Error(blocked.error),{stop:true});
      if(dialogs.some(r=>r.dismissed)){await sleep(500);continue;}
      const session=await inspect(task.tabId);
      if(['expired','security_check','account_mismatch'].includes(session.status))return {...session,checkedAt:new Date().toISOString()};
      if(session.status==='valid'){
        if(session.hasContent)throw Object.assign(new Error('새 글쓰기 화면에 이전 내용이 남아 있습니다. 임시글 이어쓰기를 취소한 뒤 다시 시작해 주세요.'),{stop:true});
        return {...session,checkedAt:new Date().toISOString()};
      }
    }catch(error){if(error.stop)throw error;}
    await sleep(500);
  }
  throw new Error('새 글쓰기 화면을 준비하지 못했습니다. Chrome의 로그인·알림을 확인한 뒤 작업 시작을 눌러 주세요.');
}
async function resume(task) {
  const state=await api('/task/status',{id:task.id});if(state.state!=='running'){await chrome.storage.local.remove('activeTask');return;}
  const fresh=task.platform!=='tistory' && (task.type==='publish' || task.payload.preflightTitle);
  let session;
  try{session=fresh?await prepareFreshNaver(task):await inspectSession(task.tabId);}
  catch(error){return finish({id:task.id,error:error.message,code:'EDITOR_PREPARATION_FAILED'});}
  if(session.status!=='valid') {
    if(['unknown','account_mismatch'].includes(session.status) && !task.payload.interactive) return finish({id:task.id,result:session});
    const tab=await chrome.tabs.get(task.tabId).catch(()=>null);
    if(!tab){task.tabId=await editorTab(true,task);}
    else if(tab.url && new URL(tab.url).hostname==='www.naver.com'){
      await chrome.tabs.update(task.tabId,{url:`https://blog.naver.com/${task.blogId}/postwrite`});
    }
    await api('/waiting',{id:task.id,reason:session.reason,status:session.status});
    await chrome.storage.local.set({activeTask:{...task,stage:'waiting_login'}});return;
  }
  if(task.type==='session'){
    if(task.platform!=='tistory' && task.payload.preflightTitle){
      try{await command(task.tabId,'preflightTitle');}
      catch(error){return finish({id:task.id,error:error.message,code:'NAVER_PREFLIGHT_FAILED'});}
    }
    if(task.platform==='tistory'){
      try{await command(task.tabId,'preflight',{blogId:task.blogId,category:task.payload.category});}
      catch(error){return finish({id:task.id,error:error.message,code:'TISTORY_PREFLIGHT_FAILED'});}
    }
    return finish({id:task.id,result:session});
  }
  await api('/stage',{id:task.id,stage:'writing'});await chrome.storage.local.set({activeTask:{...task,stage:'writing'}});
  try {await finish({id:task.id,result:await publish(task)});}catch(error){
    const current=(await stored()).activeTask; await finish({id:task.id,error:error.message,code:['final_publish','draft_saved'].includes(current?.stage)?'PUBLISH_UNCERTAIN':error.code || 'AUTHORING_FAILED'});
  }
}
async function pump() {
  if(busy)return;busy=true;let heartbeat;
  try {
    let state=await stored(); if(!state.connection)return;
    await api('/heartbeat'); heartbeat=setInterval(()=>api('/heartbeat').catch(()=>{}),20000);
    if(state.pendingResult){await api('/result',state.pendingResult);await chrome.storage.local.remove(['pendingResult','activeTask']);state=await stored();}
    if(state.activeTask){
      if(['waiting_login','writing'].includes(state.activeTask.stage)){
        const task=state.activeTask;
        if(task.stage==='writing' && task.platform!=='tistory')task.editorResetStarted=false;
        await resume(task);
      }
      else if(state.activeTask.stage==='draft_saved'){
        try{await finish({id:state.activeTask.id,result:await saveNaverDraft(state.activeTask,true)});}
        catch(error){await finish({id:state.activeTask.id,error:error.message,code:'PUBLISH_UNCERTAIN'});}
      }
      else if(state.activeTask.payload.publishScheduleMode==='reserve'){
        try{await finish({id:state.activeTask.id,result:await verifyReservation(state.activeTask)});}
        catch(error){await finish({id:state.activeTask.id,error:error.message,code:'PUBLISH_UNCERTAIN'});}
      }
      else await finish({id:state.activeTask.id,error:'작성 중 확장이 재시작되었습니다. 열린 글을 확인하세요. 자동으로 재발행하지 않습니다.',code:'PUBLISH_UNCERTAIN'});
      return;
    }
    const {task}=await api('/poll',{session:state.session});
    if(task){
      if(task.type==='verifyPublish'){
        await chrome.storage.local.set({activeTask:{...task,stage:'verify_publish'}});
        try{await finish({id:task.id,result:await verifyReservation(task)});}
        catch(error){await finish({id:task.id,error:error.message,code:'PUBLISH_UNCERTAIN'});}
        return;
      }
      if(!['session','publish'].includes(task.type)){
        await finish({id:task.id,error:'지원하지 않는 확장 작업입니다. 확장을 업데이트하세요.',code:'UNSUPPORTED_TASK'});return;
      }
      const fresh=task.platform!=='tistory' && (task.type==='publish' || task.payload.preflightTitle);
      const tabId=fresh?undefined:await editorTab(task.payload.interactive || task.type==='publish',task);
      const active={...task,tabId,stage:'waiting_login'};await chrome.storage.local.set({activeTask:active});await resume(active);
    }else if(state.editorTab && (refreshSession || !state.session || Date.now()-Date.parse(state.session.checkedAt)>60000)) {
      refreshSession=false;
      const session=await inspectSession(state.editorTab);await api('/status',{session});
    }
    await chrome.storage.local.remove('connectionError');
  }catch(error){if(error.httpStatus===401)await preserveRevokedWork();await chrome.storage.local.set({connectionError:error.message});}finally{clearInterval(heartbeat);busy=false;}
}
chrome.alarms.create('connection',{periodInMinutes:.5});chrome.alarms.onAlarm.addListener(()=>pump());
chrome.action.onClicked.addListener(()=>chrome.tabs.create({url:chrome.runtime.getURL('connect.html')}));
chrome.tabs.onUpdated.addListener(async(id,change)=>{
  if(change.status!=='complete')return;
  const state=await stored();
  if(id===state.editorTab)refreshSession=true;
  // Also receive queued requests promptly when the user's blog first opens.
  if(id===state.editorTab || /^https:\/\/(blog|nid)\.naver\.com\//.test(change.url || (await chrome.tabs.get(id).catch(()=>null))?.url || ''))pump();
});
chrome.runtime.onStartup.addListener(()=>pump());
chrome.runtime.onInstalled.addListener(()=>pump());
// Fast loopback polling while awake; alarms remain the worker-suspension fallback.
// Idle editor inspection is still limited to once per minute or a page load.
setInterval(()=>pump(),2000);
pump();
chrome.runtime.onMessage.addListener((message,_sender,reply)=>{
  (async()=>{
    if(message.type==='status'){pump();return stored();}
    if(message.type==='pair'){
      let state=await stored();
      if(state.activeTask) {
        if(busy)throw new Error('진행 중인 작업을 먼저 취소하고 잠시 후 연결하세요.');
        try {await api('/heartbeat');}catch(error){if(error.httpStatus!==401)throw error;await preserveRevokedWork();state=await stored();}
        if(state.activeTask)throw new Error('진행 중인 작업을 먼저 취소하세요.');
      }
      const deviceId=state.deviceId || crypto.randomUUID();const connection=await api('/pair',{code:message.code,deviceId});
      await chrome.storage.local.set({deviceId,connection});await chrome.storage.local.remove(['session','editorTab']);return {ok:true};
    }
    if(message.type==='session'){await api('/session/request');pump();return {ok:true};}
    if(message.type==='disconnect'){if((await stored()).activeTask)throw new Error('앱에서 대기를 먼저 취소하세요.');await api('/disconnect');await chrome.storage.local.remove(['connection','session','editorTab']);return {ok:true};}
    throw new Error('지원하지 않는 요청');
  })().then(reply,error=>reply({error:error.message}));return true;
});
