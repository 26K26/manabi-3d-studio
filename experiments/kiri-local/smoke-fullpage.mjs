// E2E: STL from CAD local storage -> SAME-TAB Kiri fullpage -> real slice.end
// No STL file dialogs, downloads, uploads, or standalone remote tab.
import { createServer } from 'node:http';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { chromium, webkit } from 'playwright';
const site=resolve(process.argv[2]||'test-site'),prefix='/manabi-3d-studio/',port=18788;
const mime=n=>n.endsWith('.js')?'application/javascript':n.endsWith('.html')?'text/html; charset=utf-8':n.endsWith('.css')?'text/css':n.endsWith('.wasm')?'application/wasm':n.endsWith('.json')?'application/json':'application/octet-stream';
const startHtml='<html><head><script src="/manabi-3d-studio/kiri-local/bridge.js"></script></head><body>Internal STL staging</body></html>';
const server=createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1:'+port);
 if(url.pathname===prefix+'smoke.html'){res.writeHead(200,{'Content-Type':'text/html'});res.end(startHtml);return;}
 if(!url.pathname.startsWith(prefix)){res.writeHead(404);res.end('invalid base');return;}
 let name=url.pathname.slice(prefix.length);if(name.endsWith('/'))name+='index.html';
 const file=resolve(site,name);
 if(!(file===site||file.startsWith(site+sep))||!existsSync(file)||!statSync(file).isFile()){res.writeHead(404);res.end('Not found '+name);console.log('HTTP 404 '+name);return;}
 res.writeHead(200,{'Content-Type':mime(file)});res.end(readFileSync(file));
});
function cubeSTL(){
 const v=[[-10,-10,0],[10,-10,0],[10,10,0],[-10,10,0],[-10,-10,20],[10,-10,20],[10,10,20],[-10,10,20]];
 const faces=[[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]];
 const triangles=faces.flatMap(([a,b,c,d])=>[[a,b,c],[a,c,d]]);
 const buf=new ArrayBuffer(84+50*triangles.length),vw=new DataView(buf);
 vw.setUint32(80,triangles.length,true);
 triangles.forEach((tri,i)=>tri.forEach((ind,j)=>v[ind].forEach((n,k)=>vw.setFloat32(84+50*i+12+12*j+4*k,n,true))));
 return Array.from(new Uint8Array(buf));
}
let browser,log=[];
try{
 await new Promise(done=>server.listen(port,'127.0.0.1',done));
 const safari=process.env.BROWSER==='webkit';
 console.log('SAME TAB KIRI test browser '+(safari?'WebKit':'Chromium'));
 browser=await(safari?webkit:chromium).launch(safari?{headless:true}:{executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--enable-webgl','--enable-unsafe-swiftshader','--use-angle=swiftshader','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:1300,height:900}});
 const workers=[];
 page.on('worker',w=>{workers.push(w.url());console.log('WORKER '+w.url());});
 page.on('pageerror',e=>log.push('PAGE ERROR '+String(e)+' '+(e.stack||'')));
 page.on('console',m=>{if(['error','warning'].includes(m.type()))log.push('CONSOLE '+m.type()+' '+m.text());});
 page.on('requestfailed',req=>log.push('FAILED REQUEST '+req.url()+' '+req.failure()));
 page.on('response',r=>{if(r.status()>=400)log.push('HTTP '+r.status()+' '+r.url());});
 const origin='http://127.0.0.1:'+port+prefix;
 await page.goto(origin+'smoke.html',{waitUntil:'load',timeout:45000});
 const staged=await page.evaluate(async a=>window.ManabiKiriBridge.stage(new Uint8Array(a).buffer,{bedX:180,bedY:180,bedZ:180,height:.2}),cubeSTL());
 console.log('Staged STL in '+staged);
 await page.goto(origin+'kiri-local/kiri/?manabi=1&s=1',{waitUntil:'domcontentloaded',timeout:45000});
 console.log('Navigated in SAME TAB to Kiri');
 await page.waitForFunction(()=>{
  const t=document.getElementById('manabiImportStatus')?.textContent||'';
  if(t.includes('読み込みエラー')||t.includes('STLの読み込みに失敗'))throw Error(t);
  return window.kiri?.api?.widgets?.all?.().length>=1;
 },null,{timeout:45000});
 console.log('LOADED '+JSON.stringify(await page.evaluate(()=>({modelCount:window.kiri.api.widgets.all().length,status:document.getElementById('manabiImportStatus')?.textContent}))));
 const modelCount=await page.evaluate(()=>window.kiri.api.widgets.all().length);
 if(modelCount!==1)throw Error('Unexpected extra model in slicer: '+modelCount+' (expected only CAD model)');
 // Check if Kiri's core slicing Worker can receive and answer any task.
 // If the core worker module fails to initialize in WebKit, the progress UI
 // would otherwise sit at 0% forever without an actionable diagnosis.
 const probe=await page.evaluate(async()=>{
  const api=window.kiri?.api;
  if(!api?.client?.sendp)return {ok:false,why:'api.client.sendp missing'};
  try{
   return await Promise.race([
    api.client.sendp('clear',{}).then(v=>({ok:true,result:v})).catch(e=>({ok:false,error:String(e)})),
    new Promise(ok=>setTimeout(()=>ok({ok:false,reason:'worker clear command timed out'}),5000))
   ]);
  }catch(e){return {ok:false,error:String(e)}}
 });
 console.log('CORE WORKER PROBE '+JSON.stringify(probe));
  const result=await page.evaluate(()=>new Promise((resolve,reject)=>{
  const api=window.kiri.api;
  const timer=setTimeout(()=>reject(Error('Timed out waiting for slice.end')),50000);
  api.event.on('slice.end',msg=>{clearTimeout(timer);resolve({event:'slice.end',mode:api.mode.get(),models:api.widgets.all().length});});
  api.event.on('slice.error',e=>{clearTimeout(timer);reject(Error('slice.error '+JSON.stringify(e)));});
  api.function.slice();
 }));
 console.log('RESULT '+JSON.stringify(result));
 console.log('WORKER COUNT '+workers.length);
 if(result.event!=='slice.end')throw Error('Missing slice.end');
 // Regression 1: delete through our own slicer UI, then reload. A
 // consumed transfer must never recreate the intentionally deleted model.
 await page.locator('#manabiModelManagerSummary').click();
 await page.locator('#manabiModelManageList button[data-remove-id]').first().click();
 await page.waitForFunction(()=>window.kiri.api.widgets.all().length===0,null,{timeout:10000});
 console.log('PASS: slicer model-management delete');
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.getElementById('manabiModelManager') && window.kiri?.api?.widgets?.all,null,{timeout:45000});
 await new Promise(ok=>setTimeout(ok,1800));
 let afterReload=await page.evaluate(()=>window.kiri.api.widgets.all().length);
 console.log('MODELS AFTER RELOAD '+afterReload);
 if(afterReload!==0)throw Error('Deleted widget reappeared after Kiri reload');
 // Regression 2: another CAD transfer replaces saved Kiri widgets. Simulate
 // Safari's retained workspace by first creating an old model via the same
 // local handoff, then staging a second CAD transfer and navigating again.
 await page.goto(origin+'smoke.html',{waitUntil:'load'});
 await page.evaluate(async a=>window.ManabiKiriBridge.stage(new Uint8Array(a).buffer,{height:.2}),cubeSTL());
 await page.goto(origin+'kiri-local/kiri/?manabi=1&s=1',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.kiri?.api?.widgets?.all?.().length===1,null,{timeout:45000});
 await page.evaluate(()=>window.kiri.api.space.save(true));
 await page.goto(origin+'smoke.html',{waitUntil:'load'});
 await page.evaluate(async a=>window.ManabiKiriBridge.stage(new Uint8Array(a).buffer,{height:.2}),cubeSTL());
 await page.goto(origin+'kiri-local/kiri/?manabi=1&s=1',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.getElementById('manabiImportStatus')?.textContent?.includes('最新CADモデルを1個読み込みました'),null,{timeout:45000});
 let models=await page.evaluate(()=>window.kiri.api.widgets.all().length);
 console.log('MODELS AFTER SECOND CAD HANDOFF '+models);
 if(models!==1)throw Error('Repeated CAD handoff accumulated saved models: '+models);
 console.log('PASS: deletion persists and repeated CAD handoff replaces Safari workspace');
  console.log('PASS: CAD local transfer -> SAME TAB Kiri -> slice.end');
}catch(e){
 console.error('SAME TAB SMOKE FAILURE '+String(e));
 console.error('BROWSER ERRORS '+JSON.stringify(log.slice(-35)));
 process.exitCode=1;
}finally{
 if(browser)await browser.close();
 await new Promise(done=>server.close(done));
}
