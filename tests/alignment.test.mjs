import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../alignment.js',import.meta.url));
const {segmentsFor,validatedPairs}=await import('data:text/javascript;base64,'+source.toString('base64'));
const line=(str,y,h=10)=>({str,transform:[h,0,0,h,10,y],height:h,width:90,hasEOL:true});
const items=[line('A map is built.',100),line('The second',88),line('sentence continues.',76)];
const segments=segmentsFor({}, {items});
assert.deepEqual(segments.map(s=>s.text),['A map is built.','The second sentence continues.']);
assert.equal(segments[1].parts.length,2);
assert.deepEqual(validatedPairs('[{"id":2,"zh":"乙"},{"id":1,"zh":"甲"}]',segments),['甲','乙']);
for(const invalid of ['oops','[]','[{"id":1,"zh":"甲"},{"id":1,"zh":"乙"}]','[{"id":1,"zh":"甲"},{"id":2,"zh":" "}]']){
  assert.throws(()=>validatedPairs(invalid,segments));
}
console.log('Sentence mapping and translation alignment passed.');


