import assert from 'node:assert/strict';
import test from 'node:test';
import {makeReadingPack,readReadingPack} from '../reading-pack.js';

const pdf = new Blob(['sample PDF bytes']);
const id = 'a'.repeat(64);
const quote = {from:2,to:2,text:'引文',boxes:[{n:2,x:.1,y:.2,w:.3,h:.02}]};
const turn = {paper:id,id:'turn-1',thread:'float',time:1,source:'第 2 页',
  label:'你',question:'这是什么意思？',answer:'回答',quote,model:'example'};
const data = {id,name:'试读.pdf',pages:3,page:2,position:.4,bilingual:true,notes:'笔记',
  translations:[{paper:id,page:2,done:false,zh:['译文']}],turns:[turn]};

test('single paper, Unicode and original PDF round trip without unrelated settings',async()=>{
  const pack=await makeReadingPack({...data,apiKey:'excluded',turns:[{...turn,apiKey:'excluded'}]},pdf);
  const opened=await readReadingPack(pack);
  assert.equal(await opened.pdf.text(),await pdf.text());
  assert.equal(opened.data.position,.4);
  assert.deepEqual(opened.data.translations[0].zh,['译文']);
  assert.deepEqual(opened.data.turns[0].quote.boxes,quote.boxes);
  assert.equal(opened.data.notes,'笔记');
  assert.ok(!(await pack.text()).includes('excluded'));
});

test('reject unsupported format, damaged metadata, duplicate or out-of-scope records',async()=>{
  const pack=await makeReadingPack(data,pdf);
  const bytes=new Uint8Array(await pack.arrayBuffer());
  bytes[6]=50;
  await assert.rejects(readReadingPack(new Blob([bytes])),/版本/);
  bytes[6]=49;
  bytes[45]^=1;
  await assert.rejects(readReadingPack(new Blob([bytes])),/校验/);
  await assert.rejects(readReadingPack(pack.slice(0,8)));
  for(const changes of [
    {page:4},{turns:[turn,turn]},{turns:[{...turn,paper:'other'}]},
    {turns:[{...turn,quote:{...quote,boxes:[]}}]},
    {translations:[{paper:id,page:5,done:true,zh:[]}]}
  ])await assert.rejects(makeReadingPack({...data,...changes},pdf));
});
