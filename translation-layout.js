// Layout is a view over stable alignment IDs. Reflowing a cached translation never changes its text.
export const roles=new Set(['title','author','affiliation','heading','abstract','body','caption','label','table','formula','list','reference']);
const caption=/^(?:(?:fig(?:ure)?|tab(?:le)?)[.:\s]*(?:\d+|[IVX]+\b)|fig\.?$|图\s*\d+|表\s*\d+)/i;
const heading=/^(?:(?:[IVX]+|\d+(?:\.\d+)*|[A-Z])\.$|(?:[IVX]+\.|\d+(?:\.\d+)*\.?)\s+[A-Z].{0,64}$|introduction$|references$|conclusions?$|第[一二三四五六七八九十\d]+[章节])/;
export function classifyLayout(page,segments,items){
  const source=items.filter(i=>typeof i.str==='string');
  const heights=source.filter(i=>i.str.length>=25).map(i=>i.height).sort((a,b)=>a-b);
  const base=heights[Math.floor(heights.length/2)]||10;
  const margins=new Map();
  for(const i of source)if(i.str.length>25){const x=Math.round(i.transform[4]/3)*3;margins.set(x,1+(margins.get(x)||0));}
  const lefts=[...margins].sort((a,b)=>b[1]-a[1]).slice(0,2).map(m=>m[0]);
  let prior=null,mode='',bodyLength=0;
  return segments.map((s,index)=>{
    const first=source[s.parts[0].item],last=source[s.parts.at(-1).item],t=s.text.trim();
    const h=first.height,x=first.transform[4],y=first.transform[5];
    let kind='body',paragraph=false;
    if(caption.test(t)){kind='caption';mode=/^(tab|表)/i.test(t)?'table-caption':'caption';}
    else if(/^abstract\b|^摘\s*要/i.test(t)){kind='abstract';mode='abstract';}
    else if(heading.test(t)||(/^references$/i.test(t))){kind='heading';mode=/references/i.test(t)?'references':'';}
    else if(page===1 && index<4 && h>=base*1.4){kind='title';mode='front';}
    else if(page===1 && mode==='front' && /universit|institut|laborator|college|@|univ\.|大学|学院/i.test(t)){kind='affiliation';}
    else if(page===1 && mode==='front' && prior && t.length<190 &&
      (Math.abs(prior.y-y)<base*3 || (prior.kind==='title' && /[A-Z][a-z]+\s+[A-Z][a-z]+|[∗‡†]/.test(t)))){
      kind=prior.kind==='affiliation'?'affiliation':'author';
    }
    else if(mode.endsWith('caption') && prior && Math.abs(h-prior.h)<.8 && Math.abs(y-prior.y)<base*2.3){kind='caption';}
    else if((mode==='table-caption'||mode==='table') && (h<base*.95 || /(?:\d+\.\d+\s+){3}/.test(t))){kind='table';mode='table';}
    else if(mode==='abstract' && prior && Math.abs(h-prior.h)<1 && y<=prior.y+base*2){kind='abstract';}
    else if(/^\[\d+\]\s/.test(t)||mode==='references'){kind='reference';mode='references';}
    else if(/^[•●▪◦]\s*|^\([a-zivx]+\)\s/i.test(t)){kind='list';mode='';}
    else if(t.length<72 && !/[.!?。！？]$/.test(t) && h>base*1.16){kind='heading';mode='';}
    else if(t.length<85 && /[=∑∫]/.test(t) && !/[a-zA-Z]{6}/.test(t)){kind='formula';mode='';}
    else if(t.length<60 && !/[.!?。！？]$/.test(t) && (mode==='front'||mode==='labels'||(index<20&&!mode&&h<=base*1.1))){kind='label';mode='labels';}
    else mode='';
    if(kind==='body'||kind==='abstract'){
      const indent=s.parts[0].start===0 && lefts.some(left=>x-left>base*.6 && x-left<base*2.3);
      paragraph=!prior||prior.kind!==kind||!!(prior && (prior.y-y>base*1.65||indent&&Math.abs(prior.y-y)>base*.7))||bodyLength>510;
      bodyLength=(paragraph?0:bodyLength)+t.length;
    }else bodyLength=0;
    prior={kind,h:last.height,y:last.transform[5]};
    return {kind,paragraph};
  });
}
function plain(text){
  return text.trim().replace(/^#{1,6}\s+/,'').replace(/^\*\*([\s\S]+)\*\*$/,'$1');
}
function tableRows(text){
  const lines=text.split('\n').filter(s=>s.trim());
  if(lines.length<2)return null;
  const matrix=lines.map(s=>s.split('\t'));
  if(matrix[0].length<2 || matrix.some(r=>r.length!==matrix[0].length))return null;
  const table=document.createElement('table'),body=table.createTBody();
  for(const row of matrix){const tr=body.insertRow();for(const cell of row)tr.insertCell().textContent=cell;}
  return table;
}
export function translatedBlocks(entry){
  const fragment=document.createDocumentFragment();
  let group,kindBefore='',length=0;
  for(let i=0;i<entry.zh.length;i++){
    const hint=entry.layoutHints?.[i],guess=entry.sourceLayout?.[i]||{kind:'body'};
    let kind=roles.has(hint?.kind)?hint.kind:guess.kind;
    let text=plain(entry.zh[i]);
    const pair=entry.n+'-'+(i+1);
    const src=entry.segments?.[i]?.text||'';
    const lead=/^(?:\s*(?:[IVX]+\.|\d+\.)\s*)?(引言|绪论|相关工作|方法概述|实验结果|结论与讨论|结论)(?:[：:\s—-]+|(?=[\u4e00-\u9fff]))/.exec(text);
    if(lead && text.length>lead[0].length && /^(?:[IVX]+\.\s*)?(?:INTRODUCTION|RELATED WORK|METHOD OVERVIEW|RESULTS|CONCLUSION)\b/i.test(src)){
      if(kindBefore!=='heading'){group=document.createElement('h3');group.className='tr-block tr-heading';fragment.append(group);}
      const h=document.createElement('span');h.className='translated';h.dataset.pair=pair;h.textContent=lead[0].trim();
      group.append(' ',h);text=text.slice(lead[0].length);kind='body';kindBefore='heading';
    }
    const start=!group||kind!==kindBefore||(kind==='heading'&&!/^(?:[IVX]+|\d+)\.$/.test(group.textContent.trim()))||kind==='list'||
      kind==='reference'&&/^\[\d+\]/.test(text)||
      (['abstract','body'].includes(kind)&&(hint?.paragraph===true||(hint?.paragraph!==false&&guess.paragraph)||length>540));
    if(start){
      group=document.createElement(({title:'h2',heading:'h3',caption:'figcaption',formula:'div',label:'div',table:'div'})[kind]||'p');
      group.className='tr-block tr-'+kind;fragment.append(group);length=0;
    }
    const run=document.createElement(kind==='table'?'div':'span');run.className='translated';run.dataset.pair=pair;
    const grid=kind==='table'&&tableRows(text);if(grid)run.append(grid);else run.textContent=text;
    if(group.lastChild&&/[A-Za-z0-9)]$/.test(group.lastChild.textContent)&&/^[A-Za-z0-9(]/.test(text))group.append(' ');
    group.append(run);length+=text.length;kindBefore=kind;
  }
  return fragment;
}

