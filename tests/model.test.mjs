import assert from 'node:assert/strict';
import test from 'node:test';
import {complete, configureKey, tongjiModels} from '../model-api.js';

test('each provider receives only its own key and selected material', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({url, options});
    return Response.json({choices: [{message: {content: 'answer'}}]});
  });
  const request = {model:'example', question:'question', context:'selected text', history:[]};
  await assert.rejects(complete({...request, provider:'openai'}));
  await assert.rejects(configureKey('unknown', 'fake'));
  for (const provider of ['deepseek','openai','tongji']) {
    await configureKey(provider, 'test-only-' + provider);
    assert.deepEqual(await complete({...request, provider}), {answer:'answer'});
    const {url, options} = calls.at(-1);
    assert.equal(new URL(url).hostname, provider==='tongji' ? 'agi.tongji.edu.cn' : 'api.' + provider + '.com');
    assert.equal(options.headers.Authorization, 'Bearer test-only-' + provider);
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    const {messages} = JSON.parse(options.body);
    assert.equal(messages.at(-1).content, '论文材料\nselected text\n\n我的问题\nquestion');
  }
});

test('Tongji model discovery uses the entered key and the university endpoint', async t=>{
  t.mock.method(globalThis,'fetch',async (url,opts)=>{
    assert.equal(url,'https://agi.tongji.edu.cn/v1/models');
    assert.equal(opts.headers.Authorization,'Bearer test-only');
    return Response.json({data:[{id:'org/model'},{id:'org/model'}]});
  });
  assert.deepEqual(await tongjiModels('test-only'),['org/model']);
});
