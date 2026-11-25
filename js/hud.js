// ---------------------------------------------------------------------------
// VR içi durum göstergesi: kameraya bağlı, görüşün alt kısmında küçük bir
// panel. Doku yalnızca içerik değiştiğinde yeniden çizilir (her karede değil).
// ---------------------------------------------------------------------------

import * as THREE from 'three';

const ACTION_STYLE = {
  forward:   { icon: '▲', text: 'FORWARD', color: '#3ddc84' },
  turnRight: { icon: '↻', text: 'RIGHT', color: '#5aa9ff' },
  turnLeft:  { icon: '↺', text: 'LEFT', color: '#ffb347' },
  none:      { icon: '■', text: 'STOP', color: '#9aa4ae' },
};

export class StatusHUD {
  /** @param {THREE.Camera} camera */
  constructor(camera) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 160;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    });
    // 0.5 m önde, görüşün altında, 16 × 5 cm: merkez görüşü kapatmaz.
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.05), mat);
    this.mesh.position.set(0, -0.17, -0.5);
    this.mesh.rotation.x = -0.32;
    this.mesh.renderOrder = 999;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.name = 'status-hud';
    camera.add(this.mesh);
    this._key = '';
  }

  set visible(v) { this.mesh.visible = v; }

  /**
   * @param {{action:string, hands:number, warning?:string, scaleLabel:string, speed:number, turnRate:number}} s
   */
  update(s) {
    const key = `${s.action}|${s.hands}|${s.warning || ''}|${s.scaleLabel}|${s.speed.toFixed(1)}|${Math.round(s.turnRate)}`;
    if (key === this._key) return;
    this._key = key;
    const { ctx, canvas } = this;
    const st = ACTION_STYLE[s.action] || ACTION_STYLE.none;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(12,16,22,0.62)';
    ctx.beginPath();
    ctx.roundRect(4, 4, canvas.width - 8, canvas.height - 8, 28);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = st.color;
    ctx.stroke();

    ctx.fillStyle = st.color;
    ctx.font = '700 64px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${st.icon} ${st.text}`, 28, 58);

    ctx.fillStyle = '#e8edf2';
    ctx.font = '500 28px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`Hands: ${s.hands}/2`, canvas.width - 28, 44);
    ctx.fillText(s.scaleLabel, canvas.width - 28, 80);
    ctx.textAlign = 'left';
    if (s.warning) {
      ctx.fillStyle = '#ff8080';
      ctx.font = '600 26px system-ui, sans-serif';
      ctx.fillText(s.warning, 28, 124);
    } else {
      ctx.fillStyle = '#b8c2cc';
      ctx.font = '500 26px system-ui, sans-serif';
      ctx.fillText(`speed ${s.speed.toFixed(2)} m/s · turn ${Math.round(s.turnRate)}°/s`, 28, 124);
    }
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.texture.dispose();
  }
}
