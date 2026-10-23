// A floating label over a rival: race position and name, fading out with distance.
import * as THREE from 'three';

export class NameTag {
  readonly sprite: THREE.Sprite;
  private canvas = document.createElement('canvas');
  private tex: THREE.CanvasTexture;
  private shown = '';

  constructor(private name: string, private color: string) {
    this.canvas.width = 512; this.canvas.height = 96;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false }));
    this.sprite.renderOrder = 4;
  }

  private draw(pos: number) {
    const c = this.canvas.getContext('2d')!;
    c.clearRect(0, 0, 512, 96);
    c.font = '700 40px system-ui, sans-serif';
    const label = this.name.toUpperCase();
    const w = c.measureText(label).width + 120;
    const x0 = (512 - w) / 2;
    c.fillStyle = 'rgba(8, 12, 18, 0.62)';
    c.beginPath(); c.roundRect(x0, 14, w, 68, 34); c.fill();
    c.fillStyle = this.color; c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 3;
    c.beginPath(); c.arc(x0 + 40, 48, 22, 0, Math.PI * 2); c.fill(); c.stroke();
    c.font = '800 28px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    // a light dot gets dark digits, a dark one light digits
    const lum = parseInt(this.color.slice(1, 3), 16) + parseInt(this.color.slice(3, 5), 16) + parseInt(this.color.slice(5, 7), 16);
    c.fillStyle = lum > 380 ? '#0b0f14' : '#f4f7fb';
    c.fillText(String(pos), x0 + 40, 50);
    c.font = '700 40px system-ui, sans-serif'; c.textAlign = 'left'; c.fillStyle = '#f4f7fb';
    c.fillText(label, x0 + 76, 50);
    this.tex.needsUpdate = true;
  }

  /** follow the car; distance to the camera fades the tag in from 7 m and out by 110 m */
  update(pos: number, x: number, y: number, z: number, camDist: number) {
    const key = String(pos);
    if (key !== this.shown) { this.shown = key; this.draw(pos); }
    // grows with distance so it stays readable further away
    const k = Math.max(1, camDist / 22);
    this.sprite.scale.set(2.8 * k, 0.525 * k, 1);
    this.sprite.position.set(x, y + 1.3 + 0.3 * k, z);
    const fade = Math.min(1, (camDist - 7) / 5) * Math.min(1, (110 - camDist) / 30);
    this.sprite.material.opacity = Math.max(0, fade);
    this.sprite.visible = fade > 0.02;
  }
}
