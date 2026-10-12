const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function camera(file){
 const pointer={},keyboard={};
 const canvas={clientWidth:1200,clientHeight:800,style:{},classList:{add(){},remove(){}},getContext:()=>({}),focus(){},setPointerCapture(){},getBoundingClientRect:()=>({left:0,top:0}),addEventListener:(name,fn)=>pointer[name]=fn};
 const context=vm.createContext({document:{getElementById:()=>canvas},devicePixelRatio:1,ResizeObserver:class{observe(){}},addEventListener:(name,fn)=>keyboard[name]=fn});
 vm.runInContext(fs.readFileSync(path.join(__dirname,file),'utf8'),context);
 const run=code=>vm.runInContext(code,context);
 run('cameraLocked=false;Object.assign(cam,{x:80,y:15,z:90,yaw:-2,pitch:-.2,speed:54});look.yaw=cam.yaw;look.pitch=cam.pitch;');
 return {run,pointer,keyboard,state:()=>JSON.parse(run('JSON.stringify({cam,look,vel,wheelImpulse})'))};
}
const actual=()=>camera('../dist/cartographer/camera.js');
const reference=()=>camera('fixtures/reference-camera.js');
for(const fps of [30,60,120])test(`camera movement matches the original Cartographer at ${fps}fps`,()=>{
 const a=actual(),b=reference();
 for(const c of [a,b]){
  c.pointer.pointerdown({button:0,pointerType:'mouse',clientX:0,clientY:0,pointerId:1});
  c.pointer.pointermove({pointerType:'mouse',buttons:1,clientX:1400,clientY:-75});
  c.pointer.pointerup({});
 }
 for(let frame=1;frame<=fps*4;frame++){
  for(const c of [a,b]){
   if(frame===1)c.keyboard.keydown({code:'KeyW',target:{tagName:'CANVAS'},preventDefault(){}});
   if(frame===fps)c.keyboard.keydown({code:'KeyD',target:{tagName:'CANVAS'},preventDefault(){}});
   if(frame===fps*2){c.keyboard.keyup({code:'KeyW'});c.pointer.wheel({deltaY:-100,shiftKey:false,preventDefault(){}});}
   if(frame===fps*3){c.keyboard.keyup({code:'KeyD'});c.keyboard.keydown({code:'ShiftLeft',target:{tagName:'CANVAS'},preventDefault(){}});}
   c.run(`step(${frame*1000/fps})`);
  }
  assert.deepEqual(a.state(),b.state(),`reference movement differs at frame ${frame}`);
 }
 assert.ok(a.state().look.yaw>0,'free-look is not limited to an orbit hemisphere');
});
test('forms and fixed 2D view do not trigger flight; lost capture ends dragging',()=>{
 const c=actual();const before=c.state();
 c.keyboard.keydown({code:'KeyW',target:{tagName:'TEXTAREA'},preventDefault(){}});
 c.run('step(16)');assert.deepEqual(c.state().cam,before.cam);
 c.run('cameraLocked=true');c.pointer.wheel({deltaY:-500,preventDefault(){}});
 c.keyboard.keydown({code:'KeyW',target:{tagName:'CANVAS'},preventDefault(){}});c.run('step(32)');assert.deepEqual(c.state().cam,before.cam);
 c.run('cameraLocked=false');c.pointer.pointerdown({button:0,pointerType:'mouse',clientX:0,clientY:0,pointerId:1});c.pointer.lostpointercapture({});c.pointer.pointermove({pointerType:'mouse',buttons:1,clientX:800,clientY:0});assert.equal(c.state().look.yaw,before.look.yaw);
});
test('return home clears inertia, wheel impulse and held keys',()=>{
 const c=actual();c.run('Object.assign(HOME,cam);keys.KeyW=true;wheelImpulse=200;step(16);');c.pointer.dblclick();
 const home=c.state();for(let i=2;i<100;i++)c.run(`step(${i*16})`);
 assert.deepEqual(c.state().cam,home.cam);assert.deepEqual(c.state().vel,{x:0,y:0,z:0});assert.equal(c.state().wheelImpulse,0);
});
