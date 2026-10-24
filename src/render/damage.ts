// Crash dents on a car model. Each hit from sim/damage.ts becomes a dent where it landed: the
// panels there are pushed in and crumpled (with a ripple, so it reads as folded metal rather than
// a smooth dimple), and the lights and trim that sit on the panels move with them because the
// same displacement field is applied to every mesh of the body shell. The model's geometry is
// shared with its copies (cloneModel), so a car gets its own copy of each mesh's geometry the
// first time it's dented, and gets the shared one back when it's repaired.
import * as THREE from 'three';
import type { BodyModel } from './models';
import type { Hit } from '../sim/damage';

interface Dent { c: THREE.Vector3; dir: THREE.Vector3; depth: number; radius: number }
interface Part { mesh: THREE.Mesh; orig: THREE.BufferGeometry; toShell: THREE.Matrix4; fromShell: THREE.Matrix4 }

/** deepest a dent gets (m), and how many a car keeps (nearby hits deepen one) */
const MAX_DEPTH = 0.36, MAX_DENTS = 16;

/** smooth value noise in space, about -1..1, for the crumple ripples */
function ripple(x: number, y: number, z: number) {
  return Math.sin(x * 9.1 + Math.sin(z * 5.3) * 1.7) * Math.sin(z * 8.3 + y * 6.1) * 0.7 + Math.sin((x + y + z) * 17.0) * 0.3;
}

export class BodyDents {
  private parts: Part[] | null = null;
  private dents: Dent[] = [];
  private dirty = false;
  /** half extents of the body in the shell frame, and the height of its middle */
  private half = new THREE.Vector3(1, 0.6, 2.3);
  private midY = 0.5;

  constructor(private model: BodyModel) {}

  get dented() { return this.dents.length > 0; }

  /** where a hit lands on the body (shell frame), for the debris and sparks */
  contact(hit: Hit, out = new THREE.Vector3()) {
    this.init();
    const { x, z } = hit.dir;
    const t = Math.min(this.half.x / Math.max(1e-3, Math.abs(x)), this.half.z / Math.max(1e-3, Math.abs(z)));
    return out.set(x * t, this.midY - 0.1, z * t);
  }

  add(hit: Hit) {
    this.init();
    const c = this.contact(hit);
    // bumper height, a little random: some hits catch the panels higher up
    c.y = this.midY - 0.15 + Math.random() * 0.25;
    const dir = new THREE.Vector3(hit.dir.x, 0, hit.dir.z).normalize();
    const depth = Math.min(MAX_DEPTH, 0.05 + hit.amount * 0.3);
    const radius = 0.55 + Math.min(1, hit.amount) * 0.65;
    const near = this.dents.reduce<Dent | null>((best, d) => d.c.distanceTo(c) < (best ? best.c.distanceTo(c) : 0.45) ? d : best, null);
    if (near || this.dents.length >= MAX_DENTS) {
      const d = near ?? this.dents.reduce((a, b) => a.c.distanceTo(c) < b.c.distanceTo(c) ? a : b);
      d.depth = Math.min(MAX_DEPTH, d.depth + depth * 0.6);
      d.radius = Math.min(1.4, Math.max(d.radius, radius));
    } else this.dents.push({ c, dir, depth, radius });
    this.dirty = true;
  }

  /** rebuild the dented geometry if there were new hits (call once a frame) */
  update() {
    if (!this.dirty || !this.parts) return;
    this.dirty = false;
    const p = new THREE.Vector3(), q = new THREE.Vector3();
    for (const part of this.parts) {
      const src = part.orig.getAttribute('position');
      // only the meshes a dent reaches
      if (!part.orig.boundingSphere) part.orig.computeBoundingSphere();
      const bs = part.orig.boundingSphere!.clone().applyMatrix4(part.toShell);
      if (!this.dents.some(d => d.c.distanceTo(bs.center) < d.radius + bs.radius)) continue;
      if (part.mesh.geometry === part.orig) part.mesh.geometry = part.orig.clone();
      const dst = part.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let k = 0; k < src.count; k++) {
        p.set(src.getX(k), src.getY(k), src.getZ(k)).applyMatrix4(part.toShell);
        q.copy(p);
        for (const d of this.dents) {
          const r = p.distanceTo(d.c) / d.radius;
          if (r >= 1) continue;
          const w = (1 - r * r) ** 2;
          const crumple = 0.75 + 0.45 * ripple(p.x, p.y, p.z);
          // pushed in along the hit, and the panels sag a little as they fold
          q.addScaledVector(d.dir, -d.depth * w * crumple);
          q.y -= d.depth * w * 0.22 * (1 + ripple(p.z, p.x, p.y) * 0.5);
        }
        q.applyMatrix4(part.fromShell);
        dst.setXYZ(k, q.x, q.y, q.z);
      }
      dst.needsUpdate = true;
      part.mesh.geometry.computeVertexNormals();
      part.mesh.geometry.computeBoundingSphere();
    }
  }

  /** good as new: the shared geometry back */
  repair() {
    this.dents = [];
    this.dirty = false;
    for (const part of this.parts ?? []) {
      if (part.mesh.geometry !== part.orig) { part.mesh.geometry.dispose(); part.mesh.geometry = part.orig; }
    }
  }

  /** find the body's meshes and their place in the shell (once, the first time it's hit) */
  private init() {
    if (this.parts) return;
    const shell = this.model.bodyShell;
    shell.updateMatrixWorld(true);
    const inv = shell.matrixWorld.clone().invert();
    this.parts = [];
    const box = new THREE.Box3();
    shell.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry.getAttribute('position')) return;
      const toShell = inv.clone().multiply(mesh.matrixWorld);
      this.parts!.push({ mesh, orig: mesh.geometry, toShell, fromShell: toShell.clone().invert() });
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(toShell));
    });
    if (!box.isEmpty()) {
      this.half.set(Math.max(Math.abs(box.min.x), box.max.x), (box.max.y - box.min.y) / 2, Math.max(Math.abs(box.min.z), box.max.z));
      this.midY = (box.min.y + box.max.y) / 2;
    }
  }
}
