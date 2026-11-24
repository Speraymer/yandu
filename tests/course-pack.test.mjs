import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

test('course pack carries every slide image, text, progress and position without the source PPTX',async()=>{
  const values=new Map([['course.deck.p','d'],['course.page.d','2']]);
  globalThis.localStorage={setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const image=new Blob(['slide image bytes'],{type:'image/png'});
  let saved;
  globalThis.packFixture={
    courseSnapshot:async()=>({project:{id:'p',name:'课程'},decks:[{id:'d',name:'讲义.pptx',time:1,texts:['第一页','第二页'],learned:[true,false]}],turns:[],pages:new Map([['d',[{image,layout:null},{image,layout:null}]]])}),
    storeCourseCopy:async(...args)=>{saved=args;},projects:async()=>[],
    loadClips:()=>[],saveClip:()=>'',localGet:k=>values.get(k),storageKey:k=>k
  };
  const source=(await readFile(new URL('../course-pack.js',import.meta.url),'utf8'))
    .replace(/^import .*;$/gm,'');
  const api=await import('data:text/javascript;base64,'+Buffer.from('const {courseSnapshot,storeCourseCopy,projects,loadClips,saveClip,localGet,storageKey}=globalThis.packFixture;\n'+source).toString('base64'));
  const {file}=await api.exportCoursePack('p');
  const project=await api.importCoursePack(file);
  assert.equal(project.name,'课程');
  const [,decks,,pages]=saved;
  assert.deepEqual(decks[0].texts,['第一页','第二页']);
  assert.deepEqual(decks[0].learned,[true,false]);
  assert.equal(decks[0].name,'讲义.pptx');
  assert.equal(await pages[0][1].image.text(),'slide image bytes');
  assert.equal(values.get('course.page.'+decks[0].id),'2');
  assert.equal(values.get('course.deck.'+project.id),decks[0].id);
  const damaged=new Uint8Array(await file.arrayBuffer());damaged[damaged.length-1]^=1;
  await assert.rejects(api.importCoursePack(new Blob([damaged])),/画面校验失败/);
  delete globalThis.packFixture;delete globalThis.localStorage;
});
