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
 // A slicer-local clipboard: independent snapshots, without relying on OS
 // clipboard permissions (particularly restricted in iPad Safari).
 let copiedWidgets=null,pasteCount=0;
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
 tip.textContent='不要なモデルの削除・コピー・貼り付けができます。外付けキーボードは Ctrl/⌘+C・V に対応。操作後は再スライスしてください。';
 const list=document.createElement('div');list.id='manabiModelManageList';
 list.style.cssText='display:flex;flex-direction:column;gap:7px';
 const toolbar=document.createElement('div');
 toolbar.style.cssText='display:flex;gap:8px;flex-wrap:wrap';
 body.append(tip,toolbar,list);manager.append(summary,body);document.body.append(manager);
 // Keep the user aware that wide preview ranges are sampled for lower RAM.
 const previewNotice=document.createElement('div');
 previewNotice.id='manabiMemoryPreviewNotice';
 previewNotice.hidden=true;
 previewNotice.textContent='省メモリ表示：大きいモデルは代表断面のみ表示（印刷用の計算・出力は全層）';
 previewNotice.style.cssText='position:fixed;right:12px;bottom:14px;z-index:2147483599;max-width:min(350px,calc(100vw - 24px));background:#ffffffee;border:1px solid #a8c8e0;border-radius:8px;padding:6px 9px;color:#34526e;font:12px/1.5 system-ui;pointer-events:none;box-shadow:0 2px 9px #0002';
 document.body.append(previewNotice);

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
  const copy=button('⧉ コピー',copySlicerSelection,'flex:1');
  copy.disabled=selected.length===0;
  if(copy.disabled)copy.style.opacity='.5';
  const paste=button('▣ 貼り付け',pasteSlicerClipboard,'flex:1');
  paste.disabled=!copiedWidgets?.length;
  if(paste.disabled)paste.style.opacity='.5';
  toolbar.append(copy,paste,removeSelected,clearAll);
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
function copySlicerSelection(){
  if(!api)return false;
  if(!api.view.is_arrange())api.view.set_arrange();
  const selected=api.selection?.widgets?.()||[];
  if(!selected.length){setStatus('コピーするモデルを「選択」から指定してください。');return false;}
  try{
   // Native Kiri meshes already contain rotations and scaling in geometry.
   // Store a snapshot so subsequent edits/deletes cannot change the copy.
   if(copiedWidgets)for(const old of copiedWidgets)old.geo.dispose();
   copiedWidgets=selected.map(w=>({
    geo:w.mesh.geometry.clone(),
    meta:{file:String(w.meta?.file||'CADモデル'),vertices:w.meta?.vertices},
    anno:w.annotations?.()||{extruder:0},
    pos:{...w.track.pos}
   }));
   pasteCount=0;
   setStatus(copiedWidgets.length+'個のモデルをコピーしました。');
   refresh();return true;
  }catch(e){setStatus('モデルのコピーに失敗：'+(e.message||e));return false;}
 }
 function pasteSlicerClipboard(){
  if(!api||!copiedWidgets?.length){setStatus('コピーしたモデルがありません。');return false;}
  if(!api.view.is_arrange())api.view.set_arrange();
  // Avoid runaway duplicate geometry / slow Safari slicing.
  if(all().length+copiedWidgets.length>150){setStatus('モデルは150個までです。不要なものを削除してね。');return false;}
  const offset=15*(pasteCount+1),created=[];
  try{
   for(let i=0;i<copiedWidgets.length;i++){
    const r=copiedWidgets[i];
    const w=api.new.widget().loadGeometry(r.geo.clone());
    w.meta.file=r.meta.file+'（コピー）';
    w.meta.vertices=r.meta.vertices;
    w.anno={...r.anno};
    // No auto-layout: preserve relative placement of multiple widgets.
    w.move(r.pos.x+offset,r.pos.y+offset,r.pos.z,true);
    api.platform.add(w,i>0,true);
    created.push(w);
   }
   pasteCount++;
   scheduleSave();refresh();
   setStatus(created.length+'個をX・Y方向に'+offset+'mmずらして貼り付けました。再スライスしてください。');
   manager.open=true;return true;
  }catch(e){
   if(created.length){try{api.platform.delete(created);}catch{}}
   refresh();setStatus('貼り付け失敗：'+(e.message||e));return false;
  }
 }
 window.addEventListener('keydown',e=>{
  const el=e.target;
  if(!api||!manager.isConnected||!api.view.is_arrange()||!((e.ctrlKey||e.metaKey)&&!e.altKey))return;
  if(['INPUT','TEXTAREA','SELECT'].includes(el?.tagName)||el?.isContentEditable)return;
  const key=e.key.toLowerCase();
  if(key==='c'&&api.selection?.widgets?.().length){
   e.preventDefault();e.stopImmediatePropagation();copySlicerSelection();
  }else if(key==='v'&&copiedWidgets?.length){
   e.preventDefault();e.stopImmediatePropagation();pasteSlicerClipboard();
  }
 },true);
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
   // Persist immediately: a rapid reload must not interrupt the debounced
   // save and leave stale widget metadata in Kiri's workspace storage.
   api.space.save(true);
   scheduleSave();
   setStatus(targets.length+'個を削除しました。必要なら再スライスしてください。');
   refresh();
  }catch(e){setStatus('モデル削除エラー: '+(e.message||e));console.error(e)}
 };
 const bindEvents=()=>{
  api.event.on('slice.begin',()=>{previewNotice.hidden=true;});
  api.event.on('slice.end',()=>{previewNotice.hidden=false;});
  api.event.on('preview.end',()=>{previewNotice.hidden=false;});
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
    // Save the imported widget BEFORE consuming the one-shot STL transfer.
    // Otherwise, an immediate reload can lose both the transfer and model.
    api.space.save(true);
    window.ManabiKiriBridge.consume(pending).catch(e=>console.warn('Transfer cleanup issue',e));
    scheduleSave();
    refresh();
    setStatus('最新CADモデルを1個読み込みました。スライスできます。');
    manager.open=false;
   });
  }catch(e){setStatus('読み込みエラー ['+phase+']: '+(e.message||e));console.error('Manabi local Kiri transfer failed in '+phase,(e.stack||e))}
 })();
})();
