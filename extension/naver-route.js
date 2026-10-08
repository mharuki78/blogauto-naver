// Shared outer-tab identity guard. A Write redirect is already an editor.
function matchesNaverWriteUrl(value,blogId) {
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(blogId || ''))return false;
  let url;try{url=new URL(value);}catch{return false;}
  if(url.protocol!=='https:' || url.hostname!=='blog.naver.com' || url.port || url.username || url.password)return false;
  for(const key of ['blogId','Redirect'])if(url.searchParams.getAll(key).length>1)return false;
  if([...url.searchParams.keys()].some(k=>/^(blogid|redirect)$/i.test(k) && !['blogId','Redirect'].includes(k)))return false;
  const id=url.searchParams.get('blogId'),redirect=url.searchParams.get('Redirect');
  if(id && id!==blogId || redirect!==null && redirect!=='Write')return false;
  const pathname=url.pathname.replace(/\/$/,'');
  if(pathname===`/${blogId}/postwrite`)return true;
  if(/^\/PostWriteForm\.(?:naver|nhn)$/i.test(pathname))return id===blogId;
  return pathname===`/${blogId}` && redirect==='Write';
}
if(typeof module!=='undefined')module.exports={matchesNaverWriteUrl};
