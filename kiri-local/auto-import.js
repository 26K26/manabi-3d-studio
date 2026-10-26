// Manabi 3D Studio: full-page, same-origin Kiri integration.
// A CAD handoff REPLACES older Kiri models, rather than accumulating them.
// The user can also select, delete, and clear widgets directly on the slice page.
// No external Kiri tab, STL download, or manual STL upload.
(()=>{
 if(!new URLSearchParams(location.search).has('manabi'))return;
 const base='/manabi-3d-studio/';
 const button=(label,action,style='')=>{
  const el=document.createElement('button');el.type='button';el.textContent=label;
  el.style.cssText='border:1px solid #8ba9cb;border-radius:8px;padding:9px 12px;background:#f5f9ff;color:#15395f;font:600 13px system-ui;cursor:pointer;min-height:38px;'+style;
  el.addEventListener('click',action);return el;
 };
 const back=button('← CADに戻る',()=>location.assign(base+'preview/kiri-local/'),'position:fixed;left:12px;bottom:14px;z-index:2147483600;box-shadow:0 3px 12px #0003;');
 const status=document.createElement('div');
 status.id='manabiImportStatus';
 status.setAttribute('role','status');
 status.style.cssText='position:fixed;right:12px;top:60px;z-index:2147483600;max-width:min(430px,45vw);background:#0e2340;color:#fff;padding:10px 13px;border-radius:8px;font:13px/1.5 system-ui;box-shadow:0 3px 12px #0003;pointer-events:none';
 const setStatus=s=>{status.textContent=s;console.log('MANABI KIRI:',s)};
 document.body.append(back,status);

 let api=null,saveTimer=0;
 const manager=document.createElement('details');
 manager.id='manabiModelManager';
 manager.style.cssText='position:fixed;left:12px;bottom:69px;z-index:2147483600;width:min(324px,calc(100vw - 24px));max-height:46vh;overflow:auto;background:#ffffff;color:#193450;border:1px solid #90acc5;border-radius:12px;box-shadow:0 6px 22px #0003;font:14px/1.5 system-ui';
 const summary=document.createElement('summary');
 summary.id='manabiModelManagerSummary';
 summary.style.cssText='padding:10px 14px;font-weight:750;cursor:pointer;position:sticky;top:0;background:#eaf4ff;z-index:1;border-radius:10px';
 const body=document.createElement('div');
 body.style.cssText='padding:9px 11px;display:flex;flex-direction:column;gap:8px';
 const tip=document.createElement('div');
 tip.style.cssText='font-size:12px;color:#476481';
 tip.textContent='不要なモデルを1つずつ削除できます。削除後は再スライスしてください。';
 const list=document.createElement('div');list.id='manabiModelManageList';
 list.style.cssText='display:flex;flex-direction:column;gap:7px';
 const toolbar=document.createElement('div');
 toolbar.style.cssText='display:flex;gap:8px;flex-wrap:wrap';
 body.append(tip,toolbar,list);manager.append(summary,body);document.body.append(manager);

 const all=()=>api?.widgets?.all?.()||[];
 const modelName=(w,i)=>String(w.meta?.file||('モデル '+(i+1)));
 const refresh=()=>{
  if(!api)return;
  const ws=all();
  summary.textContent='📦 モデル管理（'+ws.length+'個）';
  list.replaceChildren();toolbar.replaceChildren();
  if(!ws.length){
   const empty=document.createElement('div');empty.style.cssText='color:#56718b;font-size:13px;padding:5px';
   empty.textContent='現在、モデルはありません。';list.append(empty);return;
  }
  const selected=api.selection?.widgets?.()||[];
  const removeSelected=button('選択中を削除',()=>{
   const picked=api.selection?.widgets?.()||[];
   if(!picked.length){setStatus('削除したいモデルを先に選択してください。');return;}
   removeModels(picked);
  },'flex:1');
  removeSelected.disabled=!selected.length;
  if(removeSelected.disabled)removeSelected.style.opacity='.5';
  const clearAll=button('全部削除',()=>{
   if(window.confirm('スライス画面にあるモデルをすべて削除しますか？\nCADで作成した元の作品は消えません。'))removeModels(all());
  },'background:#fff1f0;color:#992e2e;border-color:#efb6b6');
  toolbar.append(removeSelected,clearAll);
  ws.forEach((w,i)=>{
   const row=document.createElement('div');
   row.style.cssText='display:flex;align-items:center;gap:6px;padding:6px;border:1px solid #dae5ee;border-radius:8px';
   const name=document.createElement('span');name.textContent=(i+1)+'. '+modelName(w,i);
   name.style.cssText='flex:1;overflow-wrap:anywhere;min-width:0;font-size:12px';
   const chosen=button('選択',()=>{
    if(!api.view.is_arrange())api.view.set_arrange();
    api.platform.select(w);
    setStatus('モデルを選択しました。不要なら「削除」を押してください。');
    refresh();
   },'padding:6px 8px;min-height:34px');
   const del=button('削除',()=>removeModels([w]),'background:#fff3f1;color:#9d3131;border-color:#efb6b6;padding:6px 9px;min-height:34px');
   del.dataset.removeId=String(w.id);
   row.append(name,chosen,del);list.append(row);
  });
 };
 const scheduleSave=()=>{
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{
   try{api?.space?.save?.(true);}catch(e){console.warn('Kiri model list save failed',e);}
  },1100);
 };
 const removeModels=(models)=>{
  if(!api||!models?.length)return;
  try{
   if(!api.view.is_arrange())api.view.set_arrange();
   // Use Kiri's official platform API, so the mesh, selection, sliced
   // output and saved workspace all stay in sync.
   const current=new Set(all().map(w=>w.id));
   const targets=models.filter(w=>current.has(w.id));
   if(!targets.length)return;
   api.platform.delete(targets);
   scheduleSave();
   setStatus(targets.length+'個を削除しました。必要なら再スライスしてください。');
   refresh();
  }catch(e){setStatus('モデル削除エラー: '+(e.message||e));console.error(e)}
 };
 const bindEvents=()=>{
  for(const name of ['widget.add','widget.delete','widget.select','widget.deselect','view.set']){
   api.event.on(name,()=>setTimeout(refresh,0));
  }
  refresh();
 };
 async function waitForKiri(){
  // kiri.api becomes available before its asynchronous workspace restore.
  // kiri.load(callback) fires at the end of startup.
  for(let i=0;i<200;i++){
   const kiri=window.kiri;
   if(typeof kiri?.load==='function'){
    return await new Promise((resolve,reject)=>{
     const timer=setTimeout(()=>reject(Error('Kiriの初期化が完了しませんでした。')),36000);
     kiri.load(ready=>{
      clearTimeout(timer);
      if(ready?.platform?.load_stl && ready?.platform?.delete && ready?.widgets?.all)resolve(ready);
      else reject(Error('Kiriのモデル操作APIを利用できません'));
     },'manabi3d-local-handoff');
    });
   }
   await new Promise(r=>setTimeout(r,180));
  }
  throw Error('Kiriが起動しませんでした。');
 }
 (async()=>{
  let phase='Kiriの初期化';
  try{
   setStatus('Kiriの準備中…');
   api=await waitForKiri();
   bindEvents();
   const pending=await window.ManabiKiriBridge.read();
   if(!pending?.buffer){
    setStatus('保存済みのスライス画面を復元しました。不要なモデルは「モデル管理」から削除できます。');
    manager.open=all().length>1;
    return;
   }
   phase='古いモデルの整理';
   const existing=all();
   if(existing.length){
    setStatus('以前の'+existing.length+'個を削除し、最新CADモデルに置き換えています…');
    // Reloaded Kiri workspaces must NOT accumulate copies on repeated
    // CAD->slice transitions, including Safari's persisted workspace.
    api.platform.delete(existing);
   }
   refresh();
   phase='KiriへのSTL自動読み込み';
   const dev=api.settings?.dev?.();
   const proc=api.settings?.proc?.();
   if(dev && pending.settings?.bedX)Object.assign(dev,{bedWidth:pending.settings.bedX,bedDepth:pending.settings.bedY,maxHeight:pending.settings.bedZ,bedRound:false,bedBelt:false});
   if(proc && pending.settings?.height)Object.assign(proc,{sliceHeight:pending.settings.height,firstSliceHeight:pending.settings.height});
   const url=URL.createObjectURL(new Blob([pending.buffer],{type:'application/sla'}));
   api.platform.load_stl(url,(vertices,widget)=>{
    URL.revokeObjectURL(url);
    if(!vertices||!widget){setStatus('STLの読み込みに失敗しました。');return;}
    widget.meta.file='CADから転送したモデル';
    api.platform.changed();
    // This CAD transfer is one-shot. Reloading the slicer must NOT
    // resurrect a model the user has intentionally deleted.
    window.ManabiKiriBridge.consume(pending).catch(e=>console.warn('Transfer cleanup issue',e));
    scheduleSave();
    refresh();
    setStatus('最新CADモデルを1個読み込みました。スライスできます。');
    manager.open=false;
   });
  }catch(e){setStatus('読み込みエラー ['+phase+']: '+(e.message||e));console.error('Manabi local Kiri transfer failed in '+phase,(e.stack||e))}
 })();
})();
