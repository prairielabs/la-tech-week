const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=name=>fs.readFileSync(path.join(__dirname,'../dist/cartographer',name),'utf8');
function scene(width,height,app=source('app.js')){
 const listeners={};
 const canvas={clientWidth:width,clientHeight:height,dataset:{},style:{},classList:{add(){},remove(){}},getContext:()=>({}),addEventListener:(name,fn)=>{listeners[name]=fn;}};
 const context=vm.createContext({document:{getElementById:()=>canvas},devicePixelRatio:1,ResizeObserver:class{observe(){}},addEventListener(){}});
 vm.runInContext(source('camera.js'),context);
 vm.runInContext(`const state={mode:'stack',frame:'county'};let frameOffset={x:0,y:0},mapCentre={},mapScale=1,mapBaseScale=1,mapZoom=1;const points=[],anchors=[];const bodyRings=[{front:[{x:-110,y:-45,z:-75},{x:-110,y:45,z:75}],back:[{x:110,y:-45,z:-75},{x:110,y:45,z:75}]}];`,context);
 vm.runInContext(app.slice(app.indexOf('function homePose('),app.indexOf('function watchLabel(')),context);
 vm.runInContext(source('geography.js'),context);
 return {run:code=>vm.runInContext(code,context),reset:()=>listeners.dblclick()};
}
for(const [width,height] of [[1600,836],[375,700]]){
 test(`3D home and reset preserve east-right, north-up at ${width}px`,()=>{
  const s=scene(width,height);
  const check=()=>{
   const p=s.run(`[{x:0,y:0,z:-20},{x:0,y:0,z:20},{x:0,y:-20,z:0},{x:0,y:20,z:0}].map(p=>toScreen(view(p)))`);
   assert.ok(p[0].sx<p[1].sx,'east must appear right of west');
   assert.ok(p[3].sy<p[2].sy,'north must appear above south');
  };
  s.run('homePose("stack")');check();
  s.run('cam.yaw=2;cam.x=-90');s.reset();check();
  s.run('homePose("stack",true)');check();
  s.run('homePose("map");homePose("stack")');check();
  const places=s.run(`(()=>{const origin=utm11(-118.3,34);return [[-118.7798,34.0259],[-118.4912,34.0195],[-118.1937,33.7701]].map(([lon,lat])=>{const p=utm11(lon,lat);return toScreen(view({x:0,y:(p.n-origin.n)/1000,z:(p.e-origin.e)/1000}));});})()`);
  assert.ok(places[0].sx<places[1].sx && places[1].sx<places[2].sx,'Malibu, Santa Monica, Long Beach must run west to east');
 });
}
