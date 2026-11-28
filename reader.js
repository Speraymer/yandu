import {bindOrganizer} from './note-organizer.js?v=7';
import {onFileDrop} from './file-drop.js';
import {enableClipSelection,renderClips,loadClips,saveClip} from './note-clips.js?v=2';
import './pane-divider.js';
import {recallTurns} from './course-context.js?v=4';
import {localGet,localSet} from './reader-storage.js';
import {segmentsFor, bindParts, validatedPairs} from './alignment.js';
import {defaultModel, configureKey, complete, hasKey, remembersKey, restoreKeys, forgetKey} from './model-api.js?v=15';
import {selectedAnswer,answerRange,visibleAnswerPoint} from './answer-quotes.js?v=6';
import {formatMessage} from './answer.js?v=6';
import {shelf,loadFile,rememberBook,loadSaved,savePage,saveTurn,mergeBook} from './library.js?v=6';
import {makeReadingPack,readReadingPack} from './reading-pack.js?v=3';
import {contents} from './contents.js';
import {classifyLayout,translatedBlocks} from './translation-layout.js';
import {getDocument, GlobalWorkerOptions, TextLayer} from './pdfjs/pdf.min.mjs';
const asset = path => new URL(path, import.meta.url).href;
GlobalWorkerOptions.workerSrc = asset('./pdfjs/pdf.worker.min.mjs');
const $ = id => document.getElementById(id);
const el = (tag, cls, value) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (value !== undefined) node.textContent = value;
  return node;
};
document.querySelectorAll('[data-icon]').forEach(button => {
  const img = el('img'); img.src = asset('./icons/' + button.dataset.icon + '.svg'); img.alt = '';
  button.prepend(img);
  if (!button.textContent.trim()) button.setAttribute('aria-label', button.title);
});
let doc, currentFile, rows = [], pageNo = 1, zoom = 1, selected = null, busy = false;
let paperId='',paperTurns=[],tocPromise=null;
let versions = 0, observer, loadSerial = 0;
let translationOpen = false, drawingWidth = 0, flashTimer;
function notice(message) {
  $('notice').textContent = message; $('notice').hidden = false;
  clearTimeout(flashTimer); flashTimer = setTimeout(() => $('notice').hidden = true, 5500);
}
let provider = localGet('reader.provider') === 'openai' ? 'openai' : 'deepseek';
const styleNames = {easier:'Easier Paper',direct:'简明答疑',review:'审稿式质询'};
const stylePrompts = {
  easier:'从读者的起点讲。整篇问题先串起研究矛盾、已有方法的局限、输入、方法、输出、实验和结论边界，再按自然单元逐步展开。局部问题聚焦指定句、图或公式与必要前提。首次出现的术语保留英文并解释，可以用一个简短例子，随后精确映射回原文。说明为什么这样设计、每个关键量如何变化，区分论文事实、作者解释、背景知识和学习推断。围绕提问讲到疑问解决为止。只有读者要求比较或理解本题确实需要前置概念时，才简短说明具体联系。',
  direct:'先用一句话回答问题，再用最少的必要步骤解释原因和证据。',
  review:'从主张、证据、可替代解释、适用边界四个角度评估。区分作者报告和仍需验证的内容。'
};
function styleChoice(){return localGet('reader.style') in styleNames ? localGet('reader.style') : 'easier';}
function teachingQuestion(q){
  const depth=localGet('reader.depth')==='deep'?'系统说明公式、变量、假设、消融和失效条件。':'优先直觉，只用理解机制所必需的数学。';
  return [stylePrompts[styleChoice()],depth,'需要公式时用 LaTeX，以 $...$ 或 $$...$$ 分隔。','读者偏好：'+(localGet('reader.preferences')||'无'), '当前问题：'+q].join('\n');
}
const modelFor = p => localGet('reader.model.' + p) || defaultModel(p);
function turnPage(t){
  if (Number.isInteger(t?.chatPage)) return t.chatPage;
  return Number(/^第 (\d+) 页/.exec(t?.source || '')?.[1]) || t?.quote?.from || 0;
}
function visibleChatPage(){
  if ($('scope').value === 'all') return 0;
  if ($('scope').value === 'selection') return selected?.from || turnPage(paperTurns.find(t=>t.id===selected?.turnId)) || pageNo;
  return pageNo;
}
function tagMessage(msg,n){
  msg.dataset.chatPage = n;
  msg.hidden = !!visibleChatPage() && n !== visibleChatPage();
  return msg;
}
function revealTurn(turn){
  if ($('scope').value !== 'all'){
    const n = turnPage(turn);
    clearComposerQuote();
    $('scope').value = n ? 'page' : 'all';
    if(n) go(n);
    showScope();
  }
  panel('chat');
}
function status() {
  const n = visibleChatPage(), log = $('messages');
  if (log.dataset.filter !== String(n)){
    log.dataset.filter = n;
    for(const msg of log.querySelectorAll('[data-chat-page]')) msg.hidden = !!n && Number(msg.dataset.chatPage)!==n;
    log.scrollTop = log.scrollHeight;
  }
  const p = provider;
  $('keyStatus').textContent = styleNames[styleChoice()]+' · '+(hasKey(p) ? modelFor(p) : '请在上方配置密钥');
  
  $('contextHint').textContent = $('scope').value === 'all' ? '全文 · ' + rows.length + ' 页' : $('scope').value === 'page' ? '原文第 ' + pageNo + ' 页' : selected?.kind==='answer'?'AI 回答选区':'原文选区';
  $('send').disabled = busy || !doc;
}
function panel(name) {
  $('side').hidden = name === 'closed';
  $('chat').hidden = name !== 'chat';
  $('ai').classList.toggle('active',name==='chat'); $('note').classList.toggle('active',name==='notes');
  $('sideTitle').textContent = name === 'notes' ? '论文笔记' : '与 AI 一起读';
}
$('toggle').onclick = () => panel($('side').hidden ? 'chat' : 'closed');
$('collapse').onclick = () => panel('closed'); $('ai').onclick = () => panel('chat');
const prepareNotes = bindOrganizer({editor:$('notes'),status:$('noteStatus'),dialog:$('paperNotesDialog'),
  scope:()=>paperId && 'paper:'+paperId, storage:()=>'reader.notes.'+doc.fingerprints[0], title:()=>$('paperNotesTitle').textContent,
  service:()=>({provider,model:modelFor(provider)})});
function showPaperNotes(){
  if (!doc) {notice('请先打开一篇论文。');return;}
  $('paperNotesTitle').textContent=$('title').textContent;
  renderClips($('paperClips'),'paper:'+paperId);
  prepareNotes(); $('paperNotesDialog').showModal();
}
$('note').onclick = showPaperNotes;
function paperClip(turn,role){
  return {turn:turn.id,time:turn.time,order:0,book:'',page:turnPage(turn),role};
}
enableClipSelection(article=>{
  const id=article.dataset.questionId || article.querySelector('[data-answer-id]')?.dataset.answerId;
  const turn=paperTurns.find(t=>t.id===id);
  return turn && {scope:'paper:'+paperId,clip:paperClip(turn,Number(article.classList.contains('assistant')))};
},()=>{ $('selectionTools').hidden=true;notice('已写入论文笔记。'); },notice,body=>{
  const row=body.closest('.row');
  if (!row || !paperId)return;
  const page=Number(row.firstElementChild.dataset.page);
  return {scope:'paper:'+paperId,clip:{turn:'source/'+page,time:0,order:0,book:'',page,role:body.classList.contains('translation')?3:2}};
});
$('notes').oninput = () => {
  if (doc) $('noteStatus').textContent = localSet('reader.notes.'+doc.fingerprints[0],$('notes').value) ? '已保存在此浏览器。' : '浏览器存储已满，笔记尚未保存。';
};
if(matchMedia('(max-width:740px)').matches) panel('closed');
function configFields() {
  const p = $('configProvider').value; $('model').value = modelFor(p); $('key').value = '';
  $('rememberKey').checked = remembersKey(p);
  $('forgetKey').hidden = !hasKey(p);
  $('keyHelp').textContent = remembersKey(p) ? '此服务的密钥已保存在当前浏览器，重新打开可继续使用。' : hasKey(p) ? '此标签页的论文与课程共用此密钥。' : '填入所选服务商的个人 API Key。';
  $('key').required = false; $('configError').textContent = '';
}
async function settings() { await keyLoad; $('configProvider').value = provider; configFields(); $('style').value=styleChoice(); $('depth').value=localGet('reader.depth')||'learn'; $('preferences').value=localGet('reader.preferences')||''; $('settingDialog').showModal(); }
$('settings').onclick = settings;
$('configProvider').onchange = configFields;
$('forgetKey').onclick = async () => {
  const p=$('configProvider').value;
  if($('setup').inert)return;
  $('setup').inert=true;
  try {await forgetKey(p);configFields();status();$('keyHelp').textContent='已清除该服务的密钥。';}
  catch { $('configError').textContent='无法清除已保存的密钥，请检查浏览器的站点存储权限。'; }
  finally { $('setup').inert=false; }
};
$('setup').onsubmit = async e => {
  e.preventDefault();
  if($('setup').inert)return;
  $('setup').inert=true;
  const p = $('configProvider').value, key = $('key').value.trim();
  try {
    await configureKey(p,key,$('rememberKey').checked);
    localSet('reader.model.'+p,$('model').value.trim()); provider = p; localSet('reader.provider',p);
    for(const k of ['style','depth','preferences'])localSet('reader.'+k,$(k).value);
    $('key').value=''; $('settingDialog').close(); status();
  } catch(err){$('configError').textContent=err instanceof DOMException ? '密钥设置未保存。请检查浏览器存储权限，或取消勾选后仅在本次使用。' : err.message;}
  finally{$('setup').inert=false;}
};
$('settingDialog').addEventListener('close', () => {$('key').value='';});
const keyLoad=restoreKeys().then(status).catch(()=>notice('浏览器未能读取已保存的密钥，可在 AI 设置中填写。'));
status();

function go(n) {
  n = Math.max(1, Math.min(rows.length, Number(n) || 1));
  if(rows[n-1]) $('reading').scrollTop = rows[n-1].row.offsetTop - $('sheets').offsetTop;
  pageNo=n; $('page').value=n; status();
}
$('page').onchange = () => go(Math.round(Number($('page').value)));
$('page').onkeydown = e => {if(e.key === 'Enter') $('page').blur()};
$('reading').addEventListener('scroll', () => {
  if(!rows.length)return;
  const top=readingMarker();
  const next=rows.findIndex(entry=>entry.row.getBoundingClientRect().bottom>top);
  const reading = $('reading');
  const atEnd = reading.scrollTop > 0 && reading.scrollTop + reading.clientHeight >= reading.scrollHeight - 1;
  const visiblePage=atEnd || next<0 ? rows.length : next+1;
  if(paperId){
    localSet('reader.page.'+paperId,String(visiblePage));
    localSet('reader.position.'+paperId,visiblePage+' '+pagePosition(visiblePage));
  }
  pageNo=visiblePage;
  if(document.activeElement!==$('page')) $('page').value=pageNo;
  status();
},{passive:true});
function layout() {
  if(!rows.length)return;
  const before=pageNo, readerWidth=$('reading').clientWidth;
  const width=Math.round(Math.max(235,Math.min(900,(readerWidth-(innerWidth<=740?18:28))*(translationOpen && innerWidth>740?.62:1)))*zoom);
  if(width===drawingWidth)return;
  const anchor=rows[before-1],reader=$('reading');
  const old=anchor?.row.getBoundingClientRect(),top=reader.getBoundingClientRect().top;
  const fraction=old?.height?(top-old.top)/old.height:0;
  drawingWidth=width; versions++;
  for(const entry of rows) {
    entry.task?.cancel();entry.layerTask?.cancel();entry.generation=0;
    const height=Math.round(width*entry.h/entry.w);
    Object.assign(entry.sheet.style,{width:width+'px',height:height+'px'});
    entry.translation.style.height=height+'px';
    if(translationOpen)entry.translation.style.width=(innerWidth>740 ? Math.max(220,readerWidth-width-30) : Math.round(innerWidth*.78))+'px';
  }
  $('scale').textContent=Math.round(zoom*100)+'%';
  if(anchor){const current=anchor.row.getBoundingClientRect();reader.scrollTop+=current.top-top+current.height*fraction;}
  for(const entry of rows) if(entry.visible) draw(entry);
}
new ResizeObserver(layout).observe($('reading'));
function setZoom(z){zoom=Math.min(2.4,Math.max(.5,Math.round(z*100)/100));layout()}
$('plus').onclick=()=>setZoom(zoom+.15); $('minus').onclick=()=>setZoom(zoom-.15); $('scale').onclick=()=>setZoom(1);
async function draw(entry) {
  if(entry.generation===versions)return;
  const version=versions;entry.generation=version;
  try{
    const viewport=entry.pdf.getViewport({scale:drawingWidth/entry.w});
    const ratio=Math.min(devicePixelRatio || 1,2, 2600/Math.max(viewport.width,viewport.height));
    const canvas=el('canvas'); canvas.width=Math.ceil(viewport.width*ratio);canvas.height=Math.ceil(viewport.height*ratio);
    const layer=el('div','textLayer');
    entry.sheet.style.setProperty('--total-scale-factor',viewport.scale);
    entry.sheet.replaceChildren(canvas,layer);
    entry.task=entry.pdf.render({canvas,viewport,transform:[ratio,0,0,ratio,0,0]});
    await entry.task.promise;
    if(version!==versions || !entry.visible)return;
    const content=await getText(entry);
    if(version!==versions || !entry.visible)return;
    entry.layerTask=new TextLayer({textContentSource:content,container:layer,viewport});
    const task=entry.layerTask;
    await task.render();
    if(entry.layerTask===task && layer.isConnected){
      bindParts(entry, content, task.textDivs);
      refreshAnchors();
    }
  }catch(err){if(version===versions && entry.visible && !/cancel|abort/i.test(err.name+' '+err.message)) notice('页面绘制失败：'+err.message);}
}
function getText(entry){return entry.text ||= entry.pdf.getTextContent();}
async function pageText(entry) {
  const text=await getText(entry);
  return text.items.filter(i=>typeof i.str==='string').map(i=>i.str+(i.hasEOL?'\n':' ')).join('').trim();
}
const welcome=$('welcome');
async function openPDF(file,name,knownId,progress) {
  let next;
  const serial=++loadSerial;
  try {
    const bytes=await file.arrayBuffer();
    const id=knownId || Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
    if(progress && id!==progress.id)throw Error('PDF 校验失败，请重新传输完整的阅读包。');
    next=await getDocument({data:bytes,cMapUrl:asset('./pdfjs/cmaps/'),cMapPacked:true,standardFontDataUrl:asset('./pdfjs/standard_fonts/'),wasmUrl:asset('./pdfjs/wasm/'),iccUrl:asset('./pdfjs/iccs/'),isEvalSupported:false}).promise;
    if(progress && next.numPages!==progress.pages)throw Error('阅读记录与 PDF 页数不符。');
    const pages=[];
    for(let n=1;n<=next.numPages;n++){
      const pdf=await next.getPage(n); const vp=pdf.getViewport({scale:1});
      const row=el('article','row'),sheet=el('div','sheet'),translation=el('div','translation');
      sheet.dataset.page=n; sheet.setAttribute('aria-label','第 '+n+' 页');sheet.append(el('small','page-id','第 '+n+' 页'));
      translation.hidden=true;row.append(sheet,translation);pages.push({pdf,row,sheet,translation,n,w:vp.width,h:vp.height,paper:id,fingerprint:next.fingerprints[0]});
    }
    let saved=[],turns=[];
    try{
      const book={id,name,pages:pages.length,accessed:Date.now()};
      if(progress)await mergeBook(book,file,progress.translations,progress.turns);
      else await rememberBook(book,file);
      [saved,turns]=await Promise.all([loadSaved('pages',id),loadSaved('turns',id)]);
    }catch(err){if(progress)throw err;notice('本机书架存储不可用，请检查浏览器存储空间和权限。');}
    if(serial!==loadSerial){if(progress)throw Error('已切换论文，请重新导入。');await next.loadingTask.destroy();return;}
    if(progress)applyReadingProgress(progress,next.fingerprints[0]);
    observer?.disconnect(); const previous=doc; versions++; rows.forEach(e=>{e.visible=false;e.task?.cancel();e.layerTask?.cancel()});
    resetStudy(); doc=next;currentFile=file;paperId=id;paperTurns=turns.sort((a,b)=>a.time-b.time);tocPromise=null;
    setPaperControls(true);
    localSet('reader.lastPaper',id);
    rows=pages; selected=null;translationOpen=false;
    const resumePage=Number(localGet('reader.page.'+id))||1;
    updateTranslationAction(); $('translate').classList.remove('active');$('quote').hidden=true;$('scope').value='all';$('scope').options[2].disabled=true;
    $('messages').replaceChildren(welcome);$('question').value='';$('title').textContent=name;$('title').title=name;document.title=name+' · 研读';
    if ($('paperNotesDialog').open) $('paperNotesDialog').close();
    $('notes').value=localGet('reader.notes.'+doc.fingerprints[0])||'';$('noteStatus').textContent='更改自动保存在此浏览器。';
    pageNo=1; zoom=1;drawingWidth=0; $('pages').textContent=rows.length;$('page').max=rows.length;
    $('sheets').replaceChildren(...rows.map(e=>e.row));layout();go(resumePage);
    observer=new IntersectionObserver(items=>{
      for(const item of items){const entry=rows[Number(item.target.firstChild.dataset.page)-1];if(!entry||entry.row!==item.target)continue;
        entry.visible=item.isIntersecting;
        if(entry.visible)draw(entry);
        else if(entry.generation){entry.task?.cancel();entry.layerTask?.cancel();entry.generation=0;entry.sheet.replaceChildren(el('small','page-id','第 '+entry.n+' 页'));}
      }
    },{root:$('reading'),rootMargin:'500px 0px'});
    rows.forEach(e=>observer.observe(e.row));restoreTranslations(saved);
    if(localGet('reader.bilingual.'+id)==='true'&&rows.some(e=>e.zh?.length))viewTranslations(true);
    const [positionPage,fraction]=(localGet('reader.position.'+id)||'').split(' ').map(Number);
    if(resumePage===positionPage && Number.isFinite(fraction) && fraction>=0 && fraction<=1){
      const rect=rows[resumePage-1]?.row.getBoundingClientRect();
      if(rect)$('reading').scrollTop+=rect.top+rect.height*fraction-readingMarker();
    }
    restoreChat();status();await previous?.loadingTask.destroy();
  }catch(err){
    if(next && next!==doc)await next.loadingTask.destroy();
    if(progress)throw err;
    if(serial===loadSerial)notice('无法打开这份 PDF：'+err.message);
  }
}
onFileDrop('松开以打开论文 PDF', files => {
  if (files.length !== 1 || !/\.pdf$/i.test(files[0].name)) return notice('请一次拖入一份论文 PDF。');
  openPDF(files[0],files[0].name).catch(err => notice(err.message));
});
$('upload').onclick=()=>$('file').click();
$('file').onchange=async()=>{const f=$('file').files[0];if(f)await openPDF(f,f.name);$('file').value='';};
function showScope(){
  const visible=$('scope').value==='selection'&&selected;
  $('quote').hidden=!visible;
  if(visible){
    const top=el('div','quote-heading'), remove=el('button','remove-quote','取消引用');
    remove.type='button';
    remove.onclick=()=>{clearComposerQuote();$('question').focus({preventScroll:true});};
    top.append(el('div','quote-preview',quoteLabel(selected)+' · '+selected.text),remove);
    $('quote').replaceChildren(top);
    const actions=el('div','quote-actions');
    const explain=el('button','','拆解术语'),evidence=el('button','','在全文中找证据');
    explain.type=evidence.type='button';
    explain.onclick=()=>ask('找出引文中最关键的术语。用一个具体例子解释，再将例子对应回原文。','selection');
    evidence.onclick=()=>ask('针对以下摘录（'+quoteLabel(selected)+'）中的主张，在论文中定位支持或限制它的实验、对照组和指标。若它是定义或动机，请说明依据类型。请引用页码。\n'+selected.text.slice(0,4800),'all');
    const formula=el('button','','逐项读公式');formula.type='button';
    formula.onclick=()=>ask('逐项读这个表达式：它要求什么，变量从哪里来，每一步如何改变结果？给一个最小数值例子。原文提取若缺符号，请标出缺口。','selection');
    actions.append(explain,formula,evidence);$('quote').append(actions);
  }
  status();
}
$('scope').onchange=showScope;
for(const area of [$('sheets'),$('messages'),$('floatLayer')]){
  area.addEventListener('pointerup',()=>setTimeout(picked,0));
  area.addEventListener('keyup',picked);
}
// Mobile selection handles can move without a pointerup on the answer.
document.addEventListener('selectionchange',()=>{
  if(!matchMedia('(pointer: coarse)').matches)return;
  const s=getSelection(),node=s?.anchorNode;
  const el=node?.nodeType===1?node:node?.parentElement;
  if(s&&!s.isCollapsed&&el?.closest('[data-answer-id]'))picked();
});
async function context(scope,n,selection,documentRows) {
  if(scope==='selection'&&selection?.kind==='answer'){
    const source=paperTurns.find(t=>t.id===selection.turnId);
    return '【AI 回答摘录】\n'+selection.text+(source?'\n【当时的问题】\n'+source.question:'')+'\n这段文字来自先前的 AI 回答，涉及论文事实时需要核实。';
  }
  if(scope==='selection'&&selection)return '[第'+selection.from+'页'+(selection.to!==selection.from?'至第'+selection.to+'页':'')+']\n'+selection.text+(selection.original?'\n对应原文：'+selection.original:'');
  const entries=scope==='all'?documentRows:[documentRows[n-1]];
  const parts=[];let length=0, readable=false;
  for(const e of entries) {
    const text=await pageText(e); if(text) readable=true;
    const part='[第'+e.n+'页]\n'+text;length+=part.length+2;
    if(length>360000)throw Error('全文超出发送上限，请改选当前页或选区。');
    parts.push(part);
  }
  if(!readable)throw Error('所选页面没有可提取的文字。扫描件请先进行 OCR。');
  return parts.join('\n\n');
}
function addMessage(role, value, label, target=$('messages'),turnId=null) {
  if(target===$('messages'))welcome.remove();
  const msg=el('article','msg '+role);
  const author=role==='user'?'我的提问':'AI 回复';
  const detail=role==='user'?(label||'').replace(/^你(?: · )?/,''):label;
  const heading=el('small','msg-role',author);
  if(detail)heading.append(el('span','msg-detail',detail));
  const body=el('div','msg-body');msg.append(heading,body);
  formatMessage(body,value,(page,text)=>{
    if(page<1||page>rows.length)return null;
    const button=el('button','cite',text);button.onclick=()=>go(page);return button;
  });
  if(role==='user'){
    msg.dataset.questionId=turnId;
    msg.tabIndex=-1;
  }else if(turnId)body.dataset.answerId=turnId;
  target.append(msg);
  if(role==='assistant'){
    target.scrollTop+=msg.getBoundingClientRect().top-target.getBoundingClientRect().top-6;
  }else target.scrollTop=target.scrollHeight;
  return msg;
}
function setBusy(value){busy=value;$('upload').disabled=value;status();}
function newTurn(thread,question,label,source,quote){
  return {id:crypto.randomUUID(),paper:paperId,thread,time:Date.now(),question,label,source,quote:quote||null,model:modelFor(provider)};
}
async function storeTurn(turn){
  if(turn.paper===paperId){
    const index=paperTurns.findIndex(t=>t.id===turn.id);
    if(index<0)paperTurns.push(turn);else paperTurns[index]=turn;
  }
  try{await saveTurn(turn);}catch{notice('问答记录保存失败，请检查本机存储空间。');}
}
function memoryLinks(reply,turn){
  if (!turn.memoryIds?.length) return;
  const links = el('details','');
  links.append(el('summary','','本次参考的其他问答'));
  for (const id of turn.memoryIds){
    const source = paperTurns.find(t=>t.id===id && t.thread==='main');
    if (!source) continue;
    const page = turnPage(source);
    const link = el('button','cite',(page?'第 '+page+' 页':'全文讨论')+'：'+source.question.slice(0,160));
    link.onclick=()=>{
      revealTurn(source);
      $('messages').querySelector('[data-question-id="'+CSS.escape(id)+'"]')?.scrollIntoView({block:'nearest'});
    };
    links.append(link);
  }
  if(links.childElementCount>1)reply.append(links);
}
function replayTurn(turn,target,legacyFirst=false){
  const user=addMessage('user',turn.question,turn.label,target,turn.id);
  const citation=turn.replyQuote||(turn.thread==='main'?turn.quote:null);
  if(citation)user.querySelector(".msg-body").before(quoteBlock(citation));
  if(turn.quote && (turn.firstQuote ?? legacyFirst))user.querySelector(".msg-body").before(quoteBlock(turn.quote));
  const reply=addMessage('assistant',turn.answer||turn.error||'未收到完整答复，可重新提问。',turn.model,target,turn.answer?turn.id:null);
  if(target===$('messages')) { tagMessage(user,turnPage(turn)); tagMessage(reply,turnPage(turn)); memoryLinks(reply,turn); }
  if(turn.answer)saveNoteButton(reply,turn.source,turn.question,turn.answer);
}
function recentMessages(turns){
  const answered=turns.filter(t=>t.answer);
  return answered.slice(-4).flatMap(turn=>{
    const usedAnchor=turn.thread==='main'||(turn.firstQuote ?? (turn===answered[0]));
    const question=quotePrefix(usedAnchor?turn.quote:null)+quotePrefix(turn.replyQuote)+turn.question;
    return [{role:'user',content:question.slice(0,12000)},{role:'assistant',content:turn.answer.slice(0,12000)}];
  });
}
function restoreChat(){
  const main=paperTurns.filter(t=>t.thread==='main');
  for(const turn of main)replayTurn(turn,$('messages'));

}
async function chatRequest(q, material, previous){
  return complete({provider,model:modelFor(provider),question:teachingQuestion(q),context:material,history:previous.slice(-8)});
}
async function ask(question,scope=$('scope').value,n=pageNo) {
  if(busy||!doc||!question.trim())return;
  await keyLoad;
  if(busy)return;
  if(!hasKey(provider)){$('question').value=question;settings();return;}
  const field=$('question'),ref=doc,model=modelFor(provider);
  const quote=$('scope').value==='selection'?selected:null;
  const returnScope=scopeBeforeQuote;
  setBusy(true);let pending,turn,consumed=false;
  try {
    let material=await context(scope,n,quote,rows);
    if(doc!==ref)return;
    const label=scope==='all'?'你 · 全文':scope==='selection'?'你 · 选区':'你 · 第 '+n+' 页';
    turn=newTurn('main',question,label,materialScope(scope,n,quote),quote);
    turn.chatPage = scope==='all' ? 0 : scope==='page' ? n : quote?.from || turnPage(paperTurns.find(t=>t.id===quote?.turnId)) || n;
    const main = paperTurns.filter(t=>t.thread==='main' && t.paper===turn.paper);
    const previous = recentMessages(main.filter(t=>turnPage(t)===turn.chatPage));
    const memories = recallTurns(main.map(t=>({...t,project:t.paper,deck:t.paper,page:turnPage(t),name:''})),
      {project:turn.paper,deck:turn.paper,page:turn.chatPage,question},scope==='all'?'':material);
    turn.memoryIds = memories.map(t=>t.id);
    if(memories.length) material += '\n同篇论文其他讨论的摘录，仅供参考，论文事实以原文为准：\n' +
      memories.map(t=>(t.page?'第 '+t.page+' 页':'全文讨论')+'\n问：'+t.question.slice(0,400)+'\n答：'+t.answer.slice(0,1000)).join('\n');
    await storeTurn(turn);if(ref!==doc)return;
    panel('chat');const userMsg=addMessage('user',question,label,$('messages'),turn.id);
    tagMessage(userMsg,turn.chatPage);
    if(quote){
      userMsg.querySelector(".msg-body").before(quoteBlock(quote));
      if(selected===quote && $('scope').value==='selection'){clearComposerQuote();consumed=true;}
    }
    if(field.value.trim()===question)field.value='';
    pending=tagMessage(addMessage('assistant','正在阅读原文…',model),turn.chatPage);
    const result=await chatRequest(question,material,previous);
    turn.answer=result.answer;await storeTurn(turn);
    if(doc!==ref)return;
    pending.remove();const reply=addMessage('assistant',result.answer,model,$('messages'),turn.id);
    saveNoteButton(reply,materialScope(scope,n,quote),question,result.answer);
    tagMessage(reply,turn.chatPage); memoryLinks(reply,turn);
  }catch(err){
    if(turn&&!turn.answer){turn.error=err.message;await storeTurn(turn);}
    pending?.remove();
    if(doc===ref){
      panel('chat');tagMessage(addMessage('assistant',err.message,'发送失败'),turn?.chatPage ?? n);
      if(!field.value && (!selected || selected===quote)){
        field.value=question;
        if(consumed && !selected && $('scope').value===returnScope)attachQuote(quote);
      }
    }
  }
  finally{setBusy(false);}
}
$('composer').onsubmit=e=>{e.preventDefault();ask($('question').value.trim())};
$('question').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){e.preventDefault();$('composer').requestSubmit();}};
document.querySelectorAll('[data-ask]').forEach(b=>b.onclick=()=>{if(busy)return;$('scope').value='all';showScope();ask(b.dataset.ask,'all')});
function pageAsk(q){if(busy)return;panel('chat');$('scope').value='page';showScope();ask(q,'page');}
$('quiz').onclick=()=>pageAsk('根据当前页出一道理解题，先只给题目；等我回答后再讲解。');
$('fig').onclick=()=>pageAsk('根据本页的图注与正文解释图中各部分及其关系。如果本页无图注，请指出。');
$('explain').onclick=()=>{if(busy)return;if(!draft&&!selected){notice('请先在论文原文中划选需要解释的文字。');return;}attachQuote(draft||selected);$('selectionTools').hidden=true;panel('chat');ask('结合所选原文，用中文解释这段话中的术语与推理。','selection');};
function resultButton(label,n){const b=el('button');b.append(el('span','',label),el('small','',String(n)));b.onclick=()=>{$('browserDialog').close();go(n)};return b;}
function listDialog(title){
  $('shelfTransfer').hidden=true;
  findVersion++;$('browserTitle').textContent=title;$('search').hidden=true;$('results').replaceChildren();
  if(!$('browserDialog').open)$('browserDialog').showModal();
  return findVersion;
}
$('outline').onclick=async()=>{
  if(!doc)return;const token=listDialog('论文目录');
  $('results').textContent='正在读取章节…';
  try{
    tocPromise||=contents(doc);const toc=await tocPromise;
    if(token!==findVersion)return;
    $('results').replaceChildren(el('small','list-source',toc.source));
    for(const item of toc.items){
      const b=resultButton(item.title,item.page);b.style.paddingLeft=(8+12*Math.min(4,item.level))+'px';$('results').append(b);
    }
  }catch{tocPromise=null;if(token===findVersion)$('results').textContent='目录读取失败，请重新打开目录。';}
};
const packHelp='阅读包包含 PDF、阅读位置、译文、笔记和问答。API 密钥仅保存在各自设备。';
function readingMarker(){
  const reader=$('reading');
  return reader.getBoundingClientRect().top+Math.min(110,reader.clientHeight*.2);
}
function pagePosition(page){
  const rect=rows[page-1].row.getBoundingClientRect();
  return Math.max(0,Math.min(1,(readingMarker()-rect.top)/rect.height));
}
function applyReadingProgress(data,fingerprint){
  const key='reader.notes.'+fingerprint,old=localGet(key)||'';
  for(const clip of data.clips || [])saveClip('paper:'+data.id,clip);
  const incoming=data.notes;
  let notes=old;
  if(!old || incoming.includes(old))notes=incoming;
  else if(incoming && !old.includes(incoming))notes=old+'\n\n导入的笔记\n'+incoming;
  if(!localSet(key,notes)||!localSet('reader.page.'+data.id,String(data.page))||
      !localSet('reader.position.'+data.id,data.page+' '+data.position)||
      !localSet('reader.bilingual.'+data.id,String(data.bilingual)))
    throw Error('当前浏览器无法保存阅读位置或笔记，请检查站点存储空间后重新导入。');
}
function transferBusy(active){
  $('exportPack').disabled=active||!doc;$('importPack').disabled=active;
}
$('exportPack').onclick=async()=>{
  if(!doc)return;
  transferBusy(true);$('packStatus').textContent='正在生成阅读包…';
  try{
    const name=$('title').textContent;
    const pack=await makeReadingPack({
      id:paperId,name,pages:rows.length,page:pageNo,
      position:pagePosition(pageNo),
      bilingual:translationOpen,notes:$('notes').value,clips:loadClips('paper:'+paperId),turns:paperTurns,
      translations:rows.filter(e=>e.done||e.zh?.length).map(e=>({
        paper:paperId,page:e.n,zh:e.zh||[],done:!!e.done,layoutHints:e.layoutHints||[]
      }))
    },currentFile);
    const link=el('a'),url=URL.createObjectURL(pack);
    link.href=url;link.download=(name.replace(/\.pdf$/i,'').replace(/[<>:"/\\|?*]/g,'_')||'论文')+'.yandu';
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    $('packStatus').textContent='阅读包已生成。在另一台设备的书架中选择「导入阅读包」即可继续。';
  }catch(err){$('packStatus').textContent='导出失败：'+err.message;}
  finally{transferBusy(false);}
};
$('importPack').onclick=()=>$('packFile').click();
$('packFile').onchange=async()=>{
  const file=$('packFile').files[0];$('packFile').value='';
  if(!file)return;
  transferBusy(true);$('packStatus').textContent='正在校验阅读包…';
  try{
    const {data,pdf}=await readReadingPack(file);
    await openPDF(pdf,data.name,undefined,data);
    $('browserDialog').close();notice('已导入《'+data.name+'》，从第 '+data.page+' 页继续阅读。');
  }catch(err){$('packStatus').textContent='导入失败：'+err.message;}
  finally{transferBusy(false);}
};
$('shelf').onclick=async()=>{
  const token=listDialog('我的书架');
  $('shelfTransfer').hidden=false;$('exportPack').disabled=!doc||$('importPack').disabled;
  if(!$('importPack').disabled)$('packStatus').textContent=packHelp;
  try{
    const books=await shelf();if(token!==findVersion)return;
    $('results').append(el('small','list-source','当前浏览器 · '+books.length+' 篇'));
    for(const book of books.sort((a,b)=>b.accessed-a.accessed)){
      const b=el('button','shelf-book');b.append(el('span','',book.name),el('small','',book.id===paperId?'正在阅读':book.pages+' 页'));
      b.onclick=async()=>{
        try{if(book.id!==paperId){const file=await loadFile(book.id);if(!file)throw Error();await openPDF(file,book.name,book.id);}
          $('browserDialog').close();}
        catch{notice('无法从书架加载此 PDF。');}
      };$('results').append(b);
    }
  }catch{$('results').textContent='书架不可用，请检查当前浏览器的本地存储权限。';}
};
$('conversations').onclick=()=>{
  listDialog('对话目录');
  const grouped=new Map();
  for(const turn of paperTurns){
    if(!grouped.has(turn.thread))grouped.set(turn.thread,[]);
    grouped.get(turn.thread).push(turn);
  }
  if(!grouped.size)$('results').textContent='这篇论文还没有问答记录。';
  for(const [id,turns] of grouped){
    const quote=turns[0].quote;
    const section=el('section','conversation-index');
    const title=id==='main'?'右栏对话':'临时会话 · '+quoteLabel(quote);
    section.append(el('h3','',title));
    if(id!=='main')section.append(el('p','index-excerpt',quote.text));
    const list=el('ol');section.append(list);$('results').append(section);
    for(const turn of turns){
      const item=el('li'),button=el('button','index-question');
      button.append(el('span','',turn.question));
      button.title=turn.question;
      item.append(button);list.append(item);
      button.onclick=()=>{
        $('browserDialog').close();
        let log=$('messages');
        if(id==='main')revealTurn(turn);
        else{
          const existing=[...threads].find(f=>f.id===id);
          const box=existing?.box||openThread(quote,id,turns);
          $('floatLayer').append(box);log=box.querySelector('.float-log');
        }
        const question=log.querySelector('[data-question-id="'+CSS.escape(turn.id)+'"]');
        question.focus({preventScroll:true});
        log.scrollTop+=question.getBoundingClientRect().top-log.getBoundingClientRect().top-8;
      };
    }
  }
};
let findVersion=0;
$('find').onclick=()=>{if(!doc)return;listDialog('查找原文');$('search').hidden=false;$('search').value='';$('search').focus();};
$('search').oninput=async()=>{
  const serial=++findVersion,q=$('search').value.trim().toLowerCase();$('results').replaceChildren();if(!q)return;
  for(const e of rows){const t=(await pageText(e)).replace(/\s+/g,' ');if(serial!==findVersion)return;const at=t.toLowerCase().indexOf(q);
    if(at>=0)$('results').append(resultButton(t.slice(Math.max(0,at-24),at+q.length+48),e.n));}
  if(!$('results').childElementCount)$('results').textContent='没有找到匹配的原文。';
};
let job=null, draft=null, hoverId=null, anchorFrame=0;
const threads=new Set();
function quoteLabel(quote){return quote.kind==='answer'?'AI 回答':'第 '+quote.from+' 页';}
function quotePrefix(quote){return quote?quoteLabel(quote)+'引文：'+quote.text+'\n':'';}
function quoteBlock(quote){return el('blockquote','',quote.kind==='answer'?'AI 回答 · '+quote.text:quote.text);}
function materialScope(scope,n,quote){return scope==='all'?'全文':scope==='selection'?quoteLabel(quote)+' · '+quote.text:'第 '+n+' 页';}
function saveNoteButton(reply,source,question,answer){
  const b=el('button','clip-note','摘入笔记');
  b.onclick=()=>{
    if(!doc)return;
    const id=reply.querySelector('[data-answer-id]')?.dataset.answerId;
    const turn=paperTurns.find(t=>t.id===id);
    if(!turn)return;
    try{saveClip('paper:'+paperId,{...paperClip(turn,1),offset:0,text:answer});}
    catch{notice('未能写入论文笔记，请检查浏览器存储空间。');return;}
    b.textContent='已摘入笔记';b.disabled=true;
  };reply.append(b);
}
function cacheKey(e){return 'reader.align.3.'+e.fingerprint+'.'+e.n;}
function restoreTranslations(saved){
  const byPage=new Map(saved.map(v=>[v.page,v]));
  for(const e of rows){
    try{const db=byPage.get(e.n),legacy=JSON.parse(localGet(cacheKey(e)));
      const value=(!db||(!db.done&&legacy?.zh?.length>=db.zh.length))?legacy:db;
      if(Array.isArray(value?.zh)){
      e.zh=value.zh;e.done=value.done===true;e.layoutHints=value.layoutHints||[];
      if(value===legacy)persistTranslation(e);
    }}catch{}
  }
  updateTranslationAction();
}
async function persistTranslation(e){
  const key=cacheKey(e),record={paper:e.paper,page:e.n,zh:[...e.zh],done:!!e.done,layoutHints:e.layoutHints||[]};
  try{await savePage(record);}
  catch{if(!localSet(key,JSON.stringify(record)))notice('译文保存失败。请检查本机存储空间。');}
}
function updateTranslationAction(){
  const done=rows.filter(e=>e.done).length;
  const started=rows.some(e=>e.zh?.length||e.issue||e.done);
  $('translate').textContent=job?(job.stop?'正在暂停…':'暂停翻译 '+done+'/'+rows.length):done===rows.length&&done?'全文已译':started?'继续翻译 '+done+'/'+rows.length:'一键翻译全文';
  $('translate').title='从当前页开始翻译全文。模型按请求计费，暂停后会保留已完成的译文。';
  $('translationView').hidden=!translationOpen&&!rows.some(e=>e.zh?.length||e.done);
  $('translationView').textContent=translationOpen?'收起译文':'展开译文';
}
function renderTranslation(e){
  const box=e.translation;
  const scroll=box.scrollTop;
  box.replaceChildren(el('strong','tr-page','中文译文 · 第 '+e.n+' 页'));
  if(e.zh?.length){
    box.append(translatedBlocks(e));
    if(!e.sourceLayout && !e.preparing){
      e.preparing=true;
      getText(e).then(content=>{
        e.sourceLayout=classifyLayout(e.n,segmentsFor(e,content),content.items);
        if(box.isConnected)renderTranslation(e);
      }).catch(()=>{e.preparing=false;});
    }
  }
  if(!e.done||!e.zh?.length)box.append(el('small','translation-status',e.issue || (e.done?'此页无可提取文字。':job?.page===e.n?'正在翻译…':job?'等待翻译':'尚未完成')));
  box.scrollTop=scroll;
}
function viewTranslations(open){
  translationOpen=open;localSet('reader.bilingual.'+paperId,String(open));
  for(const e of rows){e.translation.hidden=!open;if(open)renderTranslation(e);}
  drawingWidth=0;layout();updateTranslationAction();scheduleAnchors();
}
$('translationView').onclick=()=>viewTranslations(!translationOpen);
async function translateAll(){
  if(job){job.stop=true;updateTranslationAction();return;}
  if(!doc)return;
  if(rows.every(e=>e.done)){viewTranslations(!translationOpen);return;}
  await keyLoad;
  if(!hasKey(provider)){settings();return;}
  const task={stop:false,provider,model:modelFor(provider)},start=pageNo-1;
  job=task;viewTranslations(true);
  const order=rows.slice(start).concat(rows.slice(0,start));
  try{
    for(const e of order){
      if(job!==task||task.stop)break;
      if(e.done)continue;
      task.page=e.n;e.issue='';renderTranslation(e);
      const content=await getText(e),segs=segmentsFor(e,content);e.zh||=[];e.layoutHints||=[];
      e.sourceLayout||=classifyLayout(e.n,segs,content.items);
      while(e.zh.length<segs.length && job===task&&!task.stop){
        let size=0;const chunk=[];
        for(const seg of segs.slice(e.zh.length)){
          if(chunk.length&&(chunk.length>=48||size+seg.text.length>5500))break;
          chunk.push({id:seg.id,text:seg.text,layout:e.sourceLayout[seg.id-1].kind});size+=seg.text.length;
        }
        const result=await complete({provider:task.provider,model:task.model,history:[],
          question:'按上下文逐项翻译 JSON 数组中的学术论文，输出纯 JSON 数组。每项返回 id、zh、kind、paragraph。每个 id 恰好一次。zh 为完整中文译文，不加 Markdown 或概括，保留术语、数字、公式和编号。辨认跨片段断句，图号前缀不用重复。kind 根据文章内容选择 title/author/affiliation/heading/abstract/body/caption/label/table/formula/list/reference，layout 是排版线索。paragraph 为布尔值，只有新自然段的第一句为 true。同一段的后续句为 false。表格仅在原行列明确时用换行分行、制表符分列，保留表头和单位；不要猜测单元格。混合章节标题与正文时在标题后换行。无需输出其他说明。',
          context:'[第'+e.n+'页]\n'+JSON.stringify(chunk)});
        const hints=[],translated=validatedPairs(result.answer,chunk,hints);
        while(e.layoutHints.length<e.zh.length)e.layoutHints.push(null);
        e.layoutHints.push(...hints);e.zh.push(...translated);e.done=e.zh.length===segs.length;
        if(job===task)renderTranslation(e);
        await persistTranslation(e);
      }
      if(job!==task)return;
      if(e.zh.length===segs.length)e.done=true;
      await persistTranslation(e);
      renderTranslation(e);updateTranslationAction();
    }
  }catch(err){if(job===task){const e=rows[task.page-1];e.issue=err.message;renderTranslation(e);notice('翻译停在第 '+task.page+' 页：'+err.message);}}
  finally{if(job===task){job=null;rows.forEach(renderTranslation);updateTranslationAction();}}
}
$('translate').onclick=translateAll;
function clearHover(){
  if(hoverId)document.querySelectorAll('.paired-hover').forEach(n=>n.classList.remove('paired-hover'));
  hoverId=null;
}
function highlightPair(node){
  if(!translationOpen||!node||node.dataset.pair===hoverId)return;
  clearHover();hoverId=node.dataset.pair;
  const matches=$('sheets').querySelectorAll('[data-pair="'+hoverId+'"]');
  for(const target of matches)target.classList.add('paired-hover');
}
$('sheets').addEventListener('pointerover',e=>highlightPair(e.target.closest('[data-pair]')));
$('sheets').addEventListener('pointerout',e=>{if(!e.relatedTarget?.closest?.('[data-pair]')||e.relatedTarget.closest('[data-pair]').dataset.pair!==hoverId)clearHover();});
function clipped(v,min,max){return Math.max(min,Math.min(v,Math.max(min,max)));}
function sourceRects(run,range){
  const text=run.firstChild;if(!text||text.nodeType!==3)return [];
  const sub=document.createRange();sub.selectNodeContents(text);
  if(range){
    if(!range.intersectsNode(text))return [];
    if(range.startContainer===text)sub.setStart(text,range.startOffset);
    if(range.endContainer===text)sub.setEnd(text,range.endOffset);
  }
  return Array.from(sub.getClientRects()).filter(r=>r.width>0&&r.height>0);
}
function picked(){
  const s=getSelection();
  if(!s?.rangeCount||s.isCollapsed){$('selectionTools').hidden=true;return;}
  const r=s.getRangeAt(0),text=s.toString().trim();
  const answer=selectedAnswer(r,text);
  if(answer){showPick(answer,r);return;}
  const elem=n=>n.nodeType===1?n:n.parentElement;
  $('selectionTools').hidden=true;
  const a=elem(r.startContainer).closest('.sheet,.translation'),b=elem(r.endContainer).closest('.sheet,.translation');
  if(!text||!a||!b||a.className!==b.className)return;
  const isTranslation=a.classList.contains('translation'),boxes=[],original=[],pieces=[];
  const from=Number(a.closest('.row').firstChild.dataset.page),to=Number(b.closest('.row').firstChild.dataset.page);
  for(const entry of rows.slice(from-1,to)){
    const ids=isTranslation?new Set([...entry.translation.querySelectorAll('[data-pair]')].filter(p=>r.intersectsNode(p)).map(p=>p.dataset.pair)):null;
    if(ids){
      for(const id of ids)original.push(entry.segments[Number(id.split('-')[1])-1].text);
      for(const p of entry.translation.querySelectorAll('[data-pair]'))if(r.intersectsNode(p))pieces.push(selectionText(p,r));
    }
    const sheet=entry.sheet.getBoundingClientRect();
    for(const run of entry.sheet.querySelectorAll('.source-run')){
      if(ids&&!ids.has(run.dataset.pair))continue;
      if(!ids&&r.intersectsNode(run))pieces.push(selectionText(run,r));
      for(const rect of sourceRects(run,ids?null:r))boxes.push({n:entry.n,x:(rect.left-sheet.left)/sheet.width,y:(rect.top-sheet.top)/sheet.height,w:rect.width/sheet.width,h:rect.height/sheet.height});
    }
  }
  if(!boxes.length)return;
  showPick({from,to,text:a===b?text:pieces.filter(Boolean).join(' '),original:original.join(' '),boxes},r);
}
function showPick(quote,r){
  draft=quote;
  const chooser=$('existingThread');
  chooser.hidden=quote.kind!=='answer'||!threads.size;
  if(!chooser.hidden){
    chooser.replaceChildren(new Option('引用到已有小窗…',''));
    let i=0;
    for(const f of threads)chooser.add(new Option(++i+' · '+f.quote.text.slice(0,20),f.id));
  }
  const last=Array.from(r.getClientRects()).filter(b=>b.width&&b.height).at(-1);
  if(!last)return;
  const tools=$('selectionTools');tools.hidden=false;
  tools.style.left=clipped(last.left,6,innerWidth-tools.offsetWidth-6)+'px';
  tools.style.top=clipped(last.bottom+5,6,innerHeight-tools.offsetHeight-6)+'px';
}
function selectionText(node,range){
  const sub=document.createRange();sub.selectNodeContents(node);
  if(node.contains(range.startContainer))sub.setStart(range.startContainer,range.startOffset);
  if(node.contains(range.endContainer))sub.setEnd(range.endContainer,range.endOffset);
  return sub.toString();
}
let scopeBeforeQuote='all';
function clearComposerQuote(){
  if(draft===selected)draft=null;
  selected=null;
  if($('scope').value==='selection')$('scope').value=scopeBeforeQuote;
  $('scope').options[2].disabled=true;
  $('quote').replaceChildren();showScope();
}
function attachQuote(quote){
  if($('scope').value!=='selection')scopeBeforeQuote=$('scope').value;
  selected=quote;$('scope').options[2].disabled=false;$('scope').value='selection';showScope();
}
function commitQuote(){
  if(!draft)return;attachQuote(draft);
  panel('chat');$('selectionTools').hidden=true;getSelection().removeAllRanges();$('question').focus();
}
$('useQuote').onclick=commitQuote;
$('selectionTools').addEventListener('pointerdown',e=>{if(e.target.closest('button'))e.preventDefault();});
$('existingThread').onchange=e=>{
  const f=[...threads].find(t=>t.id===e.target.value);if(!f||draft?.kind!=='answer')return;
  f.attach(draft);$('selectionTools').hidden=true;getSelection().removeAllRanges();
};
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#selectionTools'))$('selectionTools').hidden=true;});
document.addEventListener('keydown',e=>{if(e.key==='Escape')$('selectionTools').hidden=true;});
function scheduleAnchors(){if(!anchorFrame)anchorFrame=requestAnimationFrame(()=>{anchorFrame=0;refreshAnchors();});}
function place(box,x,y){
  box.style.left=clipped(x,4,innerWidth-box.offsetWidth-4)+'px';
  box.style.top=clipped(y,$('settings').closest('header').offsetHeight+2,innerHeight-box.offsetHeight-4)+'px';
}
function refreshAnchors(){
  const view=$('reading').getBoundingClientRect();
  $('floatLayer').style.setProperty('--available-height',Math.max(1,innerHeight-view.top-8)+'px');
  const answerMarks=[];
  for(const f of threads){
    place(f.box,f.box.offsetLeft,f.box.offsetTop);
    const range=f.quote.kind==='answer'?answerRange(f.quote):null;
    let anchor=visibleAnswerPoint(range);
    if(range)answerMarks.push(range);
    for(const piece of f.marks){
      const target=rows[piece.n-1]?.sheet;if(!target)continue;
      if(piece.mark.parentNode!==target)target.append(piece.mark);
      const r=piece.mark.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
      if(!anchor&&x>=view.left&&x<=view.right&&y>=view.top&&y<=view.bottom)anchor={x,y};
    }
    f.line.style.display=anchor?'':'none';f.jump.textContent=f.quote.kind==='answer'?'定位来源回答':anchor?'定位引文':'引文在视野外 · 定位';
    if(anchor){
      const b=f.box.getBoundingClientRect(),x=clipped(anchor.x,b.left,b.right),y=clipped(anchor.y,b.top,b.bottom);
      for(const [key,v] of Object.entries({x1:anchor.x,y1:anchor.y,x2:x,y2:y}))f.line.setAttribute(key,v);
    }
  }
  if(window.Highlight && CSS.highlights){
    if(answerMarks.length)CSS.highlights.set('answer-origin',new Highlight(...answerMarks));
    else CSS.highlights.delete('answer-origin');
  }
}
function closeThread(f){threads.delete(f);scheduleAnchors();f.resize.disconnect();f.box.remove();f.line.remove();for(const p of f.marks)p.mark.remove();}
function resetStudy(){job=null;draft=null;clearHover();$('selectionTools').hidden=true;for(const f of [...threads])closeThread(f);}
$('reading').addEventListener('scroll',()=>{$('selectionTools').hidden=true;scheduleAnchors();},{passive:true});
for(const area of [$('messages'),$('floatLayer')])area.addEventListener('scroll',()=>{
  $('selectionTools').hidden=true;scheduleAnchors();
},{capture:true,passive:true});
window.addEventListener('resize',scheduleAnchors);
function openThread(quote,id=crypto.randomUUID(),turns=[]){
  if(!quote)return;
  $('selectionTools').hidden=true;getSelection().removeAllRanges();
  const box=el('section','float-chat'),head=el('div','float-head'),title=el('strong','','临时提问 · '+quoteLabel(quote));
  box.setAttribute('role','dialog');box.setAttribute('aria-label',title.textContent);
  const expand=el('button','expand-float','展开阅读'), controls=el('div','float-actions');
  expand.setAttribute('aria-pressed','false');
  const close=el('button','','×');close.title='关闭临时会话';close.setAttribute('aria-label',close.title);
  const excerpt=el('blockquote','',quote.text),jump=el('button','jump','定位引文'),log=el('div','float-log');log.setAttribute('aria-live','polite');
  const form=el('form','float-form'),input=el('textarea'),send=el('button','primary','发送');
  input.placeholder='围绕这段话追问…';input.setAttribute('aria-label','临时问题');input.rows=2;input.maxLength=6000;
  form.append(input,send);controls.append(expand,close);head.append(title,controls);const extra=el('div','extra-quote');extra.hidden=true;
  excerpt.hidden=turns.some(t=>t.answer);
  box.append(head,excerpt,jump,log,extra,form);$('floatLayer').append(box);
  
  const sizeHint=el('span','size-hint','拖动右下角调整大小');box.append(sizeHint);
  const line=document.createElementNS('http://www.w3.org/2000/svg','line');$('leaders').append(line);
  const marks=(quote.boxes||[]).map(p=>{const mark=el('i','quote-mark');Object.assign(mark.style,{left:p.x*100+'%',top:p.y*100+'%',width:p.w*100+'%',height:p.h*100+'%'});return {mark,n:p.n};});
  const f={id,box,quote,line,marks,jump,previous:recentMessages(turns),resize:new ResizeObserver(scheduleAnchors)};threads.add(f);f.resize.observe(box);
  f.attach=value=>{
    f.replyQuote=value;extra.replaceChildren();extra.hidden=!value;
    if(value){
      const cancel=el('button','remove-quote','取消引用');cancel.onclick=()=>f.attach(null);
      extra.append(el('span','','AI 回答 · '+value.text),cancel);
      if(box.nextSibling)$('floatLayer').append(box);
    }
    input.focus({preventScroll:true});
  };
  const first=quote.boxes?.[0],ref=first&&rows[first.n-1].sheet.getBoundingClientRect();
  const point=quote.kind==='answer'&&visibleAnswerPoint(answerRange(quote));
  const ax=first?ref.left+first.x*ref.width:point?point.x:innerWidth*.5;
  const ay=first?ref.top+first.y*ref.height:point?point.y:innerHeight*.25;
  place(box,ax+box.offsetWidth+42<innerWidth?ax+42:ax-box.offsetWidth-24,ay+25);
  jump.onclick=()=>{
    if(quote.kind==='answer'){
      const turn=paperTurns.find(t=>t.id===quote.turnId);
      if(!turn){notice('这条来源回答尚未载入。');return;}
      if(turn.thread==='main')revealTurn(turn);
      else{
        const parent=[...threads].find(t=>t.id===turn.thread);
        if(parent)$('floatLayer').append(parent.box);
        else openThread(turn.quote,turn.thread,paperTurns.filter(t=>t.thread===turn.thread));
      }
      const range=answerRange(quote);
      if(range){
        const node=range.startContainer,body=(node.nodeType===1?node:node.parentElement).closest('[data-answer-id]');
        const log=body.closest('#messages,.float-log'),rect=range.getBoundingClientRect();
        log.scrollTop+=rect.top-log.getBoundingClientRect().top-log.clientHeight*.3;
      }
      scheduleAnchors();return;
    }
    const reader=$('reading'),sheet=rows[first.n-1].sheet.getBoundingClientRect(),view=reader.getBoundingClientRect();
    reader.scrollTop+=sheet.top+first.y*sheet.height-view.top-view.height*.35;reader.scrollLeft+=sheet.left+first.x*sheet.width-view.left-view.width*.35;};
  box.addEventListener('pointerdown',e=>{if(box.nextSibling&&!e.target.closest('[data-answer-id]'))$('floatLayer').append(box);});
  close.onclick=()=>closeThread(f);
  let priorBounds=null;
  expand.onclick=()=>{
    if(priorBounds){
      Object.assign(box.style,{width:priorBounds.width,height:priorBounds.height});
      place(box,priorBounds.x,priorBounds.y);priorBounds=null;
    }else{
      priorBounds={x:box.offsetLeft,y:box.offsetTop,width:box.style.width,height:box.style.height};
      box.style.width='min(780px, 92vw)';box.style.height='min(760px, var(--available-height), 85dvh)';
      place(box,(innerWidth-box.offsetWidth)/2,(innerHeight-box.offsetHeight)/2);
    }
    expand.textContent=priorBounds?'还原大小':'展开阅读';expand.setAttribute('aria-pressed',String(!!priorBounds));
    refreshAnchors();
  };
  for(const turn of turns)replayTurn(turn,log,turn===turns[0]);
  let drag;
  head.onpointerdown=e=>{if(e.target.closest('button'))return;drag={x:e.clientX-box.offsetLeft,y:e.clientY-box.offsetTop};head.setPointerCapture(e.pointerId);e.preventDefault();};
  head.onpointermove=e=>{if(drag){place(box,e.clientX-drag.x,e.clientY-drag.y);refreshAnchors();}};
  head.onlostpointercapture=()=>drag=null;
  input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){e.preventDefault();form.requestSubmit();}};
  form.onsubmit=async e=>{
    e.preventDefault();const q=input.value.trim();if(!q||send.disabled)return;
    await keyLoad;
    if(send.disabled)return;
    if(!hasKey(provider)){settings();return;}
    const cited=f.replyQuote,firstQuote=!excerpt.hidden;
    const turn=newTurn(id,q,'你',materialScope('selection',quote.from,quote),quote);
    send.disabled=true;input.value='';const user=addMessage('user',q,'你',log,turn.id);
    if(cited){user.querySelector(".msg-body").before(quoteBlock(cited));f.attach(null);}
    if(firstQuote){user.querySelector(".msg-body").before(quoteBlock(quote));excerpt.hidden=true;}
    turn.firstQuote=firstQuote;
    if(cited)turn.replyQuote=cited;
    const label=modelFor(provider),pending=addMessage('assistant','正在阅读引文…',label,log);
    try{
      await storeTurn(turn);
      const excerpts=[];
      if(firstQuote)excerpts.push(await context('selection',quote.from,quote,rows));
      if(cited)excerpts.push(await context('selection',null,cited,rows));
      const material=excerpts.join('\n\n')||'请结合这段临时会话的已有对话回答后续问题。';
      const result=await chatRequest(q,material,f.previous);
      turn.answer=result.answer;await storeTurn(turn);
      if(!threads.has(f))return;
      pending.remove();const msg=addMessage('assistant',result.answer,label,log,turn.id);
      saveNoteButton(msg,materialScope('selection',quote.from,quote),q,result.answer);
      f.previous.push({role:'user',content:(quotePrefix(firstQuote?quote:null)+quotePrefix(cited)+q).slice(0,12000)},{role:'assistant',content:result.answer.slice(0,12000)});
    }catch(err){
      turn.error=err.message;await storeTurn(turn);
      if(threads.has(f)){
        pending.remove();addMessage('assistant',err.message,'发送失败',log);
        if(firstQuote)excerpt.hidden=false;
        if(!input.value&&!f.replyQuote){input.value=q;if(cited)f.attach(cited);}
      }
    }
    finally{send.disabled=false;}
  };
  refreshAnchors();input.focus();
  return box;
}
$('newThread').onclick=()=>openThread(draft);

async function startup(){
  setPaperControls(false);
  try{
    const last=localGet('reader.lastPaper'),book=last&&(await shelf()).find(b=>b.id===last);
    if(book){const blob=await loadFile(last);if(blob){await openPDF(blob,book.name,last);if(doc)return;}}
  }catch{notice('无法读取书架，请检查浏览器的本地存储权限。');}
  $('emptyShelf').hidden=false;
}
function setPaperControls(ready){
  for(const node of document.querySelectorAll('.tools button,.tools input,[data-ask],#quiz,#fig,#explain,#note,#conversations,#question,#scope')) node.disabled=!ready;
  if(ready)$('emptyShelf').hidden=true;
}
$('firstOpen').onclick=()=>$('file').click();
startup();

