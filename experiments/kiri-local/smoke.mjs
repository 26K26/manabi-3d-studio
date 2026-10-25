// Integration test: local same-origin Kiri UI, binary STL -> real slice.end.
// This runs in CI; zero user STL downloads or uploads.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';

const site=resolve(process.argv[2]||'test-site');
const prefix='/manabi-3d-studio/';
const port=18788;
const mime=file=>file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.wasm')?'application/wasm':file.endsWith('.json')?'application/json':'application/octet-stream';
const smokeHtml='<html><body style="margin:0"><iframe id="kiri" src="/manabi-3d-studio/kiri-local/kiri/" style="height:96vh;width:99vw"></iframe></body></html>';
const server=createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1:'+port);
 if(url.pathname===prefix+'smoke.html'){res.writeHead(200,{'Content-Type':'text/html'});res.end(smokeHtml);return;}
 if(!url.pathname.startsWith(prefix)){res.writeHead(404);res.end('unknown prefix');return;}
 let name=url.pathname.slice(prefix.length);
 if(name.endsWith('/'))name+='index.html';
 const file=resolve(site,name);
 if(!(file.startsWith(site+sep)||file===site)||!existsSync(file)||!statSync(file).isFile()){
  console.log('HTTP 404',url.pathname);res.writeHead(404);res.end('Not found '+name);return;
 }
 res.writeHead(200,{'Content-Type':mime(file),'Access-Control-Allow-Origin':'*'});res.end(readFileSync(file));
});
function cubeSTL(){
 const verts=[[-10,-10,0],[10,-10,0],[10,10,0],[-10,10,0],[-10,-10,20],[10,-10,20],[10,10,20],[-10,10,20]];
 const sides=[[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]];
 const tris=sides.flatMap(([a,b,c,d])=>[[a,b,c],[a,c,d]]);
 const buf=new ArrayBuffer(84+50*tris.length),view=new DataView(buf);
 view.setUint32(80,tris.length,true);
 tris.forEach((tri,i)=>tri.forEach((vi,j)=>verts[vi].forEach((x,k)=>view.setFloat32(84+i*50+12+j*12+k*4,x,true))));
 return buf;
}
const pause=ms=>new Promise(done=>setTimeout(done,ms));
let browser;
try{
 await new Promise(done=>server.listen(port,'127.0.0.1',done));
 browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--enable-webgl','--enable-unsafe-swiftshader','--use-angle=swiftshader','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:1280,height:850}});
 const logs=[],workers=[];
 page.on('pageerror',e=>logs.push('PAGE ERROR '+String(e)));
 page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')logs.push('CONSOLE '+m.type()+' '+m.text());});
 page.on('response',r=>{if(r.status()>=400)logs.push('HTTP '+r.status()+' '+r.url());});
 page.on('requestfailed',r=>logs.push('REQUEST FAIL '+r.url()+' '+r.failure()));
 page.on('worker',w=>{workers.push(w.url());console.log('NEW WORKER '+w.url());});
 await page.goto('http://127.0.0.1:'+port+prefix+'smoke.html',{waitUntil:'domcontentloaded',timeout:45000});
 console.log('Waiting for Kiri UI...');
 await page.waitForFunction(()=>!!document.querySelector('#kiri')?.contentWindow?.kiri?.api?.function?.slice,null,{timeout:40000});
 await pause(1200);
 console.log('Kiri UI ready: '+workers.length+' workers created');
 const state=await page.evaluate(async bytes=>{
  const frame=document.querySelector('#kiri').contentWindow;
  const origin=location.origin;
  return new Promise((ok,fail)=>{
   let phase='subscriptions', events=[];
   const timer=setTimeout(()=>{window.removeEventListener('message',onMessage);fail(Error('Timed out: '+phase+'; events='+JSON.stringify(events)));},26000);
   function onMessage(e){
    if(e.source!==frame)return;
    const d=e.data||{};
    events.push(d.event||Object.keys(d).join(','));
    if(d.event==='parse.error'||d.event==='slice.error'){
     clearTimeout(timer);window.removeEventListener('message',onMessage);fail(Error('Kiri error '+JSON.stringify(d)));return;
    }
    if(d.event==='parsed'){
     phase='slice';
     const cnt=frame.kiri?.api?.widgets?.all?.()?.length;
     console.log('CAD STL accepted, Kiri widget count: '+cnt);
     frame.postMessage({function:'slice'},origin);
    }
    if(d.event==='slice.end'){
     clearTimeout(timer);window.removeEventListener('message',onMessage);
     ok({sliceEvent:d.event,widgets:frame.kiri?.api?.widgets?.all?.()?.length,events});
    }
   }
   window.addEventListener('message',onMessage);
   for(const evt of ['parsed','parse.error','slice.begin','slice.error','slice.end'])frame.postMessage({event:evt},origin);
   frame.postMessage({mode:'FDM'},origin);
   frame.postMessage({clear:true},origin);
   phase='parse';
   setTimeout(()=>frame.postMessage({parse:bytes,type:'stl'},origin),800);
  });
 },cubeSTL());
 console.log('RESULT '+JSON.stringify(state));
 console.log('Workers '+JSON.stringify(workers));
 console.log('Browser diagnostic log '+JSON.stringify(logs.slice(-35)));
 if(state.sliceEvent!=='slice.end')throw Error('No slice.end');
 console.log('PASS: direct STL to Kiri and slice.end');
}catch(e){
 console.error('SMOKE FAILURE '+String(e));
 process.exitCode=1;
}finally{
 if(browser)await browser.close();
 await new Promise(done=>server.close(done));
}
