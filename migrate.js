import {shelf,loadSaved,loadFile,mergeBook} from './library.js?v=6';
import {configureKey,hasKey,restoreKeys} from './model-api.js?v=2';

const origin='http://127.0.0.1:18769';
const nonce=location.hash.slice(1);
history.replaceState(null,'',location.pathname);
const owner=window.opener, prefix=new URL('.',import.meta.url).pathname+':';
const status=document.getElementById('status');
const allowed=/^reader\.(lastPaper|provider|preferences|style|depth|model\.(deepseek|openai)|page\.[a-f\d]{64}|bilingual\.[a-f\d]{64}|notes\.[\w-]+|align\.3\.[\w.-]+)$/;
const post=(type,data={})=>owner.postMessage({type,nonce,...data},origin);

function preferences(entries){
  for(const [key,incoming] of entries){
    if(!allowed.test(key)||typeof incoming!=='string')continue;
    const name=prefix+key,old=localStorage.getItem(name);
    if(old===incoming)continue;
    if(old===null){localStorage.setItem(name,incoming);continue;}
    if(key.startsWith('reader.notes.')&&incoming&&!old.includes(incoming)){
      localStorage.setItem(name,old?old+'\n\n本机版笔记\n'+incoming:incoming);
    }else if(key==='reader.lastPaper'||key.startsWith('reader.page.')||key.startsWith('reader.bilingual.')){
      const backup=prefix+'beforeLocalImport.'+key;
      if(localStorage.getItem(backup)===null)localStorage.setItem(backup,old);
      localStorage.setItem(name,incoming);
    }
  }
}
let imported=false;
if(owner&&/^[a-f0-9]{32}$/.test(nonce)){
  status.textContent='正在等待本机版书架…';
  window.addEventListener('message',async e=>{
    if(e.source!==owner||e.origin!==origin||e.data?.nonce!==nonce||e.data.type!=='library'||imported)return;
    imported=true;
    try{
      const {papers,settings,deepseek}=e.data;
      let pages=0,turns=0;
      for(const {book,blob,translations,history} of papers){
        if(!/^[a-f0-9]{64}$/.test(book.id)||!(blob instanceof Blob)||!blob.size||
          !translations.every(p=>p.paper===book.id&&Array.isArray(p.zh))||!history.every(t=>t.paper===book.id))throw Error('本机书架记录不完整。');
        await mergeBook(book,blob,translations,history);
        const [file,saved,chat]=await Promise.all([loadFile(book.id),loadSaved('pages',book.id),loadSaved('turns',book.id)]);
        if(file?.size!==blob.size||saved.length<translations.length||chat.length<history.length)throw Error('网页书架写入核对未通过。');
        pages+=translations.length;turns+=history.length;
      }
      preferences(settings);
      const active=localStorage.getItem(prefix+'reader.lastPaper');
      const page=Number(localStorage.getItem(prefix+'reader.page.'+active))||1;
      const books=await shelf();
      await restoreKeys();
      const summary={books:papers.length,pages,turns,page,total:books.length,deepseek:hasKey('deepseek')};
      status.textContent='已核对 '+papers.length+' 篇论文、'+pages+' 页译文记录、'+turns+' 条问答。'+(active?'当前论文从第 '+page+' 页继续阅读。':'');
      document.getElementById('keyForm').hidden=!deepseek||summary.deepseek;
      post('complete',{summary});
    }catch(err){status.textContent='迁移未完成：'+err.message;post('failed');}
  });
  post('ready');
}
document.getElementById('keyForm').onsubmit=async e=>{
  e.preventDefault();const input=document.getElementById('key'),feedback=document.getElementById('feedback');
  try{await configureKey('deepseek',input.value.trim(),true);input.value='';document.getElementById('keyForm').hidden=true;status.textContent+=' DeepSeek 密钥已保存在此浏览器。';if(owner)post('key-saved');}
  catch{feedback.textContent='保存失败，请检查密钥格式和浏览器存储权限。';}
};
