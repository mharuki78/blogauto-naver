function tistoryDocument(title,plan,images) {
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const texts=[title];
  let html='<blockquote data-ke-style="style1">'+escape(title)+'</blockquote>';
  if(images.title)html+='<p>'+images.title+'</p>';
  for(const block of plan){
    if(block.type==='image'){
      if(!images[block.sequence])throw new Error('티스토리 이미지 '+block.sequence+'이 누락되었습니다.');
      html+='<p>'+images[block.sequence]+'</p>';continue;
    }
    texts.push(block.text);
    html+=block.type==='section'?'<h2 data-ke-size="size26">'+escape(block.text)+'</h2>':'<p data-ke-size="size16">'+escape(block.text)+'</p><p>&nbsp;</p>';
  }
  return {html,texts,imageCount:Object.keys(images).length};
}
function reconcileTistoryCheckpoint(checkpoint,snapshot,title){
  if(snapshot.title && snapshot.title!==title)throw new Error('티스토리 제목이 저장 원고와 다릅니다. 기존 글을 보존했습니다.');
  if(snapshot.html===checkpoint.html)return checkpoint;
  // A genuinely empty new editor may be rebuilt from local assets. Never reuse
  // hosted image URLs whose lifetime cannot be established after a closed tab.
  const emptyMarkup=String(snapshot.html).replace(/<\/?p\s*>|<br\s*\/?>|&nbsp;|\s/gi,'');
  if(!snapshot.text.trim() && !snapshot.images.length && !emptyMarkup)return {fingerprint:checkpoint.fingerprint,html:snapshot.html,images:{}};
  const compact=html=>String(html).replace(/>\s+</g,'><').trim();
  const pending=checkpoint.pending;
  if(pending?.type==='content' && compact(snapshot.html)===compact(pending.html))return {...checkpoint,html:snapshot.html,composed:true,pending:null};
  if(pending?.type==='upload'){
    const before=pending.images || [];
    const added=snapshot.images.filter(image=>!before.includes(image));
    if(added.length===1 && snapshot.images.length===before.length+1 && before.every(image=>snapshot.images.includes(image)) && added[0].includes('"filename":'+JSON.stringify(pending.name))){
      const base=compact(checkpoint.html),image=added[0],actual=compact(snapshot.html);
      if([base+image,base+'<p>'+image+'</p>'].includes(actual))return {...checkpoint,html:snapshot.html,images:{...checkpoint.images,[pending.key]:image},pending:null};
    }
  }
  throw new Error('티스토리 본문이 마지막 확인 기록과 다릅니다. 기존 글을 보존했습니다.');
}
async function publishTistory(task) {
  const p=task.payload,tabId=task.tabId;
  const fingerprint=JSON.stringify([task.blogId,p.title,p.article]);
  const saved=(await chrome.storage.local.get('tistoryCheckpoint')).tistoryCheckpoint;
  let snapshot=await command(tabId,'snapshot',{blogId:task.blogId});
  let checkpoint=saved?.fingerprint===fingerprint?saved:null;
  if(checkpoint)checkpoint=reconcileTistoryCheckpoint(checkpoint,snapshot,p.title);
  if(!checkpoint && (snapshot.text.trim() || snapshot.images.length || (snapshot.title && snapshot.title!==p.title)))throw new Error('티스토리 편집기에 다른 글이 있습니다. 기존 글을 저장하거나 비운 후 다시 시작하세요.');
  checkpoint ||= {fingerprint,html:snapshot.html,images:{}};
  const save=async()=>chrome.storage.local.set({tistoryCheckpoint:checkpoint});
  const check=async()=>{if((await api('/task/status',{id:task.id})).state!=='running')throw new Error('작업이 취소되었습니다. 작성 내용은 보존됩니다.');};
  await check();await command(tabId,'title',{blogId:task.blogId,text:p.title});await save();
  const assets=[...(p.titleImageIndex!==null?[{key:'title',index:p.titleImageIndex}]:[]),...p.bodyImages.map(i=>({key:i.sequence,index:i.index}))];
  for(const asset of assets){
    if(checkpoint.images[asset.key])continue;
    await check();
    const {connection}=await stored();
    const response=await fetch(API+'/asset?task='+task.id+'&index='+asset.index,{headers:{Authorization:'Bearer '+connection.token},signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error('티스토리 업로드 이미지 파일을 읽지 못했습니다.');
    const imagePayload=await response.json();
    checkpoint.pending={type:'upload',key:asset.key,name:imagePayload.name,images:(await command(tabId,'snapshot',{blogId:task.blogId})).images};await save();
    const result=await command(tabId,'upload',{blogId:task.blogId,...imagePayload});
    checkpoint.images[asset.key]=result.image;
    checkpoint.html=(await command(tabId,'snapshot',{blogId:task.blogId})).html;checkpoint.pending=null;await save();
    await api('/progress',{id:task.id,message:`티스토리 이미지 ${Object.keys(checkpoint.images).length}/${assets.length} 업로드 확인 완료`});
  }
  await check();
  if(!checkpoint.composed){
    const document=tistoryDocument(p.title,articlePlan(p.article),checkpoint.images);
    checkpoint.pending={type:'content',html:document.html};await save();
    const result=await command(tabId,'content',{blogId:task.blogId,...document,expectedHtml:checkpoint.html});
    checkpoint.html=result.html;checkpoint.composed=true;checkpoint.pending=null;await save();
  }
  await command(tabId,'metadata',{...p,blogId:task.blogId});
  const settings=await command(tabId,'settings',{...p,blogId:task.blogId});await check();
  // Keep the exact UI-applied minute throughout result verification/recovery.
  if(settings.scheduledAt)task={...task,payload:{...p,scheduledAt:settings.scheduledAt}};
  await api('/stage',{id:task.id,stage:'final_publish'});
  await chrome.storage.local.set({activeTask:{...task,stage:'final_publish'}});
  await command(tabId,'publish',{blogId:task.blogId});
  for(let n=0;n<45;n++){
    await sleep(1000);
    const result=await tistoryRun(tabId,'published',{blogId:task.blogId,title:p.title,publishVisibility:p.publishVisibility,publishScheduleMode:p.publishScheduleMode,scheduledAt:task.payload.scheduledAt}).catch(()=>null);
    if(result?.complete){await chrome.storage.local.remove('tistoryCheckpoint');const {ok,complete,reason,...evidence}=result;return {published:true,...evidence};}
  }
  throw Object.assign(new Error('티스토리 발행 결과가 불확실합니다. 글 목록을 확인하세요. 자동 재발행하지 않습니다.'),{code:'PUBLISH_UNCERTAIN'});
}
if(typeof module!=='undefined')module.exports={tistoryDocument,reconcileTistoryCheckpoint};
