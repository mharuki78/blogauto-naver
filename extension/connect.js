const status=document.querySelector('#status');
async function action(type, extra={}) { const r=await chrome.runtime.sendMessage({type,...extra}); if(r?.error) throw new Error(r.error); return r; }
async function refresh(){ const {connection,session,connectionError}=await action('status'); status.textContent=connection?`${connection.label} · ${connection.blogId}\n${connectionError || (session?.reason || '연결되었습니다. 상태를 확인해 주세요.')}`:'아직 연결되지 않았습니다. 앱에서 코드를 발급받으세요.'; }
document.querySelector('#pairForm').onsubmit=async e=>{e.preventDefault();try {status.textContent='연결 중…';await action('pair',{code:document.querySelector('#code').value.trim()});document.querySelector('#code').value='';await action('session');await refresh();}catch(e){status.textContent=e.message;}};
document.querySelector('#login').onclick=async()=>{try{status.textContent='열린 블로그 화면에서 로그인하면 자동으로 확인합니다.';await action('session');await refresh();}catch(e){status.textContent=e.message;}};
document.querySelector('#disconnect').onclick=async()=>{try{await action('disconnect');await refresh();}catch(e){status.textContent=e.message;}};
refresh().catch(e=>status.textContent=e.message); setInterval(()=>refresh().catch(()=>{}),5000);
