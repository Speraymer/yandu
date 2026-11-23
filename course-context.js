function ranges(flags) {
  const result = [];
  for (let i = 0; i < flags.length; i++) {
    if (!flags[i]) continue;
    const start = i + 1;
    while (flags[i + 1]) i++;
    result.push(start === i + 1 ? String(start) : start + '–' + (i + 1));
  }
  return result.join('、') || '无';
}

function terms(text) {
  const tokens = text.toLowerCase().match(/[a-z0-9]+|[\p{Script=Han}]+/gu) || [];
  return new Set(tokens.flatMap(t => /^[\p{Script=Han}]{2,}$/u.test(t) ?
    Array.from({length:t.length-1}, (_,i) => t.slice(i,i+2)) : [t]));
}

function referencedPages(question,page) {
  const targets = new Set(Array.from(question.matchAll(/第\s*(\d+)\s*页/g), m=>Number(m[1])));
  if (/上一?页/.test(question)) targets.add(page-1);
  if (/下一?页/.test(question)) targets.add(page+1);
  return targets;
}

function asksAcrossPages(question) {
  return /上一?页|下一?页|上(?:一)?[节堂讲章]|前(?:一|几)[页讲节章]|前面|前文|刚才|刚刚|之前|先前|上次|其他页|其它页|其他课件|跨页|跨章|前后页|第\s*[零一二三四五六七八九十\d]+\s*[页章节讲]|earlier|previous|last slide/i.test(question);
}
export function courseContext(project, decks, deckId, page, question) {
  const own = decks.filter(d => d.project === project.id);
  const current = own.find(d => d.id === deckId);
  if (!current || !Number.isInteger(page) || page < 1 || page > current.texts.length) throw Error('当前课程页码无效。');
  const here = current.texts[page-1];
  const label = (d,n) => '《' + d.name + '》第 ' + n + ' 页';
  const parts = ['课程项目：' + project.name, '提问时正在阅读：' + label(current,page),
    '当前页正文：\n' + (here.slice(0,14000) || '本页没有可提取的文字。')];
  if (/进度|学过|学到哪|已学|未学|没学/.test(question)) parts.push('课程学习记录：', ...own.map(d => '《' + d.name + '》共 ' + d.texts.length +
      ' 页；已学页：' + ranges(d.learned) + '；未学页：' + ranges(d.learned.map(v => !v))));
  const named = own.filter(d => question.toLowerCase().includes(d.name.replace(/\.[^.]+$/,'').toLowerCase()));
  const overview = /整[份门套章]|整堂|整节|本讲|这[一份门]课|整个课件|整套课件|这份课件|本章|这一章|全课|全课程/.test(question);
  if (!asksAcrossPages(question) && !overview && !named.length) return parts.join('\n');
  const query = terms(question), topic = terms(here.slice(0,600));
  const targets = referencedPages(question,page);
  const related = [];
  for (const d of own) {
    if (named.length && !named.includes(d)) continue;
    if (overview && !named.length && !/整门|全课|整套/.test(question) && d.id !== deckId) continue;
    d.texts.forEach((text,i) => {
      if (!text.trim() || (d.id === deckId && i+1 === page)) return;
      if (!overview && targets.size && (!targets.has(i+1) || (!named.length && d.id!==deckId))) return;
      const tokens = terms(d.name + ' ' + text.slice(0,4000));
      let score = named.includes(d) ? 50 : 0;
      for (const t of tokens) score += (query.has(t) ? 8 : 0) + (topic.has(t) ? 0.5 : 0);
      if (targets.has(i+1)) score += 200;
      if (overview) {
        related.push({score:0,block:label(d,i+1)+' '+text.slice(0,160)});
        return;
      }
      if (score>0) related.push({score, block:label(d,i+1) + '\n' + text.slice(0,2000)});
    });
  }
  related.sort((a,b) => b.score-a.score);
  if (related.length) parts.push(overview?'课件各页文字提要：':'同项目相关课件摘录：',
    (overview?related:related.slice(0,3)).map(r=>r.block).join('\n\n').slice(0,16000));
  return parts.join('\n');
}

export function pageTurns(turns, projectId, deckId, page) {
  return turns.filter(t => t.project === projectId && t.deck === deckId && t.page === page);
}

export function recallTurns(turns, current, slideText) {
  if (!asksAcrossPages(current.question) && !/上次|学过|讲过|讨论过|还记得|联系之前/.test(current.question)) return [];
  const query = terms(current.question), topic = terms(slideText.slice(0,600));
  const targets = referencedPages(current.question,current.page);
  const recent = /刚才|上次|之前|前面/.test(current.question) && turns.findLast(t=>t.project===current.project && t.answer);
  const ranked = [];
  for (const t of turns) {
    if (!t.answer || t.project !== current.project || (t.deck === current.deck && t.page === current.page)) continue;
    if (targets.size && (!targets.has(t.page) || (t.deck!==current.deck && !current.question.includes(t.name.replace(/\.[^.]+$/,''))))) continue;
    const tokens = terms(t.name + ' ' + t.question + ' ' + t.answer.slice(0,1000));
    let score = 0;
    for (const token of tokens) score += (query.has(token) ? 4 : 0) + (topic.has(token) ? 1 : 0);
    if (targets.has(t.page)) score += 30;
    if (t === recent) score += 10;
    if (score) ranked.push({t,score});
  }
  return ranked.sort((a,b) => b.score-a.score || b.t.time-a.t.time).slice(0,3).map(entry => entry.t);
}

export function courseHistory(turns, projectId, deckId, page) {
  return pageTurns(turns,projectId,deckId,page).filter(t => t.answer).slice(-4).flatMap(t => [
    {role:'user',content:'当时正在读《' + t.name + '》第 ' + t.page + ' 页。\n' + t.question},
    {role:'assistant',content:t.answer.slice(0,4000)}
  ]);
}
