// Fun Mode, after g001's: kicker ramps on the straights (sized for the class so every jump lands
// on the road), rings of fire to drive through, jump through and fly through off a ramp, boost
// pads on the exits of the slowest corners and rows of item boxes (Turbo, Triple Turbo, Oil Slick
// and Mega Jump). Holding a slide and straightening up gives a slide boost, and big air, flips,
// rings and slide boosts score stunt points. Plain physics and math, so the headless test can
// drive it; render/funScene.ts draws it. The layout is fixed for the circuit and the class, so
// every car sees the same course.
import RAPIER from '@dimforge/rapier3d-compat';
import type { Car, CarSpec } from './car';
import type { JetEvent, Jets } from './jets';
import type { Track } from './track';
import type { CarView } from './rival';
import { PHYSICS_DT } from './world';
import { speedProfile } from './racingLine';

export interface FunOptions { rings: boolean; ramps: boolean; items: boolean }
export const FUN_DEFAULTS: FunOptions = { rings: true, ramps: true, items: true };

export type ItemKind = 'turbo' | 'triple' | 'oil' | 'mega';
export const ITEM_LABEL: Record<ItemKind, string> = { turbo: 'Turbo', triple: 'Triple Turbo', oil: 'Oil Slick', mega: 'Mega Jump' };
export const ITEM_ICON: Record<ItemKind, string> = { turbo: '🚀', triple: '🚀🚀🚀', oil: '🛢️', mega: '⏫' };

/** a kicker ramp: from s0 for len metres across the road from d0 to d1, rising to h at the lip
 *  along h·u² (u = 0 at the foot, 1 at the lip), so the launch angle is atan(2h / len) */
export interface Ramp { s0: number; len: number; h: number; d0: number; d1: number;
  /** the speed (m/s) the jump is designed for, and its air time (s) at that speed */
  v: number; air: number; ring: boolean }
export interface Pad { s0: number; len: number; d0: number; d1: number }
/** road rings stand on the road (their bottom sinks into it), hop rings hang above it so you have
 *  to jump, and ramp rings hang where a ramp's jump reaches its highest point */
export type RingKind = 'road' | 'hop' | 'ramp';
export interface Ring {
  kind: RingKind; s: number; d: number;
  /** radius of the burning hoop (m) */
  r: number;
  /** centre in the world */
  x: number; y: number; z: number;
  /** road height under the centre */
  floor: number;
  /** the hoop's plane faces along the road (nx, nz); (rx, rz) runs across it */
  nx: number; nz: number; rx: number; rz: number;
  /** the gantry holding it up (hop and ramp rings): pole offset across the road */
  poles: number;
  /** where it was put and how big it was built: a moving ring slides `sway` metres either side
   *  of d0 across the road, and a pulsing one shrinks by up to `pulse` of its radius, so the
   *  way through keeps changing */
  d0: number; r0: number; sway: number; pulse: number; rate: number; phase: number;
}
export interface Box { s: number; d: number; x: number; y: number; z: number; respawn: number }
export interface Oil { x: number; y: number; z: number; owner: FunCar; age: number }

/** half thickness of the band of flames round a hoop (m) */
export const RING_FLAME = 0.55;
/** brushing the flames: the car slows hard, burns for a while and takes damage */
export const BURN = { slow: 0.82, time: 3, drag: 0.12, damage: 0.34 };
const RAMP_LEN = 22;
/** the most upward acceleration (m/s²) a ramp asks of a car at its design speed */
const RAMP_MAX_ACCEL = 19;
const PAD_LEN = 10;
const BOX_RESPAWN = 4, PICK_R = 2.3, OIL_R = 1.9, OIL_LIFE = 25;
const G = 9.81;

/** the ramps on Roadster Circuit: where each one starts, how much of the road it covers (a half-
 *  width ramp leaves a way round), how fast cars arrive (a fraction of the class's top speed,
 *  measured from the bots) and how long a car arriving at that speed should be in the air. The
 *  first one gets a ring of fire at the top of its jump */
const RAMPS: { s0: number; d0: number; d1: number; vFrac?: number; air: number; ring: boolean }[] = [
  { s0: 140, d0: -6.5, d1: 6.5, vFrac: 0.84, air: 1.6, ring: true },
  { s0: 290, d0: -6.5, d1: -0.6, vFrac: 0.96, air: 0.8, ring: false },
  // the rest arrive at the speed the corners before them allow (from the bots' speed profile).
  // On a bend the half-width ones sit on the inside, so the car drifts back to the middle in the air
  { s0: 345, d0: 0.6, d1: 6.5, air: 0.75, ring: true },
  { s0: 1420, d0: -6.5, d1: 6.5, air: 0.6, ring: true },
  { s0: 1510, d0: 0.6, d1: 6.5, air: 0.5, ring: false },
  { s0: 2030, d0: 0.6, d1: 6.5, air: 0.5, ring: false },
  { s0: 2222, d0: -6.5, d1: -0.6, vFrac: 0.78, air: 0.75, ring: false },
];
/** rings of fire on the road (drive through) and over it (jump through): arc length, offset,
 *  and how they move: sway (m either side) or pulse (shrinking by that much of the radius) */
type RingDef = [s: number, d: number, motion?: { sway?: number; pulse?: number; rate?: number }];
const ROAD_RINGS: RingDef[] = [
  [700, 0, { sway: 2.6, rate: 1.1 }], [960, 0, { pulse: 0.3 }], [1250, 0, { sway: 2.4, rate: 0.9 }], [1385, 0], [1580, -1, { pulse: 0.28 }],
  [1700, -1.2], [1840, 0.5, { sway: 2.2, rate: 1.3 }], [1935, 1], [2010, 0.6, { pulse: 0.3 }], [2110, 0, { sway: 2.5, rate: 1 }], [2390, 0],
];
/** the raised ones sit where the road is nearly straight, so a jump doesn't land in a corner */
const HOP_RINGS: RingDef[] = [[470, -3], [780, 1.8, { sway: 1.8, rate: 0.8 }], [1100, -1], [2300, 2]];
/** item box rows: arc length; each row has four boxes across the road */
const BOX_ROWS = [620, 1250, 1790, 2120];

export interface FunLayout { ramps: Ramp[]; pads: Pad[]; rings: Ring[]; boxes: { s: number; d: number }[] }

/** the course for a class: ramp heights (and the ring over the big jump) follow its speed */
export function funLayout(track: Track, spec: CarSpec, opts: FunOptions, racingLine?: Float64Array): FunLayout {
  const ramps: Ramp[] = [], rings: Ring[] = [];
  const ring = (kind: RingKind, s: number, d: number, r: number, height: number, m: RingDef[2] = {}): Ring => {
    const p = track.pointAt(s, d), i = track.indexAt(s);
    const nx = track.tx[i], nz = track.tz[i];
    return { kind, s, d, r, x: p.x, y: p.y + height, z: p.z, floor: p.y, nx, nz, rx: track.rightX(i), rz: track.rightZ(i), poles: track.halfWidth + 1.9,
      d0: d, r0: r, sway: m.sway ?? 0, pulse: m.pulse ?? 0, rate: m.rate ?? 1.2, phase: (s * 0.37) % (Math.PI * 2) };
  };
  // how fast a car gets to each ramp: what the corners before it allow, up to the top speed
  const profile = speedProfile(track, spec.grip, 10, spec.topSpeed, 0.6 * spec.liftArea / spec.mass);
  if (opts.ramps) for (const def of RAMPS) {
    // (a fixed share of the top speed for the big ones, kept under what the corner allows)
    const corner = Math.min(spec.topSpeed, profile[track.indexAt(def.s0)]);
    const v = def.vFrac ? Math.min(spec.topSpeed * def.vFrac, corner * 0.88) : corner * (def.ring ? 0.88 : 0.95);
    // a jump of `air` seconds at v: flight distance D = v·air, and D = v² sin 2θ / g
    const theta = 0.5 * Math.asin(Math.min(0.6, G * def.air / v));
    // long enough that the curve up the ramp (v² tanθ / len) doesn't bottom out the suspension
    const len = Math.max(RAMP_LEN, (v * v * Math.tan(theta)) / RAMP_MAX_ACCEL);
    const h = (len / 2) * Math.tan(theta);
    ramps.push({ s0: def.s0, len, h, d0: def.d0, d1: def.d1, v, air: def.air, ring: def.ring && opts.rings });
    if (def.ring && opts.rings) {
      // the top of the jump: half the flight distance on, D·tanθ / 4 above the lip
      const D = v * def.air, apex = (D * Math.tan(theta)) / 4;
      // centred on the middle of the car (a tall one sits higher in the hoop)
      const top = spec.cabin ? spec.cabinAt[0] + 2 * spec.cabin[1] : spec.tubAt[0] + 2 * spec.tub[1];
      // the car flies straight on from the lip, so on a bend the ring sits on that line, not the road's
      const lip = track.pointAt(def.s0 + len, (def.d0 + def.d1) / 2), li = track.indexAt(def.s0 + len);
      const ax = lip.x + track.tx[li] * D / 2, az = lip.z + track.tz[li] * D / 2, at = track.nearest(ax, az, li);
      const rg = ring('ramp', at.s, at.lateral, 3.5, 0);
      rings.push({ ...rg, x: ax, z: az, y: lip.y + h + apex + spec.comHeight + Math.max(0.3, top / 2 - spec.comHeight), nx: track.tx[li], nz: track.tz[li], rx: track.rightX(li), rz: track.rightZ(li) });
    }
  }
  if (opts.rings) {
    // road rings: the hoop's centre 1.2 m up, so its bottom is in the road and the opening at
    // road level is about 6.4 m wide (less the flames)
    for (const [s, d, m] of ROAD_RINGS) rings.push(ring('road', s, d, 3.4, 1.2, m));
    // hop rings: the bottom of the flames at about 1.15 m, under a roof but over a bonnet, so
    // driving under them singes the car; a jump carries it through the middle
    for (const [s, d, m] of HOP_RINGS) rings.push(ring('hop', s, d, 2.5, 3.65 + spec.comHeight - 0.32, m));
  }
  // boost pads on the exits of the five slowest corners, on the racing line
  const pads: Pad[] = [];
  if (opts.ramps) {
    const sm = Array.from(track.curv, (_, i) => { let a = 0; for (let k = -6; k <= 6; k++) a += Math.abs(track.curv[track.wrap(i + k)]); return a / 13; });
    const apexes: number[] = [];
    for (let i = 0; i < track.n; i++) {
      let peak = sm[i] > 1 / 110;
      for (let k = -40; k <= 40 && peak; k++) if (sm[track.wrap(i + k)] > sm[i]) peak = false;
      if (peak) apexes.push(i);
    }
    apexes.sort((a, b) => sm[b] - sm[a]);
    for (const i of apexes.slice(0, 5)) {
      const s0 = (track.s[i] + 38) % track.total;
      const o = racingLine ? racingLine[track.indexAt(s0 + PAD_LEN / 2)] : 0;
      pads.push({ s0, len: PAD_LEN, d0: o - 2.4, d1: o + 2.4 });
    }
  }
  const boxes = opts.items ? BOX_ROWS.flatMap(s => [-4.2, -1.4, 1.4, 4.2].map(d => ({ s, d }))) : [];
  return { ramps, pads, rings, boxes };
}

/** a ramp's surface in world coordinates: the sloped top, the two sides and the back under the
 *  lip, as triangles (with uvs: u across, v along, in metres). Physics and rendering share it */
/** how far a ramp's edge out in the road slopes down to the road */
const RAMP_BEVEL = 1.1;

export function rampMesh(track: Track, r: Ramp, steps = 14) {
  const pos: number[] = [], uv: number[] = [], top: number[] = [], sides: number[] = [];
  const at = (u: number, d: number, up: boolean) => {
    const p = track.pointAt(r.s0 + u * r.len, d);
    return [p.x, p.y + (up ? r.h * u * u + 0.03 : -0.05), p.z];
  };
  const quad = (into: number[], a: number[], b: number[], c: number[], d: number[], uvs: number[]) => {
    const k = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d); uv.push(...uvs);
    into.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
  };
  const w = r.d1 - r.d0;
  const bevel = (d: number, right: boolean) => Math.abs(d) < track.halfWidth - 1.5 ? (right ? RAMP_BEVEL : -RAMP_BEVEL) : 0;
  for (let k = 0; k < steps; k++) {
    const u0 = k / steps, u1 = (k + 1) / steps;
    // top: a strip across the road (wound so the normal points up)
    quad(top, at(u0, r.d0, true), at(u0, r.d1, true), at(u1, r.d0, true), at(u1, r.d1, true), [0, u0 * r.len, w, u0 * r.len, 0, u1 * r.len, w, u1 * r.len]);
    // sides: from the road up to the top edge, facing out. An edge out in the road is a bevel a
    // metre wide, so a car that clips it rides up and over instead of hitting a wall
    for (const [d, flip] of [[r.d0, false], [r.d1, true]] as const) {
      const out = bevel(d, flip);
      const a = at(u0, d + out, false), b = at(u1, d + out, false), c = at(u0, d, true), e = at(u1, d, true);
      if (flip) quad(sides, a, b, c, e, [u0 * r.len, 0, u1 * r.len, 0, u0 * r.len, 1, u1 * r.len, 1]);
      else quad(sides, b, a, e, c, [u1 * r.len, 0, u0 * r.len, 0, u1 * r.len, 1, u0 * r.len, 1]);
    }
  }
  // the back face under the lip
  quad(sides, at(1, r.d1 + bevel(r.d1, true), false), at(1, r.d0 + bevel(r.d0, false), false), at(1, r.d1, true), at(1, r.d0, true), [0, 0, w, 0, 0, 1, w, 1]);
  return { pos: new Float32Array(pos), uv: new Float32Array(uv), idx: new Uint32Array([...top, ...sides]), topCount: top.length };
}

export type FunEventKind = 'ring' | 'singed' | 'pad' | 'box' | 'item' | 'oil' | 'spun' | 'air' | 'slide' | 'stunt' | 'mega';
export interface FunEvent { kind: FunEventKind; text: string; points?: number; ring?: Ring; item?: ItemKind }

export interface FunCar {
  name: string;
  car: Car; jets: Jets;
  /** where the car is along and across the road (an Entrant of the race) */
  view: CarView;
  isPlayer: boolean; bot: boolean;
  item: ItemKind | null; charges: number;
  /** extra thrust left (s) and how strong (m/s²) */
  boostT: number; boostAccel: number;
  spinT: number; spinDir: number;
  slideT: number;
  airT: number; rampAir: boolean;
  /** stunt points, rings flown through, the longest jump (s) and rings in a row */
  stunt: number; rings: number; bestAir: number; streak: number;
  /** 1 right after brushing the flames, fading: the paint shows soot */
  soot: number;
  /** seconds left on fire after brushing the flames: the car slows and smokes */
  burnT: number;
  /** a bot uses its item after this time */
  useAt: number;
  /** a bot's decision for each ring this lap: go for it or not */
  goFor: Map<Ring, boolean>;
  prev: { x: number; y: number; z: number };
  padOn: boolean;
  /** what happened this step, for messages and effects */
  events: FunEvent[];
}

export class Fun {
  readonly layout: FunLayout;
  readonly cars: FunCar[] = [];
  readonly boxes: Box[];
  readonly oils: Oil[] = [];
  /** new oil slicks and popped boxes since the renderer last looked */
  readonly dropped: Oil[] = [];
  private colliders: RAPIER.Collider[] = [];
  private t = 0;

  constructor(private track: Track, private world: RAPIER.World, spec: CarSpec, readonly opts: FunOptions, racingLine?: Float64Array) {
    this.layout = funLayout(track, spec, opts, racingLine);
    for (const r of this.layout.ramps) {
      const m = rampMesh(track, r);
      // smooth over the seams between the strips, so a car that scrapes the deck slides instead of catching
      this.colliders.push(world.createCollider(RAPIER.ColliderDesc.trimesh(m.pos, m.idx, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(0.3).setRestitution(0)));
    }
    // the gantry poles beside the road are solid
    for (const ring of this.layout.rings) {
      if (ring.kind === 'road') continue;
      const top = ring.y + ring.r + 1.4 - ring.floor;
      for (const side of [-1, 1]) {
        const p = track.pointAt(ring.s, side * ring.poles);
        this.colliders.push(world.createCollider(RAPIER.ColliderDesc.cylinder(top / 2, 0.16).setTranslation(p.x, p.y + top / 2, p.z).setFriction(0.2)));
      }
    }
    this.boxes = this.layout.boxes.map(b => { const p = track.pointAt(b.s, b.d); return { ...b, x: p.x, y: p.y, z: p.z, respawn: 0 }; });
  }

  add(name: string, car: Car, jets: Jets, view: CarView, isPlayer: boolean, bot: boolean): FunCar {
    const p = car.body.translation();
    const fc: FunCar = { name, car, jets, view, isPlayer, bot, item: null, charges: 0, boostT: 0, boostAccel: 0, spinT: 0, spinDir: 1, slideT: 0,
      airT: 0, rampAir: false, stunt: 0, rings: 0, bestAir: 0, streak: 0, soot: 0, burnT: 0, useAt: 0, goFor: new Map(), prev: { x: p.x, y: p.y, z: p.z }, padOn: false, events: [] };
    this.cars.push(fc);
    return fc;
  }

  clearCars() { this.cars.length = 0; }

  get player() { return this.cars.find(c => c.isPlayer) ?? null; }

  /** everything back as it was for a new race (the cars stay) */
  reset() {
    this.t = 0;
    for (const b of this.boxes) b.respawn = 0;
    this.oils.length = 0;
    for (const fc of this.cars) {
      Object.assign(fc, { item: null, charges: 0, boostT: 0, spinT: 0, slideT: 0, airT: 0, rampAir: false, stunt: 0, rings: 0, bestAir: 0, streak: 0, soot: 0, burnT: 0, padOn: false });
      fc.goFor.clear(); fc.events.length = 0;
      this.teleported(fc);
    }
  }

  /** the car was put somewhere new (a reset): don't count the jump as a ring crossing */
  teleported(fc: FunCar) { const p = fc.car.body.translation(); fc.prev = { x: p.x, y: p.y, z: p.z }; fc.spinT = 0; fc.boostT = 0; fc.burnT = 0; }

  /** moving rings slide across the road and pulsing ones shrink and grow (the same for everyone) */
  private moveRings() {
    for (const r of this.layout.rings) {
      if (!r.sway && !r.pulse) continue;
      const w = Math.sin(this.t * r.rate + r.phase);
      if (r.sway) {
        r.d = r.d0 + r.sway * w;
        const p = this.track.pointAt(r.s, r.d);
        r.x = p.x; r.z = p.z;
      }
      if (r.pulse) r.r = r.r0 * (1 - r.pulse * (0.5 + 0.5 * w));
    }
  }

  private boost(fc: FunCar, time: number, accel: number) {
    const active = fc.boostT > 0;
    fc.boostT = Math.max(fc.boostT, time);
    fc.boostAccel = active ? Math.max(fc.boostAccel, accel) : accel;
  }

  /** forces for one step, after the car and its jets have stepped and before the world does */
  preStep(fc: FunCar, dt = PHYSICS_DT) {
    const c = fc.car, b = c.body;
    if (fc.boostT > 0) {
      fc.boostT -= dt;
      const { fwd } = c.axes();
      // like the rear jets, it fades out well over the class's top speed
      const fade = Math.max(0, Math.min(1, (c.spec.topSpeed + 26 - c.speed) / 12));
      const f = fc.boostAccel * c.spec.mass * fade;
      b.addForce({ x: fwd.x * f, y: fwd.y * f, z: fwd.z * f }, true);
    }
    if (fc.burnT > 0) {
      // on fire: the motor cuts back and the car drags
      fc.burnT -= dt;
      const lv = b.linvel(), k = 1 - dt * BURN.drag;
      b.setLinvel({ x: lv.x * k, y: lv.y, z: lv.z * k }, true);
    }
    if (fc.spinT > 0) {
      // spinning on oil: the car yaws round and scrubs off speed
      fc.spinT -= dt;
      const av = b.angvel(), lv = b.linvel();
      b.setAngvel({ x: av.x, y: 5 * fc.spinDir, z: av.z }, true);
      const k = 1 - dt * 1.1;
      b.setLinvel({ x: lv.x * k, y: lv.y, z: lv.z * k }, true);
    }
  }

  /** after the world has stepped and every car's view (s, lateral) is up to date */
  afterStep(dt = PHYSICS_DT, running = true) {
    this.t += dt;
    this.moveRings();
    for (const fc of this.cars) {
      fc.soot = Math.max(0, fc.soot - dt / 6);
      const p = fc.car.body.translation();
      if (running) {
        this.ringsFor(fc, p);
        this.padsFor(fc);
        this.airFor(fc);
        this.slideFor(fc, dt);
        this.boxesFor(fc, p);
        this.oilFor(fc, p);
      }
      fc.prev = { x: p.x, y: p.y, z: p.z };
    }
    for (const b of this.boxes) if (b.respawn > 0) b.respawn = Math.max(0, b.respawn - dt);
    for (let k = this.oils.length - 1; k >= 0; k--) if ((this.oils[k].age += dt) > OIL_LIFE) this.oils.splice(k, 1);
    if (running) this.bots();
  }

  private say(fc: FunCar, e: FunEvent) {
    if (e.points) fc.stunt += e.points;
    fc.events.push(e);
  }

  /** did the car pass through a ring's plane this step, and through the hoop, the flames or past it? */
  private ringsFor(fc: FunCar, p: { x: number; y: number; z: number }) {
    const a = fc.prev;
    if ((p.x - a.x) ** 2 + (p.z - a.z) ** 2 > 25) return; // a reset, not a drive
    const tr = this.track;
    for (const r of this.layout.rings) {
      let ds = fc.view.s - r.s;
      if (ds > tr.total / 2) ds -= tr.total; else if (ds < -tr.total / 2) ds += tr.total;
      if (Math.abs(ds) > 12) continue;
      const before = (a.x - r.x) * r.nx + (a.z - r.z) * r.nz, after = (p.x - r.x) * r.nx + (p.z - r.z) * r.nz;
      if (!(before < 0 && after >= 0)) continue;
      const f = before / (before - after);
      const qx = a.x + (p.x - a.x) * f, qy = a.y + (p.y - a.y) * f, qz = a.z + (p.z - a.z) * f;
      // the body's corners in the hoop's plane: centre, left, right, roof and floor
      const { up, right } = fc.car.axes();
      const S = fc.car.spec, halfW = S.tub[0], cy = 0.28;
      // the roof: the top of the cabin (or the body), above the centre of mass
      const roof = S.cabin ? S.cabinAt[0] + 2 * S.cabin[1] - S.comHeight : S.tubAt[0] + 2 * S.tub[1] - S.comHeight + 0.3;
      const plane = (ox: number, oy: number, oz: number) => {
        const x = qx + ox - r.x, y = qy + oy - r.y, z = qz + oz - r.z;
        return Math.hypot(x * r.rx + z * r.rz, y);
      };
      const pts = [
        plane(up.x * cy, up.y * cy, up.z * cy),
        plane(up.x * cy + right.x * halfW, up.y * cy + right.y * halfW, up.z * cy + right.z * halfW),
        plane(up.x * cy - right.x * halfW, up.y * cy - right.y * halfW, up.z * cy - right.z * halfW),
        plane(up.x * roof, up.y * roof, up.z * roof),
        plane(-up.x * 0.25, -up.y * 0.25, -up.z * 0.25),
      ];
      const far = Math.max(...pts), near = Math.min(...pts);
      if (far < r.r - 0.12) {
        fc.rings++;
        const base = r.kind === 'ramp' ? 250 : r.kind === 'hop' ? 150 : 100;
        const pts = Math.round(base * (1 + 0.25 * fc.streak));
        fc.streak++;
        this.boost(fc, 0.7, 7.5);
        fc.jets.refill(0.06);
        this.say(fc, { kind: 'ring', ring: r, points: pts, text: fc.streak > 1 ? `RING OF FIRE ×${fc.streak}  +${pts}` : `RING OF FIRE  +${pts}` });
      } else if (near < r.r + RING_FLAME) {
        fc.streak = 0;
        fc.soot = 1;
        const lv = fc.car.body.linvel();
        fc.car.body.setLinvel({ x: lv.x * BURN.slow, y: lv.y, z: lv.z * BURN.slow }, true);
        const again = fc.burnT > 0;
        fc.burnT = BURN.time;
        this.say(fc, { kind: 'singed', ring: r, text: again ? 'STILL ON FIRE! Keep out of the flames' : 'ON FIRE! Burnt by the flames' });
      } else if (Math.hypot((qx - r.x) * r.rx + (qz - r.z) * r.rz, qy - r.y) < r.r + 5) fc.streak = 0;
    }
  }

  private padsFor(fc: FunCar) {
    const v = fc.view, tr = this.track;
    let on = false;
    if (!fc.car.airborne) for (const pad of this.layout.pads) {
      const u = (v.s - pad.s0 + tr.total) % tr.total;
      if (u < pad.len && v.lateral > pad.d0 - 0.6 && v.lateral < pad.d1 + 0.6) on = true;
    }
    if (on && !fc.padOn) { this.boost(fc, 0.9, 9); this.say(fc, { kind: 'pad', text: 'BOOST!' }); }
    fc.padOn = on;
  }

  /** air time: a jump off a ramp (or a long hover) scores when the car lands; flips score too */
  private airFor(fc: FunCar) {
    const c = fc.car;
    if (c.airborne) {
      if (fc.airT === 0) {
        // took off: was it from a ramp?
        const tr = this.track, v = fc.view;
        fc.rampAir = this.layout.ramps.some(r => { const u = (v.s - r.s0 + tr.total) % tr.total; return u > r.len * 0.5 && u < r.len + 6 && v.lateral > r.d0 - 1.2 && v.lateral < r.d1 + 1.2; });
      }
      fc.airT += PHYSICS_DT;
      return;
    }
    if (fc.airT > 0) {
      const t = fc.airT;
      if ((fc.rampAir && t > 0.5) || t > 2.2) {
        const pts = Math.round(t * 100 + (t > 2 ? 100 : 0));
        fc.bestAir = Math.max(fc.bestAir, t);
        this.say(fc, { kind: 'air', points: pts, text: `${t > 2 ? 'HUGE' : 'BIG'} AIR ${t.toFixed(1)} s  +${pts}` });
      }
      fc.airT = 0; fc.rampAir = false;
    }
    const tricks: Partial<Record<JetEvent, [string, number]>> = { flip: ['FLIP', 200], roll: ['BARREL ROLL', 200], spin: ['360', 150] };
    for (const ev of fc.jets.events) {
      const tk = tricks[ev];
      if (tk) this.say(fc, { kind: 'stunt', points: tk[1], text: `${tk[0]}  +${tk[1]}` });
    }
  }

  /** hold a slide, then straighten up for a mini-turbo */
  private slideFor(fc: FunCar, dt: number) {
    const c = fc.car;
    const sliding = Math.abs(c.vLat) > 2.2 && c.speed > 14 && !c.airborne && fc.spinT <= 0;
    if (sliding) { fc.slideT += dt; return; }
    if (Math.abs(c.vLat) < 0.9) {
      if (fc.slideT > 0.6) {
        const big = fc.slideT > 1.5;
        this.boost(fc, big ? 1 : 0.6, big ? 10 : 7);
        this.say(fc, { kind: 'slide', points: big ? 80 : 40, text: big ? 'SUPER SLIDE BOOST  +80' : 'SLIDE BOOST  +40' });
      }
      fc.slideT = 0;
    }
  }

  private boxesFor(fc: FunCar, p: { x: number; y: number; z: number }) {
    for (const b of this.boxes) {
      if (b.respawn > 0 || (b.x - p.x) ** 2 + (b.z - p.z) ** 2 > PICK_R * PICK_R || Math.abs(p.y - b.y - 0.8) > 2.2) continue;
      b.respawn = BOX_RESPAWN;
      if (fc.item) continue; // already holding one: the box still pops
      const roll = Math.random();
      fc.item = roll < 0.38 ? 'turbo' : roll < 0.58 ? 'triple' : roll < 0.82 ? 'oil' : 'mega';
      fc.charges = fc.item === 'triple' ? 3 : 1;
      fc.useAt = this.t + 0.8 + Math.random() * 2.5;
      this.say(fc, { kind: 'box', item: fc.item, text: `${ITEM_ICON[fc.item]} ${ITEM_LABEL[fc.item]}` });
    }
  }

  private oilFor(fc: FunCar, p: { x: number; y: number; z: number }) {
    if (fc.spinT > 0 || fc.car.airborne) return;
    for (const o of this.oils) {
      if (o.owner === fc && o.age < 2) continue;
      if ((o.x - p.x) ** 2 + (o.z - p.z) ** 2 < OIL_R * OIL_R && Math.abs(o.y - p.y) < 2) {
        fc.spinT = 0.9; fc.spinDir = Math.random() < 0.5 ? -1 : 1; fc.streak = 0;
        this.say(fc, { kind: 'spun', text: 'OIL! Spun out' });
        break;
      }
    }
  }

  /** use the held item: the player's item button, or a bot when it suits */
  useItem(fc: FunCar) {
    if (!fc.item || fc.spinT > 0) return false;
    const c = fc.car, b = c.body;
    const kind = fc.item;
    if (kind === 'oil') {
      const { fwd } = c.axes(), p = b.translation();
      const x = p.x - fwd.x * 4, z = p.z - fwd.z * 4;
      const oil = { x, y: this.track.pointAt(fc.view.s - 4, 0).y, z, owner: fc, age: 0 };
      this.oils.push(oil); this.dropped.push(oil);
      fc.item = null; fc.charges = 0;
    } else if (kind === 'mega') {
      // a huge burst from the underbody jets, free of charge
      const m = c.spec.mass, lv = b.linvel();
      b.applyImpulse({ x: 0, y: Math.max(0, 10.5 - Math.max(0, lv.y)) * m, z: 0 }, true);
      fc.item = null; fc.charges = 0;
      this.say(fc, { kind: 'mega', text: 'MEGA JUMP!' });
    } else {
      this.boost(fc, kind === 'triple' ? 1.0 : 1.5, 11);
      if (--fc.charges <= 0) fc.item = null;
    }
    fc.events.push({ kind: 'item', item: kind, text: '' });
    return true;
  }

  /** no real bend in the next `dist` metres */
  private straightAhead(s: number, dist: number) {
    for (let d = 0; d < dist; d += 10) if (Math.abs(this.track.curv[this.track.indexAt(s + d)]) > 1 / 200) return false;
    return true;
  }

  /** bots: use items when they suit, and decide which rings and boxes to go for */
  private bots() {
    const tr = this.track;
    for (const fc of this.cars) {
      if (!fc.bot || !fc.item || this.t < fc.useAt) continue;
      if (fc.item === 'oil') {
        const p = fc.car.body.translation();
        const behind = this.cars.some(o => o !== fc && (o.car.body.translation().x - p.x) ** 2 + (o.car.body.translation().z - p.z) ** 2 < 900);
        if (!behind && this.t < fc.useAt + 8) continue;
      } else if (fc.item === 'mega') {
        if (!this.layout.rings.some(r => r.kind === 'hop' && ((r.s - fc.view.s + tr.total) % tr.total) < fc.car.speed * 0.5)) {
          if (this.t < fc.useAt + 12 || !this.straightAhead(fc.view.s, fc.car.speed * 2) || fc.car.airborne) continue;
        }
      } else if (!this.straightAhead(fc.view.s, fc.car.speed * 2.5) || fc.car.airborne) continue; // turbos on a straight
      this.useItem(fc);
      fc.useAt = this.t + 1.6;
    }
  }

  /** where a bot should aim next: a ring it has decided to go for (and when to jump for a hop
   *  ring), or an item box when it has nothing */
  aim(fc: FunCar, s: number, speed: number, aggression: number): { s: number; d: number; hop: boolean } | null {
    const tr = this.track;
    let best: { s: number; d: number; hop: boolean } | null = null, bestDs = Infinity;
    for (const r of this.layout.rings) {
      if (r.kind === 'ramp') continue;
      const ds = (r.s - s + tr.total) % tr.total;
      if (ds > 110) { fc.goFor.delete(r); continue; }
      if (!fc.goFor.has(r)) fc.goFor.set(r, Math.random() < 0.45 + aggression * 0.5);
      if (!fc.goFor.get(r) || ds >= bestDs) continue;
      // a jump peaks about 0.6 s after take-off
      const hop = r.kind === 'hop' && ds < Math.max(8, speed * 0.55) && ds > speed * 0.3 && this.straightAhead(s, speed * 1.4);
      best = { s: r.s, d: r.d, hop }; bestDs = ds;
    }
    if (!best && !fc.item) {
      // the nearest box across the road in the next row that has one
      let side = Infinity;
      for (const b of this.boxes) {
        const ds = (b.s - s + tr.total) % tr.total;
        if (ds < 15 || ds > 90 || b.respawn > 0 || ds > bestDs + 1) continue;
        const off = Math.abs(b.d - fc.view.lateral);
        if (ds < bestDs - 1 || off < side) { best = { s: b.s, d: b.d, hop: false }; bestDs = ds; side = off; }
      }
    }
    return best;
  }

  dispose() {
    for (const c of this.colliders) this.world.removeCollider(c, false);
    this.colliders.length = 0;
  }
}
