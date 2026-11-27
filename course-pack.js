import {courseSnapshot, storeCourseCopy, projects} from './course-store.js?v=6';
import {loadClips, saveClip} from './note-clips.js?v=3';
import {localGet, storageKey} from './reader-storage.js?v=2';

// Eight-byte signature, manifest length, SHA-256 of manifest, JSON, then page images in deck order.
const magic = new TextEncoder().encode('YANDUC01');
const headerSize = 44;
const maxManifest = 128 * 1024 * 1024;
const text = value => typeof value === 'string';
const natural = n => Number.isSafeInteger(n) && n >= 0;
const pageIn = (n,length) => Number.isInteger(n) && n >= 1 && n <= length;
function check(ok,message='课程数据包内容不完整。') {
  if (!ok) throw Error(message);
}
async function hash(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
}
async function imageHash(blob) {
  return Array.from(await hash(await blob.arrayBuffer()),n=>n.toString(16).padStart(2,'0')).join('');
}

export async function exportCoursePack(id,report) {
  const {project,decks,turns,pages} = await courseSnapshot(id);
  check(project,'找不到要导出的课程。');
  const data = {name:project.name,active:localGet('course.deck.'+id) || decks[0]?.id || null,
    writing:localGet('course.writing.'+id) || '',
    clips:loadClips('course:'+id).map(({turn,role,page,offset,text})=>({turn,role,page,offset,text})),
    decks:[],turns:[]};
  const positions = decks.map(deck=>Number(localGet('course.page.'+deck.id)) || 1);
  const images = [];
  for (const [index,deck] of decks.entries()) {
    const {id,name,time,texts,learned,manualUnread=[]} = deck;
    const records = pages.get(id);
    check(records?.length === texts.length,'课件缺少页面，无法生成完整数据包。');
    const slots = [];
    for (const item of records) {
      const bare = item instanceof Blob;
      const image = bare ? item : item?.image;
      check(image instanceof Blob && image.size,'课件中有无法读取的页面。');
      slots.push({size:image.size,type:image.type,hash:await imageHash(image),bare,layout:item.layout ?? null});
      images.push(image);
    }
    data.decks.push({id,name,time,texts,learned,manualUnread:texts.map((_,i)=>!!manualUnread[i]),
      page:positions[index],slots});
    report?.(name);
  }
  data.turns = turns.map(({id,deck,page,time,question,answer,error,model,memory=[]}) =>
    ({id,deck,page,time,question,answer,error,model,memory:memory.map(({deck,page,question})=>({deck,page,question}))}));
  const json = new TextEncoder().encode(JSON.stringify(data));
  check(json.length <= maxManifest,'课程文字与划词记录超过数据包容量。');
  const header = new Uint8Array(headerSize);
  header.set(magic);
  new DataView(header.buffer).setUint32(8,json.length);
  header.set(await hash(json),12);
  return {name:project.name,file:new Blob([header,json,...images],{type:'application/octet-stream'})};
}

function layoutData(layout) {
  if (layout === null) return null;
  const {w,h,runs} = layout;
  check([w,h].every(n=>Number.isFinite(n) && n>0) && Array.isArray(runs));
  return {w,h,runs:runs.map(({x,y,w,h,text:value})=>{
    check([x,y,w,h].every(Number.isFinite) && w>0 && h>0 && text(value));
    return {x,y,w,h,text:value};
  })};
}

async function unpack(file,report) {
  const header = new Uint8Array(await file.slice(0,headerSize).arrayBuffer());
  check(header.length===headerSize && magic.every((v,i)=>v===header[i]),'请选择研读导出的 .yanduc 课程数据包。');
  const length = new DataView(header.buffer).getUint32(8);
  let offset = headerSize+length;
  check(length>0 && length<=maxManifest && offset<=file.size,'课程数据包长度异常。');
  const bytes = await file.slice(headerSize,offset).arrayBuffer();
  check((await hash(bytes)).every((v,i)=>v===header[i+12]),'课程数据包校验失败，请重新传输文件。');
  const data = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  check(text(data.name) && data.name.trim() && text(data.writing) && Array.isArray(data.decks) &&
    Array.isArray(data.turns) && Array.isArray(data.clips));
  const project = {id:crypto.randomUUID(),time:Date.now(),name:data.name};
  const decks = [], pages = [], positions = [], byDeck = new Map(), byTurn = new Map();
  for (const entry of data.decks) {
    const {id,name,time,texts,learned,manualUnread,page,slots} = entry;
    check(text(id) && id && !byDeck.has(id) && text(name) && natural(time) &&
      Array.isArray(texts) && texts.every(text) && pageIn(page,texts.length) &&
      [learned,manualUnread].every(a=>Array.isArray(a) && a.length===texts.length && a.every(v=>typeof v==='boolean')) &&
      Array.isArray(slots) && slots.length===texts.length);
    const deck = {id:crypto.randomUUID(),project:project.id,name,time,texts,learned,manualUnread,packOrder:decks.length};
    byDeck.set(id,deck); decks.push(deck); positions.push(page);
    const images = [];
    for (const slot of slots) {
      check(natural(slot.size) && slot.size>0 && offset+slot.size<=file.size &&
        ['image/webp','image/png','image/jpeg'].includes(slot.type) && typeof slot.bare==='boolean');
      const image = file.slice(offset,offset+slot.size,slot.type);
      check(await imageHash(image)===slot.hash,'课件画面校验失败，请重新传输文件。');
      const layout = layoutData(slot.layout);
      images.push(slot.bare ? image : {image,layout});
      offset += slot.size;
    }
    pages.push(images);
    report?.(name);
  }
  check(offset===file.size && (decks.length ? byDeck.has(data.active) : data.active===null));
  function reference(ref) {
    const deck = byDeck.get(ref.deck);
    check(deck && pageIn(ref.page,deck.texts.length) && text(ref.question));
    return {deck:deck.id,name:deck.name,page:ref.page,question:ref.question};
  }
  const turns = data.turns.map((t,packOrder)=>{
    const {id,time,model,answer,error,memory} = t;
    check(text(id) && id && !byTurn.has(id) && natural(time) && text(model) &&
      [answer,error].every(v=>v==null || text(v)) && Array.isArray(memory));
    const turn = {...reference(t),id:crypto.randomUUID(),project:project.id,time,model,answer,error,
      memory:memory.map(reference),packOrder};
    byTurn.set(id,turn); return turn;
  });
  const clips = data.clips.map(c=>{
    check(text(c.turn) && text(c.text) && natural(c.offset) && [0,1,2,4].includes(c.role));
    let turn,book,order,time;
    if (c.role===2 || c.role===4) {
      const match = /^source\/([^/]+)\/(\d+)$/.exec(c.turn);
      const deck = match && byDeck.get(match[1]);
      check(deck && Number(match[2])===c.page && pageIn(c.page,deck.texts.length));
      turn='source/'+deck.id+'/'+c.page; book=deck.name; order=deck.time; time=0;
    } else {
      const t=byTurn.get(c.turn);
      check(t && t.page===c.page);
      turn=t.id; book=t.name; order=byDeck.get(data.turns[t.packOrder].deck).time; time=t.time;
    }
    return {turn,book,order,time,page:c.page,role:c.role,offset:c.offset,text:c.text};
  });
  return {project,decks,turns,pages,positions,clips,writing:data.writing,active:byDeck.get(data.active)?.id};
}

export async function importCoursePack(file,report) {
  const {project,decks,turns,pages,positions,clips,writing,active} = await unpack(file,report);
  const names = new Set((await projects()).map(p=>p.name));
  const base = project.name;
  for (let n=1;names.has(project.name);n++) project.name=base+'（导入副本'+(n===1?'':' '+n)+'）';
  // These keys belong to freshly generated IDs. Publish the project only after the notes fit.
  const written = [];
  function save(key,value) {
    const name=storageKey(key);
    localStorage.setItem(name,value);
    written.push(name);
  }
  try {
    if (writing) save('course.writing.'+project.id,writing);
    for (const c of clips) written.push(saveClip('course:'+project.id,c));
    decks.forEach((d,i)=>save('course.page.'+d.id,String(positions[i])));
    if (active) save('course.deck.'+project.id,active);
    await storeCourseCopy(project,decks,turns,pages);
  } catch (err) {
    written.forEach(key=>localStorage.removeItem(key));
    throw err;
  }
  return project;
}

