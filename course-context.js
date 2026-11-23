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

export function courseContext(project, decks, deckId, page, question) {
  const own = decks.filter(d => d.project === project.id);
  const current = own.find(d => d.id === deckId);
  if (!current || !Number.isInteger(page) || page < 1 || page > current.texts.length) throw Error('当前课程页码无效。');
  const here = current.texts[page-1];
  const label = (d,n) => '《' + d.name + '》第 ' + n + ' 页';
  const parts = ['课程项目：' + project.name, '提问时正在阅读：' + label(current,page),
    '当前页正文：\n' + (here.slice(0,14000) || '本页没有可提取的文字。'),
    '课程学习记录（手动标记）：', ...own.map(d => '《' + d.name + '》共 ' + d.texts.length +
      ' 页；已学页：' + ranges(d.learned) + '；未学页：' + ranges(d.learned.map(v => !v)))];
  const query = terms(question), topic = terms(here.slice(0,600));
  const related = [];
  for (const d of own) {
    d.texts.forEach((text,i) => {
      if (!text.trim() || (d.id === deckId && i+1 === page)) return;
      const tokens = terms(d.name + ' ' + text.slice(0,4000));
      let score = d.learned[i] ? 1 : 0;
      for (const t of tokens) score += (query.has(t) ? 8 : 0) + (topic.has(t) ? 0.5 : 0);
      if (d.id === deckId && Math.abs(i+1-page) === 1) score += 100;
      if (question.includes(d.name) || question.includes(d.name.replace(/\.[^.]+$/,''))) score += 75;
      related.push({score, block:label(d,i+1) + '\n' + text.slice(0,2000)});
    });
  }
  related.sort((a,b) => b.score-a.score);
  parts.push('同项目相关课件摘录：', related.map(r => r.block).join('\n\n').slice(0,16000));
  return parts.join('\n');
}

export function courseHistory(turns, projectId) {
  return turns.filter(t => t.project === projectId && t.answer).slice(-4).flatMap(t => [
    {role:'user',content:'当时正在读《' + t.name + '》第 ' + t.page + ' 页。\n' + t.question},
    {role:'assistant',content:t.answer.slice(0,4000)}
  ]);
}
