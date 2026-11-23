const magic = new TextEncoder().encode('YANDU01\n');
// Magic, big-endian JSON byte length, SHA-256 of JSON, UTF-8 JSON, original PDF.
const headerSize = magic.length + 4 + 32;
const maxJsonSize = 128 * 1024 * 1024;
const text = value => typeof value === 'string';
const positive = value => Number.isSafeInteger(value) && value > 0;
const nonnegative = value => Number.isSafeInteger(value) && value >= 0;

function check(valid, message = '阅读包中的进度数据不完整。') {
  if (!valid) throw Error(message);
}
function quoteData(quote, pages) {
  if (quote == null) return null;
  check(text(quote.text));
  if (quote.kind === 'answer') {
    check(text(quote.turnId));
    const point = p => {
      check(Array.isArray(p?.path) && p.path.every(nonnegative) && nonnegative(p.offset));
      return {path:p.path, offset:p.offset};
    };
    return {kind:'answer', turnId:quote.turnId, text:quote.text, start:point(quote.start), end:point(quote.end)};
  }
  const {from,to,original = '',boxes} = quote;
  check(positive(from) && positive(to) && from <= to && to <= pages && text(original) && Array.isArray(boxes) && boxes.length);
  return {from,to,original,text:quote.text,boxes:boxes.map(({n,x,y,w,h}) => {
    check(positive(n) && n >= from && n <= to && [x,y,w,h].every(Number.isFinite) && w > 0 && h > 0);
    return {n,x,y,w,h};
  })};
}

function readingData(data) {
  const {id,name,pages,page,position,bilingual,notes,translations,turns} = data;
  check(text(id) && /^[a-f0-9]{64}$/.test(id) && text(name) && name.trim() && positive(pages));
  check(positive(page) && page <= pages && Number.isFinite(position) && position >= 0 && position <= 1);
  check(typeof bilingual === 'boolean' && text(notes) && Array.isArray(translations) && Array.isArray(turns));
  const pageIds = new Set(), turnIds = new Set();
  return {id,name,pages,page,position,bilingual,notes,translations:translations.map(record => {
    const {paper,page,zh,done,layoutHints = []} = record;
    check(paper === id && positive(page) && page <= pages && !pageIds.has(page));
    check(Array.isArray(zh) && zh.every(text) && typeof done === 'boolean' && Array.isArray(layoutHints));
    pageIds.add(page);
    return {paper,page,zh,done,layoutHints:layoutHints.map(hint => hint && ({
      kind:text(hint.kind) ? hint.kind : undefined,
      paragraph:typeof hint.paragraph === 'boolean' ? hint.paragraph : undefined
    }))};
  }), turns:turns.map(turn => {
    const {paper,id:turnId,thread,time,question,label='你',source='论文',model='AI',answer,error,firstQuote} = turn;
    check(paper === id && text(turnId) && turnId && !turnIds.has(turnId) && nonnegative(time));
    check([thread,question,label,source,model].every(text) && thread && (thread === 'main' || turn.quote));
    check((answer == null || text(answer)) && (error == null || text(error)));
    turnIds.add(turnId);
    if (turn.memoryIds !== undefined) check(Array.isArray(turn.memoryIds) && turn.memoryIds.length<=3 && turn.memoryIds.every(text));
    if (turn.chatPage !== undefined) check(Number.isInteger(turn.chatPage) && turn.chatPage>=0 && turn.chatPage<=pages);
    return {paper,id:turnId,thread,time,question,label,source,model,answer,error,
      ...(turn.memoryIds?.length ? {memoryIds:turn.memoryIds} : {}),
      ...(turn.chatPage !== undefined ? {chatPage:turn.chatPage} : {}),
      firstQuote:typeof firstQuote === 'boolean' ? firstQuote : undefined,
      quote:quoteData(turn.quote,pages),replyQuote:quoteData(turn.replyQuote,pages)};
  })};
}

export async function makeReadingPack(data, pdf) {
  const json = new TextEncoder().encode(JSON.stringify(readingData(data)));
  check(json.length <= maxJsonSize, '此篇论文的文字记录超过阅读包大小上限。');
  const header = new Uint8Array(headerSize);
  header.set(magic);
  new DataView(header.buffer).setUint32(magic.length,json.length);
  header.set(new Uint8Array(await crypto.subtle.digest('SHA-256',json)),magic.length+4);
  return new Blob([header,json,pdf],{type:'application/octet-stream'});
}

export async function readReadingPack(file) {
  const header = new Uint8Array(await file.slice(0,headerSize).arrayBuffer());
  check(header.length === headerSize && magic.every((byte,i) => header[i] === byte),
    '请选择从研读书架导出的 .yandu 阅读包（格式版本 1）。');
  const length = new DataView(header.buffer).getUint32(magic.length);
  check(length > 0 && length <= maxJsonSize && headerSize+length < file.size,'阅读包长度异常，文件可能不完整。');
  const bytes = await file.slice(headerSize,headerSize+length).arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  check(digest.every((byte,i) => byte === header[magic.length+4+i]),'阅读包校验失败，请重新传输文件。');
  const data = readingData(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  return {data,pdf:file.slice(headerSize+length,file.size,'application/pdf')};
}
