// Same-tab CAD -> Kiri transport. No downloads, manual imports, or remote server.
// Transfer is stored on the same origin in IndexedDB; small-model fallback to
// sessionStorage if a device blocks IndexedDB.
(()=>{
 const dbname='manabi3d-local-slice', storename='models', key='latest';
 const fallback='manabi3d-local-slice-fallback';
 const opening=()=>new Promise((yes,no)=>{
  if(!('indexedDB' in window))return no(Error('IndexedDB unavailable'));
  const req=indexedDB.open(dbname,1);
  req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(storename))req.result.createObjectStore(storename)};
  req.onsuccess=()=>yes(req.result);
  req.onerror=()=>no(req.error||Error('Cannot open local storage'));
  req.onblocked=()=>no(Error('Storage is blocked'));
 });
 async function write(payload){
  const db=await opening();
  try{await new Promise((yes,no)=>{const tx=db.transaction(storename,'readwrite');tx.objectStore(storename).put(payload,key);tx.oncomplete=yes;tx.onerror=()=>no(tx.error||Error('Unable to save model'));tx.onabort=()=>no(tx.error||Error('Model write aborted'));});}
  finally{db.close();}
 }
 async function readDb(){
  const db=await opening();
  try{return await new Promise((yes,no)=>{const req=db.transaction(storename,'readonly').objectStore(storename).get(key);req.onsuccess=()=>yes(req.result);req.onerror=()=>no(req.error||Error('Model read failed'));});}
  finally{db.close();}
 }
 const bytesToB64=buffer=>{
  const src=new Uint8Array(buffer),chunks=[];
  for(let i=0;i<src.length;i+=8192)chunks.push(String.fromCharCode(...src.subarray(i,i+8192)));
  return btoa(chunks.join(''));
 };
 function b64ToBytes(b64){const str=atob(b64),arr=new Uint8Array(str.length);for(let i=0;i<str.length;i++)arr[i]=str.charCodeAt(i);return arr.buffer;}
 async function stage(arrayBuffer,settings={}){
  if(!(arrayBuffer instanceof ArrayBuffer)||arrayBuffer.byteLength<84)throw Error('Invalid STL binary');
  const data={buffer:arrayBuffer,created:Date.now(),settings};
  try{
   await write(data);
   try{sessionStorage.removeItem(fallback);}catch{}
   return 'indexeddb';
  }catch(dbError){
   // Safari sometimes denies IndexedDB inside particular browsing contexts.
   // A small STL can still be handed to the next view without downloading.
   if(arrayBuffer.byteLength>2*1024*1024)throw Error('モデルが大きく、端末内保存が利用できません: '+dbError.message);
   try{sessionStorage.setItem(fallback,JSON.stringify({b64:bytesToB64(arrayBuffer),created:Date.now(),settings}));return 'session';}
   catch(e){throw Error('端末内のモデル受け渡しに失敗: '+(e.message||e));}
  }
 }
 async function read(){
  try{const obj=await readDb();if(obj?.buffer instanceof ArrayBuffer && Date.now()-obj.created<24*3600*1000)return obj;}
  catch(e){console.warn('CAD local transfer IndexedDB unavailable',e);}
  const raw=sessionStorage.getItem(fallback);
  if(!raw)return null;
  const obj=JSON.parse(raw);
  if(Date.now()-obj.created>24*3600*1000)return null;
  return {buffer:b64ToBytes(obj.b64),settings:obj.settings||{},created:obj.created};
 }
 window.ManabiKiriBridge={stage,read};
})();
