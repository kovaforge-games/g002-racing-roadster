// The flying tow: after a crash a Roadster flies down from the sky, hovers over the wreck, lowers
// a cable and hooks it, lifts it, carries it back onto the track and sets it down facing the
// right way. Then it unhooks, flies on along the track through three rings of fire and climbs
// back into the sky. This is the choreography only: where the tow car, the cable and the carried
// car are at each moment. The game holds the physics car to `carPose` while `holding` is true,
// and render/towScene.ts draws the rest.
import * as THREE from 'three';
import type { Track } from './track';

export type TowEvent = 'arrived' | 'hooked' | 'release' | 'ring' | 'gone';
type Stage = 'descend' | 'hook' | 'lift' | 'carry' | 'lower' | 'unhook' | 'depart' | 'gone';

export const TOW = {
  /** seconds for each stage (the carry also grows with the distance): it streaks in from far
   *  away and has the car back on the road in under three seconds */
  descend: 0.85, hook: 0.3, lift: 0.35, lower: 0.4, unhook: 0.25,
  /** where it swoops in from: this far back along the road and this high up (m) */
  from: [110, 85] as [number, number],
  /** the cable (m), and the tow car's centre above the hooked car's centre */
  cable: 4.6, above: 5.9,
  /** how high the car is carried (m) */
  carryHeight: 3.2,
  /** rings of fire after the drop: metres along the track from the drop, and height over the road */
  rings: [[60, 8.5], [125, 11], [190, 14]] as [number, number][],
  ringRadius: 4.2,
  /** where the climb into the sky ends */
  sky: [420, 260] as [number, number],
  /** depart speed (m/s): from a hover to this (about 500 km/h), and how hard it accelerates */
  departSpeed: 140, departAccel: 150,
};

const up = new THREE.Vector3(0, 1, 0);
/** the cable comes out of the tow car's belly, this far below its centre */
export const BELLY = 0.35;
const smooth = (u: number) => u * u * (3 - 2 * u);
const easeOut = (u: number) => 1 - (1 - u) ** 3;
const yawQ = (yaw: number) => new THREE.Quaternion().setFromAxisAngle(up, yaw);

export interface Ring { pos: THREE.Vector3; yaw: number; pitch: number; passed: boolean }

export class Tow {
  stage: Stage = 'descend';
  private t = 0;
  /** events since the last takeEvents() */
  private events: TowEvent[] = [];
  /** the tow car */
  readonly pos = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  /** the carried car (its centre of mass), while held */
  readonly carPos = new THREE.Vector3();
  readonly carQuat = new THREE.Quaternion();
  /** cable length paid out (0 = reeled in) */
  cable = 0;
  /** 0..1 how far the hover jets are firing (for the effects and sound) */
  thrust = 1;
  /** wheels folded into hover pods (0..1): they fold flat as it comes down */
  fold = 1;
  readonly rings: Ring[] = [];

  private start: THREE.Vector3; private startQ: THREE.Quaternion;
  private liftQ = new THREE.Quaternion();
  private unhookFrom = new THREE.Vector3();
  private target: THREE.Vector3; private targetQ: THREE.Quaternion;
  private from: THREE.Vector3;
  private carry: number;
  private headingT: number;
  /** the depart flight: a polyline through the rings with distances along it */
  private path: THREE.Vector3[] = [];
  private pathLen: number[] = [];
  private ringDist: number[] = [];
  private flown = 0;
  private speed = 0;
  private prevYaw = 0; private bank = 0;

  /** `car`: where the crashed car is (centre of mass) and how it lies; `s`: the track position
   *  to drop it at, `lateral` its offset; `comY`: the car's centre of mass above the road */
  constructor(private track: Track, car: { p: THREE.Vector3; q: THREE.Quaternion }, readonly s: number, readonly lateral: number, comY: number) {
    this.headingT = track.headingAt(s);
    const road = track.pointAt(s, lateral);
    this.target = new THREE.Vector3(road.x, road.y + comY + 0.08, road.z);
    this.targetQ = yawQ(this.headingT);
    // a car lost far below the world is fetched from just under the road
    this.start = car.p.clone();
    if (this.start.y < road.y - 6) this.start.set(road.x, road.y - 6, road.z);
    this.startQ = car.q.clone();
    const fwd = new THREE.Vector3(Math.sin(this.headingT), 0, Math.cos(this.headingT));
    this.from = this.start.clone().addScaledVector(fwd, -TOW.from[0]).addScaledVector(up, TOW.from[1]);
    this.carry = THREE.MathUtils.clamp(0.45 + this.start.distanceTo(this.target) / 45, 0.55, 1.4);
    this.carPos.copy(this.start); this.carQuat.copy(this.startQ);
    this.pos.copy(this.from); this.quat.copy(this.targetQ);
    this.prevYaw = this.headingT;
  }

  /** the physics car follows carPose */
  get holding() { return this.stage === 'descend' || this.stage === 'hook' || this.stage === 'lift' || this.stage === 'carry' || this.stage === 'lower'; }
  get done() { return this.stage === 'gone'; }
  /** the tow car's cable end, where it meets the hooked car's roof */
  get hookPoint() { return this.pos.clone().addScaledVector(up, -BELLY - this.cable); }
  /** how fast the tow car is flying (m/s), for its contrail and sound */
  get flightSpeed() {
    if (this.stage === 'descend') return this.from.distanceTo(this.start) / TOW.descend * (1 - Math.min(1, this.t / TOW.descend)) * 2.2;
    return this.stage === 'depart' ? this.speed : 0;
  }
  /** the whole show from the crash to the drop, in seconds */
  get toDrop() { return TOW.descend + TOW.hook + TOW.lift + this.carry + TOW.lower; }

  takeEvents() { const e = this.events; this.events = []; return e; }

  step(dt: number) {
    if (this.stage === 'gone') return;
    this.t += dt;
    const bob = Math.sin(this.t * 2.3) * 0.12;
    const over = (p: THREE.Vector3) => this.pos.copy(p).addScaledVector(up, TOW.above + bob);
    const next = (s: Stage, ev?: TowEvent) => { this.stage = s; this.t = 0; if (ev) this.events.push(ev); };
    switch (this.stage) {
      case 'descend': {
        const u = Math.min(1, this.t / TOW.descend), e = easeOut(u);
        const hover = this.start.clone().addScaledVector(up, TOW.above);
        this.pos.lerpVectors(this.from, hover, e);
        this.pos.y += (1 - e) * (1 - e) * 14; // a swoop: steep at first, flattening out
        // nose down on the way in, levelling off to hover
        this.quat.copy(this.targetQ).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.35 * (1 - e)));
        this.fold = Math.min(1, u * 2.5);
        this.thrust = 0.6 + 0.4 * e;
        if (u >= 1) next('hook', 'arrived');
        break;
      }
      case 'hook': {
        const u = Math.min(1, this.t / TOW.hook);
        over(this.start);
        this.quat.copy(this.targetQ);
        this.cable = TOW.cable * smooth(u);
        if (u >= 1) { this.liftQ.copy(this.startQ); next('lift', 'hooked'); }
        break;
      }
      case 'lift': {
        const u = smooth(Math.min(1, this.t / TOW.lift));
        this.carPos.copy(this.start).addScaledVector(up, TOW.carryHeight * u);
        // the car swings round under the cable as it comes off the ground
        this.carQuat.copy(this.liftQ).slerp(this.targetQ, u * 0.35);
        over(this.carPos);
        if (this.t >= TOW.lift) { this.liftQ.copy(this.carQuat); next('carry'); }
        break;
      }
      case 'carry': {
        const u = Math.min(1, this.t / this.carry), e = smooth(u);
        const a = this.start.clone().addScaledVector(up, TOW.carryHeight), b = this.target.clone().addScaledVector(up, TOW.carryHeight);
        this.carPos.lerpVectors(a, b, e).addScaledVector(up, Math.sin(Math.PI * e) * Math.min(4, a.distanceTo(b) * 0.15));
        // swinging a little on the cable
        const sway = Math.sin(this.t * 3.1) * 0.06 * (1 - u);
        this.carQuat.copy(this.liftQ).slerp(this.targetQ, smooth(Math.min(1, u * 1.3)))
          .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(sway * 0.6, 0, sway)));
        over(this.carPos);
        this.quat.copy(this.targetQ);
        if (u >= 1) next('lower');
        break;
      }
      case 'lower': {
        const u = smooth(Math.min(1, this.t / TOW.lower));
        this.carPos.copy(this.target).addScaledVector(up, TOW.carryHeight * (1 - u));
        this.carQuat.copy(this.targetQ);
        over(this.carPos);
        if (this.t >= TOW.lower) { this.unhookFrom.copy(this.pos); this.buildPath(); next('unhook', 'release'); }
        break;
      }
      case 'unhook': {
        const u = Math.min(1, this.t / TOW.unhook);
        this.cable = TOW.cable * (1 - smooth(u));
        this.pos.lerpVectors(this.unhookFrom, this.path[0], smooth(u));
        if (u >= 1) next('depart');
        break;
      }
      case 'depart': {
        this.speed = Math.min(TOW.departSpeed, this.speed + dt * TOW.departAccel);
        this.flown += this.speed * dt;
        const { p, tan } = this.along(this.flown);
        this.pos.copy(p);
        const yaw = Math.atan2(tan.x, tan.z), pitch = -Math.asin(THREE.MathUtils.clamp(tan.y, -1, 1));
        let dy = yaw - this.prevYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        this.prevYaw = yaw;
        this.bank += (THREE.MathUtils.clamp(-dy / Math.max(dt, 1e-3) * 0.25, -0.6, 0.6) - this.bank) * Math.min(1, dt * 4);
        this.quat.setFromEuler(new THREE.Euler(pitch, yaw, this.bank, 'YXZ'));
        this.ringDist.forEach((d, k) => { if (!this.rings[k].passed && this.flown >= d) { this.rings[k].passed = true; this.events.push('ring'); } });
        if (this.flown >= this.pathLen[this.pathLen.length - 1]) { this.stage = 'gone'; this.events.push('gone'); }
        break;
      }
    }
  }

  /** the rings ahead of the drop, and a smooth flight through their centres into the sky */
  private buildPath() {
    const pts = [this.target.clone().addScaledVector(up, TOW.above + 1.5)];
    const at = (ds: number, h: number) => { const p = this.track.pointAt(this.s + ds, this.lateral * 0.3); return new THREE.Vector3(p.x, p.y + h, p.z); };
    pts.push(at(18, TOW.above + 1.5));
    for (const [ds, h] of TOW.rings) {
      const p = at(ds, h);
      this.rings.push({ pos: p, yaw: 0, pitch: 0, passed: false });
      pts.push(p);
    }
    pts.push(at(TOW.rings[TOW.rings.length - 1][0] + 30, TOW.rings[TOW.rings.length - 1][1] + 14));
    pts.push(at(TOW.sky[0], TOW.sky[1]));
    this.path = new THREE.CatmullRomCurve3(pts, false, 'centripetal').getPoints(240);
    this.measure();
    // each ring faces along the flight through it
    const ringIdx = this.rings.map(r => this.path.reduce((best, p, k) => p.distanceTo(r.pos) < this.path[best].distanceTo(r.pos) ? k : best, 0));
    ringIdx.forEach((k, j) => {
      const tan = this.path[Math.min(this.path.length - 1, k + 1)].clone().sub(this.path[Math.max(0, k - 1)]).normalize();
      this.rings[j].yaw = Math.atan2(tan.x, tan.z);
      this.rings[j].pitch = -Math.asin(THREE.MathUtils.clamp(tan.y, -1, 1));
      this.rings[j].pos.copy(this.path[k]);
      this.ringDist[j] = this.pathLen[k];
    });
  }

  private measure() {
    this.pathLen = [0];
    for (let k = 1; k < this.path.length; k++) this.pathLen.push(this.pathLen[k - 1] + this.path[k].distanceTo(this.path[k - 1]));
  }

  private along(d: number) {
    const L = this.pathLen;
    let k = 1;
    while (k < L.length - 1 && L[k] < d) k++;
    const u = THREE.MathUtils.clamp((d - L[k - 1]) / Math.max(1e-6, L[k] - L[k - 1]), 0, 1);
    const p = this.path[k - 1].clone().lerp(this.path[k], u);
    const tan = this.path[k].clone().sub(this.path[k - 1]).normalize();
    return { p, tan };
  }
}
