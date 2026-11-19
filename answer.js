import katex from './katex/katex.mjs';

// Operate only on text nodes. Page citations are independent, already-linked buttons.
export function formatAnswer(body){
  const pattern=/(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(?<![\\$])\$(?![\s$])[^$\n]+?(?<!\s)\$(?!\$)|\*\*[^\n]+?\*\*)/g;
  for(const node of Array.from(body.childNodes)){
    if(node.nodeType!==Node.TEXT_NODE)continue;
    const out=document.createDocumentFragment();
    for(const token of node.textContent.split(pattern)){
      if(token.startsWith('**')&&token.endsWith('**')&&token.length>4){
        const bold=document.createElement('strong');bold.textContent=token.slice(2,-2);out.append(bold);
      }else if(/^(?:\$\$|\\\[|\\\(|\$)/.test(token)&&/(\$\$|\\\]|\\\)|\$)$/.test(token)&&token.length>2){
        const display=token.startsWith('$$')||token.startsWith('\\[');
        const cut=display||token.startsWith('\\(')?2:1;
        const math=document.createElement('span');
        try{katex.render(token.slice(cut,-cut),math,{displayMode:display,throwOnError:true,trust:false,maxExpand:400,maxSize:12,strict:'ignore'});out.append(math);}
        catch{out.append(token);}
      }else out.append(token);
    }
    node.replaceWith(out);
  }
}
