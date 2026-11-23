export function onFileDrop(label, receive) {
  const hint = document.createElement('div');
  hint.className = 'file-drop-hint';
  hint.textContent = label;
  hint.hidden = true;
  document.body.append(hint);
  const hasFiles = e => Array.from(e.dataTransfer?.types || []).includes('Files');
  window.addEventListener('dragover', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    hint.hidden = !!document.querySelector('dialog[open]');
    e.dataTransfer.dropEffect = hint.hidden ? 'none' : 'copy';
  });
  window.addEventListener('dragleave', e => { if (!e.relatedTarget) hint.hidden = true; });
  window.addEventListener('drop', e => {
    hint.hidden = true;
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (!document.querySelector('dialog[open]')) receive(Array.from(e.dataTransfer.files));
  });
}
