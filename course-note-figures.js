import {complete, supportsCourseImage} from './model-api.js?v=15';

const figureLine = /^\[\[课件图:(source\/[^/\]\s]+\/\d+)\]\][ \t]*(.*)$/;

export function displayCourseFigures(target, writing, clips, format, renderImage) {
  const byTurn=new Map(clips.filter(c=>c.role===4).map(c=>[c.turn,c]));
  let lines=[];
  function flush() {
    if (lines.some(line=>line.trim())) {
      const section=document.createElement('div');
      format(section,lines.join('\n'));
      target.append(section);
    }
    lines=[];
  }
  for (const line of writing.split('\n')) {
    const match=figureLine.exec(line);
    const clip=match && byTurn.get(match[1]);
    if (!clip) {lines.push(line);continue;}
    flush();
    const figure=document.createElement('figure'), caption=document.createElement('figcaption');
    figure.style.margin='1em 0';
    renderImage(figure,clip);
    caption.textContent=match[2];
    figure.append(caption);target.append(figure);
  }
  flush();
}

export async function organizeCourseFigures({clips,before,config,describe,organize,active}) {
  const previous=new Map(), text=[];
  const figures=clips.filter(c=>c.role===4);
  const turns=new Set(figures.map(c=>c.turn));
  for (const line of before.split('\n')) {
    const match=figureLine.exec(line);
    if (match && turns.has(match[1])) previous.set(match[1],match[2]);
    else text.push(line);
  }
  const entries=[];
  for (const clip of figures) {
    if (!active())return '';
    const caption=previous.get(clip.turn) || await describe(clip,config);
    entries.push({slot:'[[图'+(entries.length+1)+']]',caption,turn:clip.turn});
  }
  if (!active())return '';
  const other=clips.filter(c=>c.role!==4).map(c=>c.text);
  const prose=text.join('\n').trim();
  const draft=other.length || prose ? await organize(prose,other,entries.map(({slot,caption})=>({slot,caption}))) : '';
  const bySlot=new Map(entries.map(e=>[e.slot,e]));
  const lineFor=e=>'[[课件图:'+e.turn+']] '+e.caption;
  const placed=new Set();
  const result=draft.replace(/\[\[图\d+\]\]/g,slot=>{
    const entry=bySlot.get(slot);
    if (!entry || placed.has(slot))return '';
    placed.add(slot);return '\n\n'+lineFor(entry)+'\n\n';
  });
  return [result,...entries.filter(e=>!placed.has(e.slot)).map(lineFor)].filter(Boolean).join('\n\n').trim();
}

export async function describeSlide(clip,config,deck,readImage) {
  if (!deck) throw Error('找不到摘录所属课件。');
  if (!supportsCourseImage(config.provider,config.model)) throw Error('为整页课件生成图注需要识图模型，请在 AI 设置选择支持图片的模型。');
  const pages=[], images=[];
  for (let n=Math.max(1,clip.page-1);n<=Math.min(deck.texts.length,clip.page+1);n++) {
    const text=deck.texts[n-1].trim().slice(0,3000);
    let picture='';
    if (n===clip.page || !text) {
      images.push(await readImage(deck.id,n));
      picture='（附图 '+images.length+'）';
    }
    pages.push('第 '+n+' 页'+picture+'：'+text);
  }
  const {answer}=await complete({...config,course:true,image:images,
    context:'课件《'+deck.name+'》\n'+pages.join('\n'),
    question:'给第 '+clip.page+' 页的整页图片写一到两句中文图注，让没读前文的学生单独看懂。说清图中对象、关系或过程，以及它说明的知识点。相邻页仅用于理解背景，不能把相邻页的细节当成本图内容。看不清的标注不要猜。只输出图注。'});
  return answer.trim().replace(/\s*\n\s*/g,' ');
}
