import assert from 'node:assert/strict';
import test from 'node:test';
import {courseContext, courseHistory, recallTurns} from '../course-context.js';
import {complete, configureKey} from '../model-api.js';

test('the same slide number in different courses keeps its own material, history and progress', () => {
  const deck = {project:'a',id:'one',name:'总线',texts:['地址','时序','周期'],learned:[true,false,true]};
  const materials = [deck,{...deck,id:'two',name:'实验',texts:['逻辑分析仪'],learned:[false]},
    {...deck,id:'other',project:'b',name:'其他课程',texts:['外部材料'],learned:[true]}];
  const ctx = courseContext({id:'a',name:'组成原理'},materials,'one',2,'这一页和实验有什么联系？');
  assert.match(ctx,/正在阅读：《总线》第 2 页/);
  assert.match(ctx,/当前页正文：\n时序/);
  assert.match(courseContext({id:'a'},materials,'one',2,'学习进度'),/已学页：1、3；未学页：2/);
  assert.match(ctx,/逻辑分析仪/);
  assert.doesNotMatch(ctx,/外部材料|其他课程/);
  assert.throws(() => courseContext({id:'a'},materials,'other',1,'问题'));
  const turn = {project:'a',deck:'two',name:'实验',page:3,question:'上一题',answer:'上一答'};
  assert.deepEqual(courseHistory([turn,{...turn,project:'b',answer:'其他课程回复'}],'a','two',3),
    [{role:'user',content:'当时正在读《实验》第 3 页。\n上一题'},{role:'assistant',content:'上一答'}]);
});

test('the vision request attaches the pinned page, text requests stay text-only', async t => {
  const bodies = [];
  t.mock.method(globalThis,'fetch',async (_,opts) => {
    bodies.push(JSON.parse(opts.body).messages);
    return Response.json({choices:[{message:{content:'答复'}}]});
  });
  const image = 'data:image/webp;base64,AA==';
  for (const provider of ['openai','deepseek']) {
    await configureKey(provider,'test-only');
    await complete({provider,model:'test',course:true,context:'当前页',question:'解释图',image});
  }
  assert.equal(bodies[0].at(-1).content[1].image_url.url,image);
  assert.equal(typeof bodies[1].at(-1).content,'string');
  assert.match(bodies[0][0].content,/课程辅导/);
});

test('recall and page history stay separate across slides, decks and projects', () => {
  const current = {project:'A',deck:'X',page:2,question:'之前讨论的 Cache 映射'};
  const turn = {...current,name:'第一讲',question:'Cache',answer:'映射方式',time:1};
  const other = {...turn,deck:'Y'};
  const rows = [turn,other,{...turn,project:'B'},{...turn,page:3,answer:''}];
  assert.deepEqual(recallTurns(rows,current,'缓存'),[other]);
  assert.equal(courseHistory(rows,'A','X',2).length,2);
});

test('a local slide question stays local even when other pages and chats share terms',()=>{
  const d={project:'C',id:'d',name:'第1讲.pdf',texts:['旧页 CACHE','本页 CACHE','后页 CACHE'],learned:[true,false,false]};
  const project={id:'C',name:'课程'};
  const current={project:'C',deck:'d',page:2,question:'为什么这个 Cache 的命中时间要单独算？'};
  const old={...current,page:1,question:'Cache 命中',answer:'旧讨论',name:d.name};
  const context=courseContext(project,[d],d.id,2,current.question);
  assert.match(context,/本页 CACHE/);
  assert.doesNotMatch(context,/旧页|后页|学习记录|相关课件摘录/);
  assert.deepEqual(recallTurns([old],current,d.texts[1]),[]);
  const comparison=courseContext(project,[d],d.id,2,'和上一页对比呢？');
  assert.match(comparison,/旧页 CACHE/);
  assert.doesNotMatch(comparison,/后页 CACHE/);
});
