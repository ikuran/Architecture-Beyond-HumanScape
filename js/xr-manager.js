// ---------------------------------------------------------------------------
// WebXR oturum yönetimi: destek kontrolü, immersive-vr başlatma, referans
// alanı fallback'i, hand-tracking durumu ve oturum yaşam döngüsü.
// ---------------------------------------------------------------------------

import { LOCOMOTION } from './config.js';

const SESSION_INIT = Object.freeze({ optionalFeatures: ['hand-tracking', 'local-floor'] });
const REF_SPACE_ORDER = ['local-floor', 'local'];

export class XRManager extends EventTarget {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Object3D} xrSpace kamera ve ellerin ebeveyni (referans uzayı ofseti)
   */
  constructor(renderer, xrSpace) {
    super();
    this.renderer = renderer;
    this.xrSpace = xrSpace;
    this.session = null;
    this.supported = false;
    this.refSpaceType = null;
    this.handTrackingEnabled = null; // true/false/null(bilinmiyor)
    this.state = 'idle'; // idle | unsupported | starting | running | ending
    this.lastError = null;
    this._onEnd = this._onEnd.bind(this);
    this._onInputSourcesChange = this._onInputSourcesChange.bind(this);
  }

  _emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  /** immersive-vr desteğini kontrol eder. */
  async checkSupport() {
    if (!window.isSecureContext) {
      this.state = 'unsupported';
      this.lastError = 'WebXR only works over HTTPS (or localhost).';
      return false;
    }
    if (!('xr' in navigator)) {
      this.state = 'unsupported';
      this.lastError = 'This browser does not support WebXR.';
      return false;
    }
    try {
      this.supported = await navigator.xr.isSessionSupported('immersive-vr');
    } catch (e) {
      this.supported = false;
    }
    if (!this.supported) {
      this.state = 'unsupported';
      this.lastError = 'immersive-vr is not supported on this device (a VR headset is required).';
    }
    return this.supported;
  }

  get isPresenting() { return this.state === 'running'; }

  async start() {
    if (this.session || this.state === 'starting') return;
    this.state = 'starting';
    this.lastError = null;
    this._emit('statechange');
    let session;
    try {
      session = await navigator.xr.requestSession('immersive-vr', SESSION_INIT);
    } catch (e) {
      this.state = 'idle';
      this.lastError = `Could not start the VR session: ${e.message || e}`;
      this._emit('error', { message: this.lastError });
      this._emit('statechange');
      return;
    }

    try {
      // Referans alanı fallback: local-floor yoksa local + tahmini göz ofseti.
      this.refSpaceType = null;
      for (const type of REF_SPACE_ORDER) {
        try {
          await session.requestReferenceSpace(type);
          this.refSpaceType = type;
          break;
        } catch (_) { /* sıradakini dene */ }
      }
      if (!this.refSpaceType) throw new Error('No supported reference space (local-floor/local).');

      // 'local' orijini başlangıç göz konumudur: zemini yaklaşık olarak aşağı al.
      // Bu yalnızca referans uzayının konumudur; baş hareketi aynen korunur.
      this.xrSpace.position.y = this.refSpaceType === 'local' ? LOCOMOTION.LOCAL_SPACE_EYE_OFFSET : 0;

      this.renderer.xr.setReferenceSpaceType(this.refSpaceType);
      await this.renderer.xr.setSession(session);

      this.session = session;
      session.addEventListener('end', this._onEnd);
      session.addEventListener('inputsourceschange', this._onInputSourcesChange);

      // enabledFeatures destekleniyorsa hand-tracking'in gerçekten verilip verilmediğini oku.
      if (Array.isArray(session.enabledFeatures)) {
        this.handTrackingEnabled = session.enabledFeatures.includes('hand-tracking');
      } else {
        this.handTrackingEnabled = null;
      }
      this.state = 'running';
      this._emit('sessionstart', { refSpaceType: this.refSpaceType, handTrackingEnabled: this.handTrackingEnabled });
      this._emit('statechange');
      if (this.handTrackingEnabled === false) {
        this._emit('warning', { message: 'Hand tracking was not granted in this session. On Quest: Settings > Movement tracking > Hand tracking must be on.' });
      }
    } catch (e) {
      this.lastError = `XR setup failed: ${e.message || e}`;
      this._emit('error', { message: this.lastError });
      try { await session.end(); } catch (_) { /* zaten kapalı */ }
      this.state = 'idle';
      this._emit('statechange');
    }
  }

  async end() {
    if (!this.session) return;
    this.state = 'ending';
    this._emit('statechange');
    try { await this.session.end(); } catch (_) { this._onEnd(); }
  }

  _onInputSourcesChange() {
    if (!this.session) return;
    let hands = 0; let controllers = 0;
    for (const s of this.session.inputSources) {
      if (s.hand) hands++;
      else if (s.gamepad) controllers++;
    }
    this._emit('inputsources', { hands, controllers });
  }

  _onEnd() {
    if (!this.session && this.state === 'idle') return;
    if (this.session) {
      this.session.removeEventListener('end', this._onEnd);
      this.session.removeEventListener('inputsourceschange', this._onInputSourcesChange);
    }
    this.session = null;
    this.refSpaceType = null;
    this.handTrackingEnabled = null;
    this.xrSpace.position.y = 0;
    this.state = 'idle';
    this._emit('sessionend');
    this._emit('statechange');
  }
}
