import assert from 'node:assert/strict';
import test from 'node:test';
import {storeBinary,readBinary} from '../binary-storage.js';

test('store bytes without Blob references, restore exact content and MIME type',async()=>{
  const file=new File([new Uint8Array([0,255,13,10]),'中文'],'讲义.png',{type:'image/png'});
  const stored=await storeBinary(file);
  assert.ok(stored.bytes instanceof ArrayBuffer);
  assert.equal(stored.type,'image/png');
  const restored=readBinary(structuredClone(stored));
  assert.deepEqual(await restored.arrayBuffer(),await file.arrayBuffer());
  assert.equal(restored.type,file.type);
});

test('legacy Blob records and missing files remain readable without migration',()=>{
  const legacy=new Blob(['PDF'],{type:'application/pdf'});
  assert.equal(readBinary(legacy),legacy);
  assert.equal(readBinary(undefined),undefined);
});
