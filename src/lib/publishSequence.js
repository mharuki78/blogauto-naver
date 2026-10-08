const {confirmedPublication,publicationContext}=require('./publishRecovery');
const {normalizeTistoryBlogId}=require('./tistoryTarget');
const uncertain=message=>Object.assign(new Error(message),{code:'PUBLISH_UNCERTAIN'});
async function publishSequence(draft,{save,naver,tistory,log=()=>{}}) {
  const state={...draft,tistoryBlogId:normalizeTistoryBlogId(draft.tistoryBlogId),publications:{...draft.publications}};
  for(const platform of ['naver',...(draft.publishToTistoryAfterNaver===true && draft.tistoryBlogId?['tistory']:[])]) {
    const context=publicationContext(state,platform),prior=state.publications[platform];
    if(prior?.status==='done') {
      if(!confirmedPublication(prior,context))throw uncertain(`${platform} 이전 완료 증거가 누락되었습니다.`);
      log(`${platform} 완료 기록을 확인했습니다. 다음 플랫폼으로 이어갑니다.`);continue;
    }
    if(['running','uncertain'].includes(prior?.status))throw uncertain(`${platform} 이전 발행 결과를 먼저 확인하세요.`);
    state.publications[platform]={status:'running',startedAt:new Date().toISOString()};
    await save(state);
    try {
      const result=await (platform==='naver'?naver:tistory)(state);
      if(!confirmedPublication(result,context))throw uncertain(`${platform} 발행 완료 증거를 확인하지 못했습니다.`);
      state.publications[platform]={...result,status:'done'};
    } catch(error) {
      state.publications[platform]={status:error.code==='PUBLISH_UNCERTAIN'?'uncertain':'failed',reason:error.message};
      await save(state);throw error;
    }
    // A failed local save after publication must never downgrade success to retryable.
    try{await save(state);}catch(error){throw uncertain(`${platform} 완료 후 기록 저장에 실패했습니다. 원고를 보존하고 발행 여부를 확인하세요: ${error.message}`);}
  }
  return state;
}
module.exports={publishSequence};
