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
    const request = fn(tx);
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
  tx.objectStore(store).index('project').getAll(project)).then(rows => rows.sort((a,b) => a.time-b.time));
export const slideImage = (deck, page) => access('images','readonly',tx => tx.objectStore('images').get([deck,page]));
export const saveTurn = turn => access('turns','readwrite',tx => tx.objectStore('turns').put(turn));

export async function addDeck(project, name, pages) {
  const deck = {id:crypto.randomUUID(), project, name, time:Date.now(), texts:pages.map(p => p.text),
    learned:pages.map(() => false)};
  await access(['decks','images'],'readwrite',tx => {
    tx.objectStore('decks').add(deck);
    pages.forEach(({image},i) => tx.objectStore('images').add(image,[deck.id, i+1]));
  });
  return deck;
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
