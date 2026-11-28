const protocols = new Set(['http:','https:','mailto:','tel:']);
export function safeLink(url) {
  if (typeof url !== 'string' || /[\u0000-\u0020\u007f]/.test(url)) return false;
  try { return protocols.has(new URL(url).protocol); } catch { return false; }
}
export function linkTarget(nav,total) {
  if (Number.isInteger(nav?.slideIndex) && nav.slideIndex>=0 && nav.slideIndex<total) return {page:nav.slideIndex+1};
  if (safeLink(nav?.url)) return {url:nav.url};
  return {unavailable:'此链接需要原文件或外部程序，无法在课件中打开。'};
}
export function validateLinks(links,total) {
  if (!Array.isArray(links)) throw Error('课件链接数据异常。');
  return links.map(l=>{
    if (!l || ![l.x,l.y,l.w,l.h].every(Number.isFinite) || l.x<0 || l.y<0 || l.w<=0 || l.h<=0 ||
      l.x+l.w>1.00001 || l.y+l.h>1.00001 || typeof l.label!=='string' ||
      [l.url!==undefined,l.page!==undefined,l.unavailable!==undefined].filter(Boolean).length!==1 ||
      (l.url!==undefined && !safeLink(l.url)) ||
      (l.page!==undefined && !(Number.isInteger(l.page) && l.page>=1 && l.page<=total)) ||
      (l.unavailable!==undefined && typeof l.unavailable!=='string')) throw Error('课件链接数据异常。');
    const {x,y,w,h,label,url,page,unavailable}=l;
    return {x,y,w,h,label,...(url!==undefined?{url}:page!==undefined?{page}:{unavailable})};
  });
}
export function linkRects(rects,base,target,label='') {
  if (!base.width || !base.height) return [];
  return Array.from(rects).flatMap(r=>{
    const x=Math.max(0,r.left-base.left),y=Math.max(0,r.top-base.top);
    const right=Math.min(base.width,r.right-base.left),bottom=Math.min(base.height,r.bottom-base.top);
    return right>x && bottom>y ? [{x:x/base.width,y:y/base.height,w:(right-x)/base.width,h:(bottom-y)/base.height,label,...target}] : [];
  });
}
export function capturePptxLinks(root,total,probe) {
  const base=root.getBoundingClientRect(),links=[];
  // Use the renderer's own navigation resolution, without activating browser navigation.
  const prevent=e=>e.preventDefault();root.addEventListener('click',prevent,true);
  try {
    for (const el of root.querySelectorAll('a[href],[role=link],[title]')) {
      let nav;
      if (el.matches('a[href]')) nav={url:el.getAttribute('href')};
      else if (el.getAttribute('role')==='link' || el.style.cursor==='pointer') {
        probe(null);el.dispatchEvent(new MouseEvent('click',{bubbles:false,cancelable:true}));nav=probe();
      }
      if (!nav) continue;
      links.push(...linkRects(el.getClientRects(),base,linkTarget(nav,total),(el.textContent?.trim() || el.title || '').slice(0,300)));
    }
  } finally {root.removeEventListener('click',prevent,true);}
  return validateLinks(links,total);
}
export function slideLinkLayer(host,image,jump,report) {
  const layer=document.createElement('div');layer.className='slide-link-layer';host.append(layer);
  function resize() {
    const w=image.naturalWidth,h=image.naturalHeight;
    if (!w || !h) return;
    const scale=Math.min(host.clientWidth/w,host.clientHeight/h);
    layer.style.width=w*scale+'px';layer.style.height=h*scale+'px';
  }
  new ResizeObserver(resize).observe(host);image.addEventListener('load',resize);
  let active=[],pressed;
  const stage=host.parentElement;
  stage.addEventListener('pointerdown',e=>{pressed=e.button===0?{x:e.clientX,y:e.clientY,time:performance.now(),moved:false}:null;});
  stage.addEventListener('pointermove',e=>{if(pressed && Math.hypot(e.clientX-pressed.x,e.clientY-pressed.y)>8)pressed.moved=true;});
  stage.addEventListener('pointercancel',()=>{pressed=null;});
  stage.addEventListener('click',e=>{
    if(e.target.closest('.slide-link'))return;
    const down=pressed;pressed=null;
    if(!down || down.moved || performance.now()-down.time>600 || getSelection()?.toString())return;
    const r=layer.getBoundingClientRect(),x=(e.clientX-r.left)/r.width,y=(e.clientY-r.top)/r.height;
    const matches=active.map((l,i)=>({l,i})).filter(({l})=>x>=l.x && x<=l.x+l.w && y>=l.y && y<=l.y+l.h)
      .sort((a,b)=>a.l.w*a.l.h-b.l.w*b.l.h);
    if(matches.length){e.preventDefault();layer.children[matches[0].i].click();}
  });
  return links=>{
    active=links || [];pressed=null;
    layer.replaceChildren();host.hidden=!active.length;
    if (host.hidden) return;
    for (const l of active) {
      const target=l.url || (l.page?'跳到第 '+l.page+' 页':l.unavailable);
      const el=document.createElement(l.url?'a':'button');
      el.className='slide-link';el.title=(l.label?l.label+'：':'')+target;el.setAttribute('aria-label',el.title);
      for (const [key,value] of Object.entries({left:l.x,top:l.y,width:l.w,height:l.h})) el.style[key]=value*100+'%';
      if (l.url && safeLink(l.url)) {el.href=l.url;el.target='_blank';el.rel='noopener noreferrer';}
      else {el.type='button';el.onclick=e=>{if(getSelection()?.toString())return e.preventDefault();l.page?jump(l.page):report(l.unavailable);};}
      el.addEventListener('click',e=>{if(!getSelection()?.isCollapsed && getSelection()?.toString())e.preventDefault();});
      layer.append(el);
    }
    resize();
  };
}
