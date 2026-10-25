// Full-page Kiri launcher for Manabi 3D Studio.
// Kiri is served from our own GitHub Pages origin. STL is retrieved from
// the local browser store automatically; users never handle STL files.
(()=>{
 if(!new URLSearchParams(location.search).has('manabi'))return;
 const base='/manabi-3d-studio/';
 const back=document.createElement('button');
 back.type='button';
 back.textContent='← CADに戻る';
 back.style.cssText='position:fixed;left:12px;bottom:16px;z-index:2147483600;padding:12px 18px;border:2px solid #467cb7;border-radius:10px;background:#f2f9ff;color:#1c4267;font:700 15px system-ui;box-shadow:0 3px 12px #0003;cursor:pointer';
 back.onclick=()=>{location.assign(base+'preview/kiri-local/')};
 const status=document.createElement('div');
 status.id='manabiImportStatus';
 status.setAttribute('role','status');
 status.style.cssText='position:fixed;right:12px;top:64px;z-index:2147483600;max-width:45%;background:#0e2340;color:#fff;padding:10px 13px;border-radius:8px;font:13px system-ui;box-shadow:0 3px 12px #0003';
 const setStatus=s=>{status.textContent=s;console.log('MANABI KIRI:',s)};
 document.body.append(back,status);
 async function waitForKiri(){
  // kiri.api appears BEFORE Kiri finishes its asynchronous startup.
  // Kiri's own kiri.load(callback) runs only after init_input and init_sync
  // finish, avoiding IndexedDB "version change transaction is running".
  for(let i=0;i<200;i++){
   const kiri=window.kiri;
   if(typeof kiri?.load==='function'){
    return await new Promise((resolve,reject)=>{
     const timer=setTimeout(()=>reject(Error('Kiriの初期化が完了しませんでした。')),36000);
     kiri.load(api=>{
      clearTimeout(timer);
      if(api?.platform?.load_stl && api?.mode?.set)resolve(api);
      else reject(Error('Kiriの読み込みAPIを利用できません'));
     },'manabi3d-local-handoff');
    });
   }
   await new Promise(r=>setTimeout(r,180));
  }
  throw Error('Kiriが起動しませんでした。');
 }
 (async()=>{
  try{
   setStatus('CADモデルを内部ストレージから読み込み中…');
   const obj=await window.ManabiKiriBridge.read();
   if(!obj?.buffer)throw Error('CADモデルの受け渡しデータがありません。CAD画面から「スライスへ」を押してください。');
   const api=await waitForKiri();
   setStatus('KiriにCADモデルを配置中…');
   api.mode.set('FDM');
   api.platform.clear();
   const dev=api.settings?.dev?.();
   const proc=api.settings?.proc?.();
   if(dev && obj.settings?.bedX){Object.assign(dev,{bedWidth:obj.settings.bedX,bedDepth:obj.settings.bedY,maxHeight:obj.settings.bedZ,bedRound:false,bedBelt:false});}
   if(proc && obj.settings?.height){Object.assign(proc,{sliceHeight:obj.settings.height,firstSliceHeight:obj.settings.height});}
   const url=URL.createObjectURL(new Blob([obj.buffer],{type:'application/sla'}));
   // This calls Kiri's official STL loader in the same window. There is no
   // iframe messaging, external domain, or second tab.
   api.platform.load_stl(url,(vertices,widget)=>{
    URL.revokeObjectURL(url);
    if(!vertices||!widget){setStatus('STLの読み込みに失敗しました');return;}
    setStatus('CADモデルを読み込みました。Kiriの「Slice」で積層計算できます。');
    setTimeout(()=>{if(status.isConnected)status.style.opacity='0.8'},2500);
   });
  }catch(e){setStatus('読み込みエラー: '+(e.message||e));console.error('Manabi local Kiri transfer failed',e)}
 })();
})();
