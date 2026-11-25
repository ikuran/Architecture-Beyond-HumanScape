import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Locomotion, rotateY, horizontalHeading, forwardFromQuaternion } from '../js/locomotion.js';
import { LOCOMOTION, SCALE, VIEW_MODES } from '../js/config.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const makeRig = () => ({ position: { x: 0, y: 0, z: 0 }, rotation: { y: 0 } });
const head = (fx = 0, fy = 0, fz = -1, px = 0, py = 1.6, pz = 0) => ({ position: { x: px, y: py, z: pz }, forward: { x: fx, y: fy, z: fz } });
const NOOP = { forward: false, turn: 0 };
const FWD = { forward: true, turn: 0 };

function simulate(loco, cmd, seconds, fps, h = head()) {
  const dt = 1 / fps;
  const n = Math.round(seconds * fps);
  for (let i = 0; i < n; i++) loco.update(cmd, dt, h);
}

test('ölçek sabitleri: 1.60 / 70 ≈ 0.02286', () => {
  assert.ok(near(SCALE.MODEL_RATIO, 1 / 70));
  assert.ok(near(SCALE.SCALED_EYE_HEIGHT, 0.0228571, 1e-6));
  assert.equal(VIEW_MODES.human.viewScale, 70);
  // insan modunda maket birimindeki göz yüksekliği × viewScale = gerçek göz yüksekliği
  assert.ok(near(SCALE.SCALED_EYE_HEIGHT * VIEW_MODES.human.viewScale, SCALE.REFERENCE_EYE_HEIGHT));
});

test('rotateY three.js ile aynı yönde: +90° ileriyi (-Z) sola (-X) çevirir', () => {
  const r = rotateY(0, -1, Math.PI / 2);
  assert.ok(near(r.x, -1) && near(r.z, 0));
});

test('forwardFromQuaternion: birim kuaterniyon -Z, yaw 90° -> -X', () => {
  const f0 = forwardFromQuaternion({ x: 0, y: 0, z: 0, w: 1 });
  assert.ok(near(f0.x, 0) && near(f0.y, 0) && near(f0.z, -1));
  const s = Math.SQRT1_2;
  const f1 = forwardFromQuaternion({ x: 0, y: s, z: 0, w: s });
  assert.ok(near(f1.x, -1) && near(f1.z, 0));
});

test('yürüme frame-rate bağımsızdır (30/72/90/120 fps aynı mesafe)', () => {
  const results = [30, 72, 90, 120].map((fps) => {
    const rig = makeRig();
    const l = new Locomotion(rig);
    simulate(l, FWD, 3, fps);
    return -rig.position.z;
  });
  for (const d of results) assert.ok(Math.abs(d - results[0]) < 0.02, `mesafe ${results}`);
  // 3 s, rampa (0.12 s yumuşak başlangıç) dahil yaklaşık 1.4*(3-0.06)
  assert.ok(Math.abs(results[0] - LOCOMOTION.WALK_SPEED_REAL * (3 - LOCOMOTION.WALK_RAMP_TIME / 2)) < 0.03);
});

test('dikey baş hareketi yürüme hızını/yönünü etkilemez', () => {
  const a = makeRig(); const b = makeRig();
  const la = new Locomotion(a); const lb = new Locomotion(b);
  simulate(la, FWD, 2, 72, head(0, 0, -1));
  // 60° aşağı bakış: forward = (0, -sin60, -cos60)
  simulate(lb, FWD, 2, 72, head(0, -Math.sin(Math.PI / 3), -Math.cos(Math.PI / 3)));
  assert.ok(near(a.position.z, b.position.z, 1e-9));
  assert.equal(b.position.y, 0);
});

test('yürüme başın yatay bakış yönündedir (rig yaw dahil)', () => {
  const rig = makeRig();
  rig.rotation.y = Math.PI / 2; // rig sola dönük
  const l = new Locomotion(rig);
  simulate(l, FWD, 1, 90, head(0, 0, -1));
  assert.ok(rig.position.x < -1 && near(rig.position.z, 0, 1e-9));
  assert.ok(near(horizontalHeading({ x: 0, y: -1, z: 0 }, 0) ?? 0, 0)); // tam aşağı -> null
});

test('tam aşağı bakışta son geçerli yön kullanılır', () => {
  const rig = makeRig();
  const l = new Locomotion(rig);
  simulate(l, FWD, 0.5, 90, head(1, 0, 0));
  const x0 = rig.position.x;
  simulate(l, FWD, 0.5, 90, head(0, -1, 0));
  assert.ok(rig.position.x > x0 + 0.5);
});

test('pinch bırakılınca hız anında sıfır', () => {
  const rig = makeRig();
  const l = new Locomotion(rig);
  simulate(l, FWD, 1, 72);
  assert.ok(l.currentSpeed > 1);
  const z = rig.position.z;
  l.update(NOOP, 1 / 72, head());
  assert.equal(l.currentSpeed, 0);
  assert.equal(rig.position.z, z);
});

test('sağa dönüş negatif yaw, sola pozitif; hız TURN_SPEED_DEG ve frame-rate bağımsız', () => {
  const yaws = [36, 90].map((fps) => {
    const rig = makeRig();
    const l = new Locomotion(rig);
    simulate(l, { forward: false, turn: -1 }, 2, fps);
    return rig.rotation.y;
  });
  assert.ok(yaws[0] < 0);
  assert.ok(Math.abs(yaws[0] - yaws[1]) < 0.01);
  const expected = -(LOCOMOTION.TURN_SPEED_DEG * (2 - LOCOMOTION.TURN_RAMP_TIME / 2)) * Math.PI / 180;
  assert.ok(Math.abs(yaws[1] - expected) < 0.02);

  const rig = makeRig();
  const l = new Locomotion(rig);
  simulate(l, { forward: false, turn: 1 }, 1, 72);
  assert.ok(rig.rotation.y > 0);
});

test('dönüş başın etrafında yapılır: başın dünya konumu değişmez', () => {
  const rig = makeRig();
  rig.position.x = 3; rig.position.z = -2;
  const l = new Locomotion(rig);
  const h = head(0, 0, -1, 0.4, 1.6, -0.3); // kullanıcı oyun alanında merkezden uzakta
  const before = l.headWorld(h.position);
  simulate(l, { forward: false, turn: -1 }, 1.5, 72, h);
  const after = l.headWorld(h.position);
  assert.ok(near(before.x, after.x, 1e-9) && near(before.z, after.z, 1e-9));
  assert.ok(rig.rotation.y < -1);
});

test('yürüme hızı görünüm ölçeğiyle tutarlı: maket modunda 1/70', () => {
  const rig = makeRig();
  const l = new Locomotion(rig);
  l.setViewScale(VIEW_MODES.model.viewScale);
  assert.ok(near(l.worldWalkSpeed(), LOCOMOTION.WALK_SPEED_REAL / 70));
  simulate(l, FWD, 1, 72);
  assert.ok(near(l.realSpeed(), LOCOMOTION.WALK_SPEED_REAL, 1e-6));
});

test('placeHeadAt XR baş ofsetini telafi eder', () => {
  const rig = makeRig();
  const l = new Locomotion(rig);
  const h = head(0, 0, -1, 0.5, 1.6, 0.2);
  l.placeHeadAt(1, 4, Math.PI / 3, h.position);
  const w = l.headWorld(h.position);
  assert.ok(near(w.x, 1) && near(w.z, 4));
  assert.ok(near(rig.rotation.y, Math.PI / 3));
});

test('büyük dt (sekme arkaplanda) 0.1 s ile sınırlanır', () => {
  const rig = makeRig();
  const l = new Locomotion(rig, { WALK_RAMP_TIME: 0 });
  l.update(FWD, 5, head());
  assert.ok(near(-rig.position.z, LOCOMOTION.WALK_SPEED_REAL * 0.1));
});
