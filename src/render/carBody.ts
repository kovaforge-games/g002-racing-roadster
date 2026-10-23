// The car's body shell, modelled on a modern electric roadster: a low nose with peaked front
// fenders and the hood sitting between them, a teardrop glass cabin set well back, wide rear
// haunches with a shoulder shelf, and a short ducktail. Built in a ground frame (y = 0 is the
// road, +z forward, +x the car's left).
//
// Each cross-section is a smooth curve through ten key points, from the bottom centre round the
// side to the roof centre. Details (lights, intakes, seams) are projected onto the finished
// surface with ray casts, so they always sit on the body however the shape is tuned.
import * as THREE from 'three';
import { CAR } from '../sim/car';

/** smooth curve through (z, value) keys, z descending from nose to tail */
function profile(keys: [number, number][]) {
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

export const HALF_L = 2.27;
/** centreline of the top surface: nose, hood, windshield, roof, fastback, ducktail */
const crown = profile([[2.27, 0.44], [2.18, 0.53], [1.95, 0.6], [1.45, 0.655], [1.0, 0.71], [0.86, 0.735], [0.5, 0.92],
  [0.1, 1.1], [-0.35, 1.175], [-0.8, 1.13], [-1.3, 1.02], [-1.72, 0.955], [-2.02, 0.945], [-2.14, 0.955], [-2.23, 0.9], [-2.27, 0.72]]);
const floor = profile([[2.27, 0.36], [2.13, 0.2], [1.9, 0.145], [0, 0.13], [-1.75, 0.15], [-2.1, 0.27], [-2.27, 0.46]]);
/** half width at the widest point of the side: fender bulges, a waist at the doors, wide haunches */
const width = profile([[2.27, 0.48], [2.2, 0.76], [2.0, 0.915], [1.45, 0.985], [0.85, 0.955], [0.15, 0.95],
  [-0.6, 0.985], [-1.4, 1.025], [-1.9, 0.995], [-2.13, 0.88], [-2.27, 0.52]]);
/** height of that widest line */
const waist = profile([[2.27, 0.38], [1.9, 0.47], [1.0, 0.52], [0, 0.55], [-1.3, 0.62], [-2.27, 0.6]]);
/** top edge of the side: peaked over the front wheels, dipping at the doors, rising to the haunches */
const fender = profile([[2.27, 0.48], [2.15, 0.57], [1.9, 0.7], [1.45, 0.8], [1.0, 0.77], [0.5, 0.745], [0, 0.765],
  [-0.8, 0.84], [-1.45, 0.915], [-1.95, 0.925], [-2.2, 0.9], [-2.27, 0.72]]);
/** how far the cabin sits in from the fender line (a shelf over the rear haunches) */
const shelf = profile([[1.0, 0.1], [0.3, 0.11], [-0.6, 0.15], [-1.3, 0.24], [-1.8, 0.3]]);
/** roof edge half width: a teardrop narrowing towards the back */
const roofW = profile([[0.9, 0.66], [0.4, 0.62], [-0.3, 0.57], [-0.9, 0.5], [-1.4, 0.4], [-1.8, 0.3]]);

/** the glass runs from the cowl to the end of the rear window */
export const GLASS_FRONT = 0.86, GLASS_REAR = -1.72;

export const WHEEL_Z = CAR.wheelbase / 2, WHEEL_X = CAR.track / 2, R = CAR.wheelRadius;
export const ARCH_R = R + 0.045;

function archY(z: number) {
  let y = -1;
  for (const wz of [WHEEL_Z, -WHEEL_Z]) {
    const dz = z - wz;
    if (Math.abs(dz) < ARCH_R) y = Math.max(y, R + 0.01 + Math.sqrt(ARCH_R * ARCH_R - dz * dz));
  }
  return y;
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const KEYS = 10;            // key points per half section
const PER = 10;             // samples per key segment
const HALF = (KEYS - 1) * PER;
const GLASS_T = 7 / (KEYS - 1);

/** the ten key points of the right half of the section at z (x >= 0) */
function keyPoints(z: number, capH: number) {
  // the ends close to a short horizontal lip rather than a point, which keeps the nose smooth
  const cap = 0.3 + 0.7 * capH;
  const yC0 = crown(z), yB0 = floor(z), W = width(z) * cap, yS0 = waist(z), yF0 = fender(z);
  // the end sections shrink towards their middle, closing the nose and tail
  const mid = (yC0 + yB0) / 2, sq = (y: number) => mid + (y - mid) * capH;
  const yC = sq(yC0), yB = sq(yB0), yS = sq(yS0), yF = sq(Math.min(yF0, yC0 + 0.12));
  // 0 over the hood and deck, 1 where the roof stands clear above the fenders
  const g = smooth(0.06, 0.2, yC - yF);
  const sh = shelf(z) * cap, rw = roofW(z) * cap;
  const p7 = new THREE.Vector2(W * 0.5, yC + (yF - yC) * 0.38).lerp(new THREE.Vector2(W - sh, yF + 0.035), g);
  const p8 = new THREE.Vector2(W * 0.2, yC + 0.004).lerp(new THREE.Vector2(rw, yC - 0.055), g);
  const pts = [
    new THREE.Vector2(0, yB),
    new THREE.Vector2(W - 0.15 * cap, yB),
    new THREE.Vector2(W - 0.04 * cap, yB + 0.07 * cap),
    new THREE.Vector2(W - 0.014 * cap, yS - 0.13 * cap),
    new THREE.Vector2(W, yS),
    new THREE.Vector2(W - 0.03 * cap, yF - 0.04 * cap),
    new THREE.Vector2(W - 0.085 * cap, yF),
    p7, p8,
    new THREE.Vector2(0, yC),
  ];
  return { pts, cabin: g };
}

/** HALF + 1 points of the right half section, bottom centre to top centre */
function halfSection(z: number, cap: number) {
  const { pts: k, cabin } = keyPoints(z, cap);
  // mirrored phantom points keep the curve smooth across the centreline
  const pts = [new THREE.Vector3(-k[1].x, k[1].y, 0), ...k.map(p => new THREE.Vector3(p.x, p.y, 0)), new THREE.Vector3(-k[8].x, k[8].y, 0)];
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const n = pts.length - 1, out: THREE.Vector2[] = [];
  const arch = archY(z), W = width(z);
  for (let j = 0; j <= HALF; j++) {
    const p = curve.getPoint((1 + j / PER) / n);
    let y = p.y;
    // wheel arches: lift the outer lower part of the section clear of the tyre
    if (j < HALF * 0.66 && arch > 0 && p.x > W - 0.27 && y < arch) y = arch;
    out.push(new THREE.Vector2(Math.max(0, p.x), y));
  }
  return { points: out, cabin };
}

/** the body shell with two material groups: paint (0) and glass (1) */
export function bodyGeometry() {
  const NZ = 230;
  const cols = 2 * HALF; // right half 0..HALF, then the mirrored left half back down
  const pos: number[] = [];
  const zs: number[] = [], cabins: number[] = [];
  for (let i = 0; i <= NZ; i++) {
    const u = i / NZ;
    const z = HALF_L * (0.6 * Math.cos(u * Math.PI) + 0.4 * (1 - 2 * u));
    // round off the nose and tail over the last few sections
    const e = Math.min(i, NZ - i);
    const cap = [0.02, 0.42, 0.68, 0.86, 0.95][e] ?? 1;
    const { points: half, cabin } = halfSection(z, cap);
    cabins.push(cabin);
    for (let j = 0; j < cols; j++) {
      const p = j <= HALF ? half[j] : half[2 * HALF - j];
      pos.push(j <= HALF ? p.x : -p.x, p.y, z);
    }
    zs.push(z);
  }
  const tOf = (j: number) => (j <= HALF ? j : 2 * HALF - j) / HALF;
  const paint: number[] = [], glass: number[] = [];
  for (let i = 0; i < NZ; i++) for (let j = 0; j < cols; j++) {
    const j2 = (j + 1) % cols;
    const a = i * cols + j, b = i * cols + j2, c = a + cols, d = (i + 1) * cols + j2;
    const zMid = (zs[i] + zs[i + 1]) / 2;
    // glass only where the cabin stands up from the body, not on the flat hood or deck
    const isGlass = zMid < GLASS_FRONT && zMid > GLASS_REAR && Math.min(cabins[i], cabins[i + 1]) > 0.3 && Math.min(tOf(j), tOf(j2)) >= GLASS_T - 1e-6;
    (isGlass ? glass : paint).push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex([...paint, ...glass]);
  geo.addGroup(0, paint.length, 0);
  geo.addGroup(paint.length, glass.length, 1);
  geo.computeVertexNormals();
  return geo;
}

/** height of the fender line at z, for placing mirrors */
export const fenderAt = (z: number) => fender(z);

/**
 * Projects details onto the body. `upper` and `lower` are matching lists of points on a plane
 * outside the car; each pair is cast along `dir` and the hits are joined into a strip that
 * sits `offset` metres off the paint. Returns geometry for the right side and its mirror image.
 */
export class Projector {
  private ray = new THREE.Raycaster();
  constructor(private body: THREE.Mesh) { body.updateMatrixWorld(true); }

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
      const n = p(1).sub(p(0)).cross(p(2).sub(p(0)));
      if (n.dot(d) > 0) for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
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
