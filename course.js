import {slideLinkLayer} from './course-links.js';
import {displayCourseFigures,organizeCourseFigures,describeSlide} from './course-note-figures.js';
import {bindOrganizer} from './note-organizer.js?v=7';
import {onFileDrop} from './file-drop.js';
import {enableClipSelection,renderClips,saveClip} from './note-clips.js?v=4';
import {slideTextLayer} from './slide-text.js';
import './pane-divider.js';
import {localGet, localSet} from './reader-storage.js';
import {projects, newProject, projectRecords, addDeck, restoreSlideSelection, slideImage, setLearned, saveTurn} from './course-store.js?v=7';
import {exportCoursePack,importCoursePack} from './course-pack.js?v=5';
import {courseContext, courseHistory, pageTurns, recallTurns} from './course-context.js?v=4';
import {readSlides} from './course-import.js?v=3';
import {formatMessage} from './answer.js?v=6';
import {supportsCourseImage, defaultModel, restoreKeys, configureKey, forgetKey, hasKey, remembersKey, complete} from './model-api.js?v=15';

const $ = id => document.getElementById(id);
function node(tag, text, cls) {
  const el = document.createElement(tag);
  el.textContent = text;
  if (cls) el.className = cls;
  return el;
}
function activity(text) {
  $('packStatus').textContent = text;
  $('activity').textContent = text;
  $('activity').hidden = !text;
}
function problem(err) {
  activity(err.name === 'QuotaExceededError' ? '浏览器存储空间不足，当前课件未保存。' : err.message || '操作失败，请重试。');
}
function action(id, event, fn) {
  $(id).addEventListener(event, e => Promise.resolve(fn(e)).catch(problem));
}
let projectList = [], project, decks = [], deck, turns = [], page = 1;
let view = 0, projectVersion = 0, currentImage, importing = false;
const pending = new Map();
const drafts = new Map();
const chatKey = () => deck ? deck.id + '/' + page : '';
$('question').oninput = () => {
  if ($('question').value) drafts.set(chatKey(),$('question').value);
  else drafts.delete(chatKey());
};
let provider = localGet('reader.provider') === 'openai' ? 'openai' : 'deepseek';
const modelFor = p => localGet('reader.model.' + p) || defaultModel(p);
const visionKey = p => p === 'openai' ? 'course.vision' : 'course.vision.'+p;
const prefersImage = p => localGet(visionKey(p)) !== 'false';
const visionEnabled = p => supportsCourseImage(p,modelFor(p)) && prefersImage(p);
$('includeSlide').onchange = () => {
  localSet(visionKey(provider),String($('includeSlide').checked));
  sync();
};
const withImage = () => visionEnabled(provider);

function sync() {
  const ready = !!(deck && currentImage);
  $('saveSlide').disabled = !ready;
  $('courseNotes').disabled = !project;
  $('import').disabled = !project || importing;
  $('coursePack').disabled = importing;
  $('exportCourse').disabled = !project || importing;
  $('importCourse').disabled = importing;
  $('repairSelection').disabled=importing;
  $('projects').disabled = importing || !projectList.length;
  $('addProject').disabled = importing;
  $('start').disabled = importing;
  $('deckBar').hidden = $('pageBar').hidden = !deck;
  $('empty').hidden = !!deck;
  if (!deck) {
    $('emptyTitle').textContent = project ? '加入第一份课件' : '从一门课程开始';
    $('emptyText').textContent = project ? '可以一次拖入或选择多份 PPTX 或 PDF，按课件逐页学习。' : '为这门课建一个项目，把每次上课的课件放在一起。';
    $('start').textContent = project ? '选择课件' : '新建课程项目';
  } else {
    $('courseStats').textContent = project.name + '，共 ' + decks.length + ' 份课件';
    $('count').textContent = $('page').max = deck.texts.length;
    $('page').value = page;
    $('prev').disabled = page <= 1;
    $('next').disabled = page >= deck.texts.length;
    $('learned').checked = deck.learned[page-1];
    $('deckStats').textContent = '已学 ' + deck.learned.filter(Boolean).length + ' / ' + deck.texts.length + ' 页';
  }
  $('send').disabled = !ready || pending.has(chatKey());
  $('scopeHint').textContent = deck ? '当前页：《' + deck.name + '》第 ' + page + ' 页' : '请先打开课件';
  const canAttach=supportsCourseImage(provider,modelFor(provider));
  $('imageChoice').hidden=!canAttach || !deck;
  $('includeSlide').disabled=!ready;
  $('includeSlide').checked=withImage();
  $('inputMode').textContent=!deck ? '' : !canAttach && provider==='deepseek' ? '当前模型仅发文字，识图可在 AI 设置选择 deepseek-flash。' :
    withImage() ? '发送第 '+page+' 页图文' : '仅发送文字';
  $('keyStatus').textContent = pending.has(chatKey()) ? '正在回答…' :
    hasKey(provider) ? modelFor(provider) : '使用课程问答前，请填写 AI 设置。';
}
function updateDeckOptions() {
  $('decks').replaceChildren(...decks.map(d => new Option(d.name + '（已学 ' +
    d.learned.filter(Boolean).length + '/' + d.texts.length + ' 页）', d.id)));
  if (deck) $('decks').value = deck.id;
}
const drawSource = slideTextLayer($('slideText'));
const drawLinks = slideLinkLayer($('slideLinks'),$('slide'),n=>showPage(n).catch(problem),activity);
function clearImage() {
  drawLinks([]);$('linkBar').hidden=true;
  drawSource(null); $('plainSource').hidden=true; $('plainBody').textContent='';
  if (currentImage && (currentImage.deck !== deck || currentImage.page !== page)) {
    const old = currentImage;
    setLearned(old.deck.id,old.page,true,true).then(flags => {
      old.deck.learned = flags;
      if (deck === old.deck) { updateDeckOptions(); sync(); }
    }).catch(problem);
  }
  if (currentImage) URL.revokeObjectURL(currentImage.url);
  currentImage = null;
  $('repairBar').hidden=true;
  $('slide').hidden = true;
  $('slide').removeAttribute('src');
}
async function showPage(n) {
  const token = ++view;
  if (!deck) { clearImage(); sync(); return; }
  page = Math.max(1, Math.min(deck.texts.length, Math.floor(Number(n)) || 1));
  clearImage(); $('question').value = drafts.get(chatKey()) || ''; drawChat(); sync();
  const stored = await slideImage(deck.id, page);
  if (token !== view) return;
  const blob=stored?.image || stored;
  if (!blob) throw Error('本页图像无法读取，请重新导入原课件。');
  const url = URL.createObjectURL(blob);
  currentImage = {url, blob, deck, page};
  $('slide').src = url;
  $('slide').alt = deck.name + '，第 ' + page + ' 页。' + deck.texts[page-1].slice(0,300);
  $('slide').hidden = false;
  drawSource(stored.layout);
  const pageLinks=stored.links || [];drawLinks(pageLinks);
  $('linkBar').hidden=!pageLinks.length;
  $('linkHint').textContent='本页 '+pageLinks.length+' 处链接，轻点虚线框打开网页或跳页，拖动文字可划词。';
  $('repairBar').hidden=stored.linksVersion===1 && !(stored instanceof Blob);
  $('slide').title=stored.layout?.runs.length?'拖选画面中的文字可写入笔记':'';
  $('plainSource').hidden=false;
  $('plainBody').textContent=deck.texts[page-1] || '本页没有可提取的文字。';
  localSet('course.page.'+deck.id,String(page));
  sync();
}
function openDeck(id, n) {
  deck = decks.find(d => d.id === id) || decks[0];
  updateDeckOptions();
  $('deckMenu').open = false;
  if (deck) localSet('course.deck.'+project.id,deck.id);
  return showPage(n ?? (deck && localGet('course.page.'+deck.id)));
}
async function selectProject(id) {
  const token = ++projectVersion;
  project = projectList.find(p => p.id === id);
  decks = []; turns = []; deck = undefined; ++view;
  clearImage(); activity(''); $('question').value = ''; drawChat(); sync();
  if (!project) return;
  localSet('course.activeProject',id);
  $('projects').value = id;
  const [items, chat] = await Promise.all([projectRecords('decks',id),projectRecords('turns',id)]);
  if (token !== projectVersion) return;
  decks = items; turns = chat; drawChat();
  await openDeck(localGet('course.deck.'+id));
}
async function refreshProjects(id) {
  projectList = (await projects()).sort((a,b) => a.time-b.time);
  $('projects').replaceChildren(...(projectList.length ? projectList.map(p => new Option(p.name,p.id)) : [new Option('选择课程项目','')]));
  await selectProject(projectList.find(p => p.id === id)?.id || projectList[0]?.id);
}
function projectDialog() {
  $('projectName').value = '';
  $('projectDialog').showModal(); $('projectName').focus();
}
$('addProject').onclick = projectDialog;
$('coursePack').onclick = () => {
  $('packScope').textContent = project ? '当前课程：'+project.name : '选择课程数据包可以恢复已有课程。';
  $('packDialog').showModal();
};
$('importCourse').onclick = () => $('coursePackFile').click();
async function transferCourse(file) {
  if (importing) return;
  if (!file && decks.some(d=>Array.from(pending.keys()).some(key=>key.startsWith(d.id+'/')))) {
    activity('当前课程还有问答正在生成，请在回复完成后导出。'); return;
  }
  importing=true; sync();
  try {
    if (file) {
      activity('正在检查课程数据包…');
      const restored=await importCoursePack(file,name=>activity('已校验课件：'+name));
      // Opening a restored copy is not a page turn in the previous course.
      clearImage();
      await refreshProjects(restored.id);
      if ($('packDialog').open) $('packDialog').close();
      if (mobile.matches) $('side').hidden = true;
      activity('已导入课程「'+restored.name+'」，共 '+decks.length+' 份课件、'+decks.reduce((n,d)=>n+d.texts.length,0)+' 页。');
    } else {
      activity('正在打包课程…');
      const {name,file:pack}=await exportCoursePack(project.id,name=>activity('已打包课件：'+name));
      const url=URL.createObjectURL(pack), link=document.createElement('a');
      link.href=url; link.download=(name.replace(/[<>:"/\\|?*]/g,'_') || '课程')+'.yanduc';
      document.body.append(link); link.click(); link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
      activity('已生成「'+name+'」的课程数据包。');
    }
  } finally { importing=false; sync(); }
}
action('exportCourse','click',()=>transferCourse());
action('coursePackFile','change',()=>{
  const file=$('coursePackFile').files[0]; $('coursePackFile').value='';
  if (file) return transferCourse(file);
});
$('import').onclick = () => $('files').click();
$('start').onclick = () => project ? $('files').click() : projectDialog();
action('newProject','submit',async e => {
  e.preventDefault();
  const name = $('projectName').value.trim();
  if (!name) { $('projectName').focus(); return; }
  $('newProject').inert = true;
  try {
    const item = await newProject(name);
    const files = waitingFiles;
    $('projectDialog').close(); await refreshProjects(item.id);
    if (files.length) await importFiles(files);
  } finally { $('newProject').inert = false; }
});
action('projects','change',() => selectProject($('projects').value));
action('decks','change',() => openDeck($('decks').value));
action('page','change',() => showPage($('page').value));
action('prev','click',() => showPage(page-1));
action('next','click',() => showPage(page+1));
window.addEventListener('keydown', e => {
  if (!deck || document.querySelector('dialog[open]') || e.target.closest('input,select,textarea,button,summary,[role=separator]')) return;
  if (!e.ctrlKey && !e.altKey && !e.metaKey && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {
    e.preventDefault(); showPage(page+(['ArrowRight','ArrowDown'].includes(e.key) ? 1 : -1)).catch(problem);
  }
});
let lastWheel = 0, wheelDistance = 0, wheelTurned = false;
$('stage').addEventListener('wheel', e => {
  if (!deck || e.ctrlKey || !e.deltaY || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
  e.preventDefault();
  const now = performance.now();
  if (now-lastWheel > 150 || Math.sign(wheelDistance) !== Math.sign(e.deltaY)) {
    wheelDistance = 0; wheelTurned = false;
  }
  lastWheel = now;
  wheelDistance += e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1);
  if (!wheelTurned && Math.abs(wheelDistance) >= 35) {
    wheelTurned = true;
    showPage(page+Math.sign(wheelDistance)).catch(problem);
  }
}, {passive:false});
async function mark(n,value) {
  if (!deck) return;
  const item = deck;
  item.learned = await setLearned(item.id,n,value);
  if (item.project === project?.id) { updateDeckOptions(); sync(); }
  $('deckMenu').open = false;
}
action('learned','change',() => mark(page,$('learned').checked));
action('allLearned','click',() => mark(null,true));
action('allNew','click',() => mark(null,false));

let waitingFiles = [];
$('projectDialog').addEventListener('close', () => { waitingFiles = []; });
onFileDrop('松开以导入课件或课程数据包', files => {
  if (importing) return activity('正在导入课件，请等本批完成后再拖入。');
  if (files.some(file=>/\.yanduc$/i.test(file.name))) {
    if (files.length!==1) return activity('请单独拖入一份课程数据包。');
    transferCourse(files[0]).catch(problem); return;
  }
  if (!files.length) return activity('请拖入课件或课程数据包。');
  if (!project) { waitingFiles = files; projectDialog(); return; }
  importFiles(files).catch(problem);
});
action('files','change',() => {
  const files = [...$('files').files];
  $('files').value = '';
  return importFiles(files);
});
let repairTarget;
$('repairSelection').onclick=()=>{
  repairTarget=deck;
  $('repairFile').click();
};
action('repairFile','change',async ()=>{
  const file=$('repairFile').files[0],target=repairTarget;
  $('repairFile').value='';
  if (!file || !target || importing) return;
  importing=true;sync();
  try {
    activity('正在补全 '+target.name+' 的文字位置和链接…');
    const pages=await readSlides(file,(n,total)=>activity('正在处理第 '+n+' / '+total+' 页'));
    await restoreSlideSelection(target,pages);
    if(deck?.id===target.id)await showPage(page);
    activity('已补全课件文字位置和链接，进度与问答保留。');
  } finally { importing=false;sync(); }
});
async function importFiles(files) {
  if (importing || !files.length || !project) return;
  const target = project.id;
  importing = true; sync();
  const errors = [];
  let first, restored=0, added=0;
  try {
    for (const file of files) {
      try {
        activity('正在打开 ' + file.name + '…');
        const pages = await readSlides(file,(n,total) => activity('正在读取 ' + file.name + '，第 ' + n + ' / ' + total + ' 页'));
        const same=decks.filter(d=>d.name===file.name && d.texts.length===pages.length && d.texts.every((text,i)=>text===pages[i].text));
        if(same.length===1 && pages.some(p=>p.layout?.runs.length || p.links?.length)){
          await restoreSlideSelection(same[0],pages);
          restored++;
          if(!first)first=same[0].id;
          continue;
        }
        const item = await addDeck(target,file.name,pages);
        if (!first) first = item.id;
        decks.push(item);added++;
      } catch(err) { errors.push(file.name + '：' + (err.name === 'QuotaExceededError' ? '浏览器存储空间不足。' : err.message)); }
    }
    if (first) await openDeck(first,first===deck?.id?page:undefined);
    activity([added && '已导入 '+added+' 份课件。', restored && '已为 '+restored+' 份已有课件补全文字位置和链接。', ...errors].filter(Boolean).join('　'));
  } finally { importing = false; sync(); }
}

function drawChat() {
  const log = $('messages');
  log.replaceChildren();
  const thread = pageTurns(turns,project?.id,deck?.id,page);
  if (!thread.length) {
    const w = node('section','');
    w.id = 'welcome';
    w.append(node('h1','本页问答'),node('p','直接问这一页的概念、图或公式，也可以指定想比较的课件。'));
    log.append(w); return;
  }
  for (const t of thread) {
    const user = node('article','','msg user'), role = node('div','你','msg-role');
    const source = node('button','《' + t.name + '》第 ' + t.page + ' 页');
    source.title = '返回提问时的课件页';
    source.onclick = () => { if (matchMedia('(max-width:740px)').matches) $('side').hidden = true; openDeck(t.deck,t.page).catch(problem); };
    user.dataset.turnId=t.id;
    role.append(source); user.append(role,node('div',t.question,'msg-body')); log.append(user);
    const reply = node('article','','msg assistant'), body = node('div','','msg-body');
    if(t.answer) reply.dataset.turnId=t.id;
    formatMessage(body,t.answer || t.error || (pending.get(chatKey()) === t.id ? '正在回答…' : '本次提问未收到完整回复。'),() => null);
    reply.append(node('div',t.model,'msg-role'),body); log.append(reply);
    if (t.memory?.length) {
      const sources = document.createElement('details');
      sources.append(node('summary','本次参考的跨页问答'));
      for (const m of t.memory) {
        const link = node('button','《' + m.name + '》第 ' + m.page + ' 页：' + m.question);
        link.onclick = () => openDeck(m.deck,m.page).catch(problem);
        sources.append(link);
      }
      reply.append(sources);
    }
  }
  log.scrollTop = log.scrollHeight;
}

action('saveSlide','click',()=>{
  if (!currentImage) return;
  const {deck,page}=currentImage;
  saveClip('course:'+project.id,{turn:'source/'+deck.id+'/'+page,role:4,offset:0,time:0,
    order:deck.time,book:deck.name,page,text:deck.texts[page-1]});
  activity('第 '+page+' 页已存入课程笔记的「原始摘录」。');
});
async function renderSlideClip(item,clip) {
  const deckId=clip.turn.split('/')[1];
  const img=document.createElement('img');
  img.alt=clip.book+'，第 '+clip.page+' 页';
  img.style.maxWidth='100%';
  item.append(img);
  try {
    const stored=await slideImage(deckId,clip.page);
    img.src=await dataUrl(stored?.image || stored);
  } catch {
    img.replaceWith(node('p','本页画面无法读取。'));
  }
}

const prepareNotes = bindOrganizer({
  renderFigures:(target,writing,clips,format)=>displayCourseFigures(target,writing,clips,format,renderSlideClip),
  organizeFigures:args=>organizeCourseFigures({...args,describe:(clip,config)=>describeSlide(clip,config,
    decks.find(d=>d.id===clip.turn.split('/')[1]),async(id,n)=>{
      const stored=await slideImage(id,n);
      if (!stored)throw Error('无法读取第 '+n+' 页的画面。');
      return dataUrl(stored.image || stored);
    })}),editor:$('courseWriting'),status:$('courseSave'),dialog:$('courseNotesDialog'),
  scope:()=>project && 'course:'+project.id, storage:()=>'course.writing.'+project.id, title:()=>$('courseNotesTitle').textContent,
  service:()=>({provider,model:modelFor(provider)})});
$('courseNotes').onclick=()=>{
  $('courseNotesTitle').textContent=project.name;
  $('courseWriting').value=localGet('course.writing.'+project.id) || '';
  $('courseSave').textContent='更改自动保存在此浏览器。';
  renderClips($('courseClips'),'course:'+project.id,renderSlideClip);
  prepareNotes(); $('courseNotesDialog').showModal();
};
$('courseWriting').oninput=()=>{
  $('courseSave').textContent=localSet('course.writing.'+project.id,$('courseWriting').value) ?
    '已保存在此浏览器。' : '笔记尚未保存，请检查浏览器存储空间。';
};
enableClipSelection(article=>{
  const turn=turns.find(t=>t.id===article.dataset.turnId && t.project===project?.id);
  const item=turn && decks.find(d=>d.id===turn.deck);
  return item && {scope:'course:'+turn.project,clip:{turn:turn.id,time:turn.time,order:item.time,
    book:item.name,page:turn.page,role:Number(article.classList.contains('assistant'))}};
},()=>activity('已写入课程笔记。'),activity,body=>{
  if (!currentImage || !body.closest('#reading') || (body.id==='plainBody' && !deck.texts[page-1].trim()))return;
  return {scope:'course:'+project.id,clip:{turn:'source/'+deck.id+'/'+page,time:0,order:deck.time,book:deck.name,page,role:2}};
});

const keyLoad = restoreKeys().catch(() => activity('已保存的密钥读取失败，可在 AI 设置中填写。'));
function fields() {
  const p = $('provider').value;
  $('model').value = modelFor(p); $('key').value = ''; $('remember').checked = remembersKey(p);
  $('forgetKey').hidden = !hasKey(p);
  $('vision').checked = prefersImage(p);
  updateVisionOption();
  $('keyHelp').textContent = remembersKey(p) ? '密钥已保存在此浏览器。' : hasKey(p) ? '此标签页的论文与课程共用此密钥。' : '请输入个人 API Key。';
  $('configError').textContent = '';
}
function updateVisionOption() {
  const available=supportsCourseImage($('provider').value,$('model').value.trim());
  $('vision').disabled=!available;
  $('visionHelp').hidden=available;
}
$('model').oninput=updateVisionOption;
async function settings() {
  await keyLoad; $('provider').value = provider; fields(); $('settingDialog').showModal();
}
$('settings').onclick = settings; $('provider').onchange = fields;
$('settingDialog').addEventListener('close', () => $('key').value = '');
action('forgetKey','click',async () => { await forgetKey($('provider').value); fields(); sync(); });
action('setup','submit',async e => {
  e.preventDefault();
  const p = $('provider').value;
  $('setup').inert = true;
  try {
    await configureKey(p,$('key').value.trim(),$('remember').checked);
    provider = p;
    localSet('reader.provider',p); localSet('reader.model.'+p,$('model').value.trim());
    if (!$('vision').disabled) localSet(visionKey(p),String($('vision').checked));
    $('settingDialog').close(); sync();
  } catch(err) { $('configError').textContent = err.message; }
  finally { $('setup').inert = false; }
});
function dataUrl(blob) {
  return new Promise((resolve,reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(blob);
  });
}

action('composer','submit', async e => {
  e.preventDefault();
  const question = $('question').value.trim();
  if (!question || !project || !deck || !currentImage || pending.has(chatKey())) return;
  if (!hasKey(provider)) { await settings(); return; }
  const owner = project, id = owner.id, service = provider, image = withImage() ? currentImage.blob : null;
  const turn = {id:crypto.randomUUID(), project:id, deck:deck.id, name:deck.name, page, question,
    time:Date.now(), model:modelFor(service)};
  const key = chatKey();
  pending.set(key,turn.id); sync();
  try {
    const [materials, history] = await Promise.all([projectRecords('decks',id),projectRecords('turns',id)]);
    let context = courseContext(owner,materials,turn.deck,turn.page,question);
    const text = materials.find(d => d.id === turn.deck).texts[turn.page-1];
    const memory = recallTurns(history,turn,text);
    turn.memory = memory.map(({name,deck,page,question}) => ({name,deck,page,question:question.slice(0,160)}));
    if (memory.length) context += '\n同课程其他页的历史问答摘录（供联系知识点，课件事实以原文为准）：\n' +
      memory.map(m => '《' + m.name + '》第 ' + m.page + ' 页\n问：' + m.question.slice(0,400) + '\n答：' + m.answer.slice(0,1000)).join('\n');
    await saveTurn(turn);
    if (drafts.get(key)?.trim() === question) drafts.delete(key);
    if (project?.id === id) {
      turns = [...turns.filter(t => t.id !== turn.id),turn]; if (chatKey() === key && $('question').value.trim() === question) $('question').value = ''; drawChat();
    }
    try {
      const result = await complete({course:true, provider:service, model:turn.model, question,
        context, history:courseHistory(history,id,turn.deck,turn.page), image:image ? await dataUrl(image) : null});
      turn.answer = result.answer;
    } catch(err) { turn.error = err.message; }
    await saveTurn(turn);
    const updated = await projectRecords('turns',id);
    if (project?.id === id) { turns = updated; drawChat(); }
  } finally { pending.delete(key); sync(); }
});
$('question').onkeydown = e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('composer').requestSubmit(); }
};
const mobile = matchMedia('(max-width:740px)');
function adapt() { $('side').hidden = mobile.matches; }
mobile.addEventListener('change',adapt); adapt();
$('openChat').onclick = () => { $('side').hidden = false; $('question').focus(); };
$('closeChat').onclick = () => $('side').hidden = true;
Promise.all([keyLoad,refreshProjects(localGet('course.activeProject'))]).then(sync).catch(problem);
