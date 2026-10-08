const {getBridge}=require('./extensionBridge');
const {TISTORY_ACCOUNT_ID,normalizeTistoryBlogId}=require('./tistoryTarget');
const MIN_EDITOR_BUILD='20261008.1';
const failure=(message,code)=>Object.assign(new Error(message),{code});
function target(options,platform='naver') {
  const bridge=options.bridge || getBridge();
  const id=platform==='tistory'?TISTORY_ACCOUNT_ID:options.accountId;
  const blogId=platform==='tistory'?normalizeTistoryBlogId(options.tistoryBlogId):String(options.blogId || '');
  if(!id || !bridge.snapshot(id).connected)throw failure('해당 계정의 Chrome에서 Himawari 확장을 연결해 주세요.','EXTENSION_DISCONNECTED');
  const client=bridge.clientFor(id);
  if(client?.platform!==platform || platform==='naver' && client.blogId!==blogId)throw failure('계정의 Blog ID가 변경되었습니다. 새 연결 코드를 발급받아 연결해 주세요.','ACCOUNT_TARGET_CHANGED');
  if(!blogId)throw new Error('발행 대상 Blog ID가 필요합니다.');
  return {bridge,id,blogId};
}
function requireCompatibleEditor(result,blogId) {
  if(result?.status!=='valid')return;
  const build=String(result.editorBuild || '');
  const parts=/^(\d{8})\.(\d+)$/.exec(build);
  if(!parts || Number(parts[1])<20261008 || Number(parts[1])===20261008 && Number(parts[2])<1)throw failure(`${blogId} Chrome의 Himawari 확장을 업데이트하세요. 설치 폴더 준비 후 chrome://extensions에서 새로고침(↻)을 누르세요. 필요 버전: ${MIN_EDITOR_BUILD}.`,'EXTENSION_UPDATE_REQUIRED');
  if(result.blogId!==blogId)throw failure('확장이 다른 블로그의 편집기를 확인했습니다. 연결을 다시 확인하세요.','ACCOUNT_TARGET_CHANGED');
}
async function checkSession(options,platform) {
  let resolved;
  try{resolved=target(options,platform);}catch(error){if(error.code==='EXTENSION_DISCONNECTED')return {status:'disconnected',reason:error.message};throw error;}
  const {bridge,id,blogId}=resolved;
  const result=await bridge.request(id,'session',{interactive:options.interactiveLogin!==false,preflightTitle:options.preflightTitle===true,tistoryBlogId:platform==='tistory'?blogId:undefined,category:options.category || ''});
  requireCompatibleEditor(result,blogId);
  return {...result,preparedSession:result.status==='valid'?{accountId:id,connection:true}:null};
}
const checkNaverSession=(options={})=>checkSession(options,'naver');
const checkTistorySession=(options={})=>checkSession(options,'tistory');
function scheduledAt(hours,platform,now=Date.now()) {
  const delay=Number(hours ?? 3);
  if(!Number.isFinite(delay) || delay<=0)throw new Error('예약 시간은 0보다 큰 숫자여야 합니다.');
  const interval=(platform==='naver'?10:1)*60000;
  return new Date(Math.ceil((now+delay*3600000)/interval)*interval).toISOString();
}
async function publish(options,platform) {
  const {bridge,id,blogId}=target(options,platform);
  const visibility=options.publishVisibility || (options.publishPrivate===false?'public':'private');
  // Draft saving is explicitly a Naver action; Tistory remains public/private.
  if(platform==='tistory' && visibility==='draft')throw new Error('임시저장은 네이버만 지원합니다. 티스토리 동시 발행을 해제해 주세요.');
  const payload={title:options.title,article:options.article,titleImagePath:options.titleImagePath,
    titleIsReferenceOriginal:options.titleIsReferenceOriginal===true,bodyImages:options.bodyImages || [],tags:options.tags || [],category:options.category || '',
    publishVisibility:visibility,publishScheduleMode:visibility==='draft'?'now':options.publishScheduleMode || 'now',reserveAfterHours:options.reserveAfterHours ?? 3,
    breakSentencesInBody:options.breakSentencesInBody!==false,interactive:true,
    ...(platform==='tistory'?{tistoryBlogId:blogId}:{}),
    ...(visibility!=='draft' && options.publishScheduleMode==='reserve'?{scheduledAt:options.scheduledAt || scheduledAt(options.reserveAfterHours,platform)}:{})};
  const result=await bridge.request(id,'publish',payload);
  if(!require('./publishRecovery').confirmedPublication(result,{platform,blogId,title:payload.title,payload}))throw failure('발행 결과를 확인하지 못했습니다. Chrome에서 게시 여부를 확인해 주세요. 자동 재발행하지 않습니다.','PUBLISH_UNCERTAIN');
  options.log?.(result.saved?'네이버 임시저장 완료 · 빈 편집기 복귀 확인':result.scheduled?`${platform} 예약 등록 완료: ${result.scheduledAt}`:`${platform} 발행 완료: ${result.url}`);
  return result;
}
function naverSessionFailureStatus(error) {
  const codes={EXTENSION_DISCONNECTED:'extension_disconnected',ACCOUNT_TARGET_CHANGED:'extension_disconnected',EXTENSION_UPDATE_REQUIRED:'extension_update_required',SESSION_EXPIRED:'session_expired',NAVER_PREFLIGHT_FAILED:'session_expired',TISTORY_PREFLIGHT_FAILED:'session_expired',EDITOR_PREPARATION_FAILED:'session_expired',PUBLISH_UNCERTAIN:'publish_uncertain'};
  return codes[error?.code] || '';
}
module.exports={checkNaverSession,verifyOpenNaverSession:checkNaverSession,publishToNaver:(o={})=>publish(o,'naver'),checkTistorySession,publishToTistory:(o={})=>publish(o,'tistory'),requireCompatibleEditor,naverSessionFailureStatus,scheduledAt,MIN_EDITOR_BUILD};
