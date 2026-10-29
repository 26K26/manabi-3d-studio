// Manabi 3D Studio — school printer profiles and local preflight.
// Pure JavaScript: no accounts, requests, paid APIs, or external services.
// These are build envelopes only. Machine-specific G-code is NOT verified.
export const DEFAULT_PRINTER = 'a1mini';
export const PRINTERS = Object.freeze({
  a1mini: Object.freeze({id:'a1mini',label:'Bambu Lab A1 mini',bed:Object.freeze({x:180,y:180,z:180}),nozzle:0.4,editable:false,verified:false,exportTarget:'gcode.3mf'}),
  generic: Object.freeze({id:'generic',label:'汎用FDM（220 × 220 × 250の例）',bed:Object.freeze({x:220,y:220,z:250}),nozzle:0.4,editable:false,verified:false,exportTarget:'gcode'}),
  custom: Object.freeze({id:'custom',label:'学校のプリンター（寸法を指定）',bed:Object.freeze({x:200,y:200,z:200}),nozzle:0.4,editable:true,verified:false,exportTarget:'unknown'})
});
const axes=['x','y','z'];
const finitePositive=(v,min,max)=>Number.isFinite(Number(v))&&Number(v)>=min&&Number(v)<=max;
export function schoolSettings(id=DEFAULT_PRINTER, overrides={}){
  const preset=PRINTERS[id];
  if(!preset)throw Error('未対応のプリンター設定です');
  const bed=preset.editable ? {...preset.bed,...overrides.bed}: {...preset.bed};
  const height=overrides.height===undefined?0.2:Number(overrides.height);
  if(axes.some(axis=>!finitePositive(bed[axis],1,1000)))throw Error('造形サイズは1〜1000mmで指定してください');
  if(!finitePositive(height,0.04,1))throw Error('積層高さは0.04〜1mmで指定してください');
  return {id:preset.id,label:preset.label,bed:Object.fromEntries(axes.map(a=>[a,Number(bed[a])])),height,nozzle:preset.nozzle,verified:false};
}
export function assessBuildEnvelope(extents,settings){
  const size=Object.fromEntries(axes.map(a=>[a,Number(extents[a])]));
  if(axes.some(a=>!Number.isFinite(size[a])||size[a]<=0))
    return {ok:false,size,over:axes,estimatedLayers:null,warning:'モデルの大きさを確認できませんでした'};
  const over=axes.filter(a=>size[a]>settings.bed[a]+0.001);
  const estimatedLayers=Math.ceil(size.z/settings.height);
  return {ok:!over.length,size,over,estimatedLayers,
    warning:over.length ? '造形範囲を超えています' : estimatedLayers>700 ?
      '層数が多いため、端末によってはスライスに時間・メモリが必要です' : ''};
}
export function formatEnvelope(extents){
  return axes.map(a=>Number(extents[a]).toFixed(1)).join(' × ')+' mm';
}
