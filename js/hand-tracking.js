// ---------------------------------------------------------------------------
// Quest 3 native WebXR Hand Tracking adaptörü.
// Her XR karesinde XRFrame.getJointPose() ile eklem konumlarını okur, ortak
// HandFrame biçimine çevirir ve eklemleri tek bir InstancedMesh ile çizer
// (2 el × 25 eklem = 1 draw call).
// Eklem pozları three.js'in kullandığı referans uzayında (rig-yerel) gelir;
// bu yüzden görsel mesh xrSpace grubunun içine eklenir. Hiçbir ölçek uygulanmaz.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { XR_JOINT_MAP } from './gestures.js';

// WebXR Hand Input spesifikasyonundaki 25 eklem (çizim için).
const ALL_JOINTS = [
  'wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip',
];
const TIP_FOR_FINGER = { index: 'index-finger-tip', middle: 'middle-finger-tip', ring: 'ring-finger-tip', pinky: 'pinky-finger-tip' };
const HAND_IDS = ['left', 'right'];

const COLOR_IDLE = new THREE.Color(0xdfe7ef);
const COLOR_TIP = new THREE.Color(0x7fb2ff);
const COLOR_ACTIVE = new THREE.Color(0x3ddc84);
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

export class XRHandTracker {
  /** @param {THREE.Object3D} parent xrSpace grubu (referans uzayı = rig-yerel) */
  constructor(parent) {
    const count = HAND_IDS.length * ALL_JOINTS.length;
    const geo = new THREE.SphereGeometry(1, 8, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.name = 'xr-hand-joints';
    for (let i = 0; i < count; i++) this.mesh.setColorAt(i, COLOR_IDLE);
    parent.add(this.mesh);

    this.handsSeen = false;          // oturum boyunca en az bir el geldi mi
    this.controllersSeen = false;
    this.lastHands = [];
  }

  /** Oturum başında/sonunda durumu temizle. */
  reset() {
    this.handsSeen = false;
    this.controllersSeen = false;
    this.lastHands = [];
    this.mesh.visible = false;
  }

  /**
   * @param {XRFrame} frame
   * @param {XRReferenceSpace} refSpace
   * @param {{hands:Array}} lastGesture motorun önceki sonucu (vurgulama için)
   * @returns {Array} HandFrame listesi
   */
  update(frame, refSpace, lastGesture) {
    const session = frame.session;
    const hands = [];
    const present = { left: null, right: null };

    for (const source of session.inputSources) {
      if (source.hand && (source.handedness === 'left' || source.handedness === 'right')) {
        present[source.handedness] = source;
      } else if (source.gamepad && !source.hand) {
        this.controllersSeen = true;
      }
    }

    const activeByHand = {};
    for (const h of lastGesture?.hands || []) activeByHand[h.id] = h.active;

    let anyVisible = false;
    HAND_IDS.forEach((id, handIdx) => {
      const source = present[id];
      const base = handIdx * ALL_JOINTS.length;
      if (!source) {
        this._hideHand(base);
        return;
      }
      this.handsSeen = true;

      // --- Tüm eklemler: kare başına tek getJointPose çağrısı ---
      const activeTip = activeByHand[id] ? TIP_FOR_FINGER[activeByHand[id]] : null;
      const jointPos = {};
      for (let j = 0; j < ALL_JOINTS.length; j++) {
        const name = ALL_JOINTS[j];
        const space = source.hand.get(name);
        const pose = space ? frame.getJointPose(space, refSpace) : null;
        if (!pose) {
          _m.makeScale(0, 0, 0);
        } else {
          const t = pose.transform.position;
          const o = pose.transform.orientation;
          const r = Math.max(0.004, (pose.radius ?? 0.008) * 0.75);
          jointPos[name] = [t.x, t.y, t.z];
          _p.set(t.x, t.y, t.z);
          _q.set(o.x, o.y, o.z, o.w);
          _s.set(r, r, r);
          _m.compose(_p, _q, _s);
          anyVisible = true;
        }
        this.mesh.setMatrixAt(base + j, _m);
        let c = COLOR_IDLE;
        if (name.endsWith('-tip')) c = COLOR_TIP;
        if (activeTip && (name === activeTip || name === 'thumb-tip')) c = COLOR_ACTIVE;
        this.mesh.setColorAt(base + j, c);
      }

      // --- Jest motoru için HandFrame (eksik eklem -> el kayıp) ---
      const points = {};
      let ok = true;
      for (const [key, jointName] of Object.entries(XR_JOINT_MAP)) {
        const pos = jointPos[jointName];
        if (!pos) { ok = false; break; }
        points[key] = pos;
      }
      hands.push({ id, tracked: ok, points: ok ? points : null });
    });

    this.mesh.visible = anyVisible;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.lastHands = hands;
    return hands;
  }

  _hideHand(base) {
    _m.makeScale(0, 0, 0);
    for (let j = 0; j < ALL_JOINTS.length; j++) this.mesh.setMatrixAt(base + j, _m);
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}
