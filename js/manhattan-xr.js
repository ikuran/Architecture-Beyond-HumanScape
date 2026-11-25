// ---------------------------------------------------------------------------
// Glue between the Lower Manhattan climate scene (index.html, global `MX`) and the
// Quest 3 hand-tracking locomotion kit (gestures / locomotion / hand-tracking / xr-manager).
//
//  - The city is true-scale: 1 world metre = 1 real metre (the scene group `world` is
//    scaled by 0.759 horizontally because model x/z are Web-Mercator units; y is metres).
//    So VR is 1:1 human eye level, not 1:70.
//  - The user lives in rig > xrSpace > camera. Only the rig moves; head and hand poses
//    are never scaled (same rule as the original project).
//  - Walking is blocked by building footprints and open water using the same grid the
//    simulation uses (MX.walkFree).
// ---------------------------------------------------------------------------
import { LOCOMOTION, GESTURES, VIEW_MODES } from './config.js';
import { GestureEngine } from './gestures.js';
import { Locomotion, forwardFromQuaternion } from './locomotion.js';
import { XRManager } from './xr-manager.js';
import { XRHandTracker } from './hand-tracking.js';
import { DesktopHands } from './desktop-hands.js';
import { StatusHUD } from './hud.js';

const MX = window.MX;
const THREE = MX.THREE;
const { renderer, scene, camera, world, REAL } = MX;
const $ = (id) => document.getElementById(id);

// ---- UI (injected into the existing panel) --------------------------------
document.getElementById('lookc').insertAdjacentHTML('beforebegin', `
<details class="card" id="xrbox" open><summary>VR &amp; hand tracking</summary>
  <div class="row"><button id="xr-vr">Enter VR</button><button id="xr-cam">Start camera hands</button><button id="xr-stop" disabled>Stop</button></div>
  <label class="chk"><input id="xr-turnwalk" type="checkbox"> Allow turning while walking</label>
  <div class="sub">Quest 3: open this page over HTTPS in Quest Browser, set the scene (year, storm, lighting) in this panel, then Enter VR. Pinch thumb + index = walk, thumb + pinky = turn right, thumb + ring = turn left.</div>
  <div id="xrdbg">VR: checking…</div></details>`);
document.body.insertAdjacentHTML('beforeend', `
<div id="xrnote"></div>
<div id="xrcam"><video id="xrvideo" playsinline muted></video><canvas id="xroverlay"></canvas></div>
<div id="xrmodal"><div class="c"><b>Camera permission</b><p>Your webcam is used to detect hand gestures. Images are processed only in this browser with MediaPipe and are never uploaded or saved. The library and hand model download from jsDelivr and Google Storage.</p>
<div class="row"><button id="xr-no">Cancel</button><button id="xr-yes">Start camera</button></div></div></div>`);
let noteT = 0;
function notify(msg, ms = 6000) { const n = $('xrnote'); n.textContent = msg; n.style.display = 'block'; clearTimeout(noteT); if (ms) noteT = setTimeout(() => { n.style.display = 'none'; }, ms); }

// ---- rig ------------------------------------------------------------------
const rig = new THREE.Group(); rig.name = 'rig';
const xrSpace = new THREE.Group(); xrSpace.name = 'xrSpace';
rig.add(xrSpace);
const xr = new XRManager(renderer, xrSpace);
const xrHands = new XRHandTracker(xrSpace);
const hud = new StatusHUD(camera);
const desktopHands = new DesktopHands($('xrvideo'), $('xroverlay'));
const gestures = new GestureEngine({ ...GESTURES });
const loco = new Locomotion(rig);
loco.setViewScale(VIEW_MODES.human.viewScale);
const st = { warn: '', t0: 0, head: { position: { x: 0, y: 1.6, z: 0 }, forward: { x: 0, y: 0, z: -1 } }, lastXR: null, fps: 0, frames: 0, fpsT: performance.now(), dbgT: 0, source: '—' };

// ---- helpers ----------------------------------------------------------------
const local = (x, z) => ({ x: x / REAL, z: z / REAL });
const free = (xw, zw) => { const l = local(xw, zw); return MX.walkFree(l.x, l.z); };
function nearestFree(x, z) {
  if (MX.walkFree(x, z)) return { x, z };
  for (let r = 1; r <= 80; r++) for (let a = 0; a < 16; a++) {
    const xx = x + Math.cos((a / 16) * 6.2832) * r * 12, zz = z + Math.sin((a / 16) * 6.2832) * r * 12;
    if (MX.walkFree(xx, zz)) return { x: xx, z: zz };
  }
  return { x, z };
}
function spawnPoint() {
  const pick = MX.getLastPick();
  if (MX.getWalk()) return { x: camera.position.x, z: camera.position.z, yaw: camera.rotation.y };
  if (pick) return { ...nearestFree(pick.x, pick.z), yaw: Math.atan2(-(camera.position.x - pick.x), -(camera.position.z - pick.z)) };
  const P = MX.PLACES[0]; return { ...nearestFree(P[1], P[2]), yaw: P[3] };
}
function headLocalFromCamera() {
  const q = camera.quaternion;
  return { position: { x: camera.position.x + xrSpace.position.x, y: camera.position.y + xrSpace.position.y, z: camera.position.z + xrSpace.position.z }, forward: forwardFromQuaternion(q) };
}
function headFromXR(frame, ref) {
  const pose = frame.getViewerPose(ref); if (!pose) return null;
  const p = pose.transform.position, o = pose.transform.orientation;
  return { position: { x: p.x + xrSpace.position.x, y: p.y + xrSpace.position.y, z: p.z + xrSpace.position.z }, forward: forwardFromQuaternion(o) };
}

/** One locomotion step with collision against buildings and open water. */
function stepLocomotion(cmd, dt, head) {
  const h0 = loco.headWorld(head.position), p0x = rig.position.x, p0z = rig.position.z;
  loco.update(cmd, dt, head);
  const dx = rig.position.x - p0x, dz = rig.position.z - p0z;
  if (dx || dz) {
    const nx = h0.x + dx, nz = h0.z + dz;
    if (!free(nx, nz)) {
      let ax = 0, az = 0;
      if (free(h0.x + dx, h0.z)) ax = dx; else if (free(h0.x, h0.z + dz)) az = dz;
      rig.position.x = p0x + ax; rig.position.z = p0z + az; loco.currentSpeed = Math.hypot(ax, az) / Math.max(dt, 1e-3);
    }
  }
}
function placeUser(x, z, yaw) { loco.placeHeadAt(x * REAL, z * REAL, yaw, st.head.position); rig.position.y = 0; }

// ---- XR lifecycle -----------------------------------------------------------
function enterRig() {
  scene.add(rig); xrSpace.add(camera);
  MX.setXRMode(true);
  if (!xrHands.mesh.parent) xrSpace.add(xrHands.mesh);
}
function leaveRig() {
  const hw = loco.headWorld(st.head.position);
  xrSpace.remove(camera); scene.add(camera); scene.remove(rig);
  MX.setXRMode(false);
  const lx = hw.x / REAL, lz = hw.z / REAL;
  camera.rotation.set(0, 0, 0);
  MX.setLastPick(lx, lz); MX.camView('three');
}
xr.addEventListener('sessionstart', () => {
  desktopHands.stop(); $('xrcam').style.display = 'none'; MX.TK.f = 0; MX.TK.t = 0;
  const sp = spawnPoint();
  enterRig();
  camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0); camera.quaternion.identity();
  gestures.reset(); loco.stop(); xrHands.reset(); hud.visible = true; st.warn = ''; st.t0 = performance.now(); st.aligned = false;
  st.spawn = sp; rig.position.set(sp.x * REAL, 0, sp.z * REAL); rig.rotation.y = sp.yaw;
  buttons();
});
xr.addEventListener('sessionend', () => { hud.visible = false; xrHands.reset(); gestures.reset(); loco.stop(); leaveRig(); buttons(); if (st.warn) notify('VR ended. ' + st.warn, 8000); });
xr.addEventListener('error', (e) => notify(e.detail.message, 9000));
xr.addEventListener('warning', (e) => { st.warn = 'Hand tracking is off'; notify(e.detail.message, 9000); });
xr.addEventListener('statechange', buttons);

function handWarnings(now) {
  if (now - st.t0 < 4000) return;
  if (xrHands.handsSeen) { if (st.warn !== 'Hand tracking is off') st.warn = ''; return; }
  st.warn = xr.handTrackingEnabled === false ? 'Hand tracking is off' : xrHands.controllersSeen ? 'Put the controllers down' : 'No hands detected';
}

MX.onXRFrame = (frame) => {
  const now = performance.now(), dt = Math.min(0.1, (now - (st.prev || now)) / 1000); st.prev = now;
  const ref = renderer.xr.getReferenceSpace();
  if (!frame || !ref) return;
  const hands = xrHands.update(frame, ref, gestures.lastResult);
  const head = headFromXR(frame, ref) || st.head; st.head = head; st.source = 'WebXR hand tracking';
  handWarnings(now);
  if (!st.aligned && head !== st.head0 && st.spawn) { // place the head (not the rig origin) on the spawn point
    const localYaw = Math.atan2(-head.forward.x, -head.forward.z);
    loco.placeHeadAt(st.spawn.x * REAL, st.spawn.z * REAL, st.spawn.yaw - localYaw, head.position); rig.position.y = 0; st.aligned = true;
  }
  const g = gestures.update(hands, now);
  stepLocomotion({ forward: g.forward, turn: g.turn }, dt, head);
  const action = g.turn < 0 ? 'turnRight' : g.turn > 0 ? 'turnLeft' : g.forward ? 'forward' : 'none';
  hud.update({ action, hands: hands.filter((h) => h.tracked).length, warning: st.warn, scaleLabel: '1:1 city', speed: loco.currentSpeed, turnRate: Math.abs(loco.currentTurnRate) });
  st.g = g; debug(now);
};

// ---- Desktop webcam hands drive the city's first-person walk ---------------------
MX.onFrame = () => {
  const now = performance.now();
  if (desktopHands.running) {
    const hands = desktopHands.update(now, gestures.lastResult); st.source = 'MediaPipe webcam';
    const g = gestures.update(hands, now);
    if ((g.forward || g.turn) && !MX.getWalk()) MX.enterWalk();
    MX.TK.f = g.forward ? 1 : 0; MX.TK.t = g.turn; st.g = g; debug(now);
  } else if (MX.TK.f || MX.TK.t) { MX.TK.f = 0; MX.TK.t = 0; }
};
desktopHands.addEventListener('error', (e) => { notify(e.detail.message, 10000); $('xrcam').style.display = 'none'; });
desktopHands.addEventListener('statechange', () => { $('xrcam').style.display = (desktopHands.state === 'running' || desktopHands.state === 'loading') ? 'block' : 'none'; if (desktopHands.state !== 'running') gestures.reset(); buttons(); });

// ---- UI wiring ---------------------------------------------------------------------
function buttons() {
  const b = $('xr-vr'), p = xr.isPresenting;
  if (xr.state === 'unsupported') { b.disabled = true; b.textContent = 'VR unavailable'; b.title = xr.lastError || ''; }
  else { b.disabled = xr.state === 'starting' || xr.state === 'ending'; b.textContent = p ? 'Exit VR' : xr.state === 'starting' ? 'Starting…' : 'Enter VR'; }
  const cs = desktopHands.state;
  $('xr-cam').disabled = p || cs === 'running' || cs === 'loading'; $('xr-stop').disabled = !(cs === 'running' || cs === 'loading');
  $('xr-cam').textContent = cs === 'loading' ? 'Loading…' : 'Start camera hands';
}
$('xr-vr').onclick = () => (xr.isPresenting ? xr.end() : xr.start());
$('xr-cam').onclick = async () => {
  if (!window.isSecureContext) { notify('The camera needs HTTPS or localhost.'); return; }
  $('xrmodal').style.display = 'flex';
  const ok = await new Promise((res) => { $('xr-yes').onclick = () => res(true); $('xr-no').onclick = () => res(false); });
  $('xrmodal').style.display = 'none';
  if (!ok) return;
  $('xrcam').style.display = 'block'; await desktopHands.start();
  if (desktopHands.running) notify(`Hand tracking started (MediaPipe, ${desktopHands.delegate}). Pinch to walk.`);
};
$('xr-stop').onclick = () => desktopHands.stop();
$('xr-turnwalk').onchange = (e) => { gestures.cfg = { ...GESTURES, allowWalkWhileTurning: e.target.checked }; };
window.addEventListener('pagehide', () => { desktopHands.dispose(); if (xr.session) xr.end(); });

const ACT = { forward: 'forward (thumb + index)', turnRight: 'turn right (thumb + pinky)', turnLeft: 'turn left (thumb + ring)', none: '—' };
function debug(now) {
  st.frames++; if (now - st.fpsT >= 500) { st.fps = (st.frames * 1000) / (now - st.fpsT); st.frames = 0; st.fpsT = now; }
  if (now - st.dbgT < 200) return; st.dbgT = now;
  const g = st.g, tr = g ? g.hands.filter((h) => h.tracked) : [];
  $('xrdbg').textContent = `${xr.isPresenting ? 'immersive-vr (' + (xr.refSpaceType || '?') + ')' : xr.state === 'unsupported' ? 'VR unsupported here' : 'desktop'} · ${st.fps.toFixed(0)} fps\nSource: ${st.source}\nHands: ${tr.length ? tr.map((h) => h.id + (h.active ? '*' : '')).join(', ') : 'none'} · ${g ? (ACT[g.action] || g.action) : '—'}\nSpeed ${loco.currentSpeed.toFixed(2)} m/s${st.warn ? '\n⚠ ' + st.warn : ''}`;
}

(async () => {
  await MX.readyP;
  const ok = await xr.checkSupport(); buttons();
  $('xrdbg').textContent = ok ? 'VR ready. Enter VR on a Quest 3.' : 'VR: ' + (xr.lastError || 'unsupported') + '\nThe webcam hand mode still works on desktop.';
  if (!window.isSecureContext) notify('Not served over HTTPS: VR and the camera are disabled.', 0);
  const q = new URLSearchParams(location.search);
  if (q.get('year')) { MX.setYear(+q.get('year')); MX.renderSim(); }
  if (q.get('look')) MX.setLook(q.get('look'));
  window.__mxxr = { rig, xrSpace, loco, gestures, xr, st, enterRig, leaveRig, stepLocomotion, placeUser, free, spawnPoint };
})();
