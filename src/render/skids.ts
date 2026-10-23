// Skid marks: a ring buffer of dark quads laid behind sliding tyres, fading with slip.
import * as THREE from 'three';
import type { Car } from '../sim/car';

const MAX = 3000, WIDTH = 0.24;

export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private pos = new Float32Array(MAX * 6 * 3);
  private col = new Float32Array(MAX * 6 * 4);
  private next = 0;
  private last: ({ x: number; y: number; z: number; a: number } | null)[] = [null, null, null, null];

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, color: 0x101010, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  clear() { this.last = [null, null, null, null]; }

  update(car: Car) {
    const { right } = car.axes();
    let dirty = false;
    car.wheels.forEach((w, i) => {
      const p = w.contactPoint;
      if (!w.contact || w.slip < 0.2) { this.last[i] = null; return; }
      const a = Math.min(0.75, (w.slip - 0.2) * 1.4);
      const prev = this.last[i];
      if (prev && Math.hypot(p.x - prev.x, p.z - prev.z) < 0.35) return;
      if (prev && Math.hypot(p.x - prev.x, p.z - prev.z) < 3) {
        const hx = right.x * WIDTH / 2, hz = right.z * WIDTH / 2;
        const k = this.next % MAX;
        const quad = [
          [prev.x - hx, prev.y, prev.z - hz, prev.a], [p.x - hx, p.y, p.z - hz, a], [prev.x + hx, prev.y, prev.z + hz, prev.a],
          [prev.x + hx, prev.y, prev.z + hz, prev.a], [p.x - hx, p.y, p.z - hz, a], [p.x + hx, p.y, p.z + hz, a],
        ];
        quad.forEach((v, j) => {
          this.pos.set([v[0], v[1] + 0.045, v[2]], (k * 6 + j) * 3);
          this.col.set([1, 1, 1, v[3]], (k * 6 + j) * 4);
        });
        this.next++;
        dirty = true;
      }
      this.last[i] = { x: p.x, y: p.y, z: p.z, a };
    });
    if (dirty) {
      const g = this.mesh.geometry;
      g.attributes.position.needsUpdate = true;
      g.attributes.color.needsUpdate = true;
      g.setDrawRange(0, Math.min(this.next, MAX) * 6);
    }
  }
}
