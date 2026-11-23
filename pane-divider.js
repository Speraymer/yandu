import {localGet,localSet} from './reader-storage.js';
const $ = id => document.getElementById(id);
const divider=$('paneDivider'), side=$('side');
const savedWidth=Number(localGet('reader.sideWidth'));
if(savedWidth>0 && savedWidth<100)side.style.setProperty('--side-width',savedWidth+'vw');

function setSideWidth(px){
  side.style.setProperty('--side-width',px/innerWidth*100+'vw');
  // Store the visible (clamped) width so dragging back from either limit responds immediately.
  const percent=side.getBoundingClientRect().width/innerWidth*100;
  side.style.setProperty('--side-width',percent+'vw');
  return percent;
}
let grabOffset=0;
divider.onpointerdown=e=>{
  if(!e.isPrimary || e.button!==0)return;
  e.preventDefault();divider.focus({preventScroll:true});
  grabOffset=e.clientX-side.getBoundingClientRect().left;
  divider.setPointerCapture(e.pointerId);
};
divider.onpointermove=e=>{
  if(divider.hasPointerCapture(e.pointerId))setSideWidth(side.getBoundingClientRect().right-e.clientX+grabOffset);
};
divider.onlostpointercapture=()=>localSet('reader.sideWidth',String(side.getBoundingClientRect().width/innerWidth*100));
divider.onkeydown=e=>{
  if(e.key!=='ArrowLeft' && e.key!=='ArrowRight')return;
  e.preventDefault();
  const percent=setSideWidth(side.offsetWidth+(e.key==='ArrowLeft'?16:-16));
  localSet('reader.sideWidth',String(percent));
};
new ResizeObserver(()=>{
  if(side.offsetWidth)divider.setAttribute('aria-valuenow',String(Math.round(side.offsetWidth/innerWidth*100)));
}).observe(side);
