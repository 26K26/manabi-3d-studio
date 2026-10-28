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
 // Set the insertion color BEFORE placing a shape. Native color input is
 // deliberately tested because iPad uses the same HTML5 control.
 await page.locator('#newShapeColor').click();
 if(!await page.locator('#shapeColorDialog').isVisible())throw Error('New shape palette did not open');
 if(await page.locator('#shapeColorPresets button').count()!==36)throw Error('Expected 36 color presets');
 await page.locator('#shapeCustomColor').fill('#a347c1');
 await page.locator('#shapeColorApply').click();
 if(await page.locator('#shapeColorDialog').isVisible())throw Error('Color picker stayed open');
 if((await page.locator('#newColorValue').textContent()).trim()!=='#A347C1')throw Error('Insertion custom color was not selected');
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
 const insertedColors=await page.evaluate(()=>window.__manabiColorSnapshot());
 if(insertedColors.length!==2||insertedColors.some(c=>c.color!=='#A347C1'||c.display!=='A347C1'))throw Error('Copied and new shape color was not retained: '+JSON.stringify(insertedColors));
 if(await page.evaluate(()=>window.__manabiLegacyColorCheck())!=='#4EAFF4')throw Error('Old project was not migrated to the default color');
 console.log('PASS: 36 presets, native custom-color input, insertion color, copy color, legacy projects');
 console.log('PASS: all 20 new primitives, freehand polygon, saved STL, in-app copy/paste');
 // Delete one selected CAD shape with Delete; undo restores it.
 await page.locator('#shapeList button').first().click();
 await page.keyboard.press('Delete');
 await page.waitForFunction(()=>document.querySelectorAll('#shapeList button').length===1,null,{timeout:10000});
 await page.locator('#undoObjects').click();
 await page.waitForFunction(()=>document.querySelectorAll('#shapeList button').length===2,null,{timeout:10000});
 // Delete two shapes together with Backspace, and verify autosave of removal.
 await page.locator('#shapeList button').first().click();
 await page.locator('#shapeList button').nth(1).click({modifiers:['Control']});
 await page.waitForFunction(()=>document.querySelector('#deleteObjects')?.textContent?.includes('2個を削除'),null,{timeout:10000});
 await page.keyboard.press('Backspace');
 await page.waitForFunction(()=>document.querySelectorAll('#shapeList button').length===0,null,{timeout:10000});
 await page.waitForTimeout(550);
 const savedCount=await page.evaluate(()=>{
   const raw=localStorage.getItem('manabi3d-cad-draft-v1');
   return raw?JSON.parse(raw).items.length:null;
 });
 if(savedCount!==0)throw Error('Deleted models still exist in autosaved project: '+savedCount);
 await page.locator('#undoObjects').click();
 await page.waitForFunction(()=>document.querySelectorAll('#shapeList button').length===2,null,{timeout:10000});
 // Right-click a row and use the context-menu action.
 await page.locator('#shapeList button').first().click({button:'right'});
 await page.locator('#contextDelete').click();
 await page.waitForFunction(()=>document.querySelectorAll('#shapeList button').length===1,null,{timeout:10000});
 await page.keyboard.press('Control+z');
 await page.waitForFunction(()=>document.querySelectorAll('#shapeList button').length===2,null,{timeout:10000});
 // Never delete models while typing into a number box.
 await page.locator('#shapeList button').first().click();
 await page.locator('#dimX').focus();
 await page.keyboard.press('Backspace');
 const remaining=await page.locator('#shapeList button').count();
 if(remaining!==2)throw Error('Backspace in number field incorrectly deleted CAD models');
 console.log('PASS: toolbar undo, single Delete, multi Backspace, context delete, autosave, typing safety');
 // Rotate around THREE independently selectable axes. Verify the same
 // saved object keeps all 3 angles, even after copy, undo and page reload.
 await page.locator('#shapeList button').first().click();
 await page.locator('#rotateAxisX').click();
 if(await page.locator('#rotateAxisX').getAttribute('aria-pressed')!=='true')throw Error('X axis ring was not selected');
 await page.locator('#rotatePlus').click();
 if(Number(await page.locator('#angleX').inputValue())!==15)throw Error('X rotation not applied');
 if(Number(await page.locator('#angleY').inputValue())!==0)throw Error('X rotation unexpectedly changed Y');
 await page.locator('#rotateAxisY').click();
 await page.locator('#rotatePlus').click();
 if(Number(await page.locator('#angleY').inputValue())!==15)throw Error('Y rotation not applied');
 await page.locator('#rotateAxisZ').click();
 await page.locator('#rotateMinus').click();
 if(Number(await page.locator('#angle').inputValue())!==-15)throw Error('Z rotation not applied');
 await page.waitForTimeout(650);
 let rotated=await page.evaluate(()=>JSON.parse(localStorage.getItem('manabi3d-cad-draft-v1')).items.find(v=>Math.abs(v.angleX)===15));
 if(!rotated||rotated.angleX!==15||rotated.angleY!==15||rotated.angle!==-15)throw Error('Rotation project persistence failed: '+JSON.stringify(rotated));
 // Check backward compatibility with old projects containing Z rotation only.
 await page.reload({waitUntil:'domcontentloaded',timeout:45000});
 await page.waitForFunction(()=>window.__manabiCadReady===true&&document.querySelectorAll('#shapeList button').length===2,null,{timeout:60000});
 await page.locator('#shapeList button').first().click();
 if(Number(await page.locator('#angleX').inputValue())!==15||Number(await page.locator('#angleY').inputValue())!==15||Number(await page.locator('#angle').inputValue())!==-15)throw Error('XYZ angles changed across reload');
 console.log('PASS: X/Y/Z axis buttons, independent 15-degree rotate, model persistence and browser reload');

 // Ground a tilted shape using its rotated world-space bounds, not rec.z.
 const snap=()=>page.evaluate(()=>window.__manabiSpatialSnapshot());
 await page.locator('#posZ').fill('55');
 await page.locator('#posZ').press('Tab');
 const floating=(await snap()).items[0];
 if(floating.bounds.min.z<5)throw Error('Expected floated tilted mesh before ground');
 await page.locator('#dropToFloor').click();
 let landed=(await snap()).items[0];
 if(Math.abs(landed.bounds.min.z)>0.0005)throw Error('Tilted shape did not touch Z=0: '+JSON.stringify(landed));
 if(landed.angleX!==15||landed.angleY!==15||landed.angle!==-15)throw Error('Drop unexpectedly reset rotation');
 console.log('PASS: tilted mesh lowest world-space point lands on Z=0');

 // With two shapes selected, preserve their relative heights as an assembly.
 await page.locator('#posZ').fill('48');await page.locator('#posZ').press('Tab');
 await page.locator('#shapeList button').nth(1).click();
 await page.locator('#posZ').fill('92');await page.locator('#posZ').press('Tab');
 await page.locator('#shapeList button').first().click();
 await page.locator('#shapeList button').nth(1).click({modifiers:['Control']});
 const beforeDrop=(await snap()).items;
 if(beforeDrop.filter(x=>x.selected).length!==2)throw Error('Two meshes not selected for assembly drop');
 await page.locator('#dropToFloor').click();
 const afterDrop=(await snap()).items;
 const minBottom=Math.min(...afterDrop.map(x=>x.bounds.min.z));
 if(Math.abs(minBottom)>0.0005)throw Error('Group was not landed: '+minBottom);
 const move0=afterDrop[0].z-beforeDrop[0].z,move1=afterDrop[1].z-beforeDrop[1].z;
 if(Math.abs(move0-move1)>0.0005)throw Error('Group drop damaged relative heights: '+move0+' '+move1);
 await page.locator('#undoObjects').click();
 const unDropped=(await snap()).items;
 if(Math.abs(unDropped[0].z-beforeDrop[0].z)>0.0005||Math.abs(unDropped[1].z-beforeDrop[1].z)>0.0005)throw Error('Undo failed after group drop');
 console.log('PASS: assembly drop preserves relative Z and supports undo');

 // The first selected model is a fixed reference. Other models are aligned
 // against its transformed bounding edges/centers, one chosen axis at a time.
 await page.locator('#shapeList button').first().click();
 await page.locator('#shapeList button').nth(1).click({modifiers:['Control']});
 await page.locator('#alignTop').click();
 if(await page.locator('#alignOverlay').isHidden())throw Error('Align chooser did not open');
 const refId=(await snap()).items[0].id;
 await page.locator('#alignReference').selectOption(refId);
 const fixed=(await snap()).items[0];
 const xyCenter=(v,axis)=>(v.bounds.min[axis]+v.bounds.max[axis])/2;
 await page.locator('[data-align-axis="x"][data-align-position="center"]').click();
 let aligned=(await snap()).items;
 if(Math.abs(xyCenter(aligned[0],'x')-xyCenter(aligned[1],'x'))>.0005)throw Error('X centers are not aligned');
 await page.locator('[data-align-axis="y"][data-align-position="max"]').click();
 aligned=(await snap()).items;
 if(Math.abs(aligned[0].bounds.max.y-aligned[1].bounds.max.y)>.0005)throw Error('Y back edges are not aligned');
 await page.locator('[data-align-axis="z"][data-align-position="min"]').click();
 aligned=(await snap()).items;
 if(Math.abs(aligned[0].bounds.min.z-aligned[1].bounds.min.z)>.0005)throw Error('Z bottom edges are not aligned');
 const finalRef=aligned.find(x=>x.id===refId);
 if(!finalRef||Math.abs(finalRef.x-fixed.x)>.0005||Math.abs(finalRef.y-fixed.y)>.0005||Math.abs(finalRef.z-fixed.z)>.0005)throw Error('Reference mesh moved during alignment');
 if(aligned[0].angleX!==15||aligned[0].angleY!==15||aligned[0].angle!==-15)throw Error('Alignment reset model rotation');
 await page.waitForTimeout(500);
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('manabi3d-cad-draft-v1')).items);
 if(saved.length!==2)throw Error('Align autosave lost a model');
 await page.locator('#alignClose').click();
 if(!await page.locator('#alignOverlay').isHidden())throw Error('Align overlay did not close');
 console.log('PASS: fixed-reference X center / Y max / Z min alignment on tilted models, autosave, panel close');
 // Change both selected shapes in a single operation and verify color does
 // not change to orange when selected.
 await page.locator('#selectedShapeColor').click();
 if(!await page.locator('#shapeColorDialog').isVisible())throw Error('Selected shape color picker did not open');
 await page.locator('#shapeColorPresets [data-color="#FFD329"]').click();
 let colors=await page.evaluate(()=>window.__manabiColorSnapshot());
 if(colors.length!==2||colors.some(c=>c.color!=='#FFD329'||c.display!=='FFD329'))throw Error('Multi-selection recolor failed: '+JSON.stringify(colors));
 await page.locator('#undoObjects').click();
 colors=await page.evaluate(()=>window.__manabiColorSnapshot());
 if(colors.some(c=>c.color!=='#A347C1'))throw Error('Undo failed to restore saved per-model colors: '+JSON.stringify(colors));
 // Reapply the same preset, then reload to prove color survives edit storage.
 await page.locator('#shapeList button').first().click();
 await page.locator('#shapeList button').nth(1).click({modifiers:['Control']});
 await page.locator('#selectedShapeColor').click();
 await page.locator('#shapeColorPresets [data-color="#FFD329"]').click();
 await page.waitForTimeout(550);
 await page.reload({waitUntil:'domcontentloaded',timeout:45000});
 await page.waitForFunction(()=>window.__manabiCadReady===true&&document.querySelectorAll('#shapeList button').length===2,null,{timeout:60000});
 colors=await page.evaluate(()=>window.__manabiColorSnapshot());
 if(colors.some(c=>c.color!=='#FFD329'||c.display!=='FFD329'))throw Error('Color was lost across browser reload: '+JSON.stringify(colors));
 // Hole mode is gray translucent but converting back restores its color.
 await page.locator('#shapeList button').first().click();
 await page.locator('#holeToggle').click();
 colors=await page.evaluate(()=>window.__manabiColorSnapshot());
 if(colors[0].color!=='#FFD329'||colors[0].display==='FFD329'||!colors[0].hole)throw Error('Hole did not use neutral preview while keeping its color');
 await page.locator('#holeToggle').click();
 colors=await page.evaluate(()=>window.__manabiColorSnapshot());
 if(colors[0].hole||colors[0].display!=='FFD329')throw Error('Converting hole back lost color');
 // Selection stays colored and mixed selection is explained.
 await page.locator('#shapeList button').first().click();
 await page.locator('#selectedShapeColor').click();
 await page.locator('#shapeColorPresets [data-color="#E83641"]').click();
 await page.locator('#shapeList button').nth(1).click({modifiers:['Control']});
 if((await page.locator('#selectedColorValue').textContent()).trim()!=='色が混在')throw Error('Mixed colors not indicated');
 console.log('PASS: selected-shape recolor, multi-selection, undo, autosave, hole-color restore and mixed colors');

 // Portrait iPhone: the CAD workplane should be visible without a drawer
 // covering it; shape selection should dismiss the sheet and arm placement.
 await page.setViewportSize({width:390,height:660});
 await page.reload({waitUntil:'domcontentloaded',timeout:45000});
 await page.waitForFunction(()=>window.__manabiCadReady===true,null,{timeout:60000});
 const mobile=await page.evaluate(()=>{
  const canvas=document.getElementById('canvasWrap').getBoundingClientRect();
  const header=document.querySelector('header').getBoundingClientRect();
  const tabs=document.getElementById('cadBar').getBoundingClientRect();
  const panel=document.getElementById('props');
  return {screen:innerWidth,screenH:innerHeight,canvasW:canvas.width,canvasH:canvas.height,
   headerH:header.height,toolsH:tabs.height,drawerClosed:getComputedStyle(panel).visibility==='hidden',
   footerHidden:getComputedStyle(document.querySelector('footer')).display==='none',
   horizontalOverflow:document.documentElement.scrollWidth>innerWidth+2};
 });
 console.log('IPHONE PORTRAIT LAYOUT '+JSON.stringify(mobile));
 if(mobile.canvasW<370||mobile.canvasH<430||mobile.headerH>60||mobile.toolsH>108||
    !mobile.drawerClosed||!mobile.footerHidden||mobile.horizontalOverflow)
   throw Error('Mobile CAD workspace is still crowded: '+JSON.stringify(mobile));
 if(!await page.locator('#mobileShapeToggle').isVisible()||!await page.locator('#toSlice').isVisible())
   throw Error('Essential mobile toolbar controls are missing');
 await page.locator('#mobileShapeToggle').click();
 await page.waitForFunction(()=>getComputedStyle(document.getElementById('props')).visibility==='visible');
 if(!await page.locator('#shapePanel').isVisible())throw Error('Shape palette did not open in bottom sheet');
 await page.locator('[data-shape="box"]').first().click();
 await page.waitForFunction(()=>getComputedStyle(document.getElementById('props')).visibility==='hidden');
 const placing=await page.locator('#canvasWrap').evaluate(el=>el.classList.contains('placing'));
 if(!placing)throw Error('Tap on mobile shape failed to arm workplane placement');
 await page.locator('#canvas3d').click({position:{x:195,y:210}});
 await page.waitForFunction(()=>window.__manabiColorSnapshot().length===3,null,{timeout:10000});
 await page.locator('#propsToggle').click();
 if(!await page.locator('#editPanel').isVisible())throw Error('Mobile editing tab did not open');
 await page.locator('[data-mobile-tab-button="actions"]').click();
 if(!await page.locator('#mobileActionPanel').isVisible())throw Error('Mobile actions tab did not open');
 const undoMobile=page.locator('[data-cad-action="undoObjects"]');
 if(await undoMobile.isDisabled())throw Error('Mobile undo button did not mirror actual action state');
 await undoMobile.click();
 await page.waitForFunction(()=>window.__manabiColorSnapshot().length===2,null,{timeout:10000});
 await page.locator('#mobileMoreToggle').click();
 await page.locator('#mobileDrawerBackdrop').click();
 if(await page.locator('#props').evaluate(el=>getComputedStyle(el).visibility)!=='hidden')
   throw Error('Tapping the workplane backdrop did not close the mobile sheet');
 console.log('PASS: portrait iPhone full-height workspace, shape drawer, touch-place, edit/action tabs, undo and backdrop close');



}catch(e){
 console.error('CAD SMOKE FAILED',e);
 console.error('Browser errors',JSON.stringify(log.slice(-20)));
 process.exitCode=1;
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
