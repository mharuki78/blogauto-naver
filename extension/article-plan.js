// Mechanical layout only. Keep every text line; move a section's images before its body.
function articlePlan(article) {
  const groups=[[]];
  for(const raw of String(article || '').split(/\r?\n/)){
    const text=raw.trim();if(!text)continue;
    const section=text.match(/^\[SECTION\s*-\s*(.+)\]$/i);
    const image=text.match(/^\[IMAGE INSERT\s*-\s*(\d+)\]$/i);
    if(section)groups.push([{type:'section',text:section[1],style:'quotation_line'}]);
    else groups.at(-1).push(image?{type:'image',sequence:Number(image[1])}:{type:'paragraph',text});
  }
  return groups.flatMap((group,i)=>i===0?group:[group[0],...group.slice(1).filter(b=>b.type==='image'),...group.slice(1).filter(b=>b.type!=='image')]);
}
if(typeof module!=='undefined')module.exports={articlePlan};
