// Patch a pinned upstream Kiri:Moto checkout BEFORE esbuild.
// This code is experimental and applies only to our self-hosted copy.
import fs from 'node:fs';
import path from 'node:path';

const upstream=path.resolve(process.argv[2]||'upstream');
const name=path.join(upstream,'src/kiri/app/frame.js');
let code=fs.readFileSync(name,'utf8');
function replaceOne(before,after){
 const occurrences=code.split(before).length-1;
 if(occurrences!==1)throw Error('Upstream frame API changed ('+occurrences+'): '+before.slice(0,80));
 code=code.replace(before,after);
}
// Fix missing targetOrigin when responding to a same-origin CAD frame.
replaceOne('const send = source.window.postMessage;',
  'const send = message => source.postMessage(message, origin);');
// The upstream parse handler incorrectly passes a callback as the STL scale.
const start=code.indexOf("            case 'stl':");
const end=code.indexOf("            case 'obj':",start);
if(start<0||end<0)throw Error('Expected Kiri STL parse branch not found');
code=code.slice(0,start)+`            case 'stl':
                try {
                    // CAD passes a binary STL ArrayBuffer via postMessage.
                    if (ArrayBuffer.isView(bin)) {
                        bin = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
                    }
                    if (!(bin instanceof ArrayBuffer)) {
                        throw Error('Expected binary STL ArrayBuffer');
                    }
                    const vertices = new load.STL().parse(bin);
                    if (!vertices || vertices.length < 9 || vertices.length % 9 !== 0) {
                        throw Error('Empty or invalid STL vertices');
                    }
                    platform.add(widget = newWidget().loadVertices(vertices));
                    send({event: 'parsed', data: [ widget.id ]});
                } catch (error) {
                    send({event: 'parse.error', error: String(error?.message || error)});
                }
                break;
`+code.slice(end);
fs.writeFileSync(name,code);
// On modest school PCs as well as tablets, four minion workers duplicate
// substantial Kiri memory. Use one core Worker for this isolated Manabi build.
// The worker-side synchronous fallback below already supports all browsers.
const syncName=path.join(upstream,'src/kiri/app/init/sync.js');
let sync=fs.readFileSync(syncName,'utf8');
const before='    preferences.setThreaded(true);';
const n=sync.split(before).length-1;
if(n!==1)throw Error('Kiri thread configuration moved: '+n);
sync=sync.replace(before,`    // Manabi low-memory mode: don't start the four optional minion Workers.
    // Leave the core Worker active; preserve complete slice/export precision.
    preferences.setThreaded(false);`);
// Kiri normally hides all URL parameters after startup. Manabi relies on
// ?manabi=1 to restore its model manager after a page reload. Preserve this
// marker on our route, while leaving vanilla Kiri behavior unchanged.
const hideOptions=`    if (kio >= 0) {
        history.replaceState({}, '', wlp.substring(0,kio + 6));
    }`;
if(sync.split(hideOptions).length!==2)throw Error('Kiri URL cleanup code moved: expected one match');
sync=sync.replace(hideOptions,`    if (kio >= 0 && !new URLSearchParams(location.search).has('manabi')) {
        history.replaceState({}, '', wlp.substring(0,kio + 6));
    }`);
fs.writeFileSync(syncName,sync);
// Kiri's worker-side parallel queue uses 'concurrent' even when the
// optional minion pool has been disabled! Without this change WebKit may
// enqueue slicing tasks to minions that never start, leaving progress at 0%.
const workName=path.join(upstream,'src/kiri/run/worker.js');
let work=fs.readFileSync(workName,'utf8');
const oldConcurrent='concurrent = Math.round(Math.max(4, self.Worker && ccvalue > 3 ? ccvalue * 0.75 : 0)),';
if(work.split(oldConcurrent).length!==2)throw Error('Kiri worker parallelism expression changed');
work=work.replace(oldConcurrent,'concurrent = 1,');
// Run per-layer slicing in the core worker for all Manabi clients.
// Upstream minwork.sliceZ rejects when concurrent < 2, so this fallback
// preserves the full slicing calculation without allocating a minion pool.
const sliceImport="import { sliceZ as sliceAtZ } from '../../geo/slicer.js';";
if(!work.includes("import { Widget, newWidget }"))throw Error('Upstream worker imports moved');
work=work.replace("import { Widget, newWidget }",sliceImport+"\nimport { Widget, newWidget }");
const sliceReject=`            if (concurrent < 2) {
                reject("concurrent slice unavaiable");
            }`;
if(work.split(sliceReject).length!==2)throw Error('Upstream minwork.sliceZ guard changed');
work=work.replace(sliceReject,`            if (concurrent < 2) {
                // The synchronous worker path still returns an async Promise.
                // Keep on-each callback/collection semantics matching the
                // minion branch, without sending work to absent minions.
                const recs = [];
                sliceAtZ(z, points, {
                    ...options,
                    each(rec) {
                        recs.push(rec);
                        if (options.each) options.each(rec);
                    }
                }).then(() => resolve(recs)).catch(reject);
                return;
            }`);
// Kiri's polygon-clipping stage also requires a minion by default.
// Implement the same Clipper intersection directly in the core worker.
if(!work.includes("import '../../add/array.js';"))throw Error('Main worker imports changed');
work=work.replace("import '../../add/array.js';","import '../../ext/clip2.js';\nimport '../../add/array.js';");
const clipReject=`            if (concurrent < 2) {
                reject("concurrent clip unavailable");
            }`;
if(work.split(clipReject).length!==2)throw Error('Upstream clip rejection guard changed');
work=work.replace(clipReject,`            if (concurrent < 2) {
                try {
                    const CL = self.ClipperLib;
                    const clip = new CL.Clipper();
                    const tree = new CL.PolyTree();
                    const scale = base.config.clipper;
                    const asPath = array => array.map(p => ({X:p.x*scale,Y:p.y*scale}));
                    clip.AddPaths(lines.map(asPath),CL.PolyType.ptSubject,false);
                    clip.AddPaths(POLY.flatten(polys).map(p=>asPath(p.points)),CL.PolyType.ptClip,true);
                    let result = [];
                    if (clip.Execute(CL.ClipType.ctIntersection,tree,CL.PolyFillType.pftNonZero,CL.PolyFillType.pftEvenOdd)) {
                        result = tree.m_AllPolys.map(node=>POLY.fromClipperNode(node,slice.z));
                    }
                    for (const top of slice.tops) {
                        for (const poly of result) {
                            if (poly.isInside(top.poly)) top.fill_sparse.push(poly);
                        }
                    }
                    resolve(result);
                } catch(err) { reject(err); }
                return;
            }`);
fs.writeFileSync(workName,work);
// OPFS is optional for slicing. Some WebKit contexts reject
// navigator.storage.getDirectory() with UnknownError at module startup,
// preventing Kiri's entire UI from initializing. Catch it explicitly.
const opfsName=path.join(upstream,'src/moto/opfs.js');
let opfs=fs.readFileSync(opfsName,'utf8');
const oldOpfs='const root = await navigator.storage?.getDirectory();';
if(opfs.split(oldOpfs).length!==2)throw Error('Upstream OPFS initialization moved');
opfs=opfs.replace(oldOpfs,`let root;
try {
    root = await navigator.storage?.getDirectory();
} catch(error) {
    console.warn('Kiri OPFS unavailable; continuing with slicing', error);
    root = undefined;
}`);
fs.writeFileSync(opfsName,opfs);
// Kiri normally seeds a new workspace with the official cube. Suppress
// that object only for Manabi's ?manabi=1 route: the CAD object is injected
// automatically and must be the ONLY model loaded into Kiri.
const inputName=path.join(upstream,'src/kiri/app/init/input.js');
let input=fs.readFileSync(inputName,'utf8');
const seed='if (!SETUP.s && api.feature.seed) {';
if(input.split(seed).length!==2)throw Error('Kiri sample seed logic changed');
input=input.replace(seed,"if (!SETUP.s && api.feature.seed && !new URLSearchParams(location.search).has('manabi')) {");
fs.writeFileSync(inputName,input);
// Manabi cap FDM render layers: retaining full STL/G-code geometry is
// essential, but materializing hundreds of large per-layer polygons in the
// Worker consumes RAM before the browser-side lazy preview even starts.
// Keep the exact computed slices. Generate lightweight display data for only
// 48 evenly distributed cross-sections when a model exceeds 220 layers.
const fdmSliceName=path.join(upstream,'src/kiri/mode/fdm/work/slice.js');
let fdmSlice=fs.readFileSync(fdmSliceName,'utf8');
const normalRender=`    async function renderSlices(plo, phi) {
        forSlices(plo, phi, slice => {
            let params = slice.params || process;
            layerRender(slice, params, {
                dark: controller.dark,
                devel: controller.devel,
                renderContext
            });
        }, "render");
    }`;
const limitedRender=`    async function renderSlices(plo, phi) {
        const limit = slices.length > 220 ? 48 : 0;
        if (limit) {
            const step = Math.max(1, Math.ceil((slices.length - 1) / (limit - 1)));
            console.log('MANABI PREVIEW SAMPLES', JSON.stringify({
                allLayers:slices.length, maxPreviewLayers:limit, every:step
            }));
            slices.forEach((slice, index) => {
                if (index === 0 || index === slices.length - 1 || index % step === 0) {
                    let params = slice.params || process;
                    layerRender(slice, params, {
                        dark: controller.dark,
                        devel: controller.devel,
                        renderContext
                    });
                } else {
                    // Empty render payload preserves exact layer indices and
                    // metadata. The complete print polygons remain untouched.
                    slice.output();
                }
                doupdate(slice.index, plo, phi, "render");
            });
            return;
        }
        forSlices(plo, phi, slice => {
            let params = slice.params || process;
            layerRender(slice, params, {
                dark: controller.dark,
                devel: controller.devel,
                renderContext
            });
        }, "render");
    }`;
if(fdmSlice.split(normalRender).length!==2)throw Error('Upstream FDM render function moved');
fdmSlice=fdmSlice.replace(normalRender,limitedRender);
fs.writeFileSync(fdmSliceName,fdmSlice);
// Manabi memory-safe preview: avoid creating WebGL geometry for every layer
// immediately after slicing. Full computed slice data is retained for export.
const stackName=path.join(upstream,'src/kiri/app/stack.js');
let stack=fs.readFileSync(stackName,'utf8');
function patchStack(before,after){
 const count=stack.split(before).length-1;
 if(count!==1)throw Error('Upstream Stack API changed ('+count+'): '+before.slice(0,90));
 stack=stack.replace(before,after);
}
patchStack("        this.freeMem = freeMem;","        this.freeMem = freeMem;\n        this.manabiLazy = new URLSearchParams(self.location.search).has('manabi');\n        this.manabiSources = this.manabiLazy ? [] : null;\n        this.manabiProxies = this.manabiLazy ? [] : null;\n        this.manabiRendered = this.manabiLazy ? new Set() : null;\n        this.manabiMaxLayers = 12;");
patchStack("    setVisible(newMin, newMax) {\n        this.show();\n        for (let i=0, s=this.slices, len=s.length; i<len; i++) {\n            s[i].visible = i >= newMin && i <= newMax;\n            if (s[i].visible) this.lastVis = s[i];\n        }\n    }","    setVisible(newMin, newMax) {\n        this.show();\n        if (!this.manabiLazy) {\n            for (let i=0, s=this.slices, len=s.length; i<len; i++) {\n                s[i].visible = i >= newMin && i <= newMax;\n                if (s[i].visible) this.lastVis = s[i];\n            }\n            return;\n        }\n        const count=this.slices.length;\n        if(!count)return;\n        const low=Math.max(0,Math.min(count-1,Math.ceil(newMin)));\n        const high=Math.max(low,Math.min(count-1,Math.floor(newMax)));\n        const span=high-low+1;\n        const wanted=new Set();\n        if (span<=this.manabiMaxLayers) {\n            for (let i=low;i<=high;i++) wanted.add(i);\n        } else {\n            for (let i=0;i<this.manabiMaxLayers;i++) {\n                wanted.add(Math.round(low+(high-low)*i/(this.manabiMaxLayers-1)));\n            }\n        }\n        // Dispose previously visible WebGL geometry before allocating more.\n        for(const index of this.manabiRendered) {\n            if(wanted.has(index))continue;\n            const group=this.slices[index];\n            const removed=new Set(group.children);\n            for(const mesh of [...group.children]) {\n                group.remove(mesh);\n                THREE.dispose(mesh);\n            }\n            this.meshes=this.meshes.filter(mesh=>!removed.has(mesh));\n            for(const proxy of Object.values(this.manabiProxies[index]))proxy.linked=[];\n            group.visible=false;\n            this.manabiRendered.delete(index);\n        }\n        this.lastVis=null;\n        for(const index of [...wanted].sort((a,b)=>a-b)) {\n            const group=this.slices[index];\n            if(!this.manabiRendered.has(index)) {\n                const materials=this.renderLayers(this.manabiSources[index],group);\n                for(const [label,proxy] of Object.entries(this.manabiProxies[index])) {\n                    proxy.linked=materials[label]||[];\n                    for(const mat of proxy.linked)mat.visible=proxy.visible;\n                }\n                this.manabiRendered.add(index);\n            }\n            group.visible=true;\n            this.lastVis=group;\n        }\n    }");
patchStack("    addLayers(layers) {\n        // each slice gets a group so the slice can be toggled efficiently\n        let group = this.view.newGroup();\n        this.slices.push(group);\n        let map = this.renderLayers(layers, group);","    addLayers(layers) {\n        // each slice gets a group so the slice can be toggled efficiently\n        let group = this.view.newGroup();\n        this.slices.push(group);\n        if(this.manabiLazy) {\n            group.visible=false;\n            this.manabiSources.push(layers);\n            const map={};\n            const proxies={};\n            for(const [label,layer] of Object.entries(layers.layers)) {\n                const proxy={\n                    linked:[],\n                    _visible:!layer.off,\n                    get visible(){return this._visible;},\n                    set visible(v){\n                        this._visible=!!v;\n                        for(const mat of this.linked)mat.visible=!!v;\n                    }\n                };\n                proxies[label]=proxy;\n                map[label]=[proxy];\n                map[label].state=!layer.off;\n            }\n            this.manabiProxies.push(proxies);\n            return map;\n        }\n        let map = this.renderLayers(layers, group);");
// Map any selected slice position to the nearest pre-rendered sample.
// Large models can still use the ordinary layer slider; sampled positions
// are an explicit visual approximation, never a change to print geometry.
const beforeSampleMapping=`        this.lastVis=null;
        for(const index of [...wanted].sort((a,b)=>a-b)) {`;
const afterSampleMapping=`        if(!this.manabiAvailable) {
            this.manabiAvailable=this.manabiSources.map((source,i)=>
                source?.layers && Object.keys(source.layers).length ? i : -1
            ).filter(i=>i>=0);
        }
        if(this.manabiAvailable.length && this.manabiAvailable.length<count) {
            const normalized=new Set();
            for(const position of wanted) {
                let nearest=this.manabiAvailable[0];
                for(const sample of this.manabiAvailable) {
                    if(Math.abs(sample-position)<Math.abs(nearest-position))nearest=sample;
                }
                normalized.add(nearest);
            }
            wanted.clear();
            for(const sample of normalized)wanted.add(sample);
        }
        this.lastVis=null;
        for(const index of [...wanted].sort((a,b)=>a-b)) {`;
if(stack.split(beforeSampleMapping).length!==2)throw Error('Upstream lazy Stack view selection changed');
stack=stack.replace(beforeSampleMapping,afterSampleMapping);
fs.writeFileSync(stackName,stack);
console.log('Patched Kiri STL bridge, WebKit workers, and nonfatal OPFS startup.');
