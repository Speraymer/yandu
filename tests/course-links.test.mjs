import assert from 'node:assert/strict';
import test from 'node:test';
import {safeLink,linkTarget,linkRects,validateLinks} from '../course-links.js';
const rect={x:.1,y:.2,w:.2,h:.1,label:'网页'};
test('allow web and contact links, reject executable and local file targets',()=>{
  for (const url of ['https://example.com/?x=1#s','http://example.com','mailto:test@example.com','tel:+861234'])assert.ok(safeLink(url));
  for (const url of ['javascript:alert(1)','data:text/html,test','file:///C:/a.pptx','//example.com','../file','https:\n//example.com'])assert.ok(!safeLink(url));
  assert.deepEqual(linkTarget({slideIndex:2},3),{page:3});
  assert.ok(linkTarget({slideIndex:3},3).unavailable);
  assert.ok(linkTarget({url:'file:///a.pptx'},3).unavailable);
});
test('validate untrusted pack link geometry, destinations and protocols',()=>{
  assert.equal(validateLinks([{...rect,page:2}],2)[0].page,2);
  for(const bad of [{url:'javascript:alert(1)'},{page:3},{page:1,url:'https://example.com'},{w:Infinity,page:1},{x:-.1,page:1},{w:2,page:1}])
    assert.throws(()=>validateLinks([{...rect,...bad}],2));
});
test('clip link areas to the slide and preserve normalized position for resizing',()=>{
  const links=linkRects([{left:90,top:220,right:210,bottom:260}],{left:100,top:200,width:200,height:100},{page:1},'返回');
  assert.deepEqual(links,[{x:0,y:.2,w:.55,h:.4,label:'返回',page:1}]);
});
