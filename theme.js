(() => {
  const root = document.documentElement;
  const base = new URL('.', document.currentScript.src).pathname + ':reader.';
  function get(key) { try { return localStorage.getItem(base + key); } catch { return null; } }
  function save(key, value) { try { localStorage.setItem(base + key, value); } catch {} }
  const system = matchMedia('(prefers-color-scheme: dark)');
  let choice = get('theme');
  let original = get('originalPaper') === 'true';
  function apply() {
    const dark = choice === 'dark' || (choice !== 'light' && system.matches);
    root.dataset.theme = dark ? 'dark' : 'light';
    root.classList.toggle('original-paper', original);
    const theme = document.getElementById('themeToggle'), paper = document.getElementById('paperColors');
    if (!theme) return;
    theme.setAttribute('aria-pressed', String(dark));
    theme.title = dark ? '切换到白天模式' : '切换到夜间模式';
    theme.querySelector('span').textContent = dark ? '夜间' : '白天';
    theme.querySelector('img').src = dark ? './icons/moon.svg' : './icons/sun.svg';
    if (!paper) return;
    paper.hidden = !dark;
    paper.setAttribute('aria-pressed', String(original));
    paper.title = original ? '恢复 PDF 夜间配色' : '查看 PDF 原始图表配色';
  }
  apply();
  system.addEventListener('change', apply);
  addEventListener('DOMContentLoaded', () => {
    apply();
    document.getElementById('themeToggle').onclick = () => {
      choice = root.dataset.theme === 'dark' ? 'light' : 'dark';
      save('theme', choice); apply();
    };
    if (!document.getElementById('paperColors')) return;
    document.getElementById('paperColors').onclick = () => {
      original = !original; save('originalPaper', String(original)); apply();
    };
  });
})();
