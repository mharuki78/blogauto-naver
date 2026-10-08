// Deterministic authoring: inspect the document, apply one operation, verify it.
// No AI calls, text rewriting, blind retries, or final publication here.
const writerNormalize = value => String(value || '').replace(/[\s\u200b\ufeff]/g,'');
function writerLink(value){try{const url=new URL(value);if(!/^https?:$/.test(url.protocol))return '';return url.href.replace(/\/$/,'');}catch{return '';}}
function withoutGeneratedPreviews(blocks){
  const content=[];
  for(const block of blocks){
    if(block.type!=='linkPreview'){content.push(block);continue;}
    const previous=content.at(-1);
    const links=previous?.type==='paragraph' ? String(previous.text || '').match(/https?:\/\/[^\s<>"\u200b]+/g) || [] : [];
    if(block.url){
      if(!writerLink(block.url) || !links.some(url=>writerLink(url)===writerLink(block.url)))return null;
    }else{
      // SmartEditor renders edit-mode cards as divs with a domain label, not anchors.
      // Preserve these cards only beside a matching source URL; do not invent a target.
      const display=String(block.displayUrl || '').trim();
      try {
        const shown=new URL(/^https?:\/\//i.test(display)?display:'https://'+display);
        if(!display || !links.some(value=>{const target=new URL(value);return target.host===shown.host && (shown.pathname==='/' || target.pathname===shown.pathname) && (!shown.search || target.search===shown.search);}))return null;
      }catch{return null;}
    }
  }
  return content;
}
function writerUnits(steps) {
  const units=[];
  for(const step of steps){
    if(step.type==='title')continue;
    const unit={type:step.type,text:writerNormalize(step.text),style:step.style || '',name:step.name || ''};
    if(unit.type==='paragraph' && !unit.text)continue;
    if(unit.type==='paragraph' && units.at(-1)?.type==='paragraph')units.at(-1).text+=unit.text;
    else units.push(unit);
  }
  return units;
}
function matchingWriterPrefix(snapshot,steps) {
  if(snapshot.title && writerNormalize(snapshot.title)!==writerNormalize(steps[0].text))return -1;
  const content=withoutGeneratedPreviews(snapshot.blocks);
  if(!content)return -1;
  const actual=writerUnits(content);
  for(let count=steps.length;count>=0;count--){
    if(count>0 && writerNormalize(snapshot.title)!==writerNormalize(steps[0].text))continue;
    if(count===0 && snapshot.title)continue;
    const expected=writerUnits(steps.slice(0,count));
    if(expected.length!==actual.length)continue;
    if(expected.every((e,i)=>{const a=actual[i];return e.type===a.type && (e.type==='image' ? Boolean(e.name) && e.name===a.name : e.text===a.text && e.style===a.style);}))return count;
  }
  return -1;
}
async function runWriter({steps,read,apply,save,checkCancelled,onProgress,requireEmpty=false}) {
  let snapshot=await read(),cursor=matchingWriterPrefix(snapshot,steps);
  if(requireEmpty && (writerNormalize(snapshot.title) || (withoutGeneratedPreviews(snapshot.blocks)?.length ?? snapshot.blocks.length)))throw new Error('새 글쓰기 화면이 비어 있지 않습니다. 기존 글을 저장하거나 비운 후 다시 시작해 주세요.');
  if(cursor<0)throw new Error('현재 글이 저장 원고의 입력 순서와 다릅니다. 기존 글을 보존하고 입력을 중지했습니다.');
  await save({cursor,anchorId:snapshot.blocks.at(-1)?.id || '',snapshot});
  while(cursor<steps.length){
    await checkCancelled();
    // Link previews can appear asynchronously after the preceding URL was verified.
    snapshot=await read();
    if(matchingWriterPrefix(snapshot,steps)!==cursor)throw new Error('다음 입력 전 문서가 변경되었습니다. 기존 글을 보존합니다.');
    const step=steps[cursor],before=snapshot,startCursor=cursor;
    let failure;
    for(let attempt=0;attempt<2;attempt++){
      try{await apply(step,{anchorId:before.blocks.at(-1)?.id || ''});}catch(error){failure=error;}
      snapshot=await read();
      const next=matchingWriterPrefix(snapshot,steps);
      if(next===cursor+1){cursor=next;failure=null;break;}
      // Retry only a proven no-op; never append over partial or unexpected input.
      if(next!==cursor || JSON.stringify(snapshot)!==JSON.stringify(before))break;
      if(!failure)failure=new Error('입력 명령 후 문서가 변경되지 않았습니다.');
    }
    if(failure || cursor!==startCursor+1 || matchingWriterPrefix(snapshot,steps)!==cursor)throw failure || new Error('입력 결과가 원고와 달라 중지했습니다.');
    if(JSON.stringify(snapshot)===JSON.stringify(before))throw new Error('입력 위치를 확보하지 못했습니다. 원고는 보존돼 있습니다.');
    await save({cursor,anchorId:snapshot.blocks.at(-1)?.id || '',snapshot});
    await onProgress?.(cursor,steps.length,step.type);
  }
  return {complete:true,cursor};
}
if(typeof module!=='undefined')module.exports={writerUnits,matchingWriterPrefix,runWriter};
