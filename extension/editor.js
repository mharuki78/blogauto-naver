// This function runs only inside the editor's isolated world. No debugger or remote control.
async function editorCommand(command, args = {}) {
  const build='20261008.1';let step='locate';
  try {
  const visible = el => Boolean(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  const find = selector => [...document.querySelectorAll(selector)].find(visible);
  const exact = text => {
    for(const selector of ['button,label,[role="button"],a','span']){
      const match=[...document.querySelectorAll(selector)].find(el=>visible(el) && el.textContent.trim()===text);
      if(match)return match;
    }
  };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const findTitle = () => find('.se-title-text .se-text-paragraph, .se-documentTitle .se-text-paragraph, .se-title-text [contenteditable="true"], .se-title [contenteditable="true"], textarea[placeholder*="제목"], input[placeholder*="제목"]');
  const title = findTitle();
  const quoteSelector='.se-component-quotation, .se-section-quotation, .se-quotation-container, .se-module-quotation, .se-module-quote, .se-quote, .se-quotation';
  const allParagraphs = () => [...document.querySelectorAll('.se-section-text .se-text-paragraph, .se-section-text [contenteditable="true"]')].filter(el=>!el.closest(quoteSelector) && !el.closest('.se-title, .se-documentTitle, .se-caption, .se-source'));
  const paragraphs = () => allParagraphs().filter(visible);
  const quotes=()=>[...document.querySelectorAll(quoteSelector)].filter(el=>visible(el) && !el.parentElement?.closest(quoteSelector));
  const body = paragraphs()[0];
  const text = document.body?.innerText || '';
  const readText=el=>{
    if(!el)return '';
    if(el.matches('input,textarea'))return el.value;
    const clone=el.cloneNode(true);clone.querySelectorAll('.se-placeholder,.se-placeholder-text').forEach(e=>e.remove());
    return clone.textContent.replace(/[\u200b\ufeff]/g,'');
  };
  const normalize=value=>String(value || '').replace(/[\s\u200b\ufeff]/g,'');
  // Scrolling or selection can temporarily hide a component. Content integrity
  // must not depend on its current rendering/visibility.
  const bodyText=()=>allParagraphs().map(readText).map(normalize).join('');
  const waitFor=async predicate=>{let stable=0;for(let n=0;n<100;n++){stable=predicate()?stable+1:0;if(stable>=2)return true;await wait(50);}return false;};
  const ensureImageAi=async image=>{
    const id=image.id;
    const current=()=>id ? document.getElementById(id) : image;
    image.scrollIntoView({block:'center'});(image.querySelector('img') || image).click();
    if(!await waitFor(()=>current()?.querySelector('.se-set-ai-mark-button-toggle')))throw new Error('이미지 AI 활용 스위치를 찾지 못했습니다.');
    const toggle=current().querySelector('.se-set-ai-mark-button-toggle');
    if(!toggle.classList.contains('se-is-selected'))toggle.click();
    if(!await waitFor(()=>current()?.querySelector('.se-set-ai-mark-button-toggle')?.classList.contains('se-is-selected')))throw new Error('이미지 AI 활용 설정이 켜지지 않았습니다.');
  };
  let inputDocument=document;
  const resolveInput=()=>{
    let doc=document;
    for(let depth=0;depth<5;depth++){
      const active=doc.activeElement;
      if(active?.tagName!=='IFRAME')return {doc,active};
      const next=active.contentDocument;
      if(!next)throw new Error('활성 입력 프레임에 접근할 수 없습니다.');
      doc=next;
    }
    throw new Error('입력 프레임 중첩 한도를 초과했습니다.');
  };
  const activateParagraph = async el => {
    if(find('.se-popup-container,[role="dialog"][aria-modal="true"]'))throw new Error('편집기 팝업이 열려 있습니다. 팝업을 처리한 뒤 다시 시작해 주세요.');
    const id=el.id;
    el.scrollIntoView({block:'center',behavior:'instant'});
    el=id?document.getElementById(id):el;
    if(!el)throw new Error('입력 요소가 변경됐습니다. 문서를 다시 확인해야 합니다.');
    const rect=el.getBoundingClientRect();
    const lastNode=[...(el.querySelectorAll?.('.__se-node') || [])].filter(n=>n.textContent).at(-1);
    const tail=lastNode ? [...lastNode.getClientRects()].at(-1) : null;
    // Send selection events to the resolved paragraph itself. Paint hit-testing
    // is unreliable for background/minimized documents and is not model selection.
    const box=tail || rect;
    const x=box.left+Math.max(1,(box.width || 2)/2),y=box.top+Math.max(1,(box.height || 2)/2);
    const target=lastNode || el;
    // SmartEditor selects its model/caret on mousedown, not HTMLElement.click().
    for(const type of ['mousedown','mouseup','click'])target.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,buttons:type==='mousedown'?1:0,view:window}));
    await wait(100);
    focusEnd(el);
  };
  const focusEnd = el => {
    const receiver=resolveInput();
    // SmartEditor routes editing through a separate iframe. Preserve the
    // caret it established on click; selecting the display paragraph loses it.
    if(receiver.doc!==document || (!el.isContentEditable && receiver.active?.isContentEditable && receiver.active!==el && !el.contains?.(receiver.active))){
      const active=receiver.active;
      if(!active?.isContentEditable && !active?.matches?.('input,textarea'))throw new Error('활성 입력 프레임에 편집 가능한 입력란이 없습니다.');
      inputDocument=receiver.doc;active.focus();return;
    }
    inputDocument=document;
    const editable=el.isContentEditable ? el.closest('[contenteditable="true"]') : null;
    (editable || el).focus();
    if (el.matches('input,textarea')) { el.setSelectionRange(el.value.length, el.value.length); return; }
    const range = document.createRange(); range.selectNodeContents(el); range.collapse(false);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  };
  const insertText = value => {
    const el = inputDocument.activeElement;
    if (el?.matches('input,textarea')) {
      const setter = Object.getOwnPropertyDescriptor(el.tagName === 'INPUT' ? inputDocument.defaultView.HTMLInputElement.prototype : inputDocument.defaultView.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, el.value + value); el.dispatchEvent(new inputDocument.defaultView.Event('input', { bubbles: true }));
      el.dispatchEvent(new inputDocument.defaultView.Event('change', { bubbles: true })); return;
    }
    if (!inputDocument.execCommand('insertText', false, value)) throw new Error('편집기가 본문 입력을 허용하지 않았습니다.');
  };
  const insertParagraph = async () => {
    if(inputDocument!==document){
      for(const type of ['keydown','keypress','keyup'])inputDocument.activeElement.dispatchEvent(new inputDocument.defaultView.KeyboardEvent(type,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));
      await wait(40);
    } else if(!inputDocument.execCommand('insertParagraph'))throw new Error('새 문단을 만들지 못했습니다.');
  };
  const setField = (el, value, name = '설정', numeric = false) => {
    if (!el) throw new Error(`${name} 입력란을 찾지 못했습니다. 요청 값: ${value}`);
    if (el.matches('select')) {
      const option = [...el.options].find(o => o.value === value || o.textContent.trim() === value
        || (numeric && /^\d+$/.test(o.value) && Number(o.value) === Number(value)));
      if (!option) throw new Error(`${name} 선택 값을 찾지 못했습니다. 요청: ${value}, 선택 가능: ${[...el.options].map(o=>o.value).join(', ')}`); el.value = option.value;
    } else {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
    }
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const lastBody = async () => {
    const components=[...document.querySelectorAll('.se-component')].filter(el=>!el.closest('.se-title, .se-documentTitle'));
    const last=components.at(-1); let target=allParagraphs().at(-1);
    if(args.anchorId){
      const anchor=document.getElementById(args.anchorId);
      if(!anchor || !components.includes(anchor))throw new Error('직전 입력 요소가 사라졌습니다. 원고를 다시 대조해야 합니다.');
      const following=components.slice(components.indexOf(anchor)+1);
      const anchorLinks=(readText(anchor).match(/https?:\/\/[^\s<>"\u200b]+/g) || []).map(url=>{try{return new URL(url).href.replace(/\/$/,'');}catch{return '';}});
      const generatedPreview=el=>{
        if(!el.matches('.se-oglink'))return false;
        const links=[...el.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')).filter(url=>/^https?:\/\//i.test(url || ''));
        if(links.length)return links.every(url=>{try{return anchorLinks.includes(new URL(url).href.replace(/\/$/,''));}catch{return false;}});
        const display=readText(el.querySelector('.se-oglink-url')).trim();
        try {const shown=new URL(/^https?:\/\//i.test(display)?display:'https://'+display);
          return Boolean(display) && anchorLinks.some(url=>{const target=new URL(url);return target.host===shown.host && (shown.pathname==='/' || target.pathname===shown.pathname) && (!shown.search || target.search===shown.search);});
        }catch{return false;}
      };
      if(following.some(el=>!generatedPreview(el) && (!el.matches('.se-text') || normalize(readText(el)))))throw new Error('입력 기준점 뒤에 다른 내용이 있습니다. 덮어쓰지 않습니다.');
    }
    // Completed paragraph commands already leave an empty paragraph behind.
    // Never reselect a populated paragraph: SmartEditor resets its input buffer
    // on click and display coordinates can split the final word.
    if((target && readText(target).trim()) || (last && !last.contains(target) && !last.matches('.se-text'))){
      const beforeText=bodyText();
      const add=find('button.se-canvas-bottom-button');
      if(add){
        add.scrollIntoView({block:'center',behavior:'instant'});await wait(100);
        const rect=add.getBoundingClientRect();
        const x=Math.max(1,Math.min(innerWidth-1,rect.left+rect.width/2));
        const y=Math.max(1,Math.min(innerHeight-1,rect.top+Math.min(rect.height/2,25)));
        for(const type of ['mousedown','mouseup','click'])add.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,buttons:type==='mousedown'?1:0,view:window}));
        await waitFor(()=>{const end=paragraphs().at(-1);return end && !readText(end).trim() && end!==target && bodyText()===beforeText;});target=paragraphs().at(-1);
      }
      if(!target || readText(target).trim() || bodyText()!==beforeText)throw new Error(`새 입력 영역 확인 실패: 빈 문단 ${Boolean(target && !readText(target).trim())}, 원문 보존 ${bodyText()===beforeText}, 본문 길이 ${beforeText.length} → ${bodyText().length}. 기존 내용은 자동 삭제하지 않습니다.`);
      if(last && !last.contains(target) && !(last.compareDocumentPosition(target)&Node.DOCUMENT_POSITION_FOLLOWING))throw new Error('문서 맨 아래의 입력 위치를 찾지 못했습니다.');
    }
    if(!target)throw new Error('본문 입력 위치를 찾지 못했습니다.');await activateParagraph(target);return target;
  };
  if(command==='dismissResume'){
    // Confirmed on the live Naver editor: match this dialog, never a generic cancel.
    const dialogs=[...document.querySelectorAll('.se-popup-container')].filter(visible);
    for(const dialog of dialogs){
      const heading=dialog.querySelector('.se-popup-title')?.textContent.trim();
      const message=dialog.querySelector('.se-popup-alert-text')?.textContent || '';
      if(heading!=='작성 중인 글이 있습니다.' || !message.includes('이어서 작성하시겠습니까?'))continue;
      const cancel=dialog.querySelector('button.se-popup-button-cancel');
      if(!visible(cancel) || cancel.textContent.trim()!=='취소')return {ok:false,error:'임시글 이어쓰기 창의 취소 버튼을 확인하지 못했습니다. Chrome에서 취소해 주세요.'};
      cancel.click();return {ok:true,dismissed:true};
    }
    return {ok:true,dismissed:false};
  }
  if(command==='snapshot'){
    const blocks=[];
    for(const el of document.querySelectorAll('.se-component')){
      if(el.matches('.se-documentTitle'))continue;
      const id=el.id;
      if(el.matches('.se-text')){const text=[...el.querySelectorAll('.se-text-paragraph')].map(readText).join('\n');if(normalize(text))blocks.push({id,type:'paragraph',text});}
      else if(el.matches('.se-quotation'))blocks.push({id,type:'quote',text:readText(el.querySelector('.se-quote .se-text-paragraph') || el.querySelector('.se-text-paragraph')),style:el.classList.contains('se-l-quotation_line')?'quotation_line':'default'});
      else if(el.matches('.se-image'))blocks.push({id,type:'image',name:el.querySelector('img')?.getAttribute('alt') || ''});
      else if(el.matches('.se-oglink')){
        const urls=[...el.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')).filter(url=>/^https?:\/\//i.test(url || ''));
        const displayUrl=readText(el.querySelector('.se-oglink-url')).trim();
        if(!urls.length && !displayUrl)throw new Error('링크 미리보기의 표시 주소를 읽지 못했습니다. 기존 글을 보존합니다.');
        blocks.push({id,type:'linkPreview',url:urls[0] || '',displayUrl});
      }
      else throw new Error(`지원하지 않는 편집기 요소: ${String(el.className)}. 기존 글을 보존합니다.`);
    }
    return {ok:true,title:readText(findTitle()).trim(),blocks};
  }
  if (command === 'inspect') {
    const url=new URL(location.href), identities=url.searchParams.getAll('blogId');
    const pathIdentity=/^\/([^/]+)\/postwrite\/?$/.exec(url.pathname)?.[1];
    if(args.blogId && (identities.length>1 || identities.some(id=>id!==args.blogId) || pathIdentity && pathIdentity!==args.blogId))return {status:'account_mismatch',reason:'다른 블로그의 편집기가 열려 있습니다. 해당 계정으로 로그인해 주세요.'};
    const securityText=title ? [...document.querySelectorAll('[role="dialog"],.se-popup')].filter(visible).map(e=>e.innerText).join(' ') : text;
    if (/보호조치|자동입력 방지|보안 확인|본인 확인/.test(securityText) || find('input[name*="captcha"], #captcha')) return { status: 'security_check', reason: 'Chrome에서 추가 인증을 완료해 주세요.' };
    if (location.hostname === 'nid.naver.com') return { status: 'expired', reason: '열린 Chrome에서 로그인하세요. 완료되면 자동으로 이어집니다.' };
    const redirect=url.searchParams.getAll('Redirect');
    const ownRoute=location.hostname==='blog.naver.com' && args.blogId &&
      (pathIdentity===args.blogId || /^\/PostWriteForm\.(naver|nhn)$/i.test(url.pathname) && identities[0]===args.blogId || url.pathname.replace(/\/$/,'')===`/${args.blogId}` && redirect[0]==='Write');
    if(!ownRoute || redirect.length>1 || redirect.some(r=>r!=='Write'))return {status:'unknown',reason:'대상 블로그의 글쓰기 프레임이 아닙니다.'};
    if (!title && /권한이 없|접근이 제한|잘못된 접근|본인의 블로그/.test(text)) return { status: 'account_mismatch', reason: '이 블로그의 계정으로 로그인해 주세요.' };
    const components=[...document.querySelectorAll('.se-component')].filter(el=>visible(el) && !el.matches('.se-documentTitle') && !el.closest('.se-documentTitle'));
    const titleQuoteOnly=!bodyText() && components.length===1 && components[0].matches('.se-quotation.se-l-default') && normalize(readText(components[0].querySelector('.se-text-paragraph')))===normalize(readText(title));
    // A quotation replaces the initial empty text component. It is still an
    // editor; the next command creates a text slot or uploads an image.
    const insertionReady=Boolean(find('button.se-canvas-bottom-button') && components.some(el=>el.matches('.se-quotation,.se-image')));
    if (title && (body || insertionReady)) return { status: 'valid', blogId:args.blogId, editorBuild:build, titleQuoteOnly, reason: '글쓰기 화면 확인 · 확장 '+build+' · 제목 '+title.tagName+'/'+(title.isContentEditable?'편집가능':'편집불가')+' · 입력호스트 '+(title.closest('[contenteditable]')?.getAttribute('contenteditable') ?? '없음'), automationControlled: navigator.webdriver === true, titleText:readText(title).trim(),bodyHasContent:Boolean(paragraphs().some(p=>readText(p).trim()) || document.querySelector('.se-component.se-image') || quotes().length),hasContent: Boolean(readText(title).trim() || paragraphs().some(p => readText(p).trim()) || document.querySelector('.se-component.se-image') || quotes().length) };
    return { status: 'unknown', reason: `편집기를 확인할 수 없습니다. Chrome의 알림·임시글 창을 확인하세요. (확장 ${build}, 제목 ${title?'있음':'없음'}, 본문 ${body?'있음':'없음'})`, diagnostics:{url:location.origin+location.pathname,ready:document.readyState,editableCount:document.querySelectorAll('[contenteditable]').length,componentCount:document.querySelectorAll('.se-component').length} };
  }
  if (command === 'reserved') {
    const url=new URL(location.href);
    if(url.hostname!=='blog.naver.com' || !(url.pathname===`/${args.blogId}/postwrite` || url.pathname===`/${args.blogId}` && url.searchParams.get('Redirect')==='Write' || /^\/PostWriteForm\.(naver|nhn)$/.test(url.pathname) && url.searchParams.get('blogId')===args.blogId))return {complete:false,reason:'예약 확인 대상 블로그가 아닙니다.'};
    const normalize=value=>String(value || '').replace(/\s+/g,' ').trim();
    const target=new Date(Math.ceil(new Date(args.scheduledAt).getTime()/600000)*600000);
    if(!Number.isFinite(target.getTime()) || !normalize(args.title))return {complete:false,reason:'예약 확인 제목 또는 시각이 없습니다.'};
    const rows=[...document.querySelectorAll('button[data-click-area="tpb*t.schedulelist"]')].filter(visible);
    if(!rows.length){
      const open=find('button[data-click-area="tpb*t.schedule"]');
      if(open && ![...document.querySelectorAll('strong')].some(el=>visible(el) && el.textContent.trim()==='예약 발행 글'))open.click();
      return {complete:false,reason:'예약 목록을 불러오는 중입니다.'};
    }
    const matches=rows.filter(row=>{
      if(normalize(row.querySelector('strong')?.textContent)!==normalize(args.title))return false;
      const parts=(row.querySelector('span[class*="date"]')?.textContent || '').match(/^\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\s+(\d{1,2}):(\d{2})\s*$/);
      return parts && [target.getFullYear(),target.getMonth()+1,target.getDate(),target.getHours(),target.getMinutes()].every((value,index)=>value===Number(parts[index+1]));
    });
    return matches.length===1
      ? {complete:true,published:true,scheduled:true,scheduledAt:target.toISOString(),verification:'reservation-list',managementUrl:location.href}
      : {complete:false,reason:matches.length>1?'같은 제목과 시각의 예약글이 여러 개입니다.':'제목과 예약 시각이 일치하는 글을 찾지 못했습니다.'};
  }
  if (command === 'published') {
    const url = new URL(location.href);
    const direct = url.hostname === 'blog.naver.com' && new RegExp('^/' + args.blogId + '/[0-9]+/?$').test(url.pathname);
    const legacy = url.hostname === 'blog.naver.com' && /PostView\.naver$/.test(url.pathname) && url.searchParams.get('blogId') === args.blogId && /^\d+$/.test(url.searchParams.get('logNo') || '');
    const editorOpen=Boolean(find('button[data-click-area="tpb.publish"]'));
    const expected=String(args.title || '').replace(/\s+/g,' ').trim();
    const actual=readText(title).replace(/\s+/g,' ').trim();
    const complete=!editorOpen && (direct || legacy) && Boolean(expected) && actual===expected;
    // The published viewer uses the same title classes as the editor. After
    // writing, Naver can initially render the previous post under the new URL.
    const logNo=legacy ? url.searchParams.get('logNo') : direct ? url.pathname.split('/')[2] : '';
    const listed=!complete && !editorOpen && logNo && [...document.querySelectorAll('a[href]')].some(a=>{
      if(a.textContent.replace(/\s+/g,' ').trim()!==expected)return false;
      try{const link=new URL(a.href,location.href);return link.hostname==='blog.naver.com' && link.searchParams.get('blogId')===args.blogId && link.searchParams.get('logNo')===logNo;}catch{return false;}
    });
    return {complete,url:location.href,...(listed?{refreshUrl:'https://blog.naver.com/PostView.naver?blogId='+encodeURIComponent(args.blogId)+'&logNo='+logNo}:{})};
  }
  if (!title) return { ok: false, error: '대상 편집기가 아닙니다.' };
  const activateTitle=async()=>{
    step='focus-title';await activateParagraph(title);
    const current=findTitle() || title,component=current.closest?.('.se-documentTitle');
    if(!current.isContentEditable && component?.classList){
      const selected=()=>(findTitle() || title).closest?.('.se-documentTitle')?.classList?.contains('se-is-selected') && resolveInput().doc!==document;
      if(!await waitFor(selected))throw new Error('제목 요소는 찾았지만 편집기가 제목을 입력 대상으로 선택하지 않았습니다. 본문에 잘못 입력하지 않도록 중지했습니다.');
    }
  };
  if(command==='preflightTitle'){await activateTitle();return {ok:true,editorBuild:build};}
  if(command==='probeTitle'){
    const describe=el=>el ? el.tagName+'.'+String(el.className || '').slice(0,90)+' editable='+el.isContentEditable : '없음';
    await activateParagraph(title);
    const receiver=resolveInput();return {ok:true,reason:'입력문서 '+(receiver.doc===document?'현재 문서':'별도 프레임')+' / 활성 '+describe(receiver.active)+' / 표시 '+describe(title)};
  }
  if (command === 'title') {
    const normalize=value=>String(value || '').replace(/[\u200b\ufeff]/g,'').replace(/\s+/g,' ').trim();
    const expected=normalize(args.text),existing=normalize(readText(title));
    if(!expected)return {ok:false,error:'제목이 비어 있습니다.'};
    if(existing===expected)return {ok:true,alreadyApplied:true};
    if(existing)throw new Error('기존 제목을 덮어쓰지 않습니다.');
    await activateTitle();
    // The hidden SmartEditor input buffer is shared by title and body. Its focus
    // alone is not proof of which model will receive the text.
    step='insert-title';insertText(args.text);step='verify-title';
    // SmartEditor can replace the paragraph node while committing an edit.
    // Reacquire it instead of checking a detached pre-input node after 80 ms.
    let observed='';
    for(let n=0;n<30;n++){
      await wait(100);observed=normalize(readText(findTitle()));
      if(observed===expected){await wait(150);if(normalize(readText(findTitle()))===expected)return {ok:true};}
    }
    return {ok:false,error:'제목 입력 확인 실패: '+(observed?'입력된 제목이 요청한 제목과 다릅니다.':'제목 입력란이 비어 있습니다.')+' 기존 글을 보존했습니다.',diagnostics:{expectedLength:expected.length,observedLength:observed.length,titleFound:Boolean(findTitle()),oldNodeConnected:title.isConnected}};
  }
  if (command === 'paragraph') {
    const beforeText=bodyText();
    await lastBody();
    const value=String(args.text),lines=[];
    if(args.breakSentences){
      let start=0;
      for(const boundary of value.matchAll(/[.!?。！？](?:\s*\[참고\s*\d+\])*\s+/gu)){
        const end=boundary.index+boundary[0].length;
        const part=value.slice(start,end).trim();
        // A numbered list marker is not a complete sentence.
        if(/^\d+\.$/.test(part))continue;
        lines.push(part);start=end;
      }
      const tail=value.slice(start).trim();if(tail)lines.push(tail);
    } else lines.push(value);
    for(let i=0;i<lines.length;i++){
      if(i){await insertParagraph();await insertParagraph();}
      insertText(lines[i]);
      // Wait for the editor model to commit before Enter or a toolbar action.
      if(!await waitFor(()=>bodyText()===beforeText+normalize(lines.slice(0,i+1).join(''))))throw new Error('본문 입력이 원문과 일치하지 않아 다음 요소 삽입을 중지했습니다.');
    }
    // Keep the caret created by insertText, before any new click can reset it.
    await insertParagraph();
    if(args.breakSentences && /[.!?。！？]$/.test(value.trim()))await insertParagraph();
    const emptyTail=()=>!readText(paragraphs().at(-1)).trim() && bodyText()===beforeText+normalize(lines.join(''));
    if(!await waitFor(emptyTail)){
      // SmartEditor consumes the first Enter to recognize a standalone URL.
      if(/^https?:\/\/\S+$/.test(value.trim()) && bodyText()===beforeText+normalize(lines.join('')))await insertParagraph();
      if(!await waitFor(emptyTail))throw new Error('본문 끝의 빈 문단 생성이 완료되지 않았습니다.');
    }
    // A link has no sentence-ending punctuation. Reserve its blank separator
    // explicitly, whether SmartEditor creates a preview card or plain text.
    if(/^https?:\/\/\S+$/.test(value.trim())){
      await insertParagraph();
      if(!await waitFor(emptyTail))throw new Error('참고 링크 뒤 빈 줄 생성이 완료되지 않았습니다.');
    }
    return { ok: true };
  }
  if (command === 'quote') {
    const beforeText=bodyText();
    const styleName=args.style || 'default';
    if(!['default','quotation_line'].includes(styleName))throw new Error('지원하지 않는 인용구 스타일입니다.');
    const button = find('button[data-name="quotation"][aria-haspopup="true"]');
    if (!button) throw new Error('인용구 버튼을 찾지 못했습니다.');
    const before = quotes().length;
    await lastBody();
    button.click(); await wait(150);
    const style=find(`button[data-name="quotation"][data-role="option"][data-value="${styleName}"]`);
    if(!style)throw new Error('요청한 인용구 스타일을 찾지 못했습니다: '+styleName);
    style.click();await waitFor(()=>quotes().length>before);
    const quote = quotes().at(-1);
    if (!quote || quotes().length <= before) throw new Error('네이버 인용구 삽입을 확인하지 못했습니다.');
    const field = [...quote.querySelectorAll('.se-text-paragraph,[contenteditable="true"]')].find(el=>!el.closest('.se-source,[class*="source"],[class*="caption"]'));
    if (!field) throw new Error('인용구 입력 영역이 없습니다.');
    await activateParagraph(field); insertText(args.text);
    if(!await waitFor(()=>normalize(readText(quotes().at(-1)))===normalize(args.text)))throw new Error('인용구 제목 입력이 완료되지 않았습니다.');
    if(bodyText()!==beforeText)throw new Error('인용구 삽입 중 기존 본문이 변경되었습니다.');
    if(!quotes().at(-1).classList.contains('se-l-'+styleName))throw new Error('인용구 스타일 반영 실패: '+styleName);
    // Use the editor's own component separator to exit the quotation when available.
    const separator = quote.nextElementSibling?.querySelector('[contenteditable="true"], .se-text-paragraph');
    if (separator) { await activateParagraph(separator); }
    return { ok: true };
  }
  if (command === 'image') {
    await lastBody();
    const before = document.querySelectorAll('.se-component.se-image, .se-component[data-comp-type="image"]').length;
    const findImageInput=()=>[...document.querySelectorAll('input[type="file"]')].find(el=>/image|\.png|\.jpg/i.test(el.accept || ''));
    let input = findImageInput();
    if (!input) {
      const button = find('button[data-name="image"], button[data-name="photo"], .se-image-toolbar-button');
      if (!button) throw new Error('사진 버튼을 찾지 못했습니다.'); button.click();
      for(let n=0;n<50 && !input;n++){await wait(100);input=findImageInput();}
    }
    if (!input) throw new Error('사진 업로드 입력을 찾지 못했습니다.');
    const transfer = new DataTransfer(); const data = Uint8Array.from(atob(args.data), c => c.charCodeAt(0));
    transfer.items.add(new File([data], args.name, { type: args.mime })); input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    for (let n = 0; n < 40; n++) {
      await wait(400);
      const images = [...document.querySelectorAll('.se-component.se-image, .se-component[data-comp-type="image"]')];
      if (images.length > before) {
        if(args.aiGenerated!==false)await ensureImageAi(images.at(-1));
        return { ok: true };
      }
    }
    throw new Error('이미지 업로드 완료를 확인하지 못했습니다.');
  }
  if (command === 'imageAi') {
    const images=[...document.querySelectorAll('.se-component.se-image, .se-component[data-comp-type="image"]')];
    if(!Array.isArray(args.imageAiFlags) || images.length!==args.imageAiFlags.length)throw new Error('이미지 원본 구분과 편집기 이미지 수가 다릅니다.');
    for(const [i,image] of images.entries())if(args.imageAiFlags[i])await ensureImageAi(image);
    return {ok:true};
  }
  if (command === 'verify') {
    const expected = args.article.replace(/^\[SECTION\s*-\s*(.+)\]\s*$/gmi, '$1').replace(/^\[IMAGE INSERT\s*-\s*\d+\]\s*$/gmi, '').split(/\r?\n/).map(s=>s.replace(/\s+/g,'')).filter(Boolean);
    const actual = [...document.querySelectorAll('.se-component-content')].map(e => e.textContent).join('').replace(/\s+/g, '');
    const count = document.querySelectorAll('.se-component.se-image, .se-component[data-comp-type="image"]').length;
    let offset=0,missing=-1;const matches=expected.every((block,n)=>{const index=actual.indexOf(block,offset);if(index<0){missing=n;return false;}offset=index+block.length;return true;});
    const sectionQuotes=args.titleQuote?quotes().slice(1):quotes();
    const quoteCount=(args.article.match(/^\[SECTION\s*-/gmi)||[]).length;
    const issues=[];
    if(readText(title).trim()!==args.title.trim())issues.push('제목 불일치');
    if(!matches)issues.push(`본문 ${missing+1}번째 블록 누락 또는 순서 불일치: ${expected[missing].slice(-100)}`);
    if(count!==args.imageCount)issues.push(`이미지 ${count}/${args.imageCount}개`);
    if(args.requireAi){if(!Array.isArray(args.imageAiFlags) || args.imageAiFlags.length!==count)issues.push('이미지 원본 구분 누락');const unchecked=[...document.querySelectorAll('.se-component.se-image, .se-component[data-comp-type="image"]')].map((e,i)=>args.imageAiFlags?.[i]===false || e.querySelector('.se-set-ai-mark-button-toggle')?.classList.contains('se-is-selected')?null:i+1).filter(Boolean);if(unchecked.length)issues.push(`이미지 AI 활용 미설정: ${unchecked.join(', ')}번`);}
    if(args.titleQuote && (!quotes()[0]?.classList.contains('se-l-default') || normalize(readText(quotes()[0]))!==normalize(args.title)))issues.push('본문 최상단 제목 인용구 불일치');
    if(sectionQuotes.length!==quoteCount)issues.push(`섹션 ${sectionQuotes.length}/${quoteCount}개`);
    if(args.sectionStyle && sectionQuotes.some(q=>!q.classList.contains('se-l-'+args.sectionStyle)))issues.push('섹션 버티컬 스타일 불일치');
    if(args.plan){
      const components=[...document.querySelectorAll('.se-component')].filter(e=>!e.matches('.se-text') || normalize(readText(e)));let section=-1;
      for(let i=0;i<args.plan.length;i++)if(args.plan[i].type==='section'){
        const quote=sectionQuotes[++section],start=components.indexOf(quote);
        let imageCount=0;for(let j=i+1;j<args.plan.length && args.plan[j].type==='image';j++)imageCount++;
        if(start<0 || Array.from({length:imageCount},(_,n)=>components[start+n+1]).some(e=>!e?.matches('.se-image,[data-comp-type="image"]')))issues.push(`섹션 ${section+1} 제목 다음 이미지 배치 불일치`);
      }
    }
    return {ok:issues.length===0,...(issues.length?{error:'발행 전 확인 실패: '+issues.join(' · ')}:{})};
  }
  if (command === 'click') {
    if(args.skipIfSelector && find(args.skipIfSelector))return {ok:true,alreadyApplied:true};
    const el = args.selector ? find(args.selector) : exact(args.text);
    if (!el) throw new Error(`${args.text || '요청한'} 버튼을 찾지 못했습니다.`); el.click(); return { ok: true };
  }
  if (command === 'settings') {
    if (args.category) {
      const categoryButton=()=>find('button[data-click-area="tpb*i.category"], button[aria-label="카테고리 목록 버튼"]');
      const button = categoryButton();
      if (!button) throw new Error('카테고리 선택을 확인할 수 없습니다.'); if(button.getAttribute('aria-expanded')!=='true'){button.click();await wait(150);}
      // Search the whole category menu, regardless of nesting depth. Accessibility
      // hints describe hierarchy, but are not part of the category's name.
      const categoryKey=text=>String(text).normalize('NFC').replace(/[\s\u200b\ufeff]+/gu,'');
      const categoryName=el=>{
        if(!el)return '';
        const clone=el.cloneNode(true);
        clone.querySelectorAll('.blind, [aria-hidden="true"]').forEach(node=>node.remove());
        return categoryKey(clone.textContent);
      };
      const requested=String(args.category).replace(/\s+/g,' ').trim();
      const requestedKey=categoryKey(args.category);
      const options=()=>[...(categoryButton()?.parentElement?.querySelector('[role="menu"]')?.querySelectorAll('label[for]') || [])]
        .filter(label=>label.querySelector('[data-testid^="categoryItemText_"]'));
      let candidates=[];
      for(let n=0;n<20;n++){
        candidates=options().filter(label=>categoryName(label.querySelector('[data-testid^="categoryItemText_"]'))===requestedKey);
        if(candidates.length)break;
        await wait(100);
      }
      if(!candidates.length)throw new Error(`등록한 카테고리를 찾지 못했습니다: ${requested}`);
      if(candidates.length>1)throw new Error(`같은 이름의 카테고리가 ${candidates.length}개 있습니다: ${requested}. 카테고리명을 구분해 주세요.`);
      const category=candidates[0];
      const itemId=category.querySelector('[data-testid^="categoryItemText_"]').getAttribute('data-testid');
      const selected=()=>{
        const current=categoryButton();
        const item=current?.querySelector('[data-testid^="categoryItemText_"]');
        return current?.getAttribute('aria-expanded')==='false' && item?.getAttribute('data-testid')===itemId && categoryName(item)===requestedKey;
      };
      category.scrollIntoView({block:'nearest'});category.click();
      for(let n=0;n<20 && !selected();n++)await wait(100);
      if(!selected())throw new Error('카테고리 선택 결과를 확인할 수 없습니다.');
    }
    const visibility = args.publishVisibility === 'public' ? '전체공개' : '비공개';
    const label = exact(visibility); if (!label) throw new Error('공개 설정을 찾지 못했습니다.'); label.click(); await wait(100);
    const radio = label.querySelector('input') || document.getElementById(label.htmlFor || '');
    if (!(radio?.checked || label.getAttribute('aria-checked') === 'true')) throw new Error('공개 설정을 확인하지 못했습니다.');
    const tagInput = find('input[placeholder*="태그"], input[class*="tag_input"]');
    for (const tag of args.tags || []) {
      if (!tagInput) throw new Error('태그 입력란을 찾지 못했습니다.'); setField(tagInput, tag);
      tagInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      tagInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      await wait(40); if (tagInput.value) throw new Error('태그 입력 반영을 확인하지 못했습니다.');
    }
    if (args.publishScheduleMode === 'reserve') {
      step='reserve';
      const reserve = exact('예약'); if (!reserve) throw new Error('예약 설정을 찾지 못했습니다.'); reserve.click(); await wait(100);
      const requested = new Date(args.scheduledAt).getTime();
      if (!Number.isFinite(requested)) throw new Error('예약 시각이 올바르지 않습니다.');
      const date = new Date(Math.ceil(requested / 600000) * 600000); const pad = n => String(n).padStart(2, '0');
      const field = find('input[class*="input_date"], input[type="date"]');
      const dateValue = [date.getFullYear(), pad(date.getMonth()+1), pad(date.getDate())].join(field?.type === 'date' ? '-' : '.');
      step='reserve-date';
      const sameDate=value=>{
        const parts=String(value || '').match(/^\s*(\d{4})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{1,2})\s*\.?\s*$/);
        return parts && Number(parts[1])===date.getFullYear() && Number(parts[2])===date.getMonth()+1 && Number(parts[3])===date.getDate();
      };
      if(field?.readOnly && !sameDate(field.value)){
        field.click();await wait(100);
        const targetMonth=date.getFullYear()*12+date.getMonth();let matched=false;
        for(let n=0;n<25;n++){
          const calendar=find('.ui-datepicker');
          const year=Number(calendar?.querySelector('.ui-datepicker-year')?.textContent);
          const month=parseInt(calendar?.querySelector('.ui-datepicker-month')?.textContent,10);
          if(!calendar || !year || !month)throw new Error('예약 달력의 연월을 읽지 못했습니다.');
          const current=year*12+month-1;
          if(current===targetMonth){
            const day=[...calendar.querySelectorAll('td button')].find(button=>button.textContent.trim()===String(date.getDate()) && !button.disabled && !button.closest('.ui-state-disabled'));
            if(!day)throw new Error(`예약 달력에서 선택 가능한 날짜가 아닙니다: ${dateValue}`);
            day.click();matched=true;break;
          }
          const move=calendar.querySelector(current<targetMonth?'.ui-datepicker-next':'.ui-datepicker-prev');
          if(!move || move.disabled || move.classList.contains('ui-state-disabled'))throw new Error(`예약 달력에서 이동할 수 없는 날짜입니다: ${dateValue}`);
          move.click();await wait(100);
        }
        if(!matched)throw new Error('예약 달력의 날짜 이동 범위를 초과했습니다.');
      } else if(!field?.readOnly)setField(field,dateValue,'예약 날짜');
      await wait(100);
      step='reserve-hour';setField(find('select[class*="hour"], input[class*="hour"]'), pad(date.getHours()), '예약 시', true);await wait(100);
      step='reserve-minute';setField(find('select[class*="minute"], input[class*="minute"]'), pad(date.getMinutes()), '예약 분', true);await wait(100);
      step='reserve-verify';
      const actualDate=find('input[class*="input_date"], input[type="date"]')?.value || '';
      if (!sameDate(actualDate)
        || Number(find('select[class*="hour"], input[class*="hour"]')?.value) !== date.getHours()
        || Number(find('select[class*="minute"], input[class*="minute"]')?.value) !== date.getMinutes()) {
        throw new Error(`예약 시각 반영을 확인하지 못했습니다. 요청: ${dateValue} ${pad(date.getHours())}:${pad(date.getMinutes())}, 실제: ${actualDate} ${find('select[class*="hour"], input[class*="hour"]')?.value}:${find('select[class*="minute"], input[class*="minute"]')?.value}`);
      }
    }
    return { ok: true };
  }
  return { ok: false, error: '지원하지 않는 편집 동작입니다.' };
  } catch(error) {
    // Chrome may otherwise resolve executeScript with an undefined result for
    // an injected exception. Always serialize the actual page-side failure.
    return {ok:false,status:'unknown',error:command+' ['+build+'/'+step+']: '+String(error?.message || error),reason:'편집기 스크립트 오류: '+String(error?.message || error),diagnostics:{build,step,activeTag:document.activeElement?.tagName || '',activeEditable:Boolean(document.activeElement?.isContentEditable)}};
  }
}

if(typeof module!=='undefined')module.exports={editorCommand};
