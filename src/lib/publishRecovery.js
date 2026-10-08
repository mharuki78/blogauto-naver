const {TISTORY_ACCOUNT_ID,normalizeTistoryBlogId}=require('./tistoryTarget');
const {matchesNaverWriteUrl}=require('../../extension/naver-route');
const uncertain=message=>Object.assign(new Error(message),{code:'PUBLISH_UNCERTAIN'});
function targetUrl(value,platform,blogId,management=false) {
  let url;try{url=new URL(value);}catch{return false;}
  if(url.protocol!=='https:' || url.username || url.password || url.port)return false;
  if(platform==='tistory')return url.hostname===`${blogId}.tistory.com` && (management?/^\/manage\/posts\/?$/.test(url.pathname):/^\/\d+\/?$/.test(url.pathname) || /^\/entry\/[^/]+\/?$/.test(url.pathname));
  if(url.hostname!=='blog.naver.com')return false;
  if(management)return matchesNaverWriteUrl(value,blogId);
  const ids=url.searchParams.getAll('blogId'),numbers=url.searchParams.getAll('logNo');
  if(ids.length>1 || ids.some(id=>id!==blogId) || numbers.length>1)return false;
  const parts=url.pathname.replace(/\/$/,'').split('/');
  return parts.length===3 && parts[1]===blogId && /^\d+$/.test(parts[2]) || /^\/PostView\.(naver|nhn)$/i.test(url.pathname) && ids[0]===blogId && /^\d+$/.test(numbers[0] || '');
}
function confirmedPublication(result,{platform='naver',blogId,title,payload={}}={}) {
  if(result?.saved===true)return platform==='naver' && result.published===false && result.verification==='draft-list' && result.cleanupComplete===true && Boolean(result.title && result.savedAt) && (!title || result.title===title) && (!payload.publishVisibility || payload.publishVisibility==='draft');
  if(result?.published!==true || result.saved===true || payload.publishVisibility==='draft')return false;
  if(!blogId)return false;
  if(result.scheduled===true) {
    const date=Date.parse(result.scheduledAt);
    return result.verification==='reservation-list' && Number.isFinite(date) && targetUrl(result.managementUrl,platform,blogId,true) &&
      (!payload.publishScheduleMode || payload.publishScheduleMode==='reserve') && (!payload.scheduledAt || date===Date.parse(payload.scheduledAt));
  }
  return payload.publishScheduleMode!=='reserve' && targetUrl(result.url,platform,blogId);
}
function publicationContext(draft,platform) {
  return {platform,blogId:platform==='tistory'?normalizeTistoryBlogId(draft.tistoryBlogId):draft.blogId,title:draft.title,payload:draft};
}
async function recoverPendingPublication(draft,{bridge,save,log=()=>{}}) {
  if(!draft.publications)throw uncertain('이전 버전 원고에는 발행 확인 기록이 없습니다. 원고를 보존했습니다. Chrome에서 이전 게시 여부를 확인한 후 보류 원고 처리에서 확인하세요.');
  let state={...draft,tistoryBlogId:normalizeTistoryBlogId(draft.tistoryBlogId),publications:{...draft.publications}};
  for(const platform of ['naver',...(draft.publishToTistoryAfterNaver===true?['tistory']:[])]) {
    const prior=state.publications[platform];if(!prior)continue;
    const context=publicationContext(state,platform);
    if(prior.status==='done') {
      if(!confirmedPublication(prior,context))throw uncertain(`${platform} 완료 기록의 증거가 유효하지 않습니다.`);
      continue;
    }
    if(!['running','uncertain'].includes(prior.status))continue;
    const accountId=platform==='tistory'?TISTORY_ACCOUNT_ID:draft.accountId;
    const matches=[...bridge.tasks.values()].filter(t=>t.type==='publish' && t.accountId===accountId && t.blogId===context.blogId && t.payload.title===draft.title && t.payload.article===draft.article && (t.payload.publishVisibility==='draft')===(draft.publishVisibility==='draft'));
    const latest=matches.at(-1),unresolved=matches.filter(t=>t.code==='PUBLISH_UNCERTAIN' || t.stage==='final_publish' && t.state!=='done');
    if(latest?.state==='done' && confirmedPublication(latest.result,{...context,payload:latest.payload}) && !unresolved.length) {
      state.publications[platform]={status:'done',...latest.result};await save(state);log(`${platform} 완료 증거를 복구했습니다. 다시 게시하지 않습니다.`);continue;
    }
    if(latest && ['interrupted','cancelled','failed','expired'].includes(latest.state) && latest.stage!=='final_publish' && !unresolved.length && prior.status==='running') {
      state.publications[platform]={status:'failed',reason:'최종 발행 전 중단 기록 확인'};await save(state);continue;
    }
    const dates=unresolved.map(t=>t.payload.publishScheduleMode==='reserve'?t.payload.scheduledAt:'');
    if(!unresolved.length || dates.some(d=>!Number.isFinite(Date.parse(d))) || new Set(dates).size!==1)throw uncertain(`${platform} 이전 발행 결과가 불확실합니다. Chrome에서 게시 여부를 확인하세요. 자동으로 다시 게시하지 않습니다.`);
    const scheduledAt=dates[0],target=platform==='tistory'?{tistoryBlogId:context.blogId}:{};
    const session=await bridge.request(accountId,'session',{...target,interactive:true});
    if(session?.status!=='valid')throw uncertain('예약 목록 확인을 위해 Chrome 로그인이 필요합니다.');
    require('./desktopPublisher').requireCompatibleEditor(session,context.blogId);
    const payload={...target,title:draft.title,article:draft.article,publishScheduleMode:'reserve',publishVisibility:draft.publishVisibility,scheduledAt,interactive:true};
    const result=await bridge.request(accountId,'verifyPublish',payload);
    if(!confirmedPublication(result,{...context,payload}) || !result.scheduled)throw uncertain('예약 목록에서 제목·시각·대상을 확인하지 못했습니다.');
    state.publications[platform]={status:'done',...result};await save(state);
    for(const task of unresolved){task.previousOutcome={state:task.state,code:task.code};task.state='done';task.code='';task.result=result;task.resolvedAt=new Date().toISOString();}
    bridge.saveTasks();log(`${platform} 예약 완료 증거를 복구했습니다.`);
  }
  return state;
}
module.exports={confirmedPublication,recoverPendingPublication,publicationContext,targetUrl};
