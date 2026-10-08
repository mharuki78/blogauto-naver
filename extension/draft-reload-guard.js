// Register before Naver installs its beforeunload handlers. The guard is armed
// only after the extension has verified a saved draft in Naver's own list.
window.addEventListener('beforeunload',event=>{
  if(window.__blogAutoVerifiedDraftReload!==true)return;
  window.__blogAutoVerifiedDraftReload=false;
  event.stopImmediatePropagation();
},{capture:true});
window.__blogAutoDraftReloadGuardInstalled=true;
