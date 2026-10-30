// Build an entirely same-origin CAD module: no CDN imports on school devices.
// Usage: npm install && node experiments/kiri-local/build-cad.mjs [site-root]
// Build-time npm dependencies are included in a single local ESM asset.
// Stable main/index.html is never replaced; only the isolated preview is built.
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
const cwd=process.cwd();
const site=path.resolve(process.argv[2]||'test-site');
const original=fs.readFileSync(path.join(cwd,'index.html'),'utf8');
const cadScript=/<script type="module">([\s\S]*?)<\/script>/g;
const hits=[...original.matchAll(cadScript)];
if(hits.length!==1)throw Error('Expected exactly one inline CAD module: '+hits.length);
const importmaps=[...original.matchAll(/<script type="importmap">[\s\S]*?<\/script>/g)];
if(importmaps.length!==1)throw Error('Expected exactly one CDN importmap');
const entry=hits[0][1];
const outBundle=path.join(site,'kiri-local','cad.bundle.js');
fs.mkdirSync(path.dirname(outBundle),{recursive:true});
const result=await build({
 stdin:{contents:entry,resolveDir:cwd,sourcefile:'cad-entry.mjs',loader:'js'},
 absWorkingDir:cwd,
 bundle:true,
 splitting:false,
 platform:'browser',
 format:'esm',
 target:['es2020'],
 outfile:outBundle,
 minify:false,
 sourcemap:false,
 metafile:true,
 legalComments:'eof',
 plugins:[{
  name:'local-school-printer-settings',
  setup(api){
   api.onResolve({filter:/^\/manabi-3d-studio\/kiri-local\/print-config\.mjs$/},
     ()=>({path:path.join(cwd,'experiments/kiri-local/print-config.mjs')}));
  }
 }]
});
const out=result.metafile.outputs[Object.keys(result.metafile.outputs).find(x=>x.endsWith('/cad.bundle.js')) || Object.keys(result.metafile.outputs).find(x=>x.endsWith('cad.bundle.js'))];
if(!out)throw Error('No CAD bundle metadata emitted');
if(out.imports.some(imp=>imp.external))throw Error('Unexpected external CAD dependency: '+JSON.stringify(out.imports));
let html=original.replace(importmaps[0][0],'');
html=html.replace(hits[0][0],'<script type="module" src="/manabi-3d-studio/kiri-local/cad.bundle.js"></script>');
if(html.includes('cdn.jsdelivr.net')||html.includes('esm.sh'))throw Error('CAD HTML still depends on a runtime CDN');
if(!html.includes('id="canvas3d"')||!html.includes('src="/manabi-3d-studio/kiri-local/cad.bundle.js"'))
 throw Error('CAD entry or workplane missing');
fs.mkdirSync(site,{recursive:true});
fs.writeFileSync(path.join(site,'index.html'),html);
const bytes=fs.statSync(outBundle).size;
console.log('CAD SELF-HOSTED BUNDLE '+JSON.stringify({bytes,externalDependencies:out.imports.length,inputFiles:Object.keys(result.metafile.inputs).length}));
