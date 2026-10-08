// Runs in MAIN world: TinyMCE's supported editor API owns the content and serialization.
async function tistoryCommand(command,args={}) {
  const wait=async(test,ms=12000)=>{const end=Date.now()+ms;while(Date.now()<end){try{const value=test();if(value)return value;}catch(error){if(!/업로드가 완료/.test(error.message))throw error;}await new Promise(r=>setTimeout(r,100));}throw new Error('티스토리 '+command+' 응답을 확인하지 못했습니다. 입력한 내용은 보존됩니다.');};
  const norm=s=>String(s||'').replace(/[\s\u200b-\u200d\ufeff]/g,'');
  const visible=e=>e && e.getClientRects().length && getComputedStyle(e).visibility!=='hidden';
  const button=text=>[...document.querySelectorAll('button,[role=button],[role=menuitem]')].find(e=>visible(e)&&(e.getAttribute('aria-label')===text || e.textContent.trim()===text));
  const set=(e,value)=>{if(!e)throw new Error('입력란을 찾을 수 없습니다.');Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};
  try {
    const host=args.blogId+'.tistory.com';
    if(location.hostname!==host) return {status:'expired',reason:'티스토리 공용 Chrome에서 로그인하세요.'};
    const editor=window.tinymce?.get('editor-tistory');
    if(command==='published') {
      if(!/\/manage\/posts\/?$/.test(location.pathname))return {ok:true,complete:false};
      const titleText=s=>String(s||'').replace(/[\u200b-\u200d\ufeff]/g,'').replace(/\s+/g,' ').trim();
      const expected=titleText(args.title);
      if(!expected)return {ok:true,complete:false,reason:'확인할 제목이 없습니다.'};
      // These selectors are from the live management list. Match title, status
      // and date within one row; a same-title historical link proves nothing.
      const rows=[...document.querySelectorAll('.post_cont .tit_post a.link_cont')].filter(a=>titleText(a.getAttribute('title') || a.textContent)===expected).map(a=>{
        const row=a.closest('li');let url='';
        try{const u=new URL(a.href);if(u.hostname===host && (/^\/\d+$/.test(u.pathname)||u.pathname.startsWith('/entry/')))url=u.href;}catch{}
        // Scheduled rows have a disabled, empty visibility button. Their
        // actual status is the [예약] badge inside the title link.
        const badge=titleText(a.querySelector('.info_status')?.textContent);
        const status=badge==='[예약]'?'예약':row?.querySelector('.post_btn .btn_opt')?.textContent.trim() || '';
        const dates=[...(row?.querySelectorAll('.post_cont .txt_info') || [])].map(e=>e.textContent.trim()).filter(v=>/^\d{4}[-./]\s*\d{1,2}[-./]\s*\d{1,2}\s+\d{1,2}:\d{2}$/.test(v));
        return {url,status,dates};
      }).filter(r=>r.url);
      if(rows.length!==1)return {ok:true,complete:false,reason:rows.length?'같은 제목의 글이 여러 개입니다.':'제목이 일치하는 글을 찾지 못했습니다.'};
      const row=rows[0];
      if(args.publishScheduleMode==='reserve'){
        const target=new Date(args.scheduledAt),date=row.dates[0]?.match(/^(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
        const matching=Number.isFinite(target.getTime()) && row.dates.length===1 && date && [target.getFullYear(),target.getMonth()+1,target.getDate(),target.getHours(),target.getMinutes()].every((v,i)=>v===Number(date[i+1]));
        if(!/^(?:예약|예약 발행|발행 예약)$/.test(row.status) || !matching)return {ok:true,complete:false,reason:'동일 글의 예약 상태와 예약 시각을 확인하지 못했습니다.',diagnostics:{status:row.status,dates:row.dates}};
        return {ok:true,complete:true,scheduled:true,scheduledAt:target.toISOString(),verification:'reservation-list',managementUrl:location.origin+'/manage/posts/',url:row.url};
      }
      const expectedStatus=args.publishVisibility==='public'?'공개':'비공개';
      return {ok:true,complete:row.status===expectedStatus,url:row.url,reason:row.status===expectedStatus?'':'공개 상태가 요청과 다릅니다.'};
    }
    if(!editor || !document.querySelector('#post-title-inp'))return {status:'unknown',reason:'티스토리 글쓰기 화면 또는 로그인·권한 안내를 확인하세요.'};
    const images=()=>editor.getContent().match(/\[##_Image\|[\s\S]*?_##\]/g)||[];
    if(command==='inspect')return {ok:true,status:'valid',blogId:args.blogId,editorBuild:'20261008.1',reason:'티스토리 글쓰기 권한 확인 완료 · 탭 재사용 수정본 20260928.3'};
    if(command==='preflight'){
      if(args.category){
        const select=document.querySelector('#category-btn');if(!select)throw new Error('티스토리 카테고리를 확인할 수 없습니다.');
        if(norm(select.querySelector('.mce-txt')?.textContent)!==norm(args.category)){
          select.click();await wait(()=>document.querySelector('[role=option]'));
          const found=[...document.querySelectorAll('[role=option]')].some(e=>norm(e.textContent.replace(/^\s*-\s*/,''))===norm(args.category));
          select.click();
          if(!found)throw new Error('티스토리에 “'+args.category+'” 카테고리가 없습니다. 먼저 카테고리를 추가하세요. 원고 생성은 시작하지 않았습니다.');
        }
      }
      return {ok:true};
    }
    if(command==='snapshot')return {ok:true,title:document.querySelector('#post-title-inp').value,html:editor.getContent(),text:editor.getBody().innerText,images:images()};
    if(command==='title'){set(document.querySelector('#post-title-inp'),args.text);await wait(()=>document.querySelector('#post-title-inp').value===args.text);return {ok:true};}
    if(command==='upload') {
      const before=images();const existing=before.find(i=>i.includes('"filename":"'+args.name+'"'));
      if(existing)return {ok:true,image:existing};
      editor.focus();editor.selection.select(editor.getBody(),true);editor.selection.collapse(false);
      const attach=button('첨부');if(!attach)throw new Error('사진 첨부 버튼을 찾을 수 없습니다.');attach.click();
      const photo=await wait(()=>button('사진'));photo.click();
      const input=await wait(()=>[...document.querySelectorAll('input[type=file]')].find(e=>(e.accept||'').includes('image/')));
      const file=new File([Uint8Array.from(atob(args.data),c=>c.charCodeAt(0))],args.name,{type:args.mime});
      const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
      const result=await wait(()=>{const now=images();return now.length===before.length+1 && now.find(i=>!before.includes(i));},60000);
      return {ok:true,image:result};
    }
    if(command==='content') {
      // Caller already compared the current draft with its checkpoint; preserve it on mismatch.
      if(editor.getContent()!==args.expectedHtml)throw new Error('티스토리 본문이 작업 중 변경됐습니다. 기존 내용을 보존합니다.');
      editor.setContent(args.html);editor.fire('change');editor.save();
      await wait(()=>{const text=norm(editor.getBody().innerText);let offset=0;for(const part of args.texts){const at=text.indexOf(norm(part),offset);if(at<0)return false;offset=at+norm(part).length;}return images().length===args.imageCount;});
      return {ok:true,html:editor.getContent()};
    }
    if(command==='metadata') {
      if(args.category){
        const select=document.querySelector('#category-btn');if(!select)throw new Error('티스토리 카테고리 선택란이 없습니다.');
        if(norm(select.querySelector('.mce-txt')?.textContent)!==norm(args.category)){
          select.click();await wait(()=>document.querySelector('[role=option]'));
          const option=[...document.querySelectorAll('[role=option]')].find(e=>norm(e.textContent.replace(/^\s*-\s*/,''))===norm(args.category));
          if(!option)throw new Error('티스토리에 “'+args.category+'” 카테고리가 없습니다. 카테고리를 만든 뒤 이어서 발행하세요.');
          option.click();await wait(()=>norm(select.querySelector('.mce-txt')?.textContent)===norm(args.category));
        }
      }
      for(const tag of [...new Set(args.tags || [])].slice(0,10)){
        const exists=()=>[...document.querySelectorAll('.editor_tag a')].some(e=>e.textContent.trim()==='#'+tag);
        if(exists())continue;
        const input=document.querySelector('#tagText');set(input,tag);
        await new Promise(r=>setTimeout(r,0));
        input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));
        await wait(exists);
      }
      return {ok:true};
    }
    if(command==='settings') {
      if(!visible(document.querySelector('#publish-btn'))){const done=button('완료');if(!done)throw new Error('완료 버튼을 찾을 수 없습니다.');done.click();}
      await wait(()=>visible(document.querySelector('#publish-btn')));
      if(args.publishScheduleMode==='now')button('현재')?.click();
      const radio=document.querySelector(args.publishVisibility==='public'?'#open20':'#open0');
      if(!radio)throw new Error('공개 설정을 찾을 수 없습니다.');radio.click();await wait(()=>radio.checked);
      if(args.publishScheduleMode==='reserve'){
        if(args.publishVisibility!=='public')throw new Error('티스토리는 비공개 저장에서 예약 발행을 제공하지 않습니다. 공개 예약 또는 현재 비공개 저장을 선택하세요.');
        const target=new Date(args.scheduledAt || Date.now()+Number(args.reserveAfterHours)*3600000);
        if(!Number.isFinite(target.getTime()) || target<=new Date())throw new Error('예약 시각이 올바르지 않습니다.');
        button('예약')?.click();
        const dateButton=await wait(()=>document.querySelector('.btn_reserve'));
        const day=[target.getFullYear(),String(target.getMonth()+1).padStart(2,'0'),String(target.getDate()).padStart(2,'0')].join('-');
        if(dateButton.textContent!==day){
          dateButton.click();
          const month=()=>[...document.querySelectorAll('strong')].find(e=>visible(e)&&/^\d{4}년\s*\d+월$/.test(e.textContent.trim()))?.textContent.trim();
          const wanted=target.getFullYear()+'년 '+(target.getMonth()+1)+'월';
          for(let n=0;n<13 && month()!==wanted;n++){
            const previous=month(),parts=previous?.match(/(\d+)년\s*(\d+)월/);if(!parts)throw new Error('예약 달력을 확인할 수 없습니다.');
            const move=Number(parts[1])*12+Number(parts[2])<target.getFullYear()*12+target.getMonth()+1?'다음날짜':'이전날짜';
            const control=button(move);if(!control || control.disabled)throw new Error('예약 가능한 날짜 범위를 확인하세요.');control.click();await wait(()=>month()!==previous);
          }
          if(month()!==wanted)throw new Error('예약 월을 확인할 수 없습니다.');
          const choose=[...document.querySelectorAll('.tbl_calendar button')].find(e=>e.textContent===String(target.getDate())&&!e.disabled);
          if(!choose)throw new Error('선택할 수 없는 예약 날짜입니다.');choose.click();await wait(()=>document.querySelector('.btn_reserve')?.textContent===day);
        }
        set(document.querySelector('#dateHour'),String(target.getHours()));set(document.querySelector('#dateMinute'),String(target.getMinutes()));
        await wait(()=>document.querySelector('.btn_reserve')?.textContent===day && Number(document.querySelector('#dateHour')?.value)===target.getHours() && Number(document.querySelector('#dateMinute')?.value)===target.getMinutes());
        target.setSeconds(0,0);return {ok:true,scheduledAt:target.toISOString()};
      }else button('현재')?.click();
      return {ok:true};
    }
    if(command==='publish') {const b=document.querySelector('#publish-btn');if(!visible(b))throw new Error('발행 버튼을 확인할 수 없습니다.');b.click();return {ok:true};}
    throw new Error('지원하지 않는 티스토리 작업');
  }catch(error){return {error:error.message};}
}
if(typeof module!=='undefined')module.exports={tistoryCommand};
