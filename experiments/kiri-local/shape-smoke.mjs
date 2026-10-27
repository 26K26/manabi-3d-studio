// Lightweight browser-only validation of the CAD shape library.
// Does NOT rebuild Kiri and therefore costs much less CI time.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
const port=18789,root='/manabi-3d-studio/';
const cad=readFileSync('index.html');
const bridge=readFileSync('experiments/kiri-local/bridge.js');
const server=createServer((req,res)=>{
 const p=new URL(req.url,'http://127.0.0.1:'+port).pathname;
 if(p===root||p===root+'preview/kiri-local/'||p===root+'preview/kiri-local/index.html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(cad);}
 else if(p===root+'kiri-local/bridge.js'){res.writeHead(200,{'Content-Type':'application/javascript'});res.end(bridge);}
 else {res.writeHead(404);res.end('missing '+p);}
});
let browser;const log=[];
try{
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
 const executablePath=process.env.CHROME_BIN||'/usr/bin/google-chrome';
 browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--enable-webgl','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
 const page=await browser.newPage({viewport:{width:1300,height:850}});
 page.on('pageerror',e=>log.push('pageerror '+String(e)));
 page.on('console',m=>{if(m.type()==='error')log.push('console '+m.text())});
 await page.goto('http://127.0.0.1:'+port+root+'preview/kiri-local/?testShapes=1',{waitUntil:'domcontentloaded',timeout:45000});
 await page.waitForFunction(()=>window.__manabiCadReady===true&&typeof window.__manabiTestShapes==='function',null,{timeout:60000});
 const result=await page.evaluate(()=>window.__manabiTestShapes());
 console.log('SHAPE TEST RESULTS '+JSON.stringify(result));
 if(result.length!==21||result.some(x=>!x.ok))throw Error('Shape checks failed: '+JSON.stringify(result.filter(x=>!x.ok)));
 await page.locator('#shapeLibrary summary').click();
 await page.locator('#sketchTool').click();
 const b=await page.locator('#sketchCanvas').boundingBox();
 if(!b)throw Error('No canvas for Apple Pencil drawing');
 const coords=[[.2,.2],[.8,.2],[.8,.8],[.2,.8],[.2,.2]];
 await page.mouse.move(b.x+b.width*coords[0][0],b.y+b.height*coords[0][1]);await page.mouse.down();
 for(const [x,y] of coords.slice(1))await page.mouse.move(b.x+b.width*x,b.y+b.height*y,{steps:8});
 await page.mouse.up();
 await page.locator('#sketchCreate').click();
 await page.waitForFunction(()=>document.querySelectorAll('#shapeList button').length===1,null,{timeout:12000});
 await page.locator('#copyObjects').click();await page.locator('#pasteObjects').click();
 await page.waitForFunction(()=>document.querySelectorAll('#shapeList button').length===2,null,{timeout:12000});
 console.log('PASS: all 20 new primitives, freehand polygon, saved STL, in-app copy/paste');
}catch(e){
 console.error('CAD SMOKE FAILED',e);
 console.error('Browser errors',JSON.stringify(log.slice(-20)));
 process.exitCode=1;
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
