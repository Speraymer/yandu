const database = new Promise((resolve, reject) => {
  const req = indexedDB.open('yandu-courses:' + new URL('.', import.meta.url).pathname, 1);
  req.onupgradeneeded = () => {
    const db = req.result;
    db.createObjectStore('projects', {keyPath:'id'});
    for (const name of ['decks','turns']) {
      db.createObjectStore(name, {keyPath:'id'}).createIndex('project','project');
    }
    db.createObjectStore('images');
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function access(names, mode, fn) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, mode);
    let request;
    try { request = fn(tx); }
    catch (error) { tx.abort(); reject(error); return; }
    tx.oncomplete = () => resolve(request?.result);
    tx.onabort = () => reject(tx.error || Error('存储事务中断。'));
  });
}

export const projects = () => access('projects','readonly',tx => tx.objectStore('projects').getAll());
export const newProject = name => {
  const project = {id:crypto.randomUUID(), name, time:Date.now()};
  return access('projects','readwrite',tx => tx.objectStore('projects').add(project)).then(() => project);
};
export const projectRecords = (store, project) => access(store,'readonly',tx =>
  tx.objectStore(store).index('project').getAll(project)).then(rows => rows.sort(byTime));
export const slideImage = (deck, page) => access('images','readonly',tx => tx.objectStore('images').get([deck,page]));
export const saveTurn = turn => access('turns','readwrite',tx => tx.objectStore('turns').put(turn));

// All records in an export come from one IndexedDB snapshot.
export async function courseSnapshot(id) {
  let project, decks, turns;
  const pages = new Map();
  await access(['projects','decks','turns','images'],'readonly',tx => {
    const read = (request,receive) => { request.onsuccess = () => receive(request.result); };
    read(tx.objectStore('projects').get(id),value => { project = value; });
    read(tx.objectStore('turns').index('project').getAll(id),value => { turns = value; });
    read(tx.objectStore('decks').index('project').getAll(id),value => {
      decks = value.sort(byTime);
      for (const deck of decks) {
        const range = IDBKeyRange.bound([deck.id,1],[deck.id,deck.texts.length]);
        read(tx.objectStore('images').getAll(range),images => pages.set(deck.id,images));
      }
    });
  });
  return {project,decks,turns:turns.sort(byTime),pages};
}

function byTime(a,b) { return a.time-b.time || (a.packOrder ?? 0)-(b.packOrder ?? 0); }

export function storeCourseCopy(project,decks,turns,pages) {
  return access(['projects','decks','turns','images'],'readwrite',tx => {
    tx.objectStore('projects').add(project);
    decks.forEach((deck,index) => {
      tx.objectStore('decks').add(deck);
      pages[index].forEach((value,i) => tx.objectStore('images').add(value,[deck.id,i+1]));
    });
    turns.forEach(turn => tx.objectStore('turns').add(turn));
  });
}

export async function addDeck(project, name, pages) {
  const deck = {id:crypto.randomUUID(), project, name, time:Date.now(), texts:pages.map(p => p.text),
    learned:pages.map(() => false)};
  await access(['decks','images'],'readwrite',tx => {
    tx.objectStore('decks').add(deck);
    pages.forEach(({image,layout},i) => tx.objectStore('images').add({image,layout},[deck.id, i+1]));
  });
  return deck;
}

// Commit page images and their matching text coordinates together, keeping the original deck ID.
export async function restoreSlideSelection(deck,pages){
  if (pages.length!==deck.texts.length || pages.some((p,i)=>p.text!==deck.texts[i]))
    throw Error('原文件与当前课件的页数或文字不同，请选择导入时的文件。');
  if (!pages.some(p=>p.layout?.runs.length)) throw Error('原文件没有可定位的文字。');
  await access('images','readwrite',tx=>{
    const images=tx.objectStore('images');
    pages.forEach(({image,layout},i)=>images.put({image,layout},[deck.id,i+1]));
  });
}

export async function setLearned(id, page, value, automatic = false) {
  let learned;
  await access('decks','readwrite',tx => {
    const store = tx.objectStore('decks');
    const get = store.get(id);
    get.onsuccess = () => {
      const deck = get.result;
      deck.manualUnread ??= [];
      if (automatic && (deck.manualUnread[page-1] || deck.learned[page-1])) {
        learned = deck.learned;
        return;
      }
      if (page === null) {
        deck.manualUnread = deck.learned.map(() => !value);
        deck.learned.fill(value);
      }
      else { deck.learned[page-1] = value; deck.manualUnread[page-1] = !value; }
      learned = deck.learned;
      store.put(deck);
    };
  });
  return learned;
}
