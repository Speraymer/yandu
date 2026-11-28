import {tongjiModels, testTongjiModel, hasKey} from './model-api.js?v=14';

export function bindModelChoices(provider) {
  const el=id=>document.getElementById(id);
  const list=el('modelChoices'), key=el('key'), model=el('model');
  const load=el('loadModels'), test=el('testModel'), status=el('modelStatus');
  let version=0;
  function reset() {
    ++version;
    const active=provider.value==='tongji';
    el('tongjiSettings').hidden=!active;
    el('modelLabel').hidden=model.disabled=active;
    list.disabled=!active;
    list.replaceChildren(new Option('请先读取模型列表',''));
    load.disabled=false;
    test.disabled=true;
    status.textContent='';
  }
  async function loadList() {
    const request=++version;
    load.disabled=test.disabled=true;
    list.replaceChildren(new Option('正在读取…',''));
    status.textContent='正在读取同济模型列表…';
    try {
      const ids=await tongjiModels(key.value.trim());
      if(request!==version)return;
      list.replaceChildren(...ids.map(id=>new Option(id,id)));
      list.value=ids.includes(model.value)?model.value:ids[0];
      status.textContent='已读取 '+ids.length+' 个模型。';
      test.disabled=false;
    } catch(e) {
      if(request!==version)return;
      list.replaceChildren(new Option('请重新读取模型列表',''));
      status.textContent=e.message;
    } finally {
      if(request===version)load.disabled=false;
    }
  }
  key.addEventListener('input',reset);
  key.addEventListener('change',()=>{
    if(provider.value==='tongji' && key.value.trim())loadList();
  });
  load.onclick=loadList;
  list.onchange=()=>{++version;test.disabled=!list.value;status.textContent='';};
  test.onclick=async()=>{
    const request=++version;
    test.disabled=true;
    status.textContent='正在发送纯文字测试问题…';
    try {
      const {answer}=await testTongjiModel(list.value,key.value.trim());
      if(version===request)status.textContent='模型回复：'+answer;
    } catch(e) {
      if(version===request)status.textContent=e.message;
    } finally {
      if(version===request)test.disabled=false;
    }
  };
  el('settingDialog').addEventListener('close',reset);
  return ()=>{
    reset();
    if(provider.value==='tongji' && hasKey('tongji'))loadList();
  };
}
