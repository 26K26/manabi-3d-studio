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
// Kiri's default startup eagerly spawns four minion workers. Its large
// worker bundles add memory pressure inside WebKit's embedded browsing
// context (iPad/iPhone/Safari). Fall back to single-worker slicing there.
const syncName=path.join(upstream,'src/kiri/app/init/sync.js');
let sync=fs.readFileSync(syncName,'utf8');
const before='    preferences.setThreaded(true);';
const n=sync.split(before).length-1;
if(n!==1)throw Error('Kiri thread configuration moved: '+n);
sync=sync.replace(before,`    // Embedded WebKit: avoid eager 4-minion pool; core slice worker remains active.
    const safariLike = /AppleWebKit/i.test(navigator.userAgent) && !/Chrom(?:e|ium)|Edg/i.test(navigator.userAgent);
    preferences.setThreaded(!safariLike);`);
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
work=work.replace(oldConcurrent,`concurrent = (/AppleWebKit/i.test(self.navigator?.userAgent||'') && !/Chrom(?:e|ium)|Edg/i.test(self.navigator?.userAgent||'')) ? 1 : Math.round(Math.max(4, self.Worker && ccvalue > 3 ? ccvalue * 0.75 : 0)),`);
// Run per-layer slicing in the *main worker* if WebKit has no minion
// pool. Kiri's upstream minwork.sliceZ rejects when concurrent < 2,
// causing slice to remain at 0% and never emit slice.end.
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
console.log('Patched Kiri STL bridge, WebKit workers, and nonfatal OPFS startup.');
