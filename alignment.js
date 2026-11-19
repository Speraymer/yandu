// Fragment offsets stay in the PDF text item's coordinate system across zoom and re-render.
export function segmentsFor(entry, content) {
  if(entry.segments)return entry.segments;
  const result=[], items=content.items.filter(i=>typeof i.str==='string');
  const segmenter=new Intl.Segmenter('en',{granularity:'sentence'});
  let paragraph='', positions=[], last;
  function flush(){
    for(const {segment,index} of segmenter.segment(paragraph)){
      if(!segment.trim())continue;
      const parts=[];
      for(const pos of positions){
        const from=Math.max(index,pos.at),to=Math.min(index+segment.length,pos.end);
        if(to>from)parts.push({item:pos.i,start:from-pos.at,end:to-pos.at});
      }
      if(parts.length)result.push({id:result.length+1,text:segment.trim(),parts});
    }
    positions=[];paragraph='';
  }
  items.forEach((it,i)=>{
    if(!it.str.trim())return;
    const x=it.transform[4],y=it.transform[5],h=Math.max(1,Math.abs(it.height));
    if(last){
      const dy=y-last.transform[5];
      const changedLine=Math.abs(dy)>Math.min(h,last.height)*.8;
      const newTypeSize=changedLine && Math.abs(h-last.height)>Math.max(h,last.height)*.22;
      if(newTypeSize || Math.abs(dy)>Math.max(h,last.height)*1.7 || (dy>h && Math.abs(x-last.transform[4])>h*3) || paragraph.length>600)flush();
      else if(paragraph && (last.hasEOL || x-last.transform[4]-last.width>h*.12 || i>positions.at(-1).i+1) && !paragraph.endsWith(' '))paragraph+=' ';
    }
    positions.push({i,at:paragraph.length,end:paragraph.length+it.str.length});paragraph+=it.str;last=it;
  });
  flush();entry.segments=result;return result;
}
export function bindParts(entry,content,divs){
  const groups=new Map();
  for(const seg of segmentsFor(entry,content))for(const part of seg.parts){
    if(!groups.has(part.item))groups.set(part.item,[]);
    groups.get(part.item).push({...part,id:seg.id});
  }
  for(const [i,parts] of groups){
    const div=divs[i];if(!div?.isConnected)continue;
    const text=div.textContent, fragment=document.createDocumentFragment();let pos=0;
    for(const part of parts){
      fragment.append(text.slice(pos,part.start));const token=document.createElement('b');
      token.className='source-run';token.dataset.pair=entry.n+'-'+part.id;token.textContent=text.slice(part.start,part.end);
      fragment.append(token);pos=part.end;
    }
    fragment.append(text.slice(pos));div.replaceChildren(fragment);
  }
}
export function validatedPairs(answer, segments, hints){
  let pairs;
  try{pairs=JSON.parse(answer.trim().replace(/^\x60\x60\x60(?:json)?\s*/i,'').replace(/\s*\x60\x60\x60$/,''));}catch{}
  if(!Array.isArray(pairs)||pairs.length!==segments.length)throw Error('模型返回的段落数量或格式有误。此页未保存，可继续翻译。');
  const byId=new Map(pairs.map(p=>[p?.id,p]));
  return segments.map(({id})=>{
    const pair=byId.get(id),zh=pair?.zh;if(typeof zh!=='string'||!zh.trim())throw Error('缺少对应译文，请继续翻译此页。');
    if(hints)hints.push({kind:pair.kind,paragraph:pair.paragraph});
    return zh.trim();
  });
}
