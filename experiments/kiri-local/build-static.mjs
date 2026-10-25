// Convert an upstream Kiri:Moto build to a self-hosted static subdirectory.
// Usage: node build-static.mjs <upstream> <output-root>
// The output-root is the site root: <output-root>/index.html and
// <output-root>/kiri-local/kiri/index.html are served on the same origin.
// No user STL files are uploaded to a server.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const up=path.resolve(process.argv[2]||'upstream');
const out=path.resolve(process.argv[3]||'test-site');
const base='/manabi-3d-studio/kiri-local/';
const copy=(source,target,required=true)=>{
  const from=path.join(up,source),to=path.join(out,'kiri-local',target);
  if(!fs.existsSync(from)){
    if(required)throw Error('Required upstream build output missing: '+from);
    console.warn('optional missing: '+from);return;
  }
  fs.mkdirSync(path.dirname(to),{recursive:true});
  // GitHub Pages cannot package dangling symlinks; copy actual build assets.
  // GitHub Pages tar dereferences links. Use cp -RL to resolve *nested*
  // upstream symlinks too; Node cpSync left some nested aliases as symlinks.
  fs.rmSync(to,{recursive:true,force:true});
  execFileSync('cp',['-RL',from,to]);
};
for(const [from,to,req] of [
 ['web/kiri','kiri',true],['web/moto','moto',true],
 ['web/font','font',true],['web/icon','icon',false],
 ['web/img','img',false],['web/obj','obj',false],
 ['web/boot','boot',false],
 ['src/pack/kiri-main.js','lib/main/kiri.js',true],
 ['src/pack/kiri-work.js','lib/kiri/run/worker.js',true],
 ['src/pack/kiri-pool.js','lib/kiri/run/minion.js',true],
 ['src/ext/tween.js','lib/ext/tween.js',true],
 ['src/moto/license.js','lib/moto/license.js',true],
 ['src/wasm','wasm',false],
 ['src/wasm','lib/kiri/wasm',false],
 ['src/void/solver/planegcs_dist','lib/main/planegcs_dist',false],
 ['license.md','license.md',true]
]) copy(from,to,req);
// Same-tab bridge scripts live on the same Pages origin as the CAD and Kiri.
for(const name of ['bridge.js','auto-import.js']){
 const source=path.resolve('experiments/kiri-local',name);
 const dest=path.join(out,'kiri-local',name);
 fs.copyFileSync(source,dest);
}
// Resolve Kiri's built-in absolute paths against our GitHub Pages project prefix.
// This script is still a proof-of-concept; CI does not prove runtime compatibility.
const routePrefixes=['lib','kiri','moto','font','icon','img','obj','wasm','boot','mesh','void'];
function rewriteRoutes(text){
 for(const p of routePrefixes){
  for(const slash of ['"', "'", '`', '(', '=']){
   text=text.replaceAll(slash+'/'+p+'/',slash+base+p+'/');
  }
 }
 return text;
}
function walk(dir){
 for(const name of fs.readdirSync(dir)){
  const file=path.join(dir,name),info=fs.statSync(file);
  if(info.isDirectory())walk(file);
  else if(/\.(?:js|mjs|css|html|json|svg)$/i.test(name)){
   const original=fs.readFileSync(file,'utf8');
   const adapted=rewriteRoutes(original);
   if(adapted!==original)fs.writeFileSync(file,adapted);
  }
 }
}
walk(path.join(out,'kiri-local'));
function rejectLinks(dir){
 for(const ent of fs.readdirSync(dir)){
  const p=path.join(dir,ent),info=fs.lstatSync(p);
  if(info.isSymbolicLink())throw Error('Non-portable symlink in static package: '+p);
  if(info.isDirectory())rejectLinks(p);
 }
}
rejectLinks(path.join(out,'kiri-local'));

// Kiri is a top-level view: load the model automatically from the local
// transfer store once Kiri initializes. Never require manual STL import.
const kiriPage=path.join(out,'kiri-local','kiri','index.html');
let kiriHtml=fs.readFileSync(kiriPage,'utf8');
if(kiriHtml.split('</body>').length!==2)throw Error('Kiri index body not found');
kiriHtml=kiriHtml.replace('</body>',`<script src="../bridge.js"></script>
<script src="../auto-import.js"></script>
</body>`);
fs.writeFileSync(kiriPage,kiriHtml);
const html=fs.readFileSync(path.join(out,'kiri-local','kiri','index.html'),'utf8');
if(!html.includes(base+'lib/main/kiri.js'))throw Error('Kiri main UI script was not rebased');
for(const p of ['lib/main/kiri.js','lib/kiri/run/worker.js','lib/kiri/run/minion.js','kiri/index.html']){
 if(!fs.existsSync(path.join(out,'kiri-local',p)))throw Error('Missing packaged asset: '+p);
}
console.log('Packaged self-hosted Kiri UI, main bundle, workers and assets at '+out);
