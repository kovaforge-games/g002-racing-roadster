// The A and B gates of a license test: an arch over the road with a big letter on the banner and
// a line across the tarmac. A full-lap test has one gate that is both.
import * as THREE from 'three';
import type { Track } from '../sim/track';

function banner(text: string, color: string) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const x = c.getContext('2d')!;
  x.fillStyle = color; x.fillRect(0, 0, 512, 96);
  x.fillStyle = '#0b0d10'; x.font = '900 64px system-ui, -apple-system, Segoe UI, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, 256, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Gates {
  readonly group = new THREE.Group();

  constructor(private track: Track) { this.group.visible = false; }

  private gate(s: number, text: string, color: string) {
    const tr = this.track, w = tr.halfWidth + 1.2;
    const g = new THREE.Group();
    const p = tr.pointAt(s, 0);
    g.position.copy(p);
    g.rotation.y = tr.headingAt(s);
    const pole = new THREE.MeshStandardMaterial({ color: 0x1b1f26, roughness: 0.6 });
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.35, 6, 0.35), pole);
      m.position.set(sx * w, 3, 0); m.castShadow = true;
      g.add(m);
    }
    const mat = new THREE.MeshBasicMaterial({ map: banner(text, color), side: THREE.DoubleSide });
    const b = new THREE.Mesh(new THREE.PlaneGeometry(w * 2, 1.4), mat);
    b.position.set(0, 5.6, 0);
    b.rotation.y = Math.PI; // reads the right way round to a driver coming towards it
    g.add(b);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(tr.halfWidth * 2, 1.2), new THREE.MeshBasicMaterial({ color, polygonOffset: true, polygonOffsetFactor: -4 }));
    line.rotation.x = -Math.PI / 2; line.position.y = 0.04;
    g.add(line);
    return g;
  }

  show(a: number, b: number) {
    this.hide();
    const full = Math.abs(((b - a) % this.track.total + this.track.total) % this.track.total) < 1;
    if (full) this.group.add(this.gate(a, 'A  ·  B', '#5cf0ff'));
    else this.group.add(this.gate(a, 'A  START', '#6dff9e'), this.gate(b, 'B  FINISH', '#ffd34d'));
    this.group.visible = true;
  }

  hide() {
    for (const g of [...this.group.children]) {
      g.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); const mat = m.material as THREE.MeshBasicMaterial; mat.map?.dispose(); mat.dispose(); } });
      this.group.remove(g);
    }
    this.group.visible = false;
  }
}
