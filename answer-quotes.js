// DOM paths keep two occurrences of the same phrase distinct, including inside bold text or math.
function boundary(body, node, offset) {
  const path = [];
  while (node !== body) {
    path.unshift(Array.prototype.indexOf.call(node.parentNode.childNodes, node));
    node = node.parentNode;
  }
  return {path, offset};
}

export function selectedAnswer(range, text) {
  const element = node => node.nodeType === 1 ? node : node.parentElement;
  const body = element(range.startContainer)?.closest('[data-answer-id]');
  if (!body || !body.contains(range.endContainer) || !text) return null;
  return {
    kind: 'answer', turnId: body.dataset.answerId, text,
    layout: 2, start: boundary(body, range.startContainer, range.startOffset),
    end: boundary(body, range.endContainer, range.endOffset),
  };
}

export function answerRange(quote) {
  const body = document.querySelector('[data-answer-id="' + CSS.escape(quote.turnId) + '"]');
  if (!body) return null;
  const resolve = point => point.path.reduce((node, index) => node?.childNodes[index], body);
  const start = resolve(quote.start), end = resolve(quote.end);
  if (start && end) {
    const range = document.createRange();
    try {
      range.setStart(start, quote.start.offset);
      range.setEnd(end, quote.end.offset);
      if (quote.layout === 2 || range.toString().trim() === quote.text) return range;
    } catch { /* Older messages can have a different DOM after formatting. */ }
  }
  // Only restore a legacy text anchor if the excerpt uniquely identifies its location.
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let text = '';
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.length || node.parentElement.closest('.katex-mathml')) continue;
    nodes.push({node, offset:text.length});
    text += node.data;
  }
  const at = text.indexOf(quote.text);
  if (at < 0 || !quote.text || text.indexOf(quote.text, at + 1) >= 0) return null;
  const last = at + quote.text.length;
  const firstNode = nodes.find(p => p.offset + p.node.length > at);
  const lastNode = nodes.find(p => p.offset + p.node.length >= last);
  const range = document.createRange();
  range.setStart(firstNode.node, at - firstNode.offset);
  range.setEnd(lastNode.node, last - lastNode.offset);
  return range;
}

export function visibleAnswerPoint(range) {
  if (!range) return null;
  const node = range.startContainer;
  const log = (node.nodeType === 1 ? node : node.parentElement).closest('#messages,.float-log');
  const view = log?.getBoundingClientRect();
  if (!view?.height) return null;
  for (const rect of range.getClientRects()) {
    const left = Math.max(view.left, rect.left), right = Math.min(view.right, rect.right);
    const top = Math.max(view.top, rect.top), bottom = Math.min(view.bottom, rect.bottom);
    if (right > left && bottom > top) return {x:(left + right) / 2, y:(top + bottom) / 2};
  }
  return null;
}
