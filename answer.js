import katex from './katex/katex.mjs';

function mathNode(tex, displayMode, fallback){
  const span=document.createElement('span');
  try{
    katex.render(tex,span,{displayMode,throwOnError:true,trust:false,maxExpand:400,maxSize:12,strict:'ignore'});
    return span;
  }catch{return document.createTextNode(fallback);}
}

// Protect complete formulas and code before interpreting Markdown punctuation inside a row.
export function formatMessage(body,source,citation,{paragraphs=false}={}){
  const atoms=[];
  function hold(node){
    atoms.push(node);
    return '\0'+(atoms.length-1)+'\0';
  }
  const tokens=/\x00|```[\s\S]*?```|`[^`\n]+`|\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(?<![\\$])\$(?![\s$])[^$\n]+?(?<!\s)\$(?!\$)/g;
  const text=source.replace(tokens,token=>{
    if(token==='\0')return hold(document.createTextNode(token));
    if(token.startsWith('`')){
      const block=token.startsWith('```');
      const content=block?token.slice(3,-3).replace(/^\w*\r?\n/,''):token.slice(1,-1);
      if(!block && /^[A-Za-z\\][\w\\^{}(),+\-\s]*$/.test(content) && /(?:[_^]\\[A-Za-z]+|^\\[A-Za-z]+(?:[_^]|$))/.test(content))
        return hold(mathNode(content,false,content));
      const code=document.createElement(block?'pre':'code');code.textContent=content;
      return hold(code);
    }
    const display=token.startsWith('$$')||token.startsWith('\\[');
    const cut=display||token.startsWith('\\(')?2:1;
    return hold(mathNode(token.slice(cut,-cut),display,token));
  });
  function inline(parent,text,allowBold=true){
    const pattern=/\0(\d+)\0|\[第\s*(\d+)\s*页\]|\*\*([\s\S]+?)\*\*/g;
    let end=0;
    for(const match of text.matchAll(pattern)){
      parent.append(text.slice(end,match.index));
      if(match[1]!==undefined)parent.append(atoms[Number(match[1])]);
      else if(match[2])parent.append(citation(Number(match[2]),match[0])||match[0]);
      else if(allowBold){
        const bold=document.createElement('strong');inline(bold,match[3],false);parent.append(bold);
      }else parent.append(match[0]);
      end=match.index+match[0].length;
    }
    parent.append(text.slice(end));
  }
  function cells(line){
    return line.trim().replace(/^\||\|$/g,'').split(/(?<!\\)\|/).map(s=>s.trim().replace(/\\\|/g,'|'));
  }
  const lines=text.split(/\r?\n/);
  let plain=[];
  function flush(){
    if(plain.length){
      const content=plain.join('\n');
      if(paragraphs){
        const parts=content.length>180 ? content.split(/(?<=[。！？])(?=[^”’」』）])/u) : [content];
        let chunk='';
        for(const part of parts){
          if(chunk.length>=100){paragraph(chunk);chunk='';}
          chunk+=part;
        }
        if(chunk)paragraph(chunk);
      }else inline(body,content);
    }
    plain=[];
  }
  function paragraph(content){
    const p=document.createElement('p');inline(p,content);body.append(p);
  }
  const marker=/^\s*(?:[-*+]\s+|(\d+)(?:[.)]\s+|、\s*))(\S.*)$/;
  for(let i=0;i<lines.length;i++){
    const line=lines[i], divider=lines[i+1];
    if(line.includes('|') && divider?.includes('|') && cells(divider).every(s=>/^:?-{3,}:?$/.test(s)) && cells(line).length===cells(divider).length){
      flush();
      const wrap=document.createElement('section');wrap.className='answer-table';
      const table=document.createElement('table');wrap.append(table);body.append(wrap);
      const header=table.createTHead().insertRow();
      for(const title of cells(line)){
        const th=document.createElement('th');th.scope='col';inline(th,title);header.append(th);
      }
      const rows=table.createTBody();
      i++;
      while(i+1<lines.length && lines[i+1].includes('|') && cells(lines[i+1]).length===header.cells.length){
        const row=rows.insertRow();
        for(const value of cells(lines[++i]))inline(row.insertCell(),value);
      }
    }else if(paragraphs && !line.trim()){
      flush();
    }else if(paragraphs && marker.test(line)){
      flush();
      let match=marker.exec(line);
      const numbered=match[1]!==undefined;
      const list=document.createElement(numbered?'ol':'ul');
      if(numbered)list.start=Number(match[1]);
      for(;;){
        const li=document.createElement('li');inline(li,match[2]);list.append(li);
        match=marker.exec(lines[i+1]||'');
        if(!match || (match[1]!==undefined)!==numbered)break;
        i++;
      }
      body.append(list);
    }else if(/^#{1,6}\s/.test(line)){
      flush();const heading=document.createElement('h3');inline(heading,line.replace(/^#{1,6}\s+/,''));body.append(heading);
    }else if(/^---+\s*$/.test(line)){
      flush();body.append(document.createElement('hr'));
    }else plain.push(line);
  }
  flush();
}
