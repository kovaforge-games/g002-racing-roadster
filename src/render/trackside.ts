// Trackside details for realism: braking marker boards (300, 200, 100 m) on the outside before
// the heaviest braking zones, and marshal posts with an orange flag beside the barriers.
import * as THREE from 'three';
import type { Track } from '../sim/track';
import { speedProfile } from '../sim/racingLine';

function boardTexture(n: number) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 160;
  const x = c.getContext('2d')!;
  x.fillStyle = '#f4f4f0'; x.fillRect(0, 0, 128, 160);
  x.strokeStyle = '#111'; x.lineWidth = 8; x.strokeRect(4, 4, 120, 152);
  x.fillStyle = '#111'; x.font = '900 72px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(String(n), 64, 84);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export class Trackside {
  readonly group = new THREE.Group();

  constructor(track: Track) {
    // braking zones: where the speed the corner ahead allows drops the most
    const v = speedProfile(track, 1.4, 10, 70);
    const step = track.total / track.n;
    const zones: { s: number; drop: number; side: number }[] = [];
    for (let i = 0; i < track.n; i++) {
      const ahead = v[track.wrap(i + Math.round(120 / step))];
      const drop = v[i] - ahead;
      if (drop > 14 && v[i] >= v[track.wrap(i - 1)]) {
        // the corner's direction puts the boards on the outside of it
        const curv = track.curv[track.wrap(i + Math.round(140 / step))];
        zones.push({ s: track.s[i], drop, side: curv > 0 ? 1 : -1 });
      }
    }
    zones.sort((a, b) => b.drop - a.drop);
    const picked: typeof zones = [];
    for (const z of zones) if (picked.length < 5 && picked.every(p => Math.abs(p.s - z.s) > 250 && Math.abs(p.s - z.s) < track.total - 250)) picked.push(z);
    const post = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.6, metalness: 0.5 });
    const postGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.6, 8).translate(0, 0.8, 0);
    const boardGeo = new THREE.PlaneGeometry(0.8, 1);
    const mats = new Map<number, THREE.MeshStandardMaterial>();
    for (const z of picked) {
      for (const dist of [300, 200, 100]) {
        const s = z.s + 120 - dist;
        const p = track.pointAt(s, z.side * (track.halfWidth + 3.2));
        const g = new THREE.Group();
        g.position.copy(p);
        // face oncoming cars
        g.rotation.y = track.headingAt(s) + Math.PI;
        g.add(new THREE.Mesh(postGeo, post));
        let m = mats.get(dist);
        if (!m) { m = new THREE.MeshStandardMaterial({ map: boardTexture(dist), roughness: 0.7 }); mats.set(dist, m); }
        const b = new THREE.Mesh(boardGeo, m);
        b.position.y = 2.1; b.castShadow = true;
        g.add(b);
        this.group.add(g);
      }
    }
    // marshal posts every 500 m behind the barrier: a hut and an orange flag
    const hut = new THREE.MeshStandardMaterial({ color: 0xe8e6df, roughness: 0.8 });
    const flag = new THREE.MeshStandardMaterial({ color: 0xff7a00, roughness: 0.6, side: THREE.DoubleSide });
    for (let s = 250; s < track.total; s += 500) {
      const p = track.pointAt(s, track.wallOffset + 2.5);
      const g = new THREE.Group();
      g.position.copy(p); g.rotation.y = track.headingAt(s);
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.2, 1.4).translate(0, 1.1, 0), hut); box.castShadow = true;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 6).translate(0, 3.4, 0), post);
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.45).translate(0.36, 4.3, 0), flag);
      g.add(box, pole, f);
      this.group.add(g);
    }
  }
}
