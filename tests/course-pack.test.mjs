import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {validateLinks} from '../course-links.js';

test('course pack carries every slide image, text, progress and position without the source PPTX',async()=>{
  const values=new Map([['course.deck.p','d'],['course.page.d','2']]);
  globalThis.localStorage={setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const image=new Blob(['slide image bytes'],{type:'image/png'});
  let saved;
  globalThis.packFixture={validateLinks,
    courseSnapshot:async()=>({project:{id:'p',name:'课程'},decks:[{id:'d',name:'讲义.pptx',time:1,texts:['第一页','第二页'],learned:[true,false]}],turns:[],pages:new Map([['d',[{image,layout:null,linksVersion:1,links:[{x:.1,y:.2,w:.3,h:.1,label:'网页',url:'https://example.com/'}]},{image,layout:null,linksVersion:1,links:[{x:.1,y:.2,w:.3,h:.1,label:'第一页',page:1}]}]]])}),
    storeCourseCopy:async(...args)=>{saved=args;},projects:async()=>[],
    loadClips:()=>[{turn:'source/d/2',role:4,page:2,offset:0,text:'第二页'}],
    saveClip:(scope,clip)=>values.set(scope,clip),localGet:k=>values.get(k),storageKey:k=>k
  };
  const source=(await readFile(new URL('../course-pack.js',import.meta.url),'utf8'))
    .replace(/^import .*;$/gm,'');
  const api=await import('data:text/javascript;base64,'+Buffer.from('const {validateLinks,courseSnapshot,storeCourseCopy,projects,loadClips,saveClip,localGet,storageKey}=globalThis.packFixture;\n'+source).toString('base64'));
  const {file}=await api.exportCoursePack('p');
  const project=await api.importCoursePack(file);
  assert.equal(project.name,'课程');
  const [,decks,,pages]=saved;
  assert.deepEqual(decks[0].texts,['第一页','第二页']);
  assert.deepEqual(decks[0].learned,[true,false]);
  assert.equal(decks[0].name,'讲义.pptx');
  assert.equal(await pages[0][1].image.text(),'slide image bytes');
  assert.equal(pages[0][0].links[0].url,'https://example.com/');
  assert.equal(pages[0][1].links[0].page,1);
  assert.equal(pages[0][1].linksVersion,1);
  assert.equal(values.get('course.page.'+decks[0].id),'2');
  assert.equal(values.get('course.deck.'+project.id),decks[0].id);
  const clip=values.get('course:'+project.id);
  assert.equal(clip.role,4);
  assert.equal(clip.turn,'source/'+decks[0].id+'/2');
  // The signed manifest must still reject executable link targets.
  const header=new Uint8Array(await file.slice(0,44).arrayBuffer());
  const length=new DataView(header.buffer).getUint32(8);
  const metadata=JSON.parse(await file.slice(44,44+length).text());
  metadata.decks[0].slots[0].links[0].url='javascript:alert(1)';
  const json=new TextEncoder().encode(JSON.stringify(metadata));
  new DataView(header.buffer).setUint32(8,json.length);
  header.set(new Uint8Array(await crypto.subtle.digest('SHA-256',json)),12);
  await assert.rejects(api.importCoursePack(new Blob([header,json,file.slice(44+length)])),/链接数据异常/);
  // A version-1 pack produced before links existed remains importable.
  for(const slot of metadata.decks[0].slots){delete slot.links;delete slot.linksVersion;}
  const oldJson=new TextEncoder().encode(JSON.stringify(metadata));
  new DataView(header.buffer).setUint32(8,oldJson.length);
  header.set(new Uint8Array(await crypto.subtle.digest('SHA-256',oldJson)),12);
  await api.importCoursePack(new Blob([header,oldJson,file.slice(44+length)]));
  assert.equal(saved[3][0][0].linksVersion,undefined);
  const damaged=new Uint8Array(await file.arrayBuffer());damaged[damaged.length-1]^=1;
  await assert.rejects(api.importCoursePack(new Blob([damaged])),/画面校验失败/);
  delete globalThis.packFixture;delete globalThis.localStorage;
});
