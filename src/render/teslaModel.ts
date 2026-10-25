// The rest of the line-up beside the Roadster: Model 3, Model Y, Model S, Model X, Cybercab,
// Cybertruck and Semi. The rounded cars are lofted: every cross-section of the body is a
// super-ellipse (flat sides, rounded shoulders) whose height, width and floor follow profiles
// along the car, with the floor rising over the wheels to cut the arches, and a glass canopy
// lofted on top of it. The Cybertruck and the Semi are extruded from their side outlines (flat,
// faceted panels for the truck, a rounded cab for the Semi). Lights, seams and trim are projected
// onto the finished body like the Roadster's. Built in a ground frame (y = 0 is the road, +z
// forward, +x the car's left), then shifted so the group's origin is the centre of mass.
// No badges or logos: the names are only in the menus.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hardpointY, type Car, type CarSpec } from '../sim/car';
import { Projector, line, mirrorX, profile } from './carBody';
import { PAINTS, glowTexture, shadowTexture } from './carModel';
import { Livery, type LiveryConfig, type LiveryShape } from './livery';
import type { RimStyle, WingStyle } from '../core/garage';

export type TeslaKind = 'model3' | 'modely' | 'models' | 'modelx' | 'cybercab' | 'cybertruck' | 'semi';

type Keys = [number, number][];
/** a lofted car: half length and half width, the top line of the body (to the belt under the
 *  glass), the glass canopy's roof line, the plan-view width, where the lights and seams go */
interface Loft {
  hl: number; w: number;
  top: Keys; roof: Keys; plan: Keys;
  /** the canopy runs from the cowl (front) to the end of the rear glass */
  glass: [number, number];
  /** how far the glass sits in from the body side at the belt, and its half width at the roof */
  shoulder: number; roofW: number;
  floor: number;
  /** headlights: [inner x, outer x] as a fraction of the width, their height; or a full light bar */
  head: { bar: boolean; y: number; h: number; x0: number; x1: number };
  tail: { bar: boolean; y: number; h: number; x0: number; x1: number };
  /** door seams (z) and black cladding over the arches and sills */
  doors: number[]; cladding: boolean;
  /** number roundels */
  livery: LiveryShape;
}

const LOFTS: Record<'model3' | 'modely' | 'models' | 'modelx' | 'cybercab', Loft> = {
  model3: {
    hl: 2.36, w: 0.925, floor: 0.16,
    top: [[2.36, 0.5], [2.3, 0.62], [2.1, 0.7], [1.6, 0.8], [1.0, 0.9], [0.85, 0.93], [0, 0.97], [-1.3, 1.02], [-1.75, 1.04], [-2.2, 1.0], [-2.36, 0.86]],
    roof: [[0.88, 0.93], [0.2, 1.36], [-0.3, 1.44], [-0.8, 1.42], [-1.4, 1.2], [-1.78, 1.05]],
    plan: [[2.36, 0.74], [2.25, 0.88], [2.0, 0.96], [1.4, 1], [-1.5, 1], [-2.1, 0.96], [-2.36, 0.86]],
    glass: [0.88, -1.78], shoulder: 0.2, roofW: 0.56,
    head: { bar: false, y: 0.55, h: 0.05, x0: 0.5, x1: 0.92 }, tail: { bar: false, y: 0.92, h: 0.08, x0: 0.55, x1: 0.95 },
    doors: [0.62, -0.42, -1.35], cladding: false,
    livery: { front: 2.36, rear: -2.36, stripe: [0.08, 0.24], side: [0.62, 0.66, 0.035], split: [0.95, 0.98], flames: [0.3, 0.92, 0.9], door: [-0.4, 0.6, 0.46], hood: [1.55, 0.5] },
  },
  modely: {
    hl: 2.4, w: 0.96, floor: 0.2,
    top: [[2.4, 0.56], [2.33, 0.7], [2.1, 0.8], [1.6, 0.9], [1.0, 1.0], [0.85, 1.04], [0, 1.1], [-1.3, 1.15], [-1.9, 1.16], [-2.25, 1.1], [-2.4, 0.96]],
    roof: [[0.88, 1.04], [0.25, 1.52], [-0.3, 1.62], [-0.9, 1.6], [-1.5, 1.42], [-1.95, 1.17]],
    plan: [[2.4, 0.76], [2.28, 0.88], [2.0, 0.96], [1.4, 1], [-1.5, 1], [-2.1, 0.97], [-2.4, 0.88]],
    glass: [0.88, -1.95], shoulder: 0.22, roofW: 0.58,
    head: { bar: true, y: 0.66, h: 0.035, x0: 0, x1: 0.94 }, tail: { bar: true, y: 1.04, h: 0.05, x0: 0, x1: 0.95 },
    doors: [0.62, -0.42, -1.4], cladding: true,
    livery: { front: 2.4, rear: -2.4, stripe: [0.08, 0.25], side: [0.7, 0.74, 0.035], split: [1.06, 1.1], flames: [0.36, 1.0, 0.92], door: [-0.4, 0.68, 0.48], hood: [1.6, 0.52] },
  },
  models: {
    hl: 2.51, w: 0.98, floor: 0.15,
    top: [[2.51, 0.5], [2.44, 0.6], [2.2, 0.68], [1.6, 0.79], [1.05, 0.88], [0.9, 0.92], [0, 0.97], [-1.4, 1.0], [-1.9, 1.02], [-2.35, 0.98], [-2.51, 0.84]],
    roof: [[0.93, 0.92], [0.25, 1.33], [-0.3, 1.43], [-0.9, 1.4], [-1.55, 1.18], [-1.95, 1.03]],
    plan: [[2.51, 0.74], [2.4, 0.88], [2.15, 0.96], [1.5, 1], [-1.6, 1], [-2.2, 0.96], [-2.51, 0.85]],
    glass: [0.93, -1.95], shoulder: 0.21, roofW: 0.58,
    head: { bar: false, y: 0.54, h: 0.045, x0: 0.52, x1: 0.93 }, tail: { bar: true, y: 0.93, h: 0.045, x0: 0.25, x1: 0.96 },
    doors: [0.66, -0.45, -1.45], cladding: false,
    livery: { front: 2.51, rear: -2.51, stripe: [0.08, 0.25], side: [0.6, 0.65, 0.035], split: [0.95, 0.98], flames: [0.3, 0.9, 0.92], door: [-0.45, 0.6, 0.46], hood: [1.65, 0.52] },
  },
  modelx: {
    hl: 2.53, w: 1.0, floor: 0.2,
    top: [[2.53, 0.58], [2.45, 0.72], [2.2, 0.82], [1.6, 0.93], [1.25, 1.0], [1.1, 1.03], [0, 1.1], [-1.5, 1.14], [-2.05, 1.15], [-2.4, 1.08], [-2.53, 0.95]],
    roof: [[1.13, 1.03], [0.3, 1.58], [-0.4, 1.68], [-1.2, 1.64], [-1.75, 1.45], [-2.1, 1.16]],
    plan: [[2.53, 0.76], [2.42, 0.89], [2.15, 0.97], [1.5, 1], [-1.6, 1], [-2.25, 0.97], [-2.53, 0.88]],
    glass: [1.13, -2.1], shoulder: 0.22, roofW: 0.6,
    head: { bar: false, y: 0.64, h: 0.05, x0: 0.5, x1: 0.92 }, tail: { bar: false, y: 1.05, h: 0.08, x0: 0.5, x1: 0.95 },
    doors: [0.75, -0.55], cladding: true,
    livery: { front: 2.53, rear: -2.53, stripe: [0.09, 0.26], side: [0.7, 0.75, 0.035], split: [1.06, 1.1], flames: [0.36, 1.02, 0.95], door: [-0.2, 0.7, 0.5], hood: [1.75, 0.55] },
  },
  // the two-seat robotaxi: a short teardrop with a fastback that runs right down to the tail
  cybercab: {
    hl: 2.12, w: 0.95, floor: 0.17,
    top: [[2.12, 0.5], [2.06, 0.62], [1.85, 0.7], [1.3, 0.8], [0.95, 0.88], [0.8, 0.9], [0, 0.95], [-1.2, 0.98], [-1.8, 0.95], [-2.12, 0.8]],
    roof: [[0.82, 0.9], [0.3, 1.3], [-0.2, 1.42], [-0.8, 1.38], [-1.5, 1.14], [-2.0, 0.92]],
    plan: [[2.12, 0.72], [2.0, 0.88], [1.7, 0.97], [1.1, 1], [-1.0, 1], [-1.7, 0.96], [-2.12, 0.78]],
    glass: [0.82, -2.0], shoulder: 0.2, roofW: 0.58,
    head: { bar: true, y: 0.56, h: 0.03, x0: 0, x1: 0.95 }, tail: { bar: true, y: 0.9, h: 0.04, x0: 0, x1: 0.96 },
    doors: [0.7, -0.75], cladding: false,
    livery: { front: 2.12, rear: -2.12, stripe: [0.08, 0.24], side: [0.62, 0.66, 0.035], split: [0.93, 0.96], flames: [0.3, 0.9, 0.9], door: [-0.1, 0.6, 0.46], hood: [1.4, 0.5] },
  },
};

const TRUCK_LIVERY: LiveryShape = { front: 2.84, rear: -2.84, stripe: [0.1, 0.3], side: [0.75, 0.8, 0.04], split: [1.1, 1.2], flames: [0.5, 1.05, 0.95], door: [0.2, 0.8, 0.55], hood: [1.9, 0.6] };
/** the Semi's cab, lofted in its own frame (shifted SEMI_SHIFT forward) right up to the roof: a
 *  low rounded nose, a steep wrap-round windscreen and a tall, rounded roof */
const SEMI_SHIFT = 1.15;
const SEMI_CAB: Loft = {
  hl: 2.05, w: 1.27, floor: 0.6,
  top: [[2.05, 0.72], [2.02, 1.1], [1.95, 1.5], [1.8, 1.85], [1.62, 2.05], [1.45, 2.18], [1.0, 2.95], [0.5, 3.48], [0, 3.72], [-1.0, 3.82], [-1.85, 3.8], [-2.05, 3.66]],
  roof: [], plan: [[2.05, 0.8], [1.9, 0.92], [1.6, 0.98], [1.2, 1], [-2.05, 1]],
  glass: [0, 0], shoulder: 0, roofW: 0,
  head: { bar: true, y: 0, h: 0, x0: 0, x1: 0 }, tail: { bar: true, y: 0, h: 0, x0: 0, x1: 0 },
  doors: [], cladding: false,
  livery: { front: 2.05, rear: -2.05, stripe: [0, 0], side: [0, 0, 0], split: [0, 0], flames: [0, 0, 0], door: [0, 0, 0], hood: null },
};
const SEMI_LIVERY: LiveryShape = { front: 3.2, rear: -3.2, stripe: [0.12, 0.34], side: [1.4, 1.4, 0.06], split: [2.0, 2.0], flames: [0.9, 2.2, 1.2], door: [1.9, 1.6, 0.8], hood: null };

/** the top of a wheel arch at z, over wheels at ±wz of radius r (a flat top, sloped sides) */
function arch(z: number, wz: number[], r: number) {
  let y = -1;
  for (const c of wz) {
    const top = 2 * r + 0.04, dz = Math.abs(z - c), flat = r * 0.55, slope = 2.2;
    if (dz < flat) y = Math.max(y, top);
    else y = Math.max(y, top - (dz - flat) * slope);
  }
  return y;
}

/** super-ellipse cross-sections lofted along z: a closed, smooth body with capped ends */
function loftBody(L: Loft, wheelZ: number[], R: number, n = 140, M = 18) {
  const top = profile(L.top), plan = profile(L.plan);
  const pos: number[] = [], idx: number[] = [];
  const ring = 2 * M;
  for (let i = 0; i <= n; i++) {
    const z = L.hl - (2 * L.hl * i) / n;
    const t = top(z), w = L.w * plan(z);
    const b = Math.min(t - 0.06, Math.max(L.floor, arch(z, wheelZ, R)));
    const yc = (b + t) / 2, hh = (t - b) / 2;
    const ends = Math.min(1, (L.hl - Math.abs(z)) / 0.06 + 0.15);
    const pts: [number, number][] = [];
    for (let k = 0; k <= M; k++) {
      const th = -Math.PI / 2 + (k / M) * Math.PI, c = Math.cos(th), s = Math.sin(th);
      const ny = s >= 0 ? 2.6 : 5;
      let x = w * Math.pow(Math.max(0, c), 2 / ny);
      const y = yc + hh * Math.sign(s) * Math.pow(Math.abs(s), 2 / ny);
      const u = (y - yc) / Math.max(0.01, hh);
      x *= 1 - 0.09 * Math.max(0, u) ** 1.5 - 0.05 * Math.max(0, -u) ** 2;
      pts.push([x * ends, y]);
    }
    for (let k = 0; k <= M; k++) pos.push(pts[k][0], pts[k][1], z);
    for (let k = M - 1; k >= 1; k--) pos.push(-pts[k][0], pts[k][1], z);
    if (i) {
      const a0 = (i - 1) * ring, a1 = i * ring;
      for (let k = 0; k < ring; k++) {
        const k1 = (k + 1) % ring;
        idx.push(a0 + k, a1 + k, a0 + k1, a0 + k1, a1 + k, a1 + k1);
      }
    }
  }
  // caps at the nose and the tail
  for (const [i, flip] of [[0, false], [n, true]] as const) {
    let cx = 0, cy = 0;
    for (let k = 0; k < ring; k++) { cy += pos[(i * ring + k) * 3 + 1]; }
    cy /= ring;
    const c = pos.length / 3;
    pos.push(cx, cy, pos[i * ring * 3 + 2]);
    for (let k = 0; k < ring; k++) {
      const k1 = (k + 1) % ring;
      if (flip) idx.push(c, i * ring + k1, i * ring + k); else idx.push(c, i * ring + k, i * ring + k1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** the glass canopy: an open loft from the cowl to the end of the rear glass, sitting on the body */
function loftGlass(L: Loft, range: [number, number] = L.glass, n = 70, M = 10) {
  const top = profile(L.top), roof = profile(L.roof), plan = profile(L.plan);
  const pos: number[] = [], idx: number[] = [];
  const ring = 2 * M + 1;
  for (let i = 0; i <= n; i++) {
    const z = range[0] + ((range[1] - range[0]) * i) / n;
    const w = L.w * plan(z), belt = top(z);
    const wb = w - L.shoulder, wt = Math.min(wb, L.roofW);
    // sit it a little into the body's rounded top
    const b = belt - 0.05;
    const H = Math.max(0.004, roof(z) - b);
    const pts: [number, number][] = [];
    for (let k = 0; k <= M; k++) {
      const ph = (k / M) * Math.PI / 2;
      const y = b + H * Math.pow(Math.sin(ph), 2 / 3.2);
      const A = wb + (wt - wb) * (y - b) / H;
      pts.push([A * Math.pow(Math.cos(ph), 2 / 3.2), y]);
    }
    for (let k = 0; k <= M; k++) pos.push(pts[k][0], pts[k][1], z);
    for (let k = M - 1; k >= 0; k--) pos.push(-pts[k][0], pts[k][1], z);
    if (i) {
      const a0 = (i - 1) * ring, a1 = i * ring;
      for (let k = 0; k < ring - 1; k++) idx.push(a0 + k, a0 + k + 1, a1 + k, a0 + k + 1, a1 + k + 1, a1 + k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** a side outline (z, y pairs, nose first, any winding) extruded across the car's width */
function extrudeSide(outline: [number, number][], halfW: number, bevel: number, segments = 2) {
  const s = new THREE.Shape();
  // shape x = -z, so the extrusion turned a quarter round puts the nose at +z
  outline.forEach(([z, y], k) => (k ? s.lineTo(-z, y) : s.moveTo(-z, y)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 2 * (halfW - bevel), bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: segments, curveSegments: 6 });
  g.rotateY(Math.PI / 2);
  g.translate(-(halfW - bevel), 0, 0);
  return g.index ? g : g;
}

/** a tyre (rounded shoulders) with the face towards +x */
function tyreGeometry(r: number, w: number) {
  const pts: THREE.Vector2[] = [];
  const rim = r * 0.66;
  pts.push(new THREE.Vector2(rim, -w / 2));
  for (let k = 0; k <= 12; k++) {
    const a = -Math.PI / 2 + (k / 12) * Math.PI;
    pts.push(new THREE.Vector2(r - 0.04 + Math.cos(a) * 0.04, Math.sin(a) * (w / 2 - 0.01)));
  }
  pts.push(new THREE.Vector2(rim, w / 2));
  return new THREE.LatheGeometry(pts, 40).rotateZ(-Math.PI / 2);
}

/** an aero wheel face: spokes in the rim colour over a dark centre, with a cap */
function wheelTexture(spokes: number) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#16171a'; c.beginPath(); c.arc(128, 128, 126, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#ffffff';
  for (let k = 0; k < spokes; k++) {
    c.save(); c.translate(128, 128); c.rotate((k / spokes) * Math.PI * 2);
    c.beginPath(); c.moveTo(-9, 20); c.lineTo(-20, 118); c.lineTo(20, 118); c.lineTo(9, 20); c.fill();
    c.restore();
  }
  c.lineWidth = 12; c.strokeStyle = '#ffffff'; c.beginPath(); c.arc(128, 128, 118, 0, Math.PI * 2); c.stroke();
  c.fillStyle = '#d9dbde'; c.beginPath(); c.arc(128, 128, 26, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#16171a'; c.beginPath(); c.arc(128, 128, 9, 0, Math.PI * 2); c.fill();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export class TeslaModel {
  readonly root = new THREE.Group();
  private shell = new THREE.Group();
  private wheels: { pivot: THREE.Group; spin: THREE.Group; extra: THREE.Group | null; left: boolean }[] = [];
  readonly paint: THREE.MeshPhysicalMaterial;
  private glass: THREE.MeshPhysicalMaterial;
  private brakeLight: THREE.MeshStandardMaterial;
  private headLight: THREE.MeshStandardMaterial;
  private rimMat: THREE.MeshStandardMaterial;
  private reflective: THREE.MeshStandardMaterial[] = [];
  private paintIndex = 0;
  private roll = 0; private pitch = 0;
  private livery: Livery | null = null;
  private liveryShape: LiveryShape;
  private glowMat: THREE.MeshBasicMaterial; private glow: THREE.Mesh;
  /** no active wing: no spoiler call-outs */
  onSpoiler?: (up: boolean) => void;

  constructor(readonly kind: TeslaKind, private spec: CarSpec) {
    const p = PAINTS[0];
    this.paint = new THREE.MeshPhysicalMaterial({ color: p.color, metalness: p.metalness, roughness: p.roughness, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 1.15 });
    this.glass = new THREE.MeshPhysicalMaterial({ color: 0x14181d, metalness: 0.35, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 1.6 });
    const trim = new THREE.MeshPhysicalMaterial({ color: 0x0b0b0c, roughness: 0.45, metalness: 0.2, clearcoat: 0.4 });
    const under = new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.9 });
    this.headLight = new THREE.MeshStandardMaterial({ color: 0xeaf4ff, emissive: 0xeaf6ff, emissiveIntensity: 0.6, roughness: 0.2 });
    this.brakeLight = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1020, emissiveIntensity: 1.2, roughness: 0.3 });
    this.rimMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, map: wheelTexture(kind === 'semi' ? 10 : kind === 'cybertruck' ? 6 : 5), roughness: 0.35, metalness: 0.6 });
    this.reflective.push(this.paint, this.glass, trim);

    this.shell.position.y = -spec.comHeight;
    this.root.add(this.shell);
    const R = spec.wheelRadius, wz = spec.wheelbase / 2;
    const add = (g: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], shadow = true) => {
      const mesh = new THREE.Mesh(g, m); mesh.castShadow = shadow; mesh.receiveShadow = true; this.shell.add(mesh); return mesh;
    };

    let body: THREE.Mesh;
    if (kind === 'cybertruck') { body = this.buildTruck(add, trim); this.liveryShape = TRUCK_LIVERY; }
    else if (kind === 'semi') { body = this.buildSemi(add, trim, under); this.liveryShape = SEMI_LIVERY; }
    else {
      const L = LOFTS[kind];
      this.liveryShape = L.livery;
      body = add(loftBody(L, [wz, -wz], R), this.paint);
      add(loftGlass(L), this.glass);
      this.loftDetails(L, body, trim);
    }
    // the floor pan between the wheels, so nothing shows through under the body
    if (kind !== 'semi') add(new THREE.BoxGeometry(spec.track - 0.42, 0.42, spec.wheelbase + 2 * R + 0.6).translate(0, 0.38, 0), under, false);

    // wheels: rounded tyres and an aero face in the rim colour
    const tyreM = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.9 });
    const tw = kind === 'semi' ? 0.36 : kind === 'cybertruck' ? 0.32 : 0.27;
    const tyre = tyreGeometry(R, tw), face = new THREE.CircleGeometry(R * 0.66, 32).rotateY(Math.PI / 2).translate(tw / 2 - 0.02, 0, 0);
    const makeWheel = (left: boolean) => {
      const spin = new THREE.Group();
      const t = new THREE.Mesh(tyre, tyreM); t.castShadow = true;
      const f = new THREE.Mesh(face, this.rimMat);
      if (!left) f.scale.x = -1;
      spin.add(t, f);
      return spin;
    };
    for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const left = x > 0, pivot = new THREE.Group(), spin = makeWheel(left);
      pivot.add(spin);
      pivot.position.set(x * spec.track / 2, R - spec.comHeight, z * wz);
      this.root.add(pivot);
      // the Semi's tandem: a second rear axle follows the first one
      let extra: THREE.Group | null = null;
      if (kind === 'semi' && z < 0) { extra = makeWheel(left); extra.position.z = -1.3; pivot.add(extra); }
      this.wheels.push({ pivot, spin, extra, left });
    }

    const len = kind === 'semi' ? 7.4 : kind === 'cybertruck' ? 6.2 : 5.4, wid = kind === 'semi' ? 3.2 : 2.5;
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(wid, len), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.85 }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = -spec.comHeight + 0.045; shadow.renderOrder = 1;
    this.root.add(shadow);
    this.glowMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0x2fe6ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 });
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(wid + 1, len + 1), this.glowMat);
    this.glow.rotation.x = -Math.PI / 2; this.glow.position.y = -spec.comHeight + 0.05; this.glow.renderOrder = 1;
    this.glow.visible = false;
    this.root.add(this.glow);
  }

  /** lights, seams, mirrors and cladding on a lofted body */
  private loftDetails(L: Loft, body: THREE.Mesh, trim: THREE.Material) {
    const pr = new Projector(body);
    const put = (geos: THREE.BufferGeometry[], m: THREE.Material) => geos.forEach(g => { const mesh = new THREE.Mesh(g, m); this.shell.add(mesh); });
    const W = L.w, F = L.hl + 1, B = -L.hl - 1;
    const back = new THREE.Vector3(0, 0, -1), fwd = new THREE.Vector3(0, 0, 1), side = new THREE.Vector3(-1, 0, 0);
    const plan = profile(L.plan);
    /** how far along the car the body reaches out to x (from the nose or the tail) */
    const reach = (x: number, front: boolean) => {
      for (let k = 0; k <= 200; k++) { const z = (front ? 1 : -1) * L.hl * (1 - k / 200); if (W * plan(z) >= x + 0.01) return z; }
      return 0;
    };
    const lamp = (spec: Loft['head'], front: boolean, m: THREE.Material) => {
      const z = front ? F : B, dir = front ? back : fwd;
      if (spec.bar) { put(pr.strip(line([-W * spec.x1, spec.y + spec.h, z], [W * spec.x1, spec.y + spec.h, z], 40), line([-W * spec.x1, spec.y, z], [W * spec.x1, spec.y, z], 40), dir, 0.005, false), m); return; }
      // aimed in from the front (or rear) corner so the lamp wraps round onto the wing
      const d = new THREE.Vector3(-0.7, 0, front ? -1 : 1).normalize();
      const at = (x: number, y: number) => { const p = new THREE.Vector3(x, y, reach(x, front)); return [p.x - d.x * 1.5, p.y, p.z - d.z * 1.5] as [number, number, number]; };
      const up: THREE.Vector3[] = [], lo: THREE.Vector3[] = [];
      for (let k = 0; k <= 16; k++) {
        const t = k / 16, x = W * (spec.x0 + (spec.x1 - spec.x0) * t);
        // a swept shape: thin at the inner end, taller and higher at the outer one
        up.push(new THREE.Vector3(...at(x, spec.y + spec.h * (0.6 + 0.6 * t))));
        lo.push(new THREE.Vector3(...at(x, spec.y - spec.h * (0.3 + 0.2 * t))));
      }
      // a dark glass housing with the LEDs along its top edge
      put(pr.strip(up, lo, d, 0.004), this.glass);
      put(pr.strip(up, up.map((p, k) => p.clone().lerp(lo[k], 0.4)), d, 0.007), m);
    };
    lamp(L.head, true, this.headLight);
    lamp(L.tail, false, this.brakeLight);
    if (L.tail.bar) {
      // the corners of a light bar are a little taller
      put(pr.strip(line([W * 0.7, L.tail.y + L.tail.h * 2, B], [W * 0.97, L.tail.y + L.tail.h * 2, B], 10), line([W * 0.7, L.tail.y, B], [W * 0.97, L.tail.y, B], 10), fwd, 0.006), this.brakeLight);
    }
    // no grille, just a slim black intake low in the bumper
    put(pr.strip(line([-W * 0.42, L.floor + 0.17, F], [W * 0.42, L.floor + 0.17, F], 20), line([-W * 0.4, L.floor + 0.1, F], [W * 0.4, L.floor + 0.1, F], 20), back, 0.004, false), trim);
    // door seams and handles
    const top = profile(L.top);
    for (const z of L.doors) {
      const yt = top(z) - 0.06;
      put(pr.strip(line([W + 1, yt, z + 0.006], [W + 1, L.floor + 0.12, z + 0.04], 14), line([W + 1, yt, z - 0.006], [W + 1, L.floor + 0.12, z + 0.028], 14), side, 0.003), trim);
    }
    for (let k = 0; k < L.doors.length - 1; k++) {
      const z = L.doors[k] - 0.3, y = top(z) - 0.16;
      put(pr.strip(line([W + 1, y + 0.025, z], [W + 1, y + 0.025, z - 0.2], 6), line([W + 1, y, z], [W + 1, y, z - 0.2], 6), side, 0.004), trim);
    }
    // black cladding over the arches and along the sills
    if (L.cladding) put(pr.strip(line([W + 1, L.floor + 0.22, L.hl - 0.15], [W + 1, L.floor + 0.22, -L.hl + 0.15], 60), line([W + 1, L.floor + 0.02, L.hl - 0.15], [W + 1, L.floor + 0.02, -L.hl + 0.15], 60), side, 0.004), trim);
    // mirrors on the doors, just behind the cowl
    const mz = L.glass[0] - 0.2, my = top(mz) - 0.03, mx = W * plan(mz) - 0.04;
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10).scale(0.8, 0.62, 0.62), this.paint);
      m.position.set(sx * (mx + 0.08), my, mz); m.castShadow = true;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.05), trim);
      arm.position.set(sx * (mx + 0.01), my - 0.02, mz + 0.01);
      this.shell.add(m, arm);
    }
  }

  /** the Cybertruck: flat stainless panels, a single crease from the nose to the tail, light bars */
  private buildTruck(add: (g: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], shadow?: boolean) => THREE.Mesh, trim: THREE.Material) {
    const S = this.spec, R = S.wheelRadius, wz = S.wheelbase / 2;
    const out: [number, number][] = [];
    const archPts = (c: number) => {
      const top = 2 * R + 0.1, half = R + 0.22;
      // a trapezoid arch, as square-cut as the rest of the truck
      return [[c + half, 0.46], [c + half - 0.18, top], [c - half + 0.18, top], [c - half, 0.46]] as [number, number][];
    };
    // side outline from the nose round the top and back along the bottom
    out.push([2.84, 0.48], [2.86, 1.0], [0.25, 1.79], [-2.84, 1.25], [-2.86, 0.55], [-2.6, 0.42]);
    out.push(...archPts(-wz).reverse().map(([z, y]) => [z, y] as [number, number]).reverse());
    out.push([-wz + R + 0.3, 0.42], [wz - R - 0.3, 0.42]);
    out.push(...archPts(wz));
    out.push([2.65, 0.44]);
    const body = add(extrudeSide(out.map(([z, y]) => [z, y]), 1.0, 0.025, 1), this.paint);
    // the glass: a long windscreen up the top slope, and the side windows under the crease
    const pr = new Projector(body);
    const put = (geos: THREE.BufferGeometry[], m: THREE.Material) => geos.forEach(g => this.shell.add(new THREE.Mesh(g, m)));
    const down = new THREE.Vector3(0, -1, 0), side = new THREE.Vector3(-1, 0, 0), back = new THREE.Vector3(0, 0, -1), fwd = new THREE.Vector3(0, 0, 1);
    put(pr.strip(line([0.82, 3, 1.25], [0.82, 3, 0.25], 16), line([-0.82, 3, 1.25], [-0.82, 3, 0.25], 16), down, 0.006, false), this.glass);
    put(pr.strip(line([2, 1.62, 1.1], [2, 1.7, -0.95], 20), line([2, 1.24, 1.2], [2, 1.24, -1.0], 20), side, 0.005), this.glass);
    // light bars across the nose and the tail
    put(pr.strip(line([-0.96, 1.0, 4], [0.96, 1.0, 4], 30), line([-0.96, 0.965, 4], [0.96, 0.965, 4], 30), back, 0.006, false), this.headLight);
    put(pr.strip(line([-0.97, 1.22, -4], [0.97, 1.22, -4], 30), line([-0.97, 1.17, -4], [0.97, 1.17, -4], 30), fwd, 0.006, false), this.brakeLight);
    // black trims round the square-cut arches, and the lower bumper
    for (const c of [wz, -wz]) {
      const a = archPts(c), up: THREE.Vector3[] = [], lo: THREE.Vector3[] = [];
      for (let k = 0; k < a.length - 1; k++) for (let j = 0; j < 8; j++) {
        const t = j / 8, z = a[k][0] + (a[k + 1][0] - a[k][0]) * t, y = a[k][1] + (a[k + 1][1] - a[k][1]) * t;
        // the trim's outer edge: pushed out from the arch's middle
        const ox = z - c, oy = y - 0.46, l = Math.hypot(ox, oy) || 1;
        up.push(new THREE.Vector3(2, y + (oy / l) * 0.09, z + (ox / l) * 0.09)); lo.push(new THREE.Vector3(2, y + 0.005, z));
      }
      put(pr.strip(up, lo, side, 0.006), trim);
    }
    add(new THREE.BoxGeometry(2.02, 0.16, 0.12).translate(0, 0.5, 2.86), trim, false);
    // door seams
    for (const z of [0.95, -0.15, -1.2]) put(pr.strip(line([2, 1.5, z + 0.005], [2, 0.5, z + 0.005], 10), line([2, 1.5, z - 0.005], [2, 0.5, z - 0.005], 10), side, 0.003), trim);
    // the vault: a tonneau cover over the bed
    add(new THREE.BoxGeometry(1.86, 0.02, 1.95).translate(0, 0, 0).rotateX(0.11).translate(0, 1.38, -1.9), trim, false);
    return body;
  }

  /** the Semi tractor: a rounded aero cab lofted like the cars (its own frame, shifted forward
   *  over the front axle), with a wrap-round windscreen, side fairings, a chassis and fifth wheel
   *  behind it, light bars, and a tandem rear axle */
  private buildSemi(add: (g: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], shadow?: boolean) => THREE.Mesh, trim: THREE.Material, under: THREE.Material) {
    const S = this.spec, R = S.wheelRadius, wz = S.wheelbase / 2, shift = SEMI_SHIFT;
    const body = add(loftBody(SEMI_CAB, [wz - shift], R, 160, 22).translate(0, 0, shift), this.paint);
    const pr = new Projector(body);
    const put = (geos: THREE.BufferGeometry[], m: THREE.Material) => geos.forEach(g => this.shell.add(new THREE.Mesh(g, m)));
    const back = new THREE.Vector3(0, 0, -1), side = new THREE.Vector3(-1, 0, 0);
    // the wrap-round windscreen up the slope, and the side windows behind it
    put(pr.strip(line([-1.05, 3.3, 6], [1.05, 3.3, 6], 40, [0, 0.06, 0]), line([-1.12, 2.3, 6], [1.12, 2.3, 6], 40), back, 0.006, false), this.glass);
    put(pr.strip(line([2, 3.3, 2.2], [2, 3.5, 0.75], 14), line([2, 2.45, 2.55], [2, 2.45, 0.75], 14), side, 0.006), this.glass);
    // a light bar across the nose, headlamps in its corners, and a slim intake under them
    put(pr.strip(line([-1.15, 1.7, 5], [1.15, 1.7, 5], 40), line([-1.15, 1.65, 5], [1.15, 1.65, 5], 40), back, 0.008, false), this.headLight);
    put(pr.strip(line([0.62, 1.42, 5], [1.05, 1.48, 5], 12), line([0.62, 1.32, 5], [1.05, 1.34, 5], 12), back, 0.008), this.headLight);
    put(pr.strip(line([-0.7, 1.0, 5], [0.7, 1.0, 5], 20), line([-0.7, 0.86, 5], [0.7, 0.86, 5], 20), back, 0.006, false), trim);
    // the door seam, and black cladding along the bottom of the cab
    put(pr.strip(line([2, 2.15, 0.7], [2, 1.2, 0.7], 10), line([2, 2.15, 0.68], [2, 1.2, 0.68], 10), side, 0.004), trim);
    put(pr.strip(line([2, 0.95, 3.0], [2, 0.95, -0.8], 40), line([2, 0.66, 3.0], [2, 0.66, -0.8], 40), side, 0.005), trim);
    // the chassis behind the cab and the fifth wheel
    add(new THREE.BoxGeometry(1.1, 0.32, 3.0).translate(0, 1.0, -2.2), under, false);
    add(new THREE.CylinderGeometry(0.62, 0.62, 0.1, 24).translate(0, 1.22, -2.35), trim, false);
    for (const sx of [-1, 1]) {
      // tail lights on the chassis ends, and fenders over the tandem
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.03), this.brakeLight);
      tl.position.set(sx * 0.95, 1.1, -3.72); this.shell.add(tl);
      add(new THREE.BoxGeometry(0.42, 0.06, 2.4).translate(sx * (S.track / 2), 2 * R + 0.12, -wz - 0.65), trim, false);
    }
    add(new THREE.BoxGeometry(2.3, 0.14, 0.12).translate(0, 0.62, -3.75), trim, false);
    return body;
  }

  /** the livery on the paint (a copy of the model makes its own) */
  setLivery(cfg: LiveryConfig) {
    if (!this.livery || this.livery.material !== this.paint) this.livery = new Livery(this.paint, this.liveryShape);
    this.livery.set(cfg);
  }

  setSoot(v: number) { if (this.livery) this.livery.soot = v; }

  /** garage parts: the rim style and colour, the glass tint and the underglow (no wing) */
  setParts(p: { rims: RimStyle; rimColor: number; wing: WingStyle; glass: number; glow: number }) {
    this.rimMat.color.setHex(p.rims === 'aero' ? 0xe2e4e6 : p.rimColor);
    this.rimMat.metalness = p.rims === 'painted' ? 0.3 : 0.6;
    // the glass keeps its dark tint, leaning towards the colour picked
    this.glass.color.setHex(p.glass).lerp(new THREE.Color(0x101318), 0.6);
    this.glow.visible = p.glow !== 0;
    if (p.glow) this.glowMat.color.setHex(p.glow);
  }

  get bodyShell() { return this.shell; }

  get paintName() { return PAINTS[this.paintIndex].name; }

  nextPaint() {
    this.paintIndex = (this.paintIndex + 1) % PAINTS.length;
    const p = PAINTS[this.paintIndex];
    this.paint.color.setHex(p.color); this.paint.metalness = p.metalness; this.paint.roughness = p.roughness;
  }

  setNight(night: boolean) { this.headLight.emissiveIntensity = night ? 4 : 0.6; this.glowMat.opacity = night ? 1 : 0.65; }

  setReflections(tex: THREE.Texture | null) {
    for (const m of this.reflective) { m.envMap = tex; m.needsUpdate = true; }
  }

  /** showroom: nothing moves on its own */
  showSpoiler(_up: boolean) { /* no wing */ }
  animate(_dt: number) { /* no wing */ }

  /** sync the wheels and the brake lights with the physics car, and roll and pitch the body */
  update(car: Car, braking: boolean, dt: number) {
    const S = this.spec, hardY = hardpointY(S);
    car.wheels.forEach((w, i) => {
      const vw = this.wheels[i];
      vw.pivot.position.y = hardY - Math.min(w.suspension, S.restLength + 0.02);
      vw.pivot.rotation.y = w.steer;
      vw.spin.rotation.x = w.spin;
      if (vw.extra) vw.extra.rotation.x = w.spin;
    });
    this.brakeLight.emissiveIntensity = braking ? 5 : 1.2;
    const k = Math.min(1, dt * 6), tall = this.kind === 'semi' ? 0.5 : this.kind === 'modelx' || this.kind === 'modely' || this.kind === 'cybertruck' ? 1.25 : 1;
    this.roll += (THREE.MathUtils.clamp(-car.latAccel * 0.004 * tall, -0.06, 0.06) - this.roll) * k;
    this.pitch += (THREE.MathUtils.clamp(-car.longAccel * 0.0026 * tall, -0.04, 0.04) - this.pitch) * k;
    this.shell.rotation.set(this.pitch, 0, this.roll);
  }
}

/** all the parts above in one geometry (unused helper kept small: merge for instancing later) */
export const mergeParts = (g: THREE.BufferGeometry[]) => mergeGeometries(g);
export { mirrorX };
