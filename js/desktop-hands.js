// ---------------------------------------------------------------------------
// Masaüstü webcam el takibi: MediaPipe Hand Landmarker (tasks-vision).
// Kütüphane yalnızca kullanıcı kamerayı başlattığında dinamik olarak yüklenir
// (Quest'te VR modunda hiç indirilmez). Tespit, ana render döngüsünden
// (renderer.setAnimationLoop) çağrılan update() içinde, yalnızca yeni bir
// video karesi geldiğinde yapılır.
// ---------------------------------------------------------------------------

import { CDN } from './config.js';
import { handFrameFromMediaPipe } from './gestures.js';

// MediaPipe el iskeleti bağlantıları (çizim için).
const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];
const FINGER_TIP = { index: 8, middle: 12, ring: 16, pinky: 20 };

export class DesktopHands extends EventTarget {
  /**
   * @param {HTMLVideoElement} video
   * @param {HTMLCanvasElement} overlay
   */
  constructor(video, overlay) {
    super();
    this.video = video;
    this.overlay = overlay;
    this.ctx = overlay.getContext('2d');
    this.landmarker = null;
    this.stream = null;
    this.state = 'stopped'; // stopped | loading | running | error
    this.lastVideoTime = -1;
    this.lastHands = [];
    this.lastRaw = null;
    this.delegate = null;
    this.inferenceMs = 0;
  }

  _emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  get running() { return this.state === 'running'; }

  async _ensureLandmarker() {
    if (this.landmarker) return this.landmarker;
    const vision = await import(CDN.MEDIAPIPE_VISION);
    const fileset = await vision.FilesetResolver.forVisionTasks(CDN.MEDIAPIPE_WASM);
    const make = (delegate) => vision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: CDN.HAND_MODEL, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      this.landmarker = await make('GPU');
      this.delegate = 'GPU';
    } catch (e) {
      console.warn('[desktop-hands] GPU delegate kullanılamadı, CPU deneniyor:', e);
      this.landmarker = await make('CPU');
      this.delegate = 'CPU';
    }
    return this.landmarker;
  }

  /** Kamera izni zaten kullanıcıdan alınmış olmalı (UI onay penceresi). */
  async start() {
    if (this.state === 'running' || this.state === 'loading') return;
    this.state = 'loading';
    this._emit('statechange');
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw Object.assign(new Error('This browser does not support camera access (getUserMedia) or the page is not HTTPS.'), { name: 'NotSupportedError' });
      }
      // Kamera ve model paralel yüklenir.
      const [stream] = await Promise.all([
        navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
          audio: false,
        }),
        this._ensureLandmarker(),
      ]);
      if (this.state !== 'loading') { // bu arada stop() çağrıldı (ör. VR başladı)
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      this.video.srcObject = stream;
      this.video.muted = true;
      this.video.playsInline = true;
      await this.video.play();
      this.overlay.width = this.video.videoWidth || 640;
      this.overlay.height = this.video.videoHeight || 480;
      this.lastVideoTime = -1;
      this.state = 'running';
      this._emit('statechange');
    } catch (e) {
      this._releaseStream();
      this.state = 'error';
      const msg = DesktopHands.describeError(e);
      this._emit('error', { message: msg, error: e });
      this._emit('statechange');
    }
  }

  static describeError(e) {
    switch (e?.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'Camera permission was denied. Allow it from the address-bar camera icon and try again.';
      case 'NotFoundError':
      case 'OverconstrainedError':
        return 'No camera found.';
      case 'NotReadableError':
        return 'The camera is in use by another application.';
      case 'NotSupportedError':
        return e.message;
      default:
        return `Could not start hand tracking: ${e?.message || e}`;
    }
  }

  stop() {
    const was = this.state;
    this._releaseStream();
    this.lastHands = [];
    this.lastRaw = null;
    this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    this.state = 'stopped';
    if (was !== 'stopped') this._emit('statechange');
  }

  _releaseStream() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }
  }

  /** Sayfa kapanırken modeli de serbest bırak. */
  dispose() {
    this.stop();
    if (this.landmarker) {
      try { this.landmarker.close(); } catch (_) { /* yoksay */ }
      this.landmarker = null;
    }
  }

  /**
   * Render döngüsünden çağrılır. Yeni video karesi varsa tespit yapar.
   * @param {{hands:Array}} lastGesture vurgulama için önceki jest sonucu
   * @returns {Array} HandFrame listesi
   */
  update(nowMs, lastGesture) {
    if (this.state !== 'running' || !this.landmarker) return [];
    const v = this.video;
    if (v.readyState < 2) return this.lastHands;
    if (v.currentTime === this.lastVideoTime) return this.lastHands;
    this.lastVideoTime = v.currentTime;

    const t0 = performance.now();
    let res;
    try {
      res = this.landmarker.detectForVideo(v, nowMs);
    } catch (e) {
      console.error('[desktop-hands] detectForVideo hatası:', e);
      return [];
    }
    this.inferenceMs = performance.now() - t0;
    this.lastRaw = res;

    const aspect = (v.videoWidth || 4) / (v.videoHeight || 3);
    const hands = [];
    const used = new Set();
    (res.landmarks || []).forEach((lm, i) => {
      // MediaPipe el yönünü ayna (selfie) görüntüsüne göre verir; ham webcam
      // karesi aynalanmadığı için etiket ters çevrilir.
      const label = res.handedness?.[i]?.[0]?.categoryName || res.handednesses?.[i]?.[0]?.categoryName;
      let id = label === 'Left' ? 'right' : label === 'Right' ? 'left' : `hand${i}`;
      if (used.has(id)) id = `${id}${i}`;
      used.add(id);
      hands.push(handFrameFromMediaPipe(lm, res.worldLandmarks?.[i], id, aspect));
    });
    this.lastHands = hands;
    this._draw(res, hands, lastGesture);
    return hands;
  }

  _draw(res, hands, lastGesture) {
    const ctx = this.ctx;
    const w = this.overlay.width;
    const h = this.overlay.height;
    ctx.clearRect(0, 0, w, h);
    const activeById = {};
    for (const g of lastGesture?.hands || []) activeById[g.id] = g.active;

    (res.landmarks || []).forEach((lm, i) => {
      const hf = hands[i];
      const tracked = hf?.tracked;
      ctx.lineWidth = 3;
      ctx.strokeStyle = tracked ? 'rgba(120,200,255,0.9)' : 'rgba(255,120,120,0.8)';
      ctx.beginPath();
      for (const [a, b] of CONNECTIONS) {
        ctx.moveTo(lm[a].x * w, lm[a].y * h);
        ctx.lineTo(lm[b].x * w, lm[b].y * h);
      }
      ctx.stroke();
      const active = hf ? activeById[hf.id] : null;
      for (let k = 0; k < lm.length; k++) {
        const isActive = active && (k === 4 || k === FINGER_TIP[active]);
        ctx.fillStyle = isActive ? '#3ddc84' : (k % 4 === 0 && k > 0 ? '#7fb2ff' : '#ffffff');
        ctx.beginPath();
        ctx.arc(lm[k].x * w, lm[k].y * h, isActive ? 7 : 4, 0, Math.PI * 2);
        ctx.fill();
      }
      if (active) {
        ctx.strokeStyle = '#3ddc84';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(lm[4].x * w, lm[4].y * h);
        ctx.lineTo(lm[FINGER_TIP[active]].x * w, lm[FINGER_TIP[active]].y * h);
        ctx.stroke();
      }
    });
  }
}
