import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GestureEngine, computePinchRatios, selectFinger, handFrameFromMediaPipe, MP_LANDMARK_MAP,
} from '../js/gestures.js';
import { GESTURES } from '../js/config.js';

// Sentetik el: bilek orijinde, orta parmak MCP 0.09 m yukarıda (el büyüklüğü 9 cm).
// Parmak uçları açık el konumunda; pinch için ilgili uç başparmağa yaklaştırılır.
function makeHand(id, { index = 0.10, ring = 0.09, pinky = 0.085 } = {}, scale = 1) {
  const thumbTip = [0.05, 0.10, 0];
  const at = (d, dir) => [thumbTip[0] + dir[0] * d, thumbTip[1] + dir[1] * d, thumbTip[2] + dir[2] * d];
  const pts = {
    wrist: [0, 0, 0],
    middleMcp: [0, 0.09, 0],
    thumbTip,
    indexTip: at(index, [0, 1, 0]),
    ringTip: at(ring, [-1, 0, 0]),
    pinkyTip: at(pinky, [0, 0, 1]),
  };
  for (const k of Object.keys(pts)) pts[k] = pts[k].map((v) => v * scale);
  return { id, tracked: true, points: pts };
}
const open = (id, s) => makeHand(id, {}, s);
const pinch = (id, finger, s, d = 0.012) => makeHand(id, { ...{ index: 0.10, ring: 0.09, pinky: 0.085 }, [finger]: d }, s);

function run(engine, frames, t0 = 0, dtMs = 16) {
  let r; let t = t0;
  for (const f of frames) { r = engine.update(f, t); t += dtMs; }
  return { r, t };
}
function hold(engine, hands, ms, t0 = 0) {
  let r; let t = t0;
  for (; t <= t0 + ms; t += 16) r = engine.update(hands, t);
  return { r, t };
}

test('pinch oranları el büyüklüğüne göre normalize edilir (ölçekten bağımsız)', () => {
  const a = computePinchRatios(pinch('r', 'index', 1).points);
  const b = computePinchRatios(pinch('r', 'index', 0.6).points);  // küçük el
  const c = computePinchRatios(pinch('r', 'index', 25).points);   // MediaPipe/görüntü birimi
  assert.ok(Math.abs(a.index - 0.012 / 0.09) < 1e-9);
  assert.ok(Math.abs(a.index - b.index) < 1e-9);
  assert.ok(Math.abs(a.index - c.index) < 1e-9);
});

test('eksik veya bozuk noktalarda oran null döner', () => {
  const h = open('r');
  assert.equal(computePinchRatios({ ...h.points, thumbTip: [NaN, 0, 0] }), null);
  assert.equal(computePinchRatios({ ...h.points, middleMcp: h.points.wrist }), null);
  assert.equal(computePinchRatios(null), null);
});

test('işaret pinch -> ileri, serçe -> sağa, yüzük -> sola', () => {
  const cases = [['index', 'forward', true, 0], ['pinky', 'turnRight', false, -1], ['ring', 'turnLeft', false, 1]];
  for (const [finger, action, fwd, turn] of cases) {
    const e = new GestureEngine();
    const { r } = hold(e, [pinch('right', finger)], 200);
    assert.equal(r.action, action, finger);
    assert.equal(r.forward, fwd);
    assert.equal(r.turn, turn);
  }
});

test('hiç pinch yokken hareket yok', () => {
  const e = new GestureEngine();
  const { r } = hold(e, [open('left'), open('right')], 200);
  assert.equal(r.action, 'none');
  assert.equal(r.forward, false);
  assert.equal(r.turn, 0);
  assert.equal(r.trackedCount, 2);
});

test('aktivasyon gecikmesi: tek karelik titreşim hareket başlatmaz', () => {
  const e = new GestureEngine();
  let r = e.update([pinch('r', 'index')], 0);
  assert.equal(r.action, 'none');
  r = e.update([open('r')], 16);
  r = e.update([pinch('r', 'index')], 32);
  assert.equal(r.action, 'none');
  r = e.update([pinch('r', 'index')], 32 + GESTURES.activationMs);
  assert.equal(r.action, 'forward');
});

test('hysteresis: press ile release eşiği arasında jest korunur, release üstünde biter', () => {
  const th = GESTURES.thresholds.index;
  const between = ((th.press + th.release) / 2) * 0.09;
  const above = (th.release + 0.02) * 0.09;
  const e = new GestureEngine();
  let { r, t } = hold(e, [pinch('r', 'index')], 120);
  assert.equal(r.action, 'forward');
  r = e.update([pinch('r', 'index', 1, between)], t);
  assert.equal(r.action, 'forward', 'ara bölgede aktif kalmalı');
  r = e.update([pinch('r', 'index', 1, above)], t + 16);
  assert.equal(r.action, 'none', 'release eşiği aşılınca anında durmalı');
  // Ara bölgede yeniden başlamaz (press altına inmesi gerekir)
  ({ r } = hold(e, [pinch('r', 'index', 1, between)], 200, t + 32));
  assert.equal(r.action, 'none');
});

test('bırakma anında hareket durur (gecikme yok)', () => {
  const e = new GestureEngine();
  let { r, t } = hold(e, [pinch('r', 'index')], 120);
  assert.equal(r.forward, true);
  r = e.update([open('r')], t);
  assert.equal(r.forward, false);
  assert.equal(r.action, 'none');
});

test('el kameradan/takipten çıkınca tüm hareketler durur', () => {
  const e = new GestureEngine();
  let { r, t } = hold(e, [pinch('r', 'pinky')], 200);
  assert.equal(r.action, 'turnRight');
  r = e.update([], t);
  assert.equal(r.action, 'none');
  assert.equal(r.reason, 'no-hands');
  // tracked:false da aynı
  ({ r, t } = hold(e, [pinch('r', 'pinky')], 200, t + 16));
  r = e.update([{ id: 'r', tracked: false, points: null }], t);
  assert.equal(r.action, 'none');
  assert.equal(r.turn, 0);
});

test('aynı elde iki parmak birden yakınsa belirsiz -> hareket yok', () => {
  const e = new GestureEngine();
  const both = makeHand('r', { index: 0.09, ring: 0.012, pinky: 0.0125 });
  const { r } = hold(e, [both], 300);
  assert.equal(r.action, 'none');
  assert.equal(r.reason, 'ambiguous');
});

test('aynı elde biri açıkça daha yakınsa o seçilir', () => {
  const sel = selectFinger({ index: 0.9, ring: 0.26, pinky: 0.05 }, null);
  assert.equal(sel.finger, 'pinky');
  assert.equal(sel.ambiguous, false);
});

test('latch: aktif jest, rakip parmak belirgin şekilde daha iyi değilse korunur', () => {
  const sel = selectFinger({ index: 0.20, middle: Infinity, ring: 0.20, pinky: 0.9 }, 'index');
  assert.equal(sel.finger, 'index');
});

test('latch devralma: başka parmak açıkça pinch yapınca jest ona geçer', () => {
  // Ölçülen IWER (Meta Quest el iskeleti) "pinch-ring" oranları; önceki jest serçe.
  const sel = selectFinger({ index: 0.60, middle: 0.45, ring: 0.06, pinky: 0.14 }, 'pinky');
  assert.equal(sel.finger, 'ring');
});

test('orta parmak engelleyici: başparmak+orta pinch yüzük parmağını tetiklemez', () => {
  // middle pinch'te yüzük de başparmağa yaklaşır (IWER ölçümü: r=0.22)
  const sel = selectFinger({ index: 0.44, middle: 0.05, ring: 0.22, pinky: 0.39 }, null);
  assert.equal(sel.finger, 'middle');
  const e = new GestureEngine();
  const h = makeHand('r', { index: 0.04, ring: 0.02, pinky: 0.035 });
  h.points.middleTip = [0.05, 0.1, 0.002]; // orta parmak başparmağa en yakın
  h.points.indexTip = [0.05, 0.1 + 0.04, 0];
  const { r } = hold(e, [h], 300);
  assert.equal(r.action, 'none');
  assert.equal(r.hands[0].active, 'middle');
});

test('IWER Quest el iskeleti oranları: pinch-ring -> yüzük, pinch-pinky -> serçe, yumruk -> yok', () => {
  assert.equal(selectFinger({ index: 0.60, middle: 0.4, ring: 0.06, pinky: 0.14 }, null).finger, 'ring');
  assert.equal(selectFinger({ index: 0.72, middle: 0.5, ring: 0.21, pinky: 0.07 }, null).finger, 'pinky');
  assert.equal(selectFinger({ index: 0.02, middle: 0.9, ring: 1.08, pinky: 1.17 }, null).finger, 'index');
  assert.equal(selectFinger({ index: 0.47, middle: 0.45, ring: 0.45, pinky: 0.46 }, null).finger, null);
});

test('iki el: karşıt dönüşler birbirini iptal eder', () => {
  const e = new GestureEngine();
  const { r } = hold(e, [pinch('left', 'ring'), pinch('right', 'pinky')], 200);
  assert.equal(r.turn, 0);
  assert.equal(r.reason, 'conflict-turn');
});

test('iki el: dönüş yürümeden önceliklidir (varsayılan)', () => {
  const e = new GestureEngine();
  const { r } = hold(e, [pinch('left', 'index'), pinch('right', 'pinky')], 200);
  assert.equal(r.action, 'turnRight');
  assert.equal(r.forward, false);
  assert.equal(r.reason, 'turn-priority');
});

test('iki el: allowWalkWhileTurning açıkken yürüme + dönüş birlikte', () => {
  const e = new GestureEngine({ ...GESTURES, allowWalkWhileTurning: true });
  const { r } = hold(e, [pinch('left', 'index'), pinch('right', 'ring')], 200);
  assert.equal(r.forward, true);
  assert.equal(r.turn, 1);
});

test('iki el: herhangi bir elle ileri yürünebilir', () => {
  for (const id of ['left', 'right']) {
    const e = new GestureEngine();
    const other = id === 'left' ? 'right' : 'left';
    const { r } = hold(e, [pinch(id, 'index'), open(other)], 200);
    assert.equal(r.action, 'forward');
  }
});

test('MediaPipe adaptörü: world landmark kullanır ve kenar dışını kayıp sayar', () => {
  const lm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const wl = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  wl[MP_LANDMARK_MAP.middleMcp] = { x: 0, y: -0.09, z: 0 };
  wl[MP_LANDMARK_MAP.thumbTip] = { x: 0.05, y: -0.1, z: 0 };
  wl[MP_LANDMARK_MAP.indexTip] = { x: 0.06, y: -0.1, z: 0 };
  wl[MP_LANDMARK_MAP.ringTip] = { x: -0.03, y: -0.1, z: 0 };
  wl[MP_LANDMARK_MAP.pinkyTip] = { x: -0.04, y: -0.08, z: 0 };
  const hf = handFrameFromMediaPipe(lm, wl, 'right', 16 / 9);
  assert.equal(hf.tracked, true);
  const ratios = computePinchRatios(hf.points);
  assert.ok(Math.abs(ratios.index - 0.01 / 0.09) < 1e-9);

  lm[MP_LANDMARK_MAP.indexTip] = { x: 1.2, y: 0.5, z: 0 };
  assert.equal(handFrameFromMediaPipe(lm, wl, 'right').tracked, false);
  assert.equal(handFrameFromMediaPipe(null, null, 'right').tracked, false);
});

test('reset tüm durumu temizler', () => {
  const e = new GestureEngine();
  hold(e, [pinch('r', 'index')], 200);
  e.reset();
  assert.equal(e.handStates.size, 0);
  assert.equal(e.lastResult.action, 'none');
});

void run;
