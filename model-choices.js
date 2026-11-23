import {tongjiModels} from './model-api.js?v=6';

export function bindModelChoices(provider) {
  const byId = id => document.getElementById(id);
  const button = byId('loadModels'), list = byId('modelChoices'), model = byId('model');
  const key = byId('key'), error = byId('configError');
  let version = 0;
  function reset() {
    version++;
    list.replaceChildren();
    button.hidden = provider.value !== 'tongji';
    button.disabled = false;
    button.textContent = '读取同济可用模型';
    model.placeholder = button.hidden ? '' : '填写模型 ID，或先填写密钥再读取可用模型';
  }
  key.addEventListener('input',reset);
  byId('settingDialog').addEventListener('close',reset);
  button.onclick = async () => {
    const request = ++version;
    error.textContent = '';
    button.disabled = true;
    button.textContent = '正在读取…';
    try {
      const ids = await tongjiModels(key.value.trim());
      if (version !== request) return;
      list.replaceChildren(...ids.map(id=>new Option(id,id)));
      if (!ids.includes(model.value)) model.value = ids[0];
      button.textContent = '已读取 '+ids.length+' 个模型';
      model.focus();
    } catch (e) {
      if (version !== request) return;
      error.textContent = e.message;
      button.textContent = '重新读取模型';
    } finally {
      if (version === request) button.disabled = false;
    }
  };
  return reset;
}
