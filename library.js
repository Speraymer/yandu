// Paper metadata is separate from PDF bytes so listing a shelf never loads every PDF.
let connection;
function openLibrary(){
  if(!connection)connection=new Promise((resolve,reject)=>{
    const req=indexedDB.open('yandu-library:' + new URL('.',import.meta.url).pathname,1);
    req.onupgradeneeded=()=>{
      const db=req.result;
      db.createObjectStore('books',{keyPath:'id'});
      db.createObjectStore('files');
      db.createObjectStore('pages',{keyPath:['paper','page']}).createIndex('paper','paper');
      db.createObjectStore('turns',{keyPath:'id'}).createIndex('paper','paper');
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>{connection=null;reject(req.error);};
  });
  return connection;
}
export async function transaction(stores,mode,operation){
  const db=await openLibrary();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(stores,mode);
    const req=operation(tx);
    tx.oncomplete=()=>resolve(req?.result);
    tx.onerror=tx.onabort=()=>reject(tx.error||Error('本地数据库操作失败'));
  });
}
export const shelf=()=>transaction('books','readonly',tx=>tx.objectStore('books').getAll());
export const loadFile=id=>transaction('files','readonly',tx=>tx.objectStore('files').get(id));
export function rememberBook(book,blob){
  return transaction(['books','files'],'readwrite',tx=>{
    tx.objectStore('books').put(book);
    const files=tx.objectStore('files'),known=files.getKey(book.id);
    known.onsuccess=()=>{if(known.result===undefined)files.add(blob,book.id);};
  });
}
export const loadSaved=(store,id)=>transaction(store,'readonly',tx=>tx.objectStore(store).index('paper').getAll(id));
export const saveTurn=turn=>transaction('turns','readwrite',tx=>tx.objectStore('turns').put(turn));
export function savePage(record){
  return transaction('pages','readwrite',tx=>{
    const pages=tx.objectStore('pages'),read=pages.get([record.paper,record.page]);
    read.onsuccess=()=>{
      const old=read.result;
      if(!old||(!old.done&&record.zh.length>=old.zh.length))pages.put(record);
    };
  });
}

// Each record is compared and written within one transaction, including on retry.
export function mergeBook(book,blob,pages,turns){
  return transaction(['books','files','pages','turns'],'readwrite',tx=>{
    function upsert(store,key,value,accept,externalKey){
      const table=tx.objectStore(store),read=table.get(key);
      read.onsuccess=()=>{if(read.result===undefined||accept?.(read.result))externalKey?table.put(value,key):table.put(value);};
    }
    upsert('books',book.id,book);
    upsert('files',book.id,blob,null,true);
    for(const page of pages)upsert('pages',[book.id,page.page],page,old=>!old.done&&(page.done||page.zh.length>old.zh.length));
    for(const turn of turns)upsert('turns',turn.id,turn,old=>{
      if(old.paper!==book.id){tx.abort();return false;}
      return !old.answer&&!!turn.answer;
    });
  });
}
