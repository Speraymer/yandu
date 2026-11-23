export function captureText(root){
  const base=root.getBoundingClientRect();
  if (!base.width || !base.height) return null;
  const runs=[], nodes=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  const range=document.createRange();
  function record(node,start,end){
    range.setStart(node,start);range.setEnd(node,end);
    const rects=Array.from(range.getClientRects()).filter(r=>r.width && r.height);
    if(!rects.length)return;
    if(rects.length>1 && end-start>1){
      const mid=start+Math.floor((end-start)/2);
      record(node,start,mid);record(node,mid,end);return;
    }
    const r=rects[0],text=node.data.slice(start,end);
    if(text.trim())runs.push({text,x:r.left-base.left,y:r.top-base.top,w:r.width,h:r.height});
  }
  while(nodes.nextNode()){
    const n=nodes.currentNode;
    if(n.data.trim() && !n.parentElement.closest('style,script,defs,title,desc')) record(n,0,n.length);
  }
  return {w:base.width,h:base.height,runs};
}

export function slideTextLayer(host){
  const layer=document.createElement('div');
  layer.className='slide-text-runs';host.append(layer);
  let layout;
  function resize(){
    if(layout)layer.style.transform='translate(-50%, -50%) scale('+Math.min(host.clientWidth/layout.w,host.clientHeight/layout.h)+')';
  }
  new ResizeObserver(resize).observe(host);
  return value=>{
    layout=value;layer.replaceChildren();host.hidden=!layout?.runs.length;
    if(host.hidden)return;
    layer.style.width=layout.w+'px';layer.style.height=layout.h+'px';
    const ctx=document.createElement('canvas').getContext('2d');
    for(const r of layout.runs){
      const span=document.createElement('span');span.textContent=r.text;
      span.style.left=r.x+'px';span.style.top=r.y+'px';span.style.fontSize=r.h+'px';
      ctx.font=r.h+'px sans-serif';
      span.style.transform='scaleX('+r.w/Math.max(.01,ctx.measureText(r.text).width)+')';
      layer.append(span,document.createTextNode('\n'));
    }
    resize();
  };
}
