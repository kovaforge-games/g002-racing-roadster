// The car's body shell, modelled on the 2026 electric roadster design language: a low wedge with
// a flat, faceted hood and a V-shaped centre panel, front fenders standing proud of the hood,
// a sharp beltline rising to the rear haunches, a black lower body, a tinted glass canopy, a
// faceted hatch and a squared-off tail. Built in a ground frame (y = 0 is the road, +z forward,
// +x the car's left).
//
// Each cross-section is a polyline through nine key points, from the bottom centre round the side
// to the top centre. Every span between two key points is its own surface, so the key points
// become sharp creases while each panel stays smooth along the car. Details (lights, vents,
// seams) are projected onto the finished surface with ray casts, so they always sit on the body
// however the shape is tuned.
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

export const HALF_L = 2.2;
/** centreline of the top surface: nose, wedge hood, raked windshield, roof, fastback, hatch */
const crown = profile([[2.2, 0.405], [2.13, 0.47], [1.95, 0.54], [1.45, 0.625], [1.0, 0.69], [0.93, 0.715], [0.6, 0.86],
  [0.25, 1.03], [-0.15, 1.115], [-0.55, 1.115], [-1.0, 1.05], [-1.5, 0.96], [-1.85, 0.935], [-2.1, 0.925], [-2.2, 0.905]]);
const floor = profile([[2.2, 0.3], [2.12, 0.18], [1.85, 0.125], [0, 0.115], [-1.7, 0.125], [-2.0, 0.2], [-2.2, 0.33]]);
/** half width at the widest crease: front fenders, a slight waist at the doors, wide haunches */
const width = profile([[2.2, 0.8], [2.12, 0.89], [1.95, 0.955], [1.45, 1.0], [0.95, 0.975], [0.3, 0.955],
  [-0.6, 0.985], [-1.45, 1.0], [-1.95, 0.985], [-2.2, 0.95]]);
/** top of the black lower body */
const rocker = profile([[2.2, 0.33], [1.8, 0.3], [-1.8, 0.3], [-2.2, 0.36]]);
/** the widest crease, a character line along the side */
const wide = profile([[2.2, 0.37], [1.9, 0.45], [1.45, 0.51], [0.5, 0.51], [-0.8, 0.55], [-1.6, 0.59], [-2.2, 0.6]]);
/** the sharp beltline: peaked over the front wheels, then rising in a wedge to the rear haunches */
const belt = profile([[2.2, 0.4], [2.05, 0.5], [1.75, 0.725], [1.45, 0.78], [1.15, 0.745], [0.8, 0.705], [0.2, 0.72],
  [-0.6, 0.8], [-1.2, 0.865], [-1.45, 0.885], [-1.8, 0.89], [-2.2, 0.885]]);
/** half width of the V-shaped centre panel on the hood and the hatch: narrow at the nose */
const vPanel = profile([[2.2, 0.14], [0.95, 0.5], [0.0, 0.5], [-1.5, 0.48], [-2.2, 0.4]]);
/** how far the glass sits in from the side, leaving a shoulder over the rear haunches */
const shelf = profile([[0.95, 0.17], [0.2, 0.17], [-0.6, 0.25], [-1.2, 0.33], [-1.55, 0.4]]);
/** roof edge half width: the canopy narrows towards the back */
const roofW = profile([[0.9, 0.66], [0.3, 0.62], [-0.4, 0.58], [-1.0, 0.5], [-1.55, 0.42]]);

/** the glass runs from the cowl to the end of the rear window */
export const GLASS_FRONT = 0.95, GLASS_REAR = -1.55;

export const WHEEL_Z = CAR.wheelbase / 2, WHEEL_X = CAR.track / 2, R = CAR.wheelRadius;
/** 20" front and 21" rear wheels: the drawn radii, a little either side of the physics radius */
export const WHEEL_R = { front: 0.343, rear: 0.367 };
const ARCH_GAP = 0.03, ARCH_FLAT = 0.2, ARCH_SLOPE = 2.3;
/** how far in from the side the arch is cut (just clear of the tyre's inner wall) */
export const ARCH_DEPTH = 0.27;

/** top of the wheel arch opening at z: a flat top with sloped sides, open below the axle */
export function archY(z: number) {
  let y = -1;
  for (const [wz, rv] of [[WHEEL_Z, WHEEL_R.front], [-WHEEL_Z, WHEEL_R.rear]]) {
    const top = 2 * rv + ARCH_GAP, dz = Math.abs(z - wz);
    const reach = ARCH_FLAT + (top - rv) / ARCH_SLOPE;
    if (dz < ARCH_FLAT) y = Math.max(y, top);
    else if (dz < reach) y = Math.max(y, top - (dz - ARCH_FLAT) * ARCH_SLOPE);
  }
  return y;
}
export const ARCH_REACH = ARCH_FLAT + (WHEEL_R.rear + ARCH_GAP) / ARCH_SLOPE;

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp2 = (a: THREE.Vector2, b: THREE.Vector2, t: number) => new THREE.Vector2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);

const PER = 6;   // samples per span
/** outward bulge of each span (m), so the panels are gently sculpted rather than flat */
const BULGE = [0, 0, 0.008, 0.012, 0.004, 0.006, 0.01, 0];
/** spans 0-1 are the black lower body; 6-7 are glass inside the canopy */
const LOWER_SPANS = 2;

/** the nine key points of the right half of the section at z, and how much of it is canopy */
function keyPoints(z: number) {
  const W = width(z), yB = floor(z), yC = crown(z);
  const yR = Math.max(rocker(z), yB + 0.02), yW = Math.max(wide(z), yR + 0.012), yT = Math.min(Math.max(belt(z), yW + 0.012), yC + 0.2);
  const shoulder = new THREE.Vector2(W - 0.155, yT + 0.012);
  // 0 over the hood and hatch, 1 where the canopy stands clear above the beltline
  const g = smooth(0.04, 0.16, yC - yT - 0.03);
  const hoodV = new THREE.Vector2(vPanel(z), yC), centre = new THREE.Vector2(0, yC);
  const glassBase = new THREE.Vector2(W - shelf(z), yT + 0.015), roofEdge = new THREE.Vector2(roofW(z), yC - 0.05);
  const k6 = lerp2(hoodV, glassBase, g), k7 = lerp2(lerp2(hoodV, centre, 0.5), roofEdge, g);
  const pts = [
    new THREE.Vector2(0, yB),
    new THREE.Vector2(W - 0.1, yB),
    new THREE.Vector2(W - 0.03, yR),
    new THREE.Vector2(W, yW),
    new THREE.Vector2(W - 0.045, yT),
    shoulder, k6, k7, centre,
  ];
  return { pts, cabin: g };
}

/** rounding radius at each key point: the creases stay crisp but catch a highlight */
const FILLET = [0, 0.03, 0.012, 0.014, 0.012, 0.022, 0.01, 0.028, 0];
const FILLET_STEPS = 4;

/** the curve of span s from key s (t = 0) to key s + 1 (t = 1) */
function spanAt(k: THREE.Vector2[], s: number, cabin: number, t: number) {
  const a = k[s], b = k[s + 1], p = lerp2(a, b, t);
  if (s === 7) {
    // roof: a parabola that arrives level at the centreline; flat across the hood panel
    p.y = a.y + (b.y - a.y) * (cabin * (1 - (1 - t) ** 2) + (1 - cabin) * t);
  } else {
    const nx = b.y - a.y, ny = a.x - b.x, nl = Math.hypot(nx, ny) || 1;
    const bl = BULGE[s] * Math.sin(Math.PI * t);
    // the outward side of the span is to the right of a -> b for the right half
    p.x -= (nx / nl) * bl; p.y -= (ny / nl) * bl;
  }
  return p;
}

interface Section { z: number; ring: THREE.Vector2[]; spans: number[]; cabin: number }

/**
 * The right half of the section at z, bottom centre to top centre, with every crease rounded by
 * a small fillet, and the span each segment belongs to (for its material).
 */
function section(z: number): Section {
  const { pts: k, cabin } = keyPoints(z);
  const ring: THREE.Vector2[] = [], label: number[] = [];
  const arch = archY(z), W = k[3].x;
  const push = (p: THREE.Vector2, s: number) => {
    if (s <= 3 && arch > 0 && p.x > W - ARCH_DEPTH && p.y < arch) p.y = arch;
    ring.push(new THREE.Vector2(Math.max(0, p.x), p.y)); label.push(s);
  };
  let prevEnd: THREE.Vector2 | null = null;
  for (let s = 0; s < 8; s++) {
    const len = k[s].distanceTo(k[s + 1]) || 1e-6;
    const t0 = Math.min(0.3, FILLET[s] / len), t1 = 1 - Math.min(0.3, FILLET[s + 1] / len);
    const a = spanAt(k, s, cabin, t0);
    if (prevEnd) {
      // quadratic fillet from the end of the last span, past the key, to the start of this one
      for (let f = 1; f < FILLET_STEPS; f++) {
        const u = f / FILLET_STEPS, c = k[s];
        const p = new THREE.Vector2(
          (1 - u) ** 2 * prevEnd.x + 2 * u * (1 - u) * c.x + u * u * a.x,
          (1 - u) ** 2 * prevEnd.y + 2 * u * (1 - u) * c.y + u * u * a.y);
        push(p, u <= 0.5 ? s - 1 : s);
      }
    }
    for (let j = 0; j <= PER; j++) push(spanAt(k, s, cabin, t0 + (t1 - t0) * (j / PER)), s);
    prevEnd = spanAt(k, s, cabin, t1);
  }
  // a segment takes the span of its lower point
  return { z, ring, spans: label.slice(0, -1), cabin };
}

/** the body shell with three material groups: paint (0), glass (1) and the black lower body (2) */
export function bodyGeometry(NZ = 300) {
  const secs: Section[] = [];
  for (let i = 0; i <= NZ; i++) {
    const u = i / NZ;
    secs.push(section(HALF_L * (0.6 * Math.cos(u * Math.PI) + 0.4 * (1 - 2 * u))));
  }
  const glassAt = secs.map(s => s.z < GLASS_FRONT && s.z > GLASS_REAR && s.cabin > 0.3);
  const pos: number[] = [];
  const groups: number[][] = [[], [], []];
  const n = () => pos.length / 3;

  // one surface all the way round (bottom centre, up the right side, over the top and down the
  // left), so normals are shared everywhere and the fillets give smooth, crisp creases
  const ringOf = (sec: Section) => [
    ...sec.ring.map(p => new THREE.Vector3(p.x, p.y, sec.z)),
    ...sec.ring.slice(0, -1).reverse().map(p => new THREE.Vector3(-p.x, p.y, sec.z)),
  ];
  const spans = [...secs[0].spans, ...secs[0].spans.slice().reverse()];
  const base = n();
  let w = 0;
  for (const sec of secs) { const c = ringOf(sec); w = c.length; c.forEach(p => pos.push(p.x, p.y, p.z)); }
  for (let i = 0; i < NZ; i++) for (let j = 0; j < w - 1; j++) {
    const a = base + i * w + j, b = a + 1, c = a + w, d = c + 1;
    const s = spans[j];
    const mat = s < LOWER_SPANS ? 2 : s >= 6 && glassAt[i] && glassAt[i + 1] ? 1 : 0;
    groups[mat].push(a, c, b, b, c, d);
  }

  // flat end faces: a black nose band at the front and a vertical tail
  const cap = (sec: Section, mat: number, facing: number) => {
    const ring = ringOf(sec).slice(0, -1);
    const c = n();
    const mid = ring.reduce((m, p) => m.add(p), new THREE.Vector3()).divideScalar(ring.length);
    pos.push(mid.x, mid.y, mid.z);
    ring.forEach(p => pos.push(p.x, p.y, p.z));
    for (let k = 0; k < ring.length; k++) {
      const a = c + 1 + k, b = c + 1 + (k + 1) % ring.length;
      groups[mat].push(...(facing > 0 ? [c, a, b] : [c, b, a]));
    }
  };
  cap(secs[0], 2, 1);
  cap(secs[NZ], 0, -1);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex([...groups[0], ...groups[1], ...groups[2]]);
  geo.addGroup(0, groups[0].length, 0);
  geo.addGroup(groups[0].length, groups[1].length, 1);
  geo.addGroup(groups[0].length + groups[1].length, groups[2].length, 2);
  geo.computeVertexNormals();
  return geo;
}

/** height of the beltline, the half width and the top of the black lower body at z, for details */
export const beltAt = (z: number) => belt(z);
export const widthAt = (z: number) => width(z);
export const rockerAt = (z: number) => Math.max(rocker(z), floor(z) + 0.02);
export const crownAt = (z: number) => crown(z);

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
