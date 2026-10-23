// Everything you see around the car: landscape, road, kerbs, barriers, catch fence, start
// gantry, grandstand, the charging pavilion and trees.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Track } from '../sim/track';
import { fbm, type Terrain } from '../sim/terrain';
import { WALL_HEIGHT } from '../sim/world';
import { racingLine } from '../sim/racingLine';
import type { Quality } from './graphics';
import { enhanceSurface } from './surfaces';
import { partitionInstances } from './resources';
import { asphaltTexture, fenceTexture, grassTexture, signTexture } from './textures';

const ROAD_Y = 0.03;

interface StripPoint { d: number; y: number; u: number }

/** a ribbon swept along the whole circuit through the given cross-section points */
function strip(track: Track, pts: StripPoint[], vScale: number, extra?: (i: number, j: number) => number) {
  const n = track.n, rows = n + 1, cols = pts.length;
  const pos = new Float32Array(rows * cols * 3), uv = new Float32Array(rows * cols * 2);
  const ex = extra ? new Float32Array(rows * cols) : null;
  const p = new THREE.Vector3();
  for (let i = 0; i < rows; i++) {
    const s = i === n ? track.total : track.s[i];
    for (let j = 0; j < cols; j++) {
      track.pointAt(s % track.total, pts[j].d, p);
      const k = i * cols + j;
      pos.set([p.x, p.y + pts[j].y, p.z], k * 3);
      uv.set([pts[j].u, s / vScale], k * 2);
      if (ex) ex[k] = extra!(i % n, j);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols - 1; j++) {
    const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
    // counter-clockwise seen from above when the points run left to right across the road
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (ex) g.setAttribute('rl', new THREE.BufferAttribute(ex, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** fix winding so a strip faces up/inward whichever side of the road it is on */
function flipIfNeeded(g: THREE.BufferGeometry, flip: boolean) {
  if (!flip) return g;
  const idx = g.getIndex()!;
  for (let k = 0; k < idx.count; k += 3) { const t = idx.getX(k + 1); idx.setX(k + 1, idx.getX(k + 2)); idx.setX(k + 2, t); }
  g.computeVertexNormals();
  return g;
}

export class TrackScene {
  readonly group = new THREE.Group();
  private lights: THREE.MeshStandardMaterial[] = [];

  constructor(private track: Track, private terrain: Terrain, quality: Quality) {
    this.buildTerrain(quality);
    this.buildRoad();
    this.buildKerbs();
    this.buildBarriers(quality);
    this.buildGantry();
    this.buildGrandstand(quality);
    this.buildPavilion();
    this.buildTrees(quality);
  }

  private buildTerrain(quality: Quality) {
    const t = this.terrain;
    const stride = quality === 'low' ? 4 : 2;
    const cx = Math.floor((t.nx - 1) / stride) + 1, cz = Math.floor((t.nz - 1) / stride) + 1;
    const pos = new Float32Array(cx * cz * 3), col = new Float32Array(cx * cz * 3), uv = new Float32Array(cx * cz * 2);
    const c = new THREE.Color();
    const near = new THREE.Color(0x4d7a2c), meadow = new THREE.Color(0x6f8a3a), dry = new THREE.Color(0x9a9450),
      rock = new THREE.Color(0x7d776e), snow = new THREE.Color(0xf2f4f8), forest = new THREE.Color(0x3c5a26);
    for (let jz = 0; jz < cz; jz++) for (let jx = 0; jx < cx; jx++) {
      const ix = Math.min(t.nx - 1, jx * stride), iz = Math.min(t.nz - 1, jz * stride);
      const k = iz * t.nx + ix, v = jz * cx + jx;
      const x = t.x0 + ix * t.cell, z = t.z0 + iz * t.cell, h = t.heights[k];
      pos.set([x, h, z], v * 3);
      uv.set([x / 5, z / 5], v * 2);
      const hx = t.heights[iz * t.nx + Math.min(t.nx - 1, ix + 1)] - h, hz = t.heights[Math.min(t.nz - 1, iz + 1) * t.nx + ix] - h;
      const slope = Math.hypot(hx, hz) / t.cell;
      const n1 = fbm(x / 70, z / 70, 3), n2 = fbm(x / 23 + 5, z / 23, 2);
      c.copy(meadow).lerp(dry, Math.max(0, n1 - 0.45) * 1.6).lerp(forest, Math.max(0, 0.45 - n1) * 1.2);
      const d = t.dist[k];
      if (d < 40) c.lerp(near, 1 - Math.max(0, (d - 20) / 20));
      const rockiness = Math.min(1, Math.max(0, (h - 22 - n2 * 18) / 14) + Math.max(0, slope - 0.55) * 2.5);
      c.lerp(rock, rockiness);
      c.lerp(snow, Math.min(1, Math.max(0, (h - 105 - n2 * 30) / 12)));
      c.multiplyScalar(0.88 + n2 * 0.24);
      col.set([c.r, c.g, c.b], v * 3);
    }
    const idx = new Uint32Array((cx - 1) * (cz - 1) * 6);
    let q = 0;
    for (let jz = 0; jz < cz - 1; jz++) for (let jx = 0; jx < cx - 1; jx++) {
      const a = jz * cx + jx, b = a + 1, cc = a + cx, d = cc + 1;
      idx.set([a, cc, b, b, cc, d], q); q += 6;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    const tex = grassTexture();
    const m = enhanceSurface(new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, roughness: 0.96, metalness: 0 }), { vary: 0.16, freq: 0.012 });
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  private buildRoad() {
    const tr = this.track, hw = tr.halfWidth;
    // rubbered-in racing line, as 0..1 across the road
    const rl = Array.from(racingLine(tr), o => (o + hw) / (2 * hw));
    const pts: StripPoint[] = [];
    for (let j = 0; j <= 8; j++) { const f = j / 8; pts.push({ d: -hw + f * 2 * hw, y: ROAD_Y, u: f }); }
    const g = strip(tr, pts, 7, i => rl[i]);
    const asphalt = asphaltTexture();
    asphalt.repeat.set(2, 1);
    const m = enhanceSurface(new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.82, metalness: 0, bumpMap: asphalt, bumpScale: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      { vary: 0.1, freq: 0.03, rubber: 0.38 });
    const road = new THREE.Mesh(g, m);
    road.receiveShadow = true;
    this.group.add(road);

    // white edge lines and a chequered start/finish line
    const lineM = new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    for (const side of [-1, 1]) {
      const d0 = side * (hw - 0.35), d1 = side * (hw - 0.15);
      const lg = flipIfNeeded(strip(tr, [{ d: Math.min(d0, d1), y: ROAD_Y + 0.004, u: 0 }, { d: Math.max(d0, d1), y: ROAD_Y + 0.004, u: 1 }], 10), false);
      const l = new THREE.Mesh(lg, lineM); l.receiveShadow = true; this.group.add(l);
    }
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 32;
    const c2 = cv.getContext('2d')!;
    for (let x = 0; x < 32; x++) for (let y = 0; y < 4; y++) { c2.fillStyle = (x + y) % 2 ? '#111' : '#eee'; c2.fillRect(x * 8, y * 8, 8, 8); }
    const ct = new THREE.CanvasTexture(cv); ct.colorSpace = THREE.SRGBColorSpace; ct.magFilter = THREE.NearestFilter;
    const start = new THREE.Mesh(new THREE.PlaneGeometry(2 * hw, 1.6), new THREE.MeshStandardMaterial({ map: ct, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    const p = tr.pointAt(0, 0);
    start.position.set(p.x, p.y + ROAD_Y + 0.005, p.z);
    start.rotation.set(-Math.PI / 2, 0, tr.headingAt(0) + Math.PI / 2, 'YXZ');
    start.rotation.order = 'YXZ'; start.rotation.y = tr.headingAt(0) + Math.PI / 2; start.rotation.x = -Math.PI / 2; start.rotation.z = 0;
    start.receiveShadow = true;
    this.group.add(start);
  }

  private buildKerbs() {
    const tr = this.track, hw = tr.halfWidth;
    const grown = tr.kerb;
    const pos: number[] = [], col: number[] = [], nor: number[] = [];
    const red = new THREE.Color(0xd8262c), white = new THREE.Color(0xf4f4f4);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3();
    const step = tr.total / tr.n;
    for (const side of [-1, 1]) for (let i = 0; i < tr.n; i++) {
      if (!grown[i] || !grown[tr.wrap(i + 1)]) continue;
      const s0 = tr.s[i], s1 = s0 + step;
      const inner = side * (hw - 0.05), outer = side * (hw + 1.25);
      tr.pointAt(s0, inner, a); tr.pointAt(s0, outer, b); tr.pointAt(s1, inner, c); tr.pointAt(s1, outer, d);
      const y = ROAD_Y + 0.008;
      const quad = side > 0 ? [a, b, c, b, d, c] : [a, c, b, b, c, d];
      const colr = Math.floor(s0 / 2.5) % 2 ? red : white;
      for (const v of quad) { pos.push(v.x, v.y + y, v.z); col.push(colr.r, colr.g, colr.b); nor.push(0, 1, 0); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const kerbs = new THREE.Mesh(g, m); kerbs.receiveShadow = true;
    this.group.add(kerbs);
  }

  private buildBarriers(quality: Quality) {
    const tr = this.track, W = tr.wallOffset, H = WALL_HEIGHT;
    const concrete = enhanceSurface(new THREE.MeshStandardMaterial({ color: 0xd9d9d4, roughness: 0.85 }), { vary: 0.14, freq: 0.15 });
    const band = new THREE.MeshStandardMaterial({ color: 0x1673c9, roughness: 0.5 });
    for (const side of [-1, 1]) {
      // inner face (with a painted band), top and outer face, each its own strip for crisp edges
      const faces: [StripPoint, StripPoint, THREE.Material][] = [
        [{ d: side * W, y: -0.3, u: 0 }, { d: side * W, y: H * 0.62, u: 1 }, concrete],
        [{ d: side * W, y: H * 0.62, u: 0 }, { d: side * W, y: H, u: 1 }, band],
        [{ d: side * W, y: H, u: 0 }, { d: side * (W + 0.45), y: H, u: 1 }, concrete],
        [{ d: side * (W + 0.45), y: H, u: 0 }, { d: side * (W + 0.45), y: -0.3, u: 1 }, concrete],
      ];
      for (const [p0, p1, mat] of faces) {
        const g = flipIfNeeded(strip(tr, [p0, p1], 4), side < 0);
        const mesh = new THREE.Mesh(g, mat);
        mesh.castShadow = quality !== 'low'; mesh.receiveShadow = true;
        this.group.add(mesh);
      }
    }
    if (quality === 'low') return;
    // debris fence on top of the barriers, with posts every 6 m
    const ft = fenceTexture();
    const fm = new THREE.MeshStandardMaterial({ map: ft, alphaTest: 0.4, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5, color: 0xc8ccd0 });
    const posts: THREE.Matrix4[] = [];
    for (const side of [-1, 1]) {
      const d = side * (W + 0.3);
      const g = strip(tr, [{ d, y: H, u: 0 }, { d, y: H + 2.6, u: 2.6 / 1.2 }], 1.2);
      // uv.y runs along the track; swap so the diamond pattern repeats both ways
      const uv = g.getAttribute('uv');
      for (let k = 0; k < uv.count; k++) { const u = uv.getX(k), v = uv.getY(k); uv.setXY(k, v, u); }
      this.group.add(new THREE.Mesh(g, fm));
      for (let s = 0; s < tr.total; s += 6) {
        const p = tr.pointAt(s, d);
        posts.push(new THREE.Matrix4().makeTranslation(p.x, p.y + H + 1.3, p.z));
      }
    }
    const postMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6), new THREE.MeshStandardMaterial({ color: 0x8a9096, metalness: 0.7, roughness: 0.4 }), posts.length);
    posts.forEach((m, i) => postMesh.setMatrixAt(i, m));
    postMesh.castShadow = true;
    for (const batch of partitionInstances(postMesh)) this.group.add(batch);
  }

  /** place an object at arc length s, lateral d, facing along the track */
  private placeAt(obj: THREE.Object3D, s: number, d: number, yOffset = 0) {
    const p = this.track.pointAt(s, d);
    obj.position.set(p.x, this.terrain.heightAt(p.x, p.z) + yOffset, p.z);
    obj.rotation.y = this.track.headingAt(s);
    this.group.add(obj);
    return obj;
  }

  private buildGantry() {
    const hw = this.track.halfWidth;
    const g = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x2b3038, metalness: 0.8, roughness: 0.35 });
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7.2, 0.6), steel);
      pillar.position.set(side * (hw + 1.6), 3.6, 0); pillar.castShadow = true; g.add(pillar);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2 * hw + 4, 1.4, 0.8), steel);
    beam.position.set(0, 6.6, 0); beam.castShadow = true; g.add(beam);
    // the sign faces oncoming cars (the car drives along +z towards it)
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2 * hw + 2, 1.15), new THREE.MeshStandardMaterial({ map: signTexture('ROADSTER CIRCUIT', 'START · FINISH'), emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.4 }));
    sign.material.emissiveMap = sign.material.map;
    sign.position.set(0, 6.6, -0.41); sign.rotation.y = Math.PI; g.add(sign);
    for (let k = 0; k < 5; k++) {
      const lm = new THREE.MeshStandardMaterial({ color: 0x220606, emissive: 0xff1a1a, emissiveIntensity: 0, roughness: 0.3 });
      const l = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16), lm);
      l.position.set((k - 2) * 0.75, 5.55, -0.41); l.rotation.y = Math.PI;
      g.add(l); this.lights.push(lm);
    }
    this.placeAt(g, 0, 0, 0);
    g.position.y = this.track.pointAt(0, 0).y;
  }

  /** start lights: n of 5 lit (0 = all off) */
  setStartLights(n: number) {
    this.lights.forEach((m, k) => { m.emissiveIntensity = k < n ? 3 : 0; });
  }

  private buildGrandstand(quality: Quality) {
    const tr = this.track;
    const len = 130, rows = 12;
    const g = new THREE.Group();
    const concrete = new THREE.MeshStandardMaterial({ color: 0xb9bab5, roughness: 0.9 });
    const seatsA = new THREE.MeshStandardMaterial({ color: 0x1d5fa8, roughness: 0.6 });
    const seatsB = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.6 });
    for (let r = 0; r < rows; r++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(len, 0.5 + r * 0.55, 0.85), concrete);
      step.position.set(0, (0.5 + r * 0.55) / 2, -r * 0.85); step.castShadow = step.receiveShadow = true;
      g.add(step);
      const seat = new THREE.Mesh(new THREE.BoxGeometry(len - 1, 0.18, 0.45), r % 4 === 1 ? seatsB : seatsA);
      seat.position.set(0, 0.5 + r * 0.55 + 0.09, -r * 0.85 - 0.15); g.add(seat);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(len, 9, 0.4), concrete);
    back.position.set(0, 4.5, -rows * 0.85); back.castShadow = true; g.add(back);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 4, 0.35, rows * 0.85 + 4), new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.4, metalness: 0.3 }));
    roof.position.set(0, 10.2, -rows * 0.85 / 2 + 1.2); roof.rotation.x = -0.06; roof.castShadow = true; g.add(roof);
    for (let x = -len / 2; x <= len / 2; x += 16) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 10), new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.6, roughness: 0.4 }));
      col.position.set(x, 5, -rows * 0.85); g.add(col);
    }
    // spectators: instanced, about two-thirds of the seats filled
    if (quality !== 'low') {
      const body = new THREE.BoxGeometry(0.42, 0.62, 0.3).translate(0, 0.31, 0);
      const head = new THREE.SphereGeometry(0.13, 8, 6).translate(0, 0.78, 0);
      const person = mergeGeometries([body.toNonIndexed(), head.toNonIndexed()])!;
      const per = Math.floor(len / 0.6) * rows;
      const crowd = new THREE.InstancedMesh(person, new THREE.MeshStandardMaterial({ roughness: 0.8 }), per);
      const m = new THREE.Matrix4(), c = new THREE.Color();
      const shirts = [0xd13b3b, 0x2e6fd1, 0xf2f2f2, 0x222222, 0xf2c230, 0x3aa45a, 0x8f4fd1, 0x38c8e8];
      let k = 0, seed = 11;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let r = 0; r < rows; r++) for (let x = -len / 2 + 1; x < len / 2 - 1; x += 0.6) {
        if (rnd() < 0.34) continue;
        m.makeTranslation(x + (rnd() - 0.5) * 0.1, 0.5 + r * 0.55 + 0.18, -r * 0.85 - 0.2);
        crowd.setMatrixAt(k, m);
        crowd.setColorAt(k, c.setHex(shirts[Math.floor(rnd() * shirts.length)]));
        k++;
      }
      crowd.count = k;
      g.add(crowd);
    }
    // the grandstand sits on the outside of the main straight, facing the track
    const s = 150, d = -(tr.wallOffset + 7);
    const p = tr.pointAt(s, d);
    g.position.set(p.x, tr.pointAt(s, 0).y - 0.2, p.z);
    g.rotation.y = tr.headingAt(s) - Math.PI / 2;
    this.group.add(g);
  }

  /** a modern glass charging pavilion on the inside of the main straight */
  private buildPavilion() {
    const tr = this.track;
    const g = new THREE.Group();
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x1c2a36, metalness: 0.2, roughness: 0.04, clearcoat: 1, reflectivity: 0.9, envMapIntensity: 1.6 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.35, metalness: 0.1 });
    const L = 74, D = 16, H = 7;
    const box = new THREE.Mesh(new THREE.BoxGeometry(L, H, D), glass);
    box.position.set(0, H / 2, -D / 2 - 6); box.castShadow = box.receiveShadow = true; g.add(box);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(L + 10, 0.6, D + 14), white);
    roof.position.set(0, H + 0.3, -D / 2 - 1); roof.castShadow = true; g.add(roof);
    // solar panels on the roof
    const panelM = new THREE.MeshStandardMaterial({ color: 0x0d1a33, metalness: 0.5, roughness: 0.15 });
    for (let x = -L / 2; x < L / 2 - 2; x += 4.2) for (let z = -D - 4; z < 4; z += 3) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(4, 0.08, 2.6), panelM);
      p.position.set(x + 2, H + 0.75, z); p.rotation.x = -0.12; g.add(p);
    }
    // canopy columns and a row of charging posts with glowing strips
    const post = new THREE.BoxGeometry(0.35, 1.7, 0.35);
    const glow = new THREE.MeshStandardMaterial({ color: 0x0b1b22, emissive: 0x38e8ff, emissiveIntensity: 1.6 });
    for (let x = -L / 2 + 3; x < L / 2; x += 5) {
      const c = new THREE.Mesh(post, white); c.position.set(x, 0.85, 3); c.castShadow = true; g.add(c);
      const strip2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 0.02), glow); strip2.position.set(x, 0.95, 3.18); g.add(strip2);
    }
    for (const x of [-L / 2 - 4, -L / 4, 0, L / 4, L / 2 + 4]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, H), white);
      col.position.set(x, H / 2, 5.5); col.castShadow = true; g.add(col);
    }
    const name = new THREE.Mesh(new THREE.PlaneGeometry(24, 1.6), new THREE.MeshStandardMaterial({ map: signTexture('CHARGE HUB', 'PADDOCK', 1024, 96), emissive: 0xffffff, emissiveIntensity: 0.3 }));
    (name.material as THREE.MeshStandardMaterial).emissiveMap = (name.material as THREE.MeshStandardMaterial).map;
    name.position.set(0, H - 0.8, 6.01); g.add(name);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(L + 16, 0.3, D + 22), new THREE.MeshStandardMaterial({ color: 0x8c8e90, roughness: 0.9 }));
    pad.position.set(0, -0.1, -D / 2 - 1); pad.receiveShadow = true; g.add(pad);

    const s = 120, d = tr.wallOffset + 14;
    const p = tr.pointAt(s, d);
    g.position.set(p.x, tr.pointAt(s, 0).y, p.z);
    // its front (+z) faces the track, which is to its left (-d)
    g.rotation.y = tr.headingAt(s) - Math.PI / 2 + Math.PI;
    this.group.add(g);
  }

  private buildTrees(quality: Quality) {
    const t = this.terrain, tr = this.track;
    const count = quality === 'low' ? 1200 : quality === 'medium' ? 3500 : 6500;
    const tint = (g: THREE.BufferGeometry, top: THREE.Color, bottom: THREE.Color, y0: number, y1: number) => {
      const ng = g.index ? g.toNonIndexed() : g, p = ng.getAttribute('position'), col = new Float32Array(p.count * 3), c = new THREE.Color();
      for (let i = 0; i < p.count; i++) { c.copy(bottom).lerp(top, Math.min(1, Math.max(0, (p.getY(i) - y0) / (y1 - y0)))); col.set([c.r, c.g, c.b], i * 3); }
      ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return ng;
    };
    const trunkC = new THREE.Color(0x4a3526);
    const conifer = mergeGeometries([
      tint(new THREE.CylinderGeometry(0.18, 0.25, 2.4, 6).translate(0, 1.2, 0), trunkC, trunkC, 0, 1),
      tint(new THREE.ConeGeometry(2.4, 4.2, 8).translate(0, 3.6, 0), new THREE.Color(0x2d5a2a), new THREE.Color(0x1b3a1c), 1.5, 5.7),
      tint(new THREE.ConeGeometry(1.9, 3.6, 8).translate(0, 5.6, 0), new THREE.Color(0x356634), new THREE.Color(0x1f421f), 3.8, 7.4),
      tint(new THREE.ConeGeometry(1.2, 3.0, 8).translate(0, 7.6, 0), new THREE.Color(0x3d7039), new THREE.Color(0x24492a), 6.1, 9.1),
    ])!;
    const leafTop = new THREE.Color(0x5f8a35), leafBottom = new THREE.Color(0x2f4f1e);
    const broad = mergeGeometries([
      tint(new THREE.CylinderGeometry(0.2, 0.32, 3.2, 6).translate(0, 1.6, 0), trunkC, trunkC, 0, 1),
      tint(new THREE.IcosahedronGeometry(2.4, 1).translate(0, 4.6, 0), leafTop, leafBottom, 2.4, 7),
      tint(new THREE.IcosahedronGeometry(1.8, 1).translate(1.4, 4.0, 0.6), leafTop, leafBottom, 2.4, 6),
      tint(new THREE.IcosahedronGeometry(1.7, 1).translate(-1.2, 4.2, -0.8), leafTop, leafBottom, 2.4, 6),
      tint(new THREE.IcosahedronGeometry(1.5, 1).translate(0.2, 6.0, -0.2), leafTop, leafBottom, 4.5, 7.5),
    ])!;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    const kinds = [new THREE.InstancedMesh(conifer, mat, count), new THREE.InstancedMesh(broad, mat, count)];
    const used = [0, 0];
    let seed = 99;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    // keep the buildings' plots clear
    const keepOut = [tr.pointAt(150, -(tr.wallOffset + 12)), tr.pointAt(120, tr.wallOffset + 20)];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    for (let tries = 0; tries < count * 12 && used[0] + used[1] < count * 2 - 2; tries++) {
      const x = t.x0 + rnd() * t.width, z = t.z0 + rnd() * t.depth;
      const d = t.distAt(x, z);
      if (d < 26) continue;
      const h = t.heightAt(x, z);
      if (h > 60) continue;
      // woods in clusters: dense where the noise is low, sparse elsewhere, thinning far from the track
      const n = fbm(x / 90, z / 90, 3);
      const density = (n < 0.42 ? 1 : 0.12) * (d < 300 ? 1 : 0.5);
      if (rnd() > density) continue;
      if (keepOut.some(k => Math.hypot(k.x - x, k.z - z) < 75)) continue;
      const kind = n < 0.36 || h > 25 ? 0 : rnd() < 0.5 ? 0 : 1;
      if (used[kind] >= count) continue;
      const s = 0.7 + rnd() * 0.8;
      m.compose(p.set(x, h - 0.3, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28), sc.set(s, s * (0.85 + rnd() * 0.35), s));
      kinds[kind].setMatrixAt(used[kind], m);
      kinds[kind].setColorAt(used[kind], c.setScalar(0.8 + rnd() * 0.35));
      used[kind]++;
    }
    kinds.forEach((k, i) => {
      k.count = used[i];
      k.castShadow = quality !== 'low';
      for (const batch of partitionInstances(k, 300)) this.group.add(batch);
    });
  }
}
