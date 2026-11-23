import assert from 'node:assert/strict';
import test from 'node:test';
import {courseContext, courseHistory} from '../course-context.js';
import {complete, configureKey} from '../model-api.js';

test('the same slide number in different courses keeps its own material, history and progress', () => {
  const deck = {project:'a',id:'one',name:'总线',texts:['地址','时序','周期'],learned:[true,false,true]};
  const materials = [deck,{...deck,id:'two',name:'实验',texts:['逻辑分析仪'],learned:[false]},
    {...deck,id:'other',project:'b',name:'其他课程',texts:['外部材料'],learned:[true]}];
  const ctx = courseContext({id:'a',name:'组成原理'},materials,'one',2,'这一页和实验有什么联系？');
  assert.match(ctx,/正在阅读：《总线》第 2 页/);
  assert.match(ctx,/当前页正文：\n时序/);
  assert.match(ctx,/已学页：1、3；未学页：2/);
  assert.match(ctx,/逻辑分析仪/);
  assert.doesNotMatch(ctx,/外部材料|其他课程/);
  assert.throws(() => courseContext({id:'a'},materials,'other',1,'问题'));
  const turn = {project:'a',name:'实验',page:3,question:'上一题',answer:'上一答'};
  assert.deepEqual(courseHistory([turn,{...turn,project:'b',answer:'其他课程回复'}],'a'),
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
