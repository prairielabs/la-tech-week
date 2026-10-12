/* Original Semantic Field Cartographer camera, Copyright (c) 2026 Prairie Labs, Inc. MIT; see LICENSE. Reference commit f6171131dfee43f288962668be488dc7262a82e9. */
const cv = document.getElementById("c"), ctx = cv.getContext("2d");
/* The camera has a target and a state. Input moves the target; the state
   eases toward it every frame, so looking and moving feel like mass, not
   like a switch. All rates are per second — frame rate does not change the
   feel. */
const cam = { x: 0, y: 18, z: -170, yaw: 0, pitch: -0.08, speed: 54 };   // world units / s
const look = { yaw: cam.yaw, pitch: cam.pitch };                          // look target
const vel = { x: 0, y: 0, z: 0 };                                          // move velocity
const HOME = { x: 0, y: 18, z: -170, yaw: 0, pitch: -0.08 };
const ACCEL = 9, DAMP = 6.5, LOOK_EASE = 14, LOOK_GAIN = 0.0032, WHEEL_GAIN = 0.55;
const keys = {};
let dragging = false, lastX = 0, lastY = 0, mouseX = -1, mouseY = -1, wheelImpulse = 0;

function resize() { cv.width = cv.clientWidth * devicePixelRatio; cv.height = cv.clientHeight * devicePixelRatio; }
new ResizeObserver(resize).observe(cv);
addEventListener("resize", resize);

/* pointer events: mouse, pen, and touch share one path */
cv.addEventListener("pointerdown", e => {
  if (e.button !== 0 && e.pointerType === "mouse") return;
  dragging = true; cv.classList.add("dragging");
  lastX = e.clientX; lastY = e.clientY;
  cv.setPointerCapture(e.pointerId);
});
const endDrag = () => { dragging = false; cv.classList.remove("dragging"); };
cv.addEventListener("pointerup", endDrag);
cv.addEventListener("pointercancel", endDrag);
cv.addEventListener("pointermove", e => {
  if (dragging) {
    look.yaw   += (e.clientX - lastX) * LOOK_GAIN;
    look.pitch -= (e.clientY - lastY) * LOOK_GAIN;
    look.pitch = Math.max(-1.5, Math.min(1.5, look.pitch));
    lastX = e.clientX; lastY = e.clientY;
  }
  const r = cv.getBoundingClientRect();
  mouseX = (e.clientX - r.left) * devicePixelRatio; mouseY = (e.clientY - r.top) * devicePixelRatio;
});
cv.addEventListener("pointerleave", () => { if (!dragging) { mouseX = -1; mouseY = -1; } });
cv.addEventListener("wheel", e => { e.preventDefault(); wheelImpulse -= e.deltaY * WHEEL_GAIN * (e.shiftKey ? 4 : 1); }, { passive: false });
cv.addEventListener("dblclick", () => { Object.assign(cam, HOME); look.yaw = HOME.yaw; look.pitch = HOME.pitch; vel.x = vel.y = vel.z = 0; });
cv.style.touchAction = "none";

addEventListener("keydown", e => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  if (e.code === "Space") e.preventDefault();
  keys[e.code] = true;
  if (e.code === "KeyR") { Object.assign(cam, HOME); look.yaw = HOME.yaw; look.pitch = HOME.pitch; vel.x = vel.y = vel.z = 0; }
});
addEventListener("keyup",   e => { keys[e.code] = false; });
addEventListener("blur", () => { for (const k in keys) keys[k] = false; });

function view(p) { // world → camera space
  let dx = p.x - cam.x, dy = p.y - cam.y, dz = p.z - cam.z;
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  let x = dx * cy - dz * sy, z = dx * sy + dz * cy;
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  let y = dy * cp - z * sp;  z = dy * sp + z * cp;
  return { x, y, z };
}
function toScreen(v) {
  const f = cv.height * .9;
  return { sx: cv.width / 2 + f * v.x / v.z, sy: cv.height / 2 - f * v.y / v.z };
}

let lastT = 0;
function step(t) {
  const dt = Math.min(0.05, lastT ? (t - lastT) / 1000 : 1 / 60); lastT = t;
  // look: ease toward the target
  const k = 1 - Math.exp(-LOOK_EASE * dt);
  cam.yaw   += (look.yaw - cam.yaw) * k;
  cam.pitch += (look.pitch - cam.pitch) * k;
  // move: keys and wheel push, damping pulls
  const fwd = { x: Math.sin(cam.yaw), z: Math.cos(cam.yaw) };
  const boost = keys["ShiftLeft"] || keys["ShiftRight"] ? 0 : 1; // Shift is "sink", not sprint
  let ax = 0, ay = 0, az = 0;
  if (keys["KeyW"] || keys["ArrowUp"])    { ax += fwd.x; az += fwd.z; }
  if (keys["KeyS"] || keys["ArrowDown"])  { ax -= fwd.x; az -= fwd.z; }
  if (keys["KeyA"] || keys["ArrowLeft"])  { ax -= fwd.z; az += fwd.x; }
  if (keys["KeyD"] || keys["ArrowRight"]) { ax += fwd.z; az -= fwd.x; }
  if (keys["Space"] || keys["KeyQ"]) ay += 1;
  if (keys["ShiftLeft"] || keys["ShiftRight"] || keys["KeyE"]) ay -= 1;
  const len = Math.hypot(ax, ay, az) || 1;
  vel.x += (ax / len) * cam.speed * ACCEL * dt;
  vel.y += (ay / len) * cam.speed * ACCEL * dt;
  vel.z += (az / len) * cam.speed * ACCEL * dt;
  if (wheelImpulse) { vel.x += fwd.x * wheelImpulse * dt * 8; vel.z += fwd.z * wheelImpulse * dt * 8; wheelImpulse *= Math.exp(-10 * dt); if (Math.abs(wheelImpulse) < 0.5) wheelImpulse = 0; }
  const damp = Math.exp(-DAMP * dt);
  vel.x *= damp; vel.y *= damp; vel.z *= damp;
  const vmax = cam.speed * 1.6 * (boost || 1);
  const vlen = Math.hypot(vel.x, vel.y, vel.z);
  if (vlen > vmax) { vel.x *= vmax / vlen; vel.y *= vmax / vlen; vel.z *= vmax / vlen; }
  cam.x += vel.x * dt; cam.y += vel.y * dt; cam.z += vel.z * dt;
}

