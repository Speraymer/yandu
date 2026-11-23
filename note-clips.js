const prefix = new URL('.',import.meta.url).pathname + ':clips:';
const scopePrefix = scope => prefix + encodeURIComponent(scope) + ':';

export function sortedClips(clips){
  return clips.sort((a,b)=>a.order-b.order || a.book.localeCompare(b.book) || a.page-b.page ||
    a.time-b.time || a.turn.localeCompare(b.turn) || a.role-b.role || a.offset-b.offset);
}
export function loadClips(scope){
  const start=scopePrefix(scope), clips=[];
  for(let i=0;i<localStorage.length;i++){
    const key=localStorage.key(i);
    if(key?.startsWith(start)) clips.push(JSON.parse(localStorage.getItem(key)));
  }
  return sortedClips(clips);
}
export function saveClip(scope,clip){
  const id=JSON.stringify([clip.turn,clip.role,clip.offset,clip.text.length]);
  localStorage.setItem(scopePrefix(scope)+id,JSON.stringify(clip));
}
export function renderClips(target,scope){
  target.replaceChildren();
  if(!scope)return;
  try {
    const clips=loadClips(scope);
    if(!clips.length){target.textContent='选中提问或回答中的文字，点「写入笔记」即可摘录。';return;}
    for(const c of clips){
      const item=document.createElement('section'), heading=document.createElement('small'), text=document.createElement('p');
      heading.textContent=[c.book,c.page?'第 '+c.page+' 页':'全文',c.role?'回答':'提问'].filter(Boolean).join('　');
      text.textContent=c.text;item.append(heading,text);target.append(item);
    }
  }catch{target.textContent='无法读取摘录，请检查浏览器存储权限。';}
}

export function enableClipSelection(resolve,onSaved,report){
  const button=document.createElement('button');
  button.className='selection-note';button.textContent='写入笔记';button.hidden=true;document.body.append(button);
  let picked;
  function update(){
    const s=getSelection(),range=s?.rangeCount && !s.isCollapsed ? s.getRangeAt(0) : null;
    const start=range && range.startContainer;
    const body=start && (start.parentElement?.closest('.msg-body') || start.closest?.('.msg-body'));
    const article=body?.closest('.msg');
    const meta=article && body.contains(range.endContainer) && article.getClientRects().length && resolve(article);
    const text=meta && s.toString().trim();
    picked=null;button.hidden=true;
    if(!text)return;
    const before=range.cloneRange();before.selectNodeContents(body);before.setEnd(range.startContainer,range.startOffset);
    const offset=before.toString().length;
    picked={scope:meta.scope,clip:{...meta.clip,offset,text}};
    const rect=range.getBoundingClientRect();button.hidden=false;
    button.style.left=Math.max(6,Math.min(rect.left,innerWidth-button.offsetWidth-6))+'px';
    button.style.top=Math.max(5,Math.min(rect.top-button.offsetHeight-5,innerHeight-button.offsetHeight-5))+'px';
  }
  document.addEventListener('selectionchange',update);
  document.addEventListener('scroll',()=>{if(!button.hidden)update();},true);
  button.onpointerdown=e=>e.preventDefault();
  button.onclick=()=>{
    if(!picked)return;
    try{
      saveClip(picked.scope,picked.clip);
      getSelection().removeAllRanges();button.hidden=true;onSaved();
    }catch{report('未能写入笔记，请检查浏览器存储空间。');}
  };
}
