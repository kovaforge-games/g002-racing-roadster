// The pit lane: its tarmac and lines, the pit wall with its catch fence, a box for every car
// painted on the lane with its number, the pit garages under a long canopy, PIT IN and PIT OUT
// signs, the speed limit boards, and a crew at every box who run out and change the tyres when
// their car stops.
import * as THREE from 'three';
import type { Track } from '../sim/track';
import { PIT, boxS, laneD, laneEdges } from '../sim/pits';
import { PIT_WALL_HEIGHT } from '../sim/world';
import { asphaltTexture, signTexture } from './textures';
import { enhanceSurface } from './surfaces';
import type { Quality } from './graphics';

const Y = 0.035;

/** a flat ribbon between two lateral offsets along an arc length range */
function ribbon(track: Track, s0: number, s1: number, d0: (s: number) => number, d1: (s: number) => number, y = Y, step = 2, vScale = 7) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const p = new THREE.Vector3();
  const n = Math.max(1, Math.ceil((s1 - s0) / step));
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n;
    for (const [j, d] of [d0(s), d1(s)].entries()) {
      track.pointAt(s, d, p);
      pos.push(p.x, p.y + y, p.z); uv.push(j, s / vScale);
    }
    if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // face up whichever way the points ran
  if (g.attributes.normal.getY(0) < 0) { for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); }
  return g;
}

/** a box placed on the track frame: centre (s, d), size across, up and along */
function placed(track: Track, geo: THREE.BufferGeometry, mat: THREE.Material, s: number, d: number, y: number) {
  const m = new THREE.Mesh(geo, mat), p = track.pointAt(s, d);
  m.position.set(p.x, p.y + y, p.z); m.rotation.y = track.headingAt(s);
  return m;
}

/** the painted box: a yellow outline with the number in it */
function boxTexture(n: number) {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 256;
  const c = cv.getContext('2d')!;
  c.strokeStyle = '#ffd23f'; c.lineWidth = 10; c.strokeRect(6, 6, 116, 244);
  c.fillStyle = 'rgba(255, 210, 63, 0.9)';
  c.font = '900 64px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.save(); c.translate(64, 200); c.fillText(String(n), 0, 0); c.restore();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** one crew member: where they stand when idle and at work (car frame: x across, z along) */
interface Crew { idle: THREE.Vector3; work: THREE.Vector3; gun: boolean }
const CREW: { x: number; z: number; ix: number; iz: number; gun: boolean }[] = [
  // the four wheel guns, the front and rear jacks, and the lollipop man in front
  { x: 1.5, z: 1.4, ix: 1.8, iz: 1.6, gun: true }, { x: -1.5, z: 1.4, ix: 1.8, iz: 0.6, gun: true },
  { x: 1.5, z: -1.4, ix: 1.8, iz: -0.6, gun: true }, { x: -1.5, z: -1.4, ix: 1.8, iz: -1.6, gun: true },
  { x: 0, z: 3.0, ix: 1.8, iz: 2.6, gun: false }, { x: 0, z: -3.0, ix: 1.8, iz: -2.6, gun: false },
];

export class PitScene {
  readonly group = new THREE.Group();
  private crews: { s: number; members: Crew[]; color: THREE.Color; work: number; target: number; lolly: THREE.Group; lollyMat: THREE.MeshStandardMaterial }[] = [];
  private bodies: THREE.InstancedMesh; private legs: THREE.InstancedMesh; private heads: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private t = 0;

  constructor(private track: Track, boxes: number, quality: Quality) {
    const tr = track;
    // the lane's tarmac, a little darker and smoother than the track's
    const asphalt = asphaltTexture(); asphalt.repeat.set(1, 1);
    const tarmac = enhanceSurface(new THREE.MeshStandardMaterial({ map: asphalt, color: 0xb9bcc2, roughness: 0.78, bumpMap: asphalt, bumpScale: 0.4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), { vary: 0.08, freq: 0.04 });
    const { left, right } = laneEdges(tr, 2);
    const at = (arr: { s: number; d: number }[]) => (s: number) => { const k = Math.min(arr.length - 1, Math.max(0, Math.round((s - PIT.entry) / 2))); return arr[k].d; };
    const lane = new THREE.Mesh(ribbon(tr, PIT.entry, PIT.exit, at(left), at(right)), tarmac);
    lane.receiveShadow = true; this.group.add(lane);

    // lines: the lane's edges, the fast lane, and the solid white line at the entry and exit
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const edge = (f: (s: number) => number, m: THREE.Material, s0 = PIT.entry, s1 = PIT.exit, w = 0.18) => this.group.add(new THREE.Mesh(ribbon(tr, s0, s1, s => f(s) - w / 2, s => f(s) + w / 2, Y + 0.004), m));
    edge(s => at(right)(s) - 0.2, white);
    edge(s => Math.max(tr.halfWidth + 0.5, (laneD(s) ?? PIT.d) - PIT.half + 0.2), white);
    // the dashed line between the fast lane and the boxes
    for (let s = PIT.wallFrom + 6; s < PIT.wallTo - 6; s += 6) edge(() => (PIT.fast + PIT.boxD) / 2 + 0.05, white, s, s + 3, 0.14);

    // the speed limit lines: a red and white band across the lane, and a board beside it
    const bandTex = (() => {
      const cv = document.createElement('canvas'); cv.width = 128; cv.height = 16;
      const c = cv.getContext('2d')!;
      for (let k = 0; k < 8; k++) { c.fillStyle = k % 2 ? '#e82b2b' : '#f4f4f4'; c.fillRect(k * 16, 0, 16, 16); }
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const band = new THREE.MeshStandardMaterial({ map: bandTex, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
    const boardTex = signTexture('PIT LIMIT 80', 'KM/H', 512, 128);
    for (const s of [PIT.limitFrom, PIT.limitTo]) {
      const d0 = PIT.wallD + 0.3, d1 = PIT.d + PIT.half;
      this.group.add(new THREE.Mesh(ribbon(tr, s - 0.5, s + 0.5, () => d0, () => d1, Y + 0.006, 1), band));
      const board = placed(tr, new THREE.PlaneGeometry(2.2, 0.55), new THREE.MeshStandardMaterial({ map: boardTex, emissive: 0xffffff, emissiveMap: boardTex, emissiveIntensity: 0.25, side: THREE.DoubleSide }), s, PIT.wallD + 0.15, PIT_WALL_HEIGHT + 0.95);
      this.group.add(board);
    }

    // the boxes, each with its number
    for (let k = 0; k < boxes; k++) {
      const m = placed(tr, new THREE.PlaneGeometry(2.7, 5.6), new THREE.MeshStandardMaterial({ map: boxTexture(k + 1), transparent: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }), boxS(k), PIT.boxD, Y + 0.008);
      m.rotation.order = 'YXZ'; m.rotation.x = -Math.PI / 2;
      m.receiveShadow = true; this.group.add(m);
    }

    // the pit wall: concrete with a red and white top, a catch fence on it, and a crash cushion
    // in yellow and black at the nose where the lane splits off
    const concrete = new THREE.MeshStandardMaterial({ color: 0xd9dadc, roughness: 0.85 });
    const stripe = new THREE.MeshStandardMaterial({ map: bandTex, roughness: 0.6 });
    const fence = new THREE.MeshStandardMaterial({ color: 0x9aa2aa, metalness: 0.6, roughness: 0.4, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
    for (let s = PIT.wallFrom; s < PIT.wallTo; s += 4) {
      const len = Math.min(4, PIT.wallTo - s);
      this.group.add(placed(tr, new THREE.BoxGeometry(0.3, PIT_WALL_HEIGHT, len + 0.02), concrete, s + len / 2, PIT.wallD + 0.15, PIT_WALL_HEIGHT / 2));
      this.group.add(placed(tr, new THREE.BoxGeometry(0.32, 0.12, len + 0.02), stripe, s + len / 2, PIT.wallD + 0.15, PIT_WALL_HEIGHT - 0.06));
      this.group.add(placed(tr, new THREE.PlaneGeometry(len, 1.6).rotateY(Math.PI / 2), fence, s + len / 2, PIT.wallD + 0.15, PIT_WALL_HEIGHT + 0.8));
      if (Math.round(s) % 8 === 0) this.group.add(placed(tr, new THREE.CylinderGeometry(0.04, 0.04, 1.7, 6), concrete, s, PIT.wallD + 0.15, PIT_WALL_HEIGHT + 0.85));
    }
    const chev = (() => {
      const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
      const c = cv.getContext('2d')!;
      c.fillStyle = '#ffd23f'; c.fillRect(0, 0, 64, 64); c.fillStyle = '#111';
      for (let k = -2; k < 4; k++) { c.beginPath(); c.moveTo(k * 24, 64); c.lineTo(k * 24 + 12, 64); c.lineTo(k * 24 + 44, 0); c.lineTo(k * 24 + 32, 0); c.fill(); }
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
    })();
    const cushion = new THREE.MeshStandardMaterial({ map: chev, roughness: 0.7 });
    for (const s of [PIT.wallFrom - 1.6, PIT.wallTo + 1.6]) {
      const c = placed(tr, new THREE.CylinderGeometry(0.75, 0.75, 1.1, 18), cushion, s, PIT.wallD + 0.15, 0.55);
      c.castShadow = true; this.group.add(c);
    }

    // the garages under a long canopy along the back of the lane, in front of the Charge Hub
    const g0 = boxS(0) - 6, g1 = boxS(boxes - 1) + 6, mid = (g0 + g1) / 2, len = g1 - g0;
    const backD = PIT.d + PIT.half + 1.0;
    const white2 = new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.35, metalness: 0.1 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: 0.6 });
    const roof = placed(tr, new THREE.BoxGeometry(3.4, 0.35, len), white2, mid, backD - 1.0, 4.4);
    roof.castShadow = true; this.group.add(roof);
    const glowStrip = new THREE.MeshStandardMaterial({ color: 0x0b1b22, emissive: 0x38e8ff, emissiveIntensity: 1.4 });
    this.group.add(placed(tr, new THREE.BoxGeometry(0.06, 0.08, len), glowStrip, mid, backD - 2.7, 4.22));
    this.group.add(placed(tr, new THREE.BoxGeometry(0.4, 4.4, len), dark, mid, backD + 0.35, 2.2));
    for (let k = 0; k < boxes; k++) {
      // a lit garage door behind each box, and a column between them
      const door = placed(tr, new THREE.PlaneGeometry(4.6, 3.2).rotateY(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x20262e, emissive: 0x9fd8ff, emissiveIntensity: 0.18, roughness: 0.5 }), boxS(k), backD + 0.14, 1.6);
      this.group.add(door);
      this.group.add(placed(tr, new THREE.BoxGeometry(0.3, 4.4, 0.3), white2, boxS(k) + PIT.boxGap / 2, backD, 2.2));
    }
    const sign = placed(tr, new THREE.PlaneGeometry(14, 1.1).rotateY(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: signTexture('PIT LANE', 'TYRES · REPAIRS · AIR', 1024, 96), emissive: 0xffffff, emissiveIntensity: 0.3 }), mid, backD - 2.71, 3.75);
    ((sign.material as THREE.MeshStandardMaterial).emissiveMap = (sign.material as THREE.MeshStandardMaterial).map);
    this.group.add(sign);

    // PIT IN and PIT OUT boards on posts, facing the cars
    const inOut = (s: number, text: string, sub: string, d: number) => {
      const tex = signTexture(text, sub, 512, 128);
      const b = placed(tr, new THREE.PlaneGeometry(3.2, 0.8), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.4, side: THREE.DoubleSide }), s, d, 3.0);
      b.rotation.y += Math.PI;
      this.group.add(b, placed(tr, new THREE.CylinderGeometry(0.06, 0.06, 3, 8), concrete, s, d, 1.5));
    };
    inOut(PIT.entry + 2, 'PIT IN', '→ 80 KM/H', PIT.d + PIT.half + 0.6);
    inOut(PIT.exit - 30, 'PIT OUT', 'BLEND LINE', PIT.d + PIT.half + 0.3);

    // the crews: instanced bodies and helmets, a lollipop per box
    const n = boxes * CREW.length;
    // overalls in the team colour, dark trousers and boots, and a white helmet
    this.bodies = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.2, 0.42, 4, 10).scale(1, 1, 0.75), new THREE.MeshStandardMaterial({ roughness: 0.6 }), n);
    this.legs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.78, 0.2).translate(0, -0.62, 0), new THREE.MeshStandardMaterial({ color: 0x1b1e24, roughness: 0.8 }), n);
    this.heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.15, 14, 10).scale(1, 1.08, 1.12), new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.2, metalness: 0.2 }), n);
    this.bodies.castShadow = this.legs.castShadow = quality !== 'low';
    for (let k = 0; k < boxes; k++) {
      const color = new THREE.Color().setHSL((k * 0.137) % 1, 0.7, 0.5);
      const members = CREW.map(c => ({ idle: new THREE.Vector3(c.ix, 0, c.iz), work: new THREE.Vector3(c.x, 0, c.z), gun: c.gun }));
      const lollyMat = new THREE.MeshStandardMaterial({ color: 0xe82b2b, emissive: 0xe82b2b, emissiveIntensity: 0.4 });
      const lolly = new THREE.Group();
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.6, 6), dark); stick.position.y = 0.8;
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.04, 20).rotateX(Math.PI / 2), lollyMat); disc.position.y = 1.65;
      lolly.add(stick, disc);
      this.group.add(lolly);
      this.crews.push({ s: boxS(k), members, color, work: 0, target: 0, lolly, lollyMat });
      members.forEach((_, j) => this.bodies.setColorAt(k * CREW.length + j, color));
    }
    this.group.add(this.bodies, this.legs, this.heads);
    this.update(0, []);
  }

  /** each frame: for every box, is its car being serviced (0..1 done) or not (null) */
  update(dt: number, service: (number | null)[]) {
    this.t += dt;
    const tr = this.track, p = new THREE.Vector3(), q = new THREE.Vector3();
    this.crews.forEach((c, k) => {
      const done = service[k] ?? null;
      c.target = done !== null && done < 1 ? 1 : 0;
      // they run out quickly and stroll back
      c.work += (c.target - c.work) * Math.min(1, dt * (c.target ? 7 : 2));
      const h = tr.headingAt(c.s), fx = Math.sin(h), fz = Math.cos(h), rx = -fz, rz = fx;
      tr.pointAt(c.s, PIT.boxD, p);
      c.members.forEach((m, j) => {
        q.lerpVectors(m.idle, m.work, c.work);
        // the wheel guns crouch and twitch while they work; everyone else stands
        const crouch = m.gun ? c.work * 0.35 : 0;
        const jig = m.gun && c.target ? Math.sin(this.t * 40 + j) * 0.02 : 0;
        const x = p.x + rx * q.x + fx * q.z, z = p.z + rz * q.x + fz * q.z;
        // facing the car while they work, along the lane while they wait
        const face = c.work > 0.5 ? Math.atan2(p.x - x, p.z - z) : h + Math.PI / 2;
        this.dummy.position.set(x + jig, p.y + Y + 1.08 - crouch, z);
        this.dummy.rotation.set(crouch * 0.9, face, 0, 'YXZ');
        this.dummy.updateMatrix();
        this.bodies.setMatrixAt(k * CREW.length + j, this.dummy.matrix);
        this.dummy.rotation.set(0, face, 0);
        this.dummy.scale.set(1, 1 - crouch * 0.7, 1);
        this.dummy.updateMatrix();
        this.legs.setMatrixAt(k * CREW.length + j, this.dummy.matrix);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.position.set(x + jig + Math.sin(face) * crouch * 0.3, p.y + Y + 1.55 - crouch * 1.15, z + Math.cos(face) * crouch * 0.3);
        this.dummy.updateMatrix();
        this.heads.setMatrixAt(k * CREW.length + j, this.dummy.matrix);
      });
      // the lollipop: in front of the car, red while they work, green to go
      const lx = p.x + fx * (2.4 + 1.2 * c.work) + rx * 0.9, lz = p.z + fz * (2.4 + 1.2 * c.work) + rz * 0.9;
      c.lolly.position.set(lx, p.y + Y, lz); c.lolly.rotation.y = h;
      const go = done !== null && done >= 0.97;
      c.lollyMat.color.setHex(go ? 0x2ad46a : 0xe82b2b); c.lollyMat.emissive.setHex(go ? 0x2ad46a : 0xe82b2b);
    });
    this.bodies.instanceMatrix.needsUpdate = true; this.legs.instanceMatrix.needsUpdate = true; this.heads.instanceMatrix.needsUpdate = true;
  }
}
