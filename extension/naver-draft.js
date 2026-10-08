// Injected into the Naver editor. A click alone is never proof of a saved draft.
async function draftEditorCommand(action,args={}) {
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  const norm=s=>String(s || '').replace(/[\u200b\ufeff]/g,'').replace(/\s+/g,' ').trim();
  const visible=e=>Boolean(e && e.getClientRects().length);
  const find=s=>[...document.querySelectorAll(s)].find(visible);
  const title=()=>norm([...document.querySelectorAll('.se-documentTitle .se-text-paragraph')].map(e=>[...e.querySelectorAll('.__se-node')].map(n=>n.textContent).join('')).join(''));
  try {
    if(action==='save'){
      if(!args.title || title()!==norm(args.title))throw new Error('임시저장할 제목이 현재 편집기와 다릅니다.');
      const button=find('button[data-click-area="tpb.save"]');
      if(!button || button.disabled)throw new Error('네이버 저장 버튼을 찾지 못했습니다.');
      button.click();await pause(1000);
    }
    if(action==='save' || action==='verifySaved'){
      const listButton=find('button[data-click-area="tpb*s.count"]');
      if(!listButton)throw new Error('임시저장 목록 버튼을 찾지 못했습니다.');
      if(!find('[aria-label="임시저장 글 보기"]'))listButton.click();
      let row;
      for(let n=0;n<40;n++){
        row=[...document.querySelectorAll('button[data-click-area="tpb*s.tlist"]')].find(e=>visible(e) && norm(e.querySelector('strong')?.textContent)===norm(args.title));
        if(row)break;await pause(250);
      }
      if(!row)throw new Error('임시저장 목록에서 요청한 제목을 확인하지 못했습니다. 자동 재저장하지 않습니다.');
      const savedAt=norm(row.querySelector('[class*="date__"]')?.textContent);
      if(!savedAt)throw new Error('임시저장 시각을 확인하지 못했습니다.');
      const close=find('button[data-click-area="tpb*s.close"]');
      if(!close)throw new Error('임시저장 목록 닫기 버튼을 찾지 못했습니다.');
      close.click();
      return {ok:true,saved:true,verification:'draft-list',title:args.title,savedAt};
    }
    if(action==='ready'){
      const dialog=[...document.querySelectorAll('.se-popup-container')].find(e=>visible(e) && norm(e.querySelector('.se-popup-title')?.textContent)==='작성 중인 글이 있습니다.' && e.textContent.includes('이어서 작성하시겠습니까?'));
      if(dialog){const cancel=dialog.querySelector('button.se-popup-button-cancel');if(!cancel)throw new Error('이어쓰기 취소 버튼이 없습니다.');cancel.click();return {ok:true,ready:false,dismissed:true};}
      if(find('.se-popup-container'))return {ok:true,ready:false};
      const body=[...document.querySelectorAll('.se-component:not(.se-documentTitle) .__se-node')].map(e=>e.textContent).join('');
      return {ok:true,ready:Boolean(find('.se-documentTitle')) && !title() && !norm(body) && !find('.se-component.se-image')};
    }
    throw new Error('지원하지 않는 임시저장 동작');
  }catch(error){return {ok:false,error:error.message};}
}
// Arm the document-start guard only after verifying the draft was saved.
function reloadSavedDraftPage() {
  if(window.__blogAutoDraftReloadGuardInstalled!==true)throw new Error('새로고침 보호 처리가 준비되지 않았습니다. 확장 갱신 후 작성 탭을 새로 열어 주세요. 저장한 글은 다시 저장하지 않습니다.');
  window.__blogAutoVerifiedDraftReload=true;
  window.onbeforeunload=null;
}
async function completeNaverDraft({title,save,verify,ready,reload,checkpoint,pause}) {
  const proof=save?await save():await verify();
  if(!proof?.saved || proof.verification!=='draft-list' || proof.title!==title || !proof.savedAt)throw new Error('임시저장 완료 증거가 없습니다.');
  await checkpoint(proof);
  await reload();
  let clean=false;
  for(let n=0;n<60;n++){
    await pause(500);
    try{if((await ready()).ready){clean=true;break;}}catch{}
  }
  if(!clean)throw new Error('임시저장은 확인했지만 새로고침·이어쓰기 취소 후 빈 편집기를 확인하지 못했습니다. 다시 저장하지 말고 열린 화면을 확인하세요.');
  const verified=await verify();
  if(!verified?.saved || verified.verification!=='draft-list' || !verified.savedAt || verified.title!==title)throw new Error('새로고침 후 임시저장 목록을 확인하지 못했습니다.');
  return {...proof,published:false,cleanupComplete:true};
}
if(typeof module!=='undefined')module.exports={draftEditorCommand,reloadSavedDraftPage,completeNaverDraft};
