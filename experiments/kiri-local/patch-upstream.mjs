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
fs.writeFileSync(syncName,sync);
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
console.log('Patched Kiri STL bridge, WebKit workers, and nonfatal OPFS startup.');
