// PDF bookmarks take precedence. Printed headings supply an offline fallback.
export async function contents(pdf){
  const items=[];
  async function visit(nodes,level){
    for(const node of nodes){
      try{
        const dest=typeof node.dest==='string'?await pdf.getDestination(node.dest):node.dest;
        if(dest){const page=1+(typeof dest[0]==='number'?dest[0]:await pdf.getPageIndex(dest[0]));
          if(page>0&&page<=pdf.numPages)items.push({title:node.title,page,level});}
      }catch{/* A malformed bookmark may still have valid children. */}
      if(node.items?.length)await visit(node.items,level+1);
    }
  }
  await visit(await pdf.getOutline().catch(()=>[])||[],0);
  if(items.length)return {source:'PDF 书签',items};
  const known=/^(?:abstract|introduction|background|related work|methods?|methodology|experiments?|evaluation|results?|discussion|conclusions?|limitations?|references|acknowledg(?:e)?ments?|appendix(?: [A-Z])?|摘要|引言|绪论|相关工作|实验(?:结果)?|讨论|结论|参考文献|附录)[.：:]?$/i;
  const numbered=/^(?:(?:\d+(?:\.\d+)*[.)、]?|[IVX]+[.)])\s+[A-Z\u4e00-\u9fff]|第[一二三四五六七八九十百零\d]+[章节])/;
  const seen=new Set();
  for(let page=1;page<=pdf.numPages;page++){
    const text=await (await pdf.getPage(page)).getTextContent(),lines=[];let line='',y=null,height=0;
    function flush(){if(line.trim())lines.push({title:line.trim().replace(/\s+/g,' '),height});line='';height=0;}
    for(const token of text.items){
      if(typeof token.str!=='string')continue;
      if(y!==null&&Math.abs(token.transform[5]-y)>Math.max(2,height*.65))flush();
      line+=token.str; height=Math.max(height,Math.abs(token.height)); y=token.transform[5];
      if(token.hasEOL)flush();
    }
    flush();
    const sizes=lines.filter(l=>l.title.length>=35).map(l=>l.height).sort((a,b)=>a-b);
    const base=sizes[Math.floor(sizes.length/2)];
    for(const l of lines){
      const t=l.title;if(seen.has(t)||t.length>95||t.length<2||/\.{3,}|\s\d{2,}$/.test(t))continue;
      const typeHeading=base&&l.height>=base*1.18&&l.height<=base*1.85&&t.length<65&&!/[.!?。；;]$/.test(t);
      if(known.test(t)||numbered.test(t)||typeHeading){
        seen.add(t);items.push({title:t,page,level:/^\d+\.\d/.test(t)?1:0});
      }
    }
  }
  if(items.length)return {source:'从正文标题识别',items};
  return {source:'未识别到章节标题 · 按页浏览',items:Array.from({length:pdf.numPages},(_,i)=>({title:'第 '+(i+1)+' 页',page:i+1,level:0}))};
}
