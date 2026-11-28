import {complete,hasKey} from './model-api.js?v=15';
import {loadClips} from './note-clips.js?v=3';
import {formatMessage} from './answer.js?v=7';
import {localGet,localSet} from './reader-storage.js';

export function bindOrganizer({editor,status,dialog,scope,storage,title,service,renderFigures,organizeFigures}) {
  const el=id=>document.getElementById(id);
  const run=el('organizeNotes'), edit=el('editNotes'), undo=el('undoNotes'), preview=el('notesPreview');
  let generation=0;
  function display(formatted) {
    preview.hidden=!formatted;
    editor.hidden=formatted;
    edit.hidden=!editor.value.trim();
    edit.textContent=formatted?'编辑正文':'查看排版';
    if(formatted){
      preview.replaceChildren();
      const format=(target,text)=>formatMessage(target,text,()=>null,{paragraphs:true});
      if (renderFigures)renderFigures(preview,editor.value,loadClips(scope()),format);
      else format(preview,editor.value);
    }
  }
  function prepare() {
    generation++;
    run.disabled=false;run.textContent='一键整理';
    undo.hidden=localGet(storage()+'.beforeOrganize')===null;
    el('clipDrawer').open=!editor.value.trim();
    display(!!editor.value.trim());
  }
  dialog.addEventListener('close',()=>{generation++});
  edit.onclick=()=>{display(preview.hidden);if(!editor.hidden)editor.focus()};
  editor.addEventListener('input',()=>{edit.hidden=!editor.value.trim()});
  undo.onclick=()=>{
    const key=storage(),old=localGet(key+'.beforeOrganize');
    if(old===null)return;
    if(!localSet(key,old)){status.textContent='存储空间不足，未能撤销。';return}
    editor.value=old;
    localStorage.removeItem(new URL('.',import.meta.url).pathname+':'+key+'.beforeOrganize');
    prepare();status.textContent='已恢复整理前的正文。';
  };
  run.onclick=async()=>{
    const token=++generation,id=scope(),key=storage(),before=editor.value,persisted=localGet(key);
    try {
      const clips=loadClips(id);
      if(!clips.length && !before.trim())throw Error('先摘录一段文字或写下笔记，再点一键整理。');
      const config=service();
      if(!hasKey(config.provider))throw Error('请先在 AI 设置中填写密钥，再整理笔记。');
      run.disabled=true;run.textContent='整理中…';status.textContent='AI 正在整理摘录和正文…';
      const organize=async(writing,excerpts,figures=[])=>{
        const question='把独立要点逐条编号；两条共同说明同一要点时可简明合写，去掉括号里的重复翻译；保持原意和篇幅，只纠正明确错漏。'+
          (figures.length?'把每个 slot 原样单独放在相关要点后，图注将自动插入。':'');
        const result=await complete({...config,organize:true,question,context:JSON.stringify({主题:title(),已有正文:writing,摘录:excerpts,插图:figures})});
        return result.answer;
      };
      const active=()=>token===generation && scope()===id && dialog.open;
      const answer=organizeFigures && clips.some(c=>c.role===4) ?
        await organizeFigures({clips,before,config,organize,active}) : await organize(before,clips.map(c=>c.text));
      if(token!==generation || scope()!==id || !dialog.open)return;
      if(editor.value!==before || localGet(key)!==persisted)throw Error('整理期间正文有修改，请重新整理。');
      if(!localSet(key+'.beforeOrganize',before) || !localSet(key,answer))throw Error('存储空间不足，请释放空间后重新整理。');
      editor.value=answer;prepare();status.textContent='已整理并保存。';
    } catch(e){if(token===generation)status.textContent=e.message}
    finally {if(token===generation)run.disabled=false}
  };
  return prepare;
}
