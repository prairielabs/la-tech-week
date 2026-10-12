const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=name=>fs.readFileSync(path.join(__dirname,'../dist/cartographer',name),'utf8');
function scene(width,height,app=source('app.js')){
 const listeners={},keyboard={};
 const canvas={clientWidth:width,clientHeight:height,dataset:{},style:{},classList:{add(){},remove(){}},getContext:()=>({}),focus(){},setPointerCapture(){},getBoundingClientRect:()=>({left:0,top:0}),addEventListener:(name,fn)=>{listeners[name]=fn;}};
 const context=vm.createContext({document:{getElementById:()=>canvas},devicePixelRatio:1,ResizeObserver:class{observe(){}},addEventListener:(name,fn)=>{keyboard[name]=fn;}});
 vm.runInContext(source('camera.js'),context);
 vm.runInContext(`const state={mode:'stack',frame:'county'};const heightScale=220;let frameOffset={x:0,y:0},mapCentre={},mapScale=1,mapBaseScale=1,mapZoom=1;const points=[],anchors=[];const bodyRings=[{front:[{x:-110,y:-45,z:-75},{x:-110,y:45,z:75}],back:[{x:110,y:-45,z:-75},{x:110,y:45,z:75}]}];`,context);
 vm.runInContext(app.slice(app.indexOf('function homePose('),app.indexOf('function watchLabel(')),context);
 vm.runInContext(source('geography.js'),context);
 if(app.includes('function timeDepth('))vm.runInContext(app.slice(app.indexOf('function timeDepth('),app.indexOf('function world(')),context);
 return {run:code=>vm.runInContext(code,context),reset:()=>listeners.dblclick(),pointer:(name,event)=>listeners[name](event),key:(name,event)=>keyboard[name](event)};
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

for(const [width,height] of [[1600,836],[375,700]]){
 test(`drag, wheel, zoom buttons and held keys cannot mirror or enter the map at ${width}px`,()=>{
  const s=scene(width,height);
  s.run('homePose("stack");cameraLocked=false');
  let clock=0;
  const settle=()=>{for(let i=0;i<160;i++)s.run(`step(${clock+=16})`);};
  const check=()=>{
   const p=s.run(`[-110,0,110].map(x=>({east:[{x,y:0,z:-30},{x,y:0,z:30}].map(p=>toScreen(view(p))),north:[{x,y:-30,z:0},{x,y:30,z:0}].map(p=>toScreen(view(p))),corners:[-45,45].flatMap(y=>[-75,75].map(z=>view({x,y,z}).z))}))`);
   for(const plane of p){
    assert.ok(plane.east[0].sx<plane.east[1].sx,'every time slice stays east-right after navigation');
    assert.ok(plane.north[1].sy<plane.north[0].sy,'every time slice stays north-up after navigation');
    assert.ok(plane.corners.every(z=>z>3),'zoom cannot enter or clip through the map');
   }
  };
  for(const dx of [1000,-1000,100000,-100000])for(const dy of [100000,-100000]){
   s.pointer('pointerdown',{button:0,pointerType:'mouse',clientX:0,clientY:0,pointerId:1});
   s.pointer('pointermove',{pointerType:'mouse',buttons:1,clientX:dx,clientY:dy});
   s.pointer('pointerup',{});settle();check();
   for(let i=0;i<100;i++)s.pointer('wheel',{deltaY:-10000,preventDefault(){}});
   check();s.run('zoomOrbit(.000001)');check();s.run('zoomOrbit(1000000)');check();
  }
  for(const code of ['KeyW','KeyA','KeyD','KeyQ','KeyE','KeyS']){
   s.key('keydown',{code,target:{tagName:'CANVAS'},preventDefault(){}});settle();check();
   s.key('keyup',{code});
  }
  s.pointer('pointerdown',{button:0,pointerType:'mouse',clientX:0,clientY:0,pointerId:1});
  s.pointer('lostpointercapture',{});
  const before=s.run('look.yaw');s.pointer('pointermove',{pointerType:'mouse',buttons:1,clientX:1000,clientY:0});
  assert.equal(s.run('look.yaw'),before,'lost capture must stop dragging');
  s.reset();check();
 });
}

test('Monday geography is in front and the week extends behind it',()=>{
 const s=scene(1600,836);s.run('homePose("stack")');
 const projected=s.run('Array.from({length:8},(_,day)=>{const p=view({x:timeDepth(day/7),y:0,z:0});return {...toScreen(p),depth:p.z};})');
 for(let i=1;i<projected.length;i++){
  assert.ok(projected[i].depth>projected[i-1].depth,'later dates recede behind the first map');
  assert.ok(projected[i].sx>projected[i-1].sx,'timeline proceeds left to right at home');
 }
});
