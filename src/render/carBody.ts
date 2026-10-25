// Shared tools for building the car bodies: smooth profiles along the car, the Roadster's wheel
// positions, and the projector that lays details (lights, seams, trim) onto a finished body
// with ray casts, so they always sit on the surface however the shape is tuned.
import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { CAR } from '../sim/car';

/** smooth curve through (z, value) keys, z descending from nose to tail */
export function profile(keys: [number, number][]) {
  return (z: number) => {
    if (z >= keys[0][0]) return keys[0][1];
    for (let k = 0; k < keys.length - 1; k++) {
      const [z0, v0] = keys[k], [z1, v1] = keys[k + 1];
      if (z <= z0 && z >= z1) {
        const vm = keys[Math.max(0, k - 1)][1], vp = keys[Math.min(keys.length - 1, k + 2)][1];
        const zm = keys[Math.max(0, k - 1)][0], zp = keys[Math.min(keys.length - 1, k + 2)][0];
        const t = (z0 - z) / (z0 - z1);
        // Catmull-Rom tangents scaled to this interval (keys are unevenly spaced)
        const m0 = k === 0 ? v1 - v0 : (v1 - vm) * (z0 - z1) / (zm - z1);
        const m1 = k + 2 >= keys.length ? v1 - v0 : (vp - v0) * (z0 - z1) / (z0 - zp);
        const t2 = t * t, t3 = t2 * t;
        return (2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * m1;
      }
    }
    return keys[keys.length - 1][1];
  };
}

export const WHEEL_Z = CAR.wheelbase / 2, WHEEL_X = CAR.track / 2, R = CAR.wheelRadius;
/** 20" front and 21" rear wheels: the drawn radii, a little either side of the physics radius */
export const WHEEL_R = { front: 0.343, rear: 0.367 };

/**
 * Projects details onto the body. `upper` and `lower` are matching lists of points on a plane
 * outside the car; each pair is cast along `dir` and the hits are joined into a strip that
 * sits `offset` metres off the paint. Returns geometry for the right side and its mirror image.
 */
export class Projector {
  private ray = new THREE.Raycaster();
  private body: THREE.Mesh;
  constructor(body: THREE.Mesh) {
    body.updateMatrixWorld(true);
    // casting against every triangle took seconds of the loading screen: a copy of the mesh with a
    // bounding volume tree finds the same nearest hit far faster, and leaves the car's own mesh alone
    const geo = body.geometry.clone();
    geo.boundsTree = new MeshBVH(geo);
    this.body = new THREE.Mesh(geo, body.material);
    this.body.matrixWorld.copy(body.matrixWorld);
    this.body.matrixWorldAutoUpdate = false;
    this.body.raycast = acceleratedRaycast;
    this.ray.firstHitOnly = true;
  }

  private hit(origin: THREE.Vector3, dir: THREE.Vector3, offset: number) {
    this.ray.set(origin, dir);
    const h = this.ray.intersectObject(this.body, false)[0];
    if (!h || !h.face) return null;
    return h.point.clone().addScaledVector(h.face.normal, offset);
  }

  strip(upper: THREE.Vector3[], lower: THREE.Vector3[], dir: THREE.Vector3, offset = 0.004, mirror = true) {
    const d = dir.clone().normalize();
    // enough rows that the strip follows the curvature between its edges instead of cutting a chord
    const rows = Math.max(1, Math.ceil(upper[0].distanceTo(lower[0]) / 0.015));
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    let prev = -1;
    const o = new THREE.Vector3();
    for (let k = 0; k < upper.length; k++) {
      const col: THREE.Vector3[] = [];
      for (let r = 0; r <= rows; r++) {
        const h = this.hit(o.lerpVectors(upper[k], lower[k], r / rows), d, offset);
        if (!h) break;
        col.push(h);
      }
      if (col.length <= rows) { prev = -1; continue; }
      const v = pos.length / 3;
      col.forEach((p, r) => { pos.push(p.x, p.y, p.z); uv.push(k / (upper.length - 1), 1 - r / rows); });
      if (prev >= 0) for (let r = 0; r < rows; r++) idx.push(prev + r, prev + r + 1, v + r, prev + r + 1, v + r + 1, v + r);
      prev = v;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    // wind the triangles to face back along the projection, towards the viewer
    if (idx.length >= 3) {
      const p = (k: number) => new THREE.Vector3(pos[idx[k] * 3], pos[idx[k] * 3 + 1], pos[idx[k] * 3 + 2]);
      const nrm = p(1).sub(p(0)).cross(p(2).sub(p(0)));
      if (nrm.dot(d) > 0) for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
    }
    g.setIndex(idx);
    g.computeVertexNormals();
    if (!mirror) return [g];
    return [g, mirrorX(g)];
  }
}

/** mirror image across x = 0, with the winding flipped so it still faces outwards */
export function mirrorX(g: THREE.BufferGeometry) {
  const m = g.clone();
  m.scale(-1, 1, 1);
  const idx = m.getIndex();
  if (idx) for (let k = 0; k < idx.count; k += 3) { const t = idx.getX(k + 1); idx.setX(k + 1, idx.getX(k + 2)); idx.setX(k + 2, t); }
  m.computeVertexNormals();
  return m;
}

/** points along a line between two endpoints, with an optional bulge (for curved outlines) */
export function line(a: [number, number, number], b: [number, number, number], n = 24, bulge: [number, number, number] = [0, 0, 0]) {
  const out: THREE.Vector3[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, s = Math.sin(t * Math.PI);
    out.push(new THREE.Vector3(a[0] + (b[0] - a[0]) * t + bulge[0] * s, a[1] + (b[1] - a[1]) * t + bulge[1] * s, a[2] + (b[2] - a[2]) * t + bulge[2] * s));
  }
  return out;
}
