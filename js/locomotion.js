// ---------------------------------------------------------------------------
// Hareket sistemi. Kullanıcı "rig" (THREE.Group) içinde durur; XR head pose
// rig'in YEREL uzayında gelir ve asla ölçeklenmez/değiştirilmez. Locomotion
// yalnızca rig'in dünya konumunu (x, z) ve dünya Y eksenindeki yaw açısını
// değiştirir. Bu dosya three.js import etmez (Node testleri için saf matematik);
// rig olarak { position:{x,y,z}, rotation:{y} } şeklinde herhangi bir nesne
// kabul eder.
// ---------------------------------------------------------------------------

import { LOCOMOTION, VIEW_MODES } from './config.js';

const DEG2RAD = Math.PI / 180;

/** Three.js ile aynı yönde dünya Y ekseni etrafında döndürme. */
export function rotateY(x, z, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: x * c + z * s, z: -x * s + z * c };
}

/**
 * Yerel bakış yönünü dünya yatay düzlemine indirger.
 * Dikey (pitch) bileşen atılır; tam aşağı/yukarı bakışta null döner.
 */
export function horizontalHeading(localForward, rigYaw) {
  const w = rotateY(localForward.x, localForward.z, rigYaw);
  const len = Math.hypot(w.x, w.z);
  if (len < 1e-4) return null;
  return { x: w.x / len, z: w.z / len };
}

/** Bir kuaterniyonu (x,y,z,w) (0,0,-1) ileri vektörüne uygular. */
export function forwardFromQuaternion(q) {
  // v' = q * (0,0,-1) * q^-1
  const { x, y, z, w } = q;
  return {
    x: -2 * (x * z + w * y),
    y: -2 * (y * z - w * x),
    z: -(1 - 2 * (x * x + y * y)),
  };
}

export class Locomotion {
  /**
   * @param {{position:{x,y,z}, rotation:{y:number}}} rig
   */
  constructor(rig, options = {}) {
    this.rig = rig;
    this.opts = { ...LOCOMOTION, ...options };
    this.viewScale = VIEW_MODES.human.viewScale;
    this.walkFactor = 0; // 0..1 rampa
    this.turnFactor = 0;
    this.turnDir = 0;
    this.lastHeading = { x: 0, z: -1 };
    this.currentSpeed = 0;    // dünya m/s
    this.currentTurnRate = 0; // derece/s (+ = sola)
  }

  /** Gerçek-insan hızını görünüm ölçeğine göre dünya hızına çevirir. */
  worldWalkSpeed() {
    // insan modu (×70): 1.4 m/s; maket modu (×1): 1.4/70 m/s (maket içinde aynı tempo)
    return (this.opts.WALK_SPEED_REAL * this.viewScale) / VIEW_MODES.human.viewScale;
  }

  setViewScale(s) { this.viewScale = s; }

  /** Gerçek ölçekte (bina metresi) hız. */
  realSpeed() {
    return this.currentSpeed * (VIEW_MODES.human.viewScale / this.viewScale);
  }

  /** Başın dünya konumu = rig.position + R(yaw) * headLocal. */
  headWorld(headLocalPos) {
    const r = rotateY(headLocalPos.x, headLocalPos.z, this.rig.rotation.y);
    return { x: this.rig.position.x + r.x, z: this.rig.position.z + r.z };
  }

  /**
   * @param {{forward:boolean, turn:number}} cmd
   * @param {number} dt saniye (frame-rate bağımsız)
   * @param {{position:{x,y,z}, forward:{x,y,z}}} headLocal rig-yerel baş pozu
   */
  update(cmd, dt, headLocal) {
    const o = this.opts;
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, 0.1); // sekme/durak sonrası sıçramayı engelle

    // --- Yürüme: bırakınca anında durur, başlarken kısa rampa ---
    if (cmd.forward) {
      this.walkFactor = o.WALK_RAMP_TIME > 0 ? Math.min(1, this.walkFactor + dt / o.WALK_RAMP_TIME) : 1;
    } else {
      this.walkFactor = 0;
    }
    this.currentSpeed = 0;
    if (this.walkFactor > 0) {
      const h = horizontalHeading(headLocal.forward, this.rig.rotation.y) || this.lastHeading;
      this.lastHeading = h;
      const speed = this.worldWalkSpeed() * easeInOut(this.walkFactor);
      this.rig.position.x += h.x * speed * dt;
      this.rig.position.z += h.z * speed * dt;
      this.currentSpeed = speed;
    } else {
      const h = horizontalHeading(headLocal.forward, this.rig.rotation.y);
      if (h) this.lastHeading = h;
    }

    // --- Dönüş: dünya Y ekseni, başın etrafında (pivot) ---
    if (cmd.turn !== 0) {
      if (cmd.turn !== this.turnDir) this.turnFactor = 0;
      this.turnDir = cmd.turn;
      this.turnFactor = o.TURN_RAMP_TIME > 0 ? Math.min(1, this.turnFactor + dt / o.TURN_RAMP_TIME) : 1;
    } else {
      this.turnDir = 0;
      this.turnFactor = 0;
    }
    this.currentTurnRate = 0;
    if (this.turnFactor > 0) {
      const rateDeg = o.TURN_SPEED_DEG * easeInOut(this.turnFactor) * this.turnDir;
      this.rotateAroundHead(rateDeg * DEG2RAD * dt, headLocal.position);
      this.currentTurnRate = rateDeg;
    }
  }

  /** Rig'i başın dünya konumu etrafında döndürür; kullanıcı yerinde döner. */
  rotateAroundHead(angle, headLocalPos) {
    const pivot = this.headWorld(headLocalPos);
    const rel = rotateY(this.rig.position.x - pivot.x, this.rig.position.z - pivot.z, angle);
    this.rig.position.x = pivot.x + rel.x;
    this.rig.position.z = pivot.z + rel.z;
    this.rig.rotation.y += angle;
  }

  /**
   * Başı (x,z) noktasına ve yaw'a yerleştirir (Reset Position).
   * XR'de fiziksel baş ofseti hesaba katılır.
   */
  placeHeadAt(x, z, yaw, headLocalPos) {
    this.rig.rotation.y = yaw;
    const r = rotateY(headLocalPos.x, headLocalPos.z, yaw);
    this.rig.position.x = x - r.x;
    this.rig.position.z = z - r.z;
    this.stop();
  }

  stop() {
    this.walkFactor = 0;
    this.turnFactor = 0;
    this.turnDir = 0;
    this.currentSpeed = 0;
    this.currentTurnRate = 0;
  }
}

function easeInOut(t) {
  return t >= 1 ? 1 : t * t * (3 - 2 * t);
}
