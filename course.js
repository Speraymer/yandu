import {onFileDrop} from './file-drop.js';
import './pane-divider.js';
import {localGet, localSet} from './reader-storage.js';
import {projects, newProject, projectRecords, addDeck, slideImage, setLearned, saveTurn} from './course-store.js';
import {courseContext, courseHistory} from './course-context.js';
import {readSlides} from './course-import.js';
import {formatMessage} from './answer.js?v=6';
import {restoreKeys, configureKey, forgetKey, hasKey, remembersKey, complete} from './model-api.js?v=3';

const $ = id => document.getElementById(id);
function node(tag, text, cls) {
  const el = document.createElement(tag);
  el.textContent = text;
  if (cls) el.className = cls;
  return el;
}
function activity(text) {
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
const pending = new Set();
let provider = localGet('reader.provider') === 'openai' ? 'openai' : 'deepseek';
const modelFor = p => localGet('reader.model.' + p) || (p === 'openai' ? 'gpt-4.1-mini' : 'deepseek-flash');
const withImage = () => provider === 'openai' && localGet('course.vision') !== 'false';

function sync() {
  const ready = !!(deck && currentImage);
  $('import').disabled = !project || importing;
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
  $('send').disabled = !ready || pending.has(project?.id);
  $('scopeHint').textContent = deck ? '当前页：《' + deck.name + '》第 ' + page + ' 页' : '请先打开课件';
  $('inputMode').textContent = withImage() ? '附本页图文' : deck && !deck.texts[page-1].trim() ? '本页无文字层；看图请在 AI 设置启用支持图片的模型。' : '发送可提取的文字';
  $('keyStatus').textContent = pending.has(project?.id) ? '正在回答…' :
    hasKey(provider) ? modelFor(provider) : '使用课程问答前，请填写 AI 设置。';
}
function updateDeckOptions() {
  $('decks').replaceChildren(...decks.map(d => new Option(d.name + '（已学 ' +
    d.learned.filter(Boolean).length + '/' + d.texts.length + ' 页）', d.id)));
  if (deck) $('decks').value = deck.id;
}
function clearImage() {
  if (currentImage) URL.revokeObjectURL(currentImage.url);
  currentImage = null;
  $('slide').hidden = true;
  $('slide').removeAttribute('src');
}
async function showPage(n) {
  const token = ++view;
  clearImage();
  if (!deck) { sync(); return; }
  page = Math.max(1, Math.min(deck.texts.length, Math.floor(Number(n)) || 1));
  sync();
  const blob = await slideImage(deck.id, page);
  if (token !== view) return;
  if (!blob) throw Error('本页图像无法读取，请重新导入原课件。');
  const url = URL.createObjectURL(blob);
  currentImage = {url, blob};
  $('slide').src = url;
  $('slide').alt = deck.name + '，第 ' + page + ' 页。' + deck.texts[page-1].slice(0,300);
  $('slide').hidden = false;
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
  if (['ArrowLeft','ArrowRight'].includes(e.key)) {
    e.preventDefault(); showPage(page+(e.key === 'ArrowRight' ? 1 : -1)).catch(problem);
  }
});
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
onFileDrop('松开以导入课程课件', files => {
  if (importing) return activity('正在导入课件，请等本批完成后再拖入。');
  if (!files.length) return activity('请拖入 PPTX 或 PDF 文件。');
  if (!project) { waitingFiles = files; projectDialog(); return; }
  importFiles(files).catch(problem);
});
action('files','change',() => {
  const files = [...$('files').files];
  $('files').value = '';
  return importFiles(files);
});
async function importFiles(files) {
  if (importing || !files.length || !project) return;
  const target = project.id;
  importing = true; sync();
  const errors = [];
  let first;
  try {
    for (const file of files) {
      try {
        activity('正在打开 ' + file.name + '…');
        const pages = await readSlides(file,(n,total) => activity('正在读取 ' + file.name + '，第 ' + n + ' / ' + total + ' 页'));
        const item = await addDeck(target,file.name,pages);
        if (!first) first = item.id;
        decks.push(item);
      } catch(err) { errors.push(file.name + '：' + (err.name === 'QuotaExceededError' ? '浏览器存储空间不足。' : err.message)); }
    }
    if (first) await openDeck(first);
    activity(errors.length ? errors.join('　') : '已导入 ' + files.length + ' 份课件。');
  } finally { importing = false; sync(); }
}

function drawChat() {
  const log = $('messages');
  log.replaceChildren();
  if (!turns.length) {
    const w = node('section','');
    w.id = 'welcome';
    w.append(node('h1','一起读课件'),node('p','翻到想问的那一页，直接提问。你也可以问它和前几讲有什么联系。'));
    log.append(w); return;
  }
  for (const t of turns) {
    const user = node('article','','msg user'), role = node('div','你','msg-role');
    const source = node('button','《' + t.name + '》第 ' + t.page + ' 页');
    source.title = '返回提问时的课件页';
    source.onclick = () => { if (matchMedia('(max-width:740px)').matches) $('side').hidden = true; openDeck(t.deck,t.page).catch(problem); };
    role.append(source); user.append(role,node('div',t.question,'msg-body')); log.append(user);
    const reply = node('article','','msg assistant'), body = node('div','','msg-body');
    formatMessage(body,t.answer || t.error || (pending.has(t.project) ? '正在回答…' : '本次提问未收到完整回复。'),() => null);
    reply.append(node('div',t.model,'msg-role'),body); log.append(reply);
  }
  log.scrollTop = log.scrollHeight;
}

const keyLoad = restoreKeys().catch(() => activity('已保存的密钥读取失败，可在 AI 设置中填写。'));
function fields() {
  const p = $('provider').value;
  $('model').value = modelFor(p); $('key').value = ''; $('remember').checked = remembersKey(p);
  $('forgetKey').hidden = !hasKey(p); $('visionOption').hidden = p !== 'openai';
  $('vision').checked = localGet('course.vision') !== 'false';
  $('keyHelp').textContent = remembersKey(p) ? '密钥已保存在此浏览器。' : hasKey(p) ? '密钥仅在当前页面有效。' : '请输入个人 API Key。';
  $('configError').textContent = '';
}
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
    if (p === 'openai') localSet('course.vision',String($('vision').checked));
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
  if (!question || !project || !deck || !currentImage || pending.has(project.id)) return;
  if (!hasKey(provider)) { await settings(); return; }
  const owner = project, id = owner.id, service = provider, image = withImage() ? currentImage.blob : null;
  const turn = {id:crypto.randomUUID(), project:id, deck:deck.id, name:deck.name, page, question,
    time:Date.now(), model:modelFor(service)};
  pending.add(id); sync();
  try {
    const [materials, history] = await Promise.all([projectRecords('decks',id),projectRecords('turns',id)]);
    const context = courseContext(owner,materials,turn.deck,turn.page,question);
    await saveTurn(turn);
    if (project?.id === id) {
      turns = [...history,turn]; if ($('question').value.trim() === question) $('question').value = ''; drawChat();
    }
    try {
      const result = await complete({course:true, provider:service, model:turn.model, question,
        context, history:courseHistory(history,id), image:image ? await dataUrl(image) : null});
      turn.answer = result.answer;
    } catch(err) { turn.error = err.message; }
    await saveTurn(turn);
    const updated = await projectRecords('turns',id);
    if (project?.id === id) { turns = updated; drawChat(); }
  } finally { pending.delete(id); sync(); }
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
