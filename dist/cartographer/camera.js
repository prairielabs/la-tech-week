/* Camera adapted from Semantic Field Cartographer; Copyright 2026 Prairie Labs, Inc. MIT; see LICENSE. Host manages home framing. */
const cv = document.getElementById('c'), ctx = cv.getContext('2d');
const cam = { x: 0, y: 85, z: -110, yaw: -1.15, pitch: -.2 };
const look = { yaw: cam.yaw, pitch: cam.pitch };
const HOME = { ...cam };
const keys = {};
const orbit = { distance: 300, radius: 150, front: 110, maxDistance: 1800 };
const LOOK_EASE = 14, LOOK_GAIN = .0032;
let cameraLocked = true;
let dragging = false, lastX = 0, lastY = 0, mouseX = -1, mouseY = -1;

function resize() { cv.width = cv.clientWidth * devicePixelRatio; cv.height = cv.clientHeight * devicePixelRatio; }
new ResizeObserver(resize).observe(cv);
addEventListener('resize', resize);

// Stay on the geographic front of every time slice. Orbiting changes the
// viewpoint, never the world coordinates, and zoom cannot pass through it.
function constrainLook() {
  look.yaw = Math.max(-Math.PI + .35, Math.min(-.35, look.yaw));
  look.pitch = Math.max(-.6, Math.min(.6, look.pitch));
}
function orbitMinimum(yaw = cam.yaw, pitch = cam.pitch) {
  return Math.max(orbit.radius * 1.12, (orbit.front + 25) / (-Math.sin(yaw) * Math.cos(pitch)));
}
function positionOrbit() {
  orbit.distance = Math.max(orbitMinimum(), Math.min(orbit.maxDistance, orbit.distance));
  cam.x = -Math.sin(cam.yaw) * Math.cos(cam.pitch) * orbit.distance;
  cam.y = -Math.sin(cam.pitch) * orbit.distance;
  cam.z = -Math.cos(cam.yaw) * Math.cos(cam.pitch) * orbit.distance;
}
function setOrbitHome(shape) {
  orbit.radius = Math.max(1, ...shape.map(p => Math.hypot(p.x, p.y, p.z)));
  orbit.front = Math.max(0, ...shape.map(p => p.x));
  orbit.distance = Math.hypot(cam.x, cam.y, cam.z);
  orbit.maxDistance = Math.max(orbit.distance * 3, orbit.radius * 6);
  positionOrbit();
  Object.assign(HOME, cam);
  for (const k in keys) keys[k] = false;
}
function zoomOrbit(factor) {
  orbit.distance = Math.max(orbitMinimum(), Math.min(orbit.maxDistance, orbit.distance * factor));
  positionOrbit();
}
function resetCamera() {
  Object.assign(cam, HOME); look.yaw = HOME.yaw; look.pitch = HOME.pitch;
  orbit.distance = Math.hypot(HOME.x, HOME.y, HOME.z);
  for (const k in keys) keys[k] = false;
  dragging = false; cv.classList.remove('dragging');
}
const endDrag = () => { dragging = false; cv.classList.remove('dragging'); };
cv.addEventListener('pointerdown', e => {
  if (cameraLocked || (e.button !== 0 && e.pointerType === 'mouse')) return;
  dragging = true; cv.classList.add('dragging'); cv.focus();
  lastX = e.clientX; lastY = e.clientY; cv.setPointerCapture(e.pointerId);
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) cv.addEventListener(name, endDrag);
cv.addEventListener('pointermove', e => {
  if (dragging && e.pointerType === 'mouse' && e.buttons === 0) endDrag();
  if (dragging && !cameraLocked) {
    look.yaw += (e.clientX - lastX) * LOOK_GAIN;
    look.pitch -= (e.clientY - lastY) * LOOK_GAIN;
    constrainLook(); lastX = e.clientX; lastY = e.clientY;
  }
  const r = cv.getBoundingClientRect();
  mouseX = (e.clientX - r.left) * devicePixelRatio; mouseY = (e.clientY - r.top) * devicePixelRatio;
});
cv.addEventListener('pointerleave', () => { if (!dragging) mouseX = mouseY = -1; });
cv.addEventListener('wheel', e => {
  if (cameraLocked) return;
  e.preventDefault(); zoomOrbit(Math.exp(Math.max(-200, Math.min(200, e.deltaY)) * .0015));
}, { passive: false });
cv.addEventListener('dblclick', resetCamera);
cv.style.touchAction = 'none';
addEventListener('keydown', e => {
  if (['INPUT','SELECT','TEXTAREA','BUTTON','A'].includes(e.target.tagName) || cameraLocked) return;
  if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
  if (e.code === 'KeyR') resetCamera();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; endDrag(); });

function view(p) {
  let dx = p.x - cam.x, dy = p.y - cam.y, dz = p.z - cam.z;
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  let x = dx * cy - dz * sy, z = dx * sy + dz * cy;
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  let y = dy * cp - z * sp; z = dy * sp + z * cp;
  return { x, y, z };
}
function toScreen(v) {
  const f = cv.height * .9;
  return { sx: cv.width / 2 + f * v.x / v.z, sy: cv.height / 2 - f * v.y / v.z };
}
let lastT = 0;
function step(t) {
  if (cameraLocked) return;
  const dt = Math.min(.05, lastT ? (t - lastT) / 1000 : 1 / 60); lastT = t;
  if (keys.KeyA || keys.ArrowLeft) look.yaw -= dt;
  if (keys.KeyD || keys.ArrowRight) look.yaw += dt;
  if (keys.KeyQ || keys.Space) look.pitch += dt * .7;
  if (keys.KeyE || keys.ShiftLeft || keys.ShiftRight) look.pitch -= dt * .7;
  constrainLook();
  const k = 1 - Math.exp(-LOOK_EASE * dt);
  cam.yaw += (look.yaw - cam.yaw) * k;
  cam.pitch += (look.pitch - cam.pitch) * k;
  if (keys.KeyW || keys.ArrowUp) orbit.distance *= Math.exp(-dt);
  if (keys.KeyS || keys.ArrowDown) orbit.distance *= Math.exp(dt);
  positionOrbit();
}
