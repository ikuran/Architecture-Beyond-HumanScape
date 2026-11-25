// ---------------------------------------------------------------------------
// Ortak jest motoru. WebXR (Quest 3) ve MediaPipe (masaüstü) adaptörleri,
// elleri aynı "HandFrame" biçimine çevirip bu motora verir. Bu dosyanın hiçbir
// bağımlılığı yoktur; Node ile birim testi yapılır.
//
// HandFrame = {
//   id: 'left' | 'right' | string,   // el kimliği (durum takibi için)
//   tracked: boolean,                // false -> el kayıp
//   points: {                         // [x, y, z], herhangi bir tutarlı birim
//     wrist, thumbTip, indexTip, ringTip, pinkyTip, middleMcp
//   }
// }
// ---------------------------------------------------------------------------

import { GESTURES } from './config.js';

/** Jest -> parmak eşlemesi (başparmak + parmak). */
// 'middle' hiçbir harekete eşlenmez; yalnızca "engelleyici" olarak izlenir:
// başparmak + orta parmak pinch'i anatomik olarak yüzük parmağını da başparmağa
// yaklaştırır. Orta parmak en yakın parmaksa jest yok sayılır (yanlış sola dönüş olmaz).
export const PINCH_FINGERS = Object.freeze(['index', 'middle', 'ring', 'pinky']);

export const FINGER_TO_ACTION = Object.freeze({
  index: 'forward',
  middle: null,
  pinky: 'turnRight',
  ring: 'turnLeft',
});

const TIP_KEY = { index: 'indexTip', middle: 'middleTip', ring: 'ringTip', pinky: 'pinkyTip' };
const REQUIRED_POINTS = ['wrist', 'thumbTip', 'indexTip', 'ringTip', 'pinkyTip', 'middleMcp'];

export function distance3(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = (a[2] ?? 0) - (b[2] ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function isFinitePoint(p) {
  return Array.isArray(p) && p.length >= 2 && p.every(Number.isFinite);
}

/** El büyüklüğü: bilek -> orta parmak MCP (parmak bükülmesinden etkilenmez). */
export function handSize(points) {
  return distance3(points.wrist, points.middleMcp);
}

/**
 * Normalize pinch oranları. Eksik/bozuk veri varsa null döner.
 * @returns {{index:number, ring:number, pinky:number, size:number} | null}
 */
export function computePinchRatios(points, minHandSize = GESTURES.minHandSize) {
  if (!points) return null;
  for (const k of REQUIRED_POINTS) if (!isFinitePoint(points[k])) return null;
  const size = handSize(points);
  if (!(size > minHandSize)) return null;
  const out = { size };
  for (const f of PINCH_FINGERS) {
    const tip = points[TIP_KEY[f]];
    // middleTip isteğe bağlıdır; yoksa engelleyici devre dışı kalır.
    out[f] = isFinitePoint(tip) ? distance3(points.thumbTip, tip) / size : Infinity;
  }
  return out;
}

/**
 * Tek el için aday seçimi (saf fonksiyon).
 * - Skor = oran / press eşiği (küçük = daha kesin pinch). Parmaklar skora göre sıralanır.
 * - Halihazırda aktif parmak, oranı "release" eşiğinin altında kaldıkça korunur
 *   (hysteresis); ancak başka bir parmak press eşiğinin altına inip aktif
 *   parmaktan ambiguityMargin kadar daha iyi skora sahipse jest ona geçer.
 * - Yeni aday için oran "press" eşiğinin altında olmalı.
 * - En iyi iki adayın skor farkı ambiguityMargin'den küçükse belirsizdir -> null.
 * - Kazanan 'middle' ise finger='middle' döner (eşlenmemiş: hareket yok).
 * @returns {{finger: string|null, ambiguous: boolean}}
 */
export function selectFinger(ratios, currentFinger, cfg = GESTURES) {
  if (!ratios) return { finger: null, ambiguous: false };
  const th = cfg.thresholds;
  const score = (f) => ratios[f] / th[f].press;

  const candidates = PINCH_FINGERS
    .filter((f) => th[f] && ratios[f] < th[f].press)
    .map((f) => ({ f, score: score(f) }))
    .sort((a, b) => a.score - b.score);

  if (currentFinger && ratios[currentFinger] < th[currentFinger].release) {
    const best = candidates[0];
    const takeover = best && best.f !== currentFinger && score(currentFinger) - best.score >= cfg.ambiguityMargin;
    if (!takeover) return { finger: currentFinger, ambiguous: false };
  }

  if (candidates.length === 0) return { finger: null, ambiguous: false };
  if (candidates.length > 1 && candidates[1].score - candidates[0].score < cfg.ambiguityMargin) {
    return { finger: null, ambiguous: true };
  }
  return { finger: candidates[0].f, ambiguous: false };
}

/**
 * Durumlu jest motoru. Her karede update(hands, nowMs) çağrılır.
 */
export class GestureEngine {
  constructor(config = GESTURES) {
    this.cfg = config;
    this.handStates = new Map(); // id -> { active, pending, pendingSince }
    this.lastResult = GestureEngine.emptyResult();
  }

  static emptyResult() {
    return { forward: false, turn: 0, action: 'none', reason: 'no-hands', trackedCount: 0, hands: [] };
  }

  reset() {
    this.handStates.clear();
    this.lastResult = GestureEngine.emptyResult();
  }

  _updateHand(hand, nowMs) {
    let st = this.handStates.get(hand.id);
    if (!st) {
      st = { active: null, pending: null, pendingSince: 0 };
      this.handStates.set(hand.id, st);
    }
    const ratios = hand.tracked ? computePinchRatios(hand.points, this.cfg.minHandSize) : null;
    if (!ratios) {
      st.active = null;
      st.pending = null;
      return { id: hand.id, tracked: false, ratios: null, active: null, ambiguous: false };
    }

    const { finger, ambiguous } = selectFinger(ratios, st.active, this.cfg);

    if (finger === null) {
      // Bırakma anında: aktif jest hemen biter.
      st.active = null;
      st.pending = null;
    } else if (finger === st.active) {
      st.pending = null;
    } else {
      // Yeni parmak: activationMs boyunca tutulmalı (titreşim filtresi).
      if (st.active !== null) st.active = null; // başka bir parmağa geçişte önce dur
      if (st.pending !== finger) {
        st.pending = finger;
        st.pendingSince = nowMs;
      }
      if (nowMs - st.pendingSince >= this.cfg.activationMs) {
        st.active = finger;
        st.pending = null;
      }
    }
    return { id: hand.id, tracked: true, ratios, active: st.active, ambiguous };
  }

  /**
   * @param {Array<HandFrame>} hands
   * @param {number} nowMs
   */
  update(hands, nowMs) {
    const seen = new Set();
    const handResults = [];
    for (const h of hands || []) {
      if (!h || h.id == null) continue;
      seen.add(h.id);
      handResults.push(this._updateHand(h, nowMs));
    }
    // Görünmeyen ellerin durumunu sıfırla (kameradan çıkan el).
    for (const id of [...this.handStates.keys()]) if (!seen.has(id)) this.handStates.delete(id);

    const tracked = handResults.filter((h) => h.tracked);
    const result = { forward: false, turn: 0, action: 'none', reason: 'idle', trackedCount: tracked.length, hands: handResults };

    if (tracked.length === 0) {
      result.reason = 'no-hands';
      this.lastResult = result;
      return result;
    }

    const actions = tracked.map((h) => (h.active ? FINGER_TO_ACTION[h.active] : null)).filter(Boolean);
    const wantForward = actions.includes('forward');
    const wantRight = actions.includes('turnRight');
    const wantLeft = actions.includes('turnLeft');

    // Öncelik 1: karşıt dönüş komutları birbirini iptal eder.
    let turn = 0;
    if (wantRight && wantLeft) result.reason = 'conflict-turn';
    else if (wantRight) turn = -1; // sağa = -Y yönünde dönüş (Three.js sağ el kuralı)
    else if (wantLeft) turn = 1;

    // Öncelik 2: dönüş, yürümeden önceliklidir (allowWalkWhileTurning=false iken).
    let forward = wantForward;
    if (forward && turn !== 0 && !this.cfg.allowWalkWhileTurning) {
      forward = false;
      result.reason = 'turn-priority';
    }

    result.forward = forward;
    result.turn = turn;
    if (turn === -1) result.action = 'turnRight';
    else if (turn === 1) result.action = 'turnLeft';
    else if (forward) result.action = 'forward';
    if (result.action !== 'none' && result.reason === 'idle') result.reason = 'ok';
    if (result.action === 'none' && result.reason === 'idle' && tracked.some((h) => h.ambiguous)) result.reason = 'ambiguous';

    this.lastResult = result;
    return result;
  }
}

// ---------------------------------------------------------------------------
// Adaptör yardımcıları: takip sistemlerinin ham verisini HandFrame'e çevirir.
// ---------------------------------------------------------------------------

/** WebXR XRHand eklem adları -> HandFrame anahtarları. */
export const XR_JOINT_MAP = Object.freeze({
  wrist: 'wrist',
  thumbTip: 'thumb-tip',
  indexTip: 'index-finger-tip',
  middleTip: 'middle-finger-tip',
  ringTip: 'ring-finger-tip',
  pinkyTip: 'pinky-finger-tip',
  middleMcp: 'middle-finger-phalanx-proximal',
});

/** MediaPipe Hand Landmarker indeksleri -> HandFrame anahtarları. */
export const MP_LANDMARK_MAP = Object.freeze({
  wrist: 0,
  thumbTip: 4,
  indexTip: 8,
  middleTip: 12,
  ringTip: 16,
  pinkyTip: 20,
  middleMcp: 9,
});

/**
 * MediaPipe sonucunu HandFrame'e çevirir.
 * @param {Array<{x,y,z}>} landmarks   görüntü-normalize landmark'lar (0..1)
 * @param {Array<{x,y,z}>|null} worldLandmarks metre cinsinden 3B landmark'lar
 * @param {string} id
 * @param {number} aspect  video genişlik/yükseklik (world yoksa kullanılır)
 * @param {number} edgeMargin  çerçeve kenarı toleransı
 */
export function handFrameFromMediaPipe(landmarks, worldLandmarks, id, aspect = 1, edgeMargin = 0.02) {
  if (!landmarks || landmarks.length < 21) return { id, tracked: false, points: null };
  // Ana noktalardan biri görüntü dışına çıktıysa el "kayıp" sayılır.
  for (const idx of Object.values(MP_LANDMARK_MAP)) {
    const p = landmarks[idx];
    if (p.x < -edgeMargin || p.x > 1 + edgeMargin || p.y < -edgeMargin || p.y > 1 + edgeMargin) {
      return { id, tracked: false, points: null };
    }
  }
  const src = worldLandmarks && worldLandmarks.length >= 21 ? worldLandmarks : null;
  const points = {};
  for (const [key, idx] of Object.entries(MP_LANDMARK_MAP)) {
    const p = src ? src[idx] : landmarks[idx];
    points[key] = src ? [p.x, p.y, p.z] : [p.x * aspect, p.y, p.z * aspect];
  }
  return { id, tracked: true, points };
}
