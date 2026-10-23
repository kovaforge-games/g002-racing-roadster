// AI rivals, ported from g001's bot drivers: pure-pursuit steering along the racing line, speed
// from the track's speed profile, overtaking and following in traffic, a pace learned per
// sector, occasional mistakes and recovery. On top of that they use the thrusters: boost on the
// straights, a hop over a slow car in their lane, and a detour through the air canisters when
// their tank runs low.
import { CAR, steerLockAt, type Car, type CarInputs } from './car';
import type { JetInputs, Jets } from './jets';
import type { Track } from './track';
import type { Canisters } from './canisters';

export interface RivalDef {
  name: string;
  /** multiplies the speed profile */
  pace: number;
  /** 0..1: how readily they pass, boost and hop */
  aggression: number;
  /** 0..1: fewer mistakes */
  consistency: number;
}

/** fictional drivers, one per paint colour after the player's */
export const RIVALS: RivalDef[] = [
  { name: 'Nova Reyes', pace: 1.02, aggression: 0.75, consistency: 0.92 },
  { name: 'Kai Lindqvist', pace: 1.0, aggression: 0.55, consistency: 0.95 },
  { name: 'Mara Okafor', pace: 0.99, aggression: 0.9, consistency: 0.8 },
  { name: 'Theo Brandt', pace: 0.97, aggression: 0.45, consistency: 0.9 },
  { name: 'Suki Tanaka', pace: 0.955, aggression: 0.7, consistency: 0.75 },
];

/** what a driver can see of another car */
export interface CarView { car: Car; s: number; lateral: number; speed: number }

const SECTORS = 24;
const LEARN_MAX = 1.04;

export class RivalDriver {
  lane = 0;
  laneTarget = 0;
  /** rubber band, set by the race */
  paceMul = 1;
  needsReset = false;
  private stuckTime = 0;
  private mistakeLeft = 0;
  private mistakeCorner = -1;
  private learned = new Float32Array(SECTORS).fill(1);
  private sector = -1;
  private trouble = false;
  /** commits to boosting for a whole straight instead of flickering on and off */
  private boostHold = 0;
  private hopNext = false;

  constructor(readonly def: RivalDef, private track: Track, private line: Float64Array, private profile: Float64Array) {}

  private at(arr: Float64Array, s: number) {
    const tr = this.track, step = tr.total / tr.n;
    const ss = ((s % tr.total) + tr.total) % tr.total;
    const i = Math.floor(ss / step), f = ss / step - i;
    return arr[i] * (1 - f) + arr[(i + 1) % tr.n] * f;
  }

  /** is the road straight (fast) for the next `dist` metres? */
  private straightAhead(s: number, dist: number, speed: number) {
    for (let d = 0; d < dist; d += 10) if (this.at(this.profile, s + d) * this.pace < speed + 4) return false;
    return true;
  }

  get pace() { return this.def.pace * this.paceMul; }

  drive(me: CarView, others: CarView[], jets: Jets, canisters: Canisters, dt: number, launching: boolean): { inp: CarInputs; jet: JetInputs } {
    const tr = this.track, car = me.car;
    const speed = car.speed;
    const look = 9 + Math.max(0, speed) * 0.42;
    const aggr = this.def.aggression;

    // --- traffic: pick a side to pass, or follow
    let blocked = Infinity, blockerSpeed = 0;
    const lineHere = this.at(this.line, me.s);
    const myLine = lineHere + this.lane;
    for (const o of others) {
      let ds = o.s - me.s;
      if (ds < -tr.total / 2) ds += tr.total;
      if (ds > tr.total / 2) ds -= tr.total;
      if (ds <= 0 || ds > 40) continue;
      if (Math.abs(o.lateral - me.lateral) < 2.4) {
        if (ds < blocked) { blocked = ds; blockerSpeed = o.speed; }
        const room = tr.halfWidth - 1.6;
        const passL = o.lateral - 3.2, passR = o.lateral + 3.2;
        const canL = passL > -room, canR = passR < room;
        if (ds < 28 && speed > o.speed * 0.97 && Math.random() < aggr * 0.9) {
          const target = canL && (!canR || Math.abs(passL - myLine) < Math.abs(passR - myLine)) ? passL : canR ? passR : myLine;
          this.laneTarget = target - lineHere;
        }
        // a much slower car right in front: hop it if there's air to spare
        if (ds < 9 && speed > o.speed + 7 && speed > 12 && jets.tank > 0.35 && Math.random() < aggr * 0.05) this.hopNext = true;
      }
    }

    // --- low on air: steer through the next row of canisters that still has some
    let seek: number | null = null;
    if (blocked > 15 && jets.tank < 0.55) {
      let bestDs = Infinity;
      for (const c of canisters.list) {
        if (c.respawn > 0) continue;
        const ds = (c.s - me.s + tr.total) % tr.total;
        if (ds > 20 && ds < 140 && ds < bestDs) { bestDs = ds; seek = c.d - this.at(this.line, c.s); }
      }
    }
    if (seek !== null) this.laneTarget = seek;
    else if (blocked === Infinity) this.laneTarget *= Math.exp(-dt * 0.6);
    this.lane += (this.laneTarget - this.lane) * Math.min(1, dt * 1.5);

    // --- steering: pure pursuit to a point on the racing line plus the lane offset
    const sT = me.s + look;
    const lim = tr.halfWidth - 1.3;
    let off = Math.max(-lim, Math.min(lim, this.at(this.line, sT) + this.lane));
    if (Math.abs(me.lateral) > tr.halfWidth + 1) off *= 0.3; // off the road: aim for the middle
    if (this.mistakeLeft > 0) off += Math.sign(off || 1) * 2;
    const p = tr.pointAt(sT, off);
    const pos = car.body.translation();
    const { fwd, right } = car.axes();
    const dx = p.x - pos.x, dz = p.z - pos.z;
    const lf = dx * fwd.x + dz * fwd.z, lr = dx * right.x + dz * right.z;
    const alpha = Math.atan2(lr, Math.max(lf, 1));
    let delta = Math.atan((2 * CAR.wheelbase * Math.sin(alpha)) / look);
    const aMax = CAR.grip * 0.95 * (9.81 + (0.6 * CAR.liftArea * speed * speed) / CAR.mass);
    const dMax = Math.atan((CAR.wheelbase * aMax) / Math.max(speed * speed, 1)) * 1.4;
    delta = Math.max(-dMax, Math.min(dMax, delta));
    const steer = Math.max(-1, Math.min(1, delta / (steerLockAt(speed) || 1e-3)));

    // --- speed: profile ahead, scaled by pace and what this driver has learned per sector
    const sec = Math.floor((me.s / tr.total) * SECTORS) % SECTORS;
    if (sec !== this.sector) {
      if (this.sector >= 0) {
        const k = this.learned;
        k[this.sector] = this.trouble ? Math.max(0.93, k[this.sector] - 0.03) : Math.min(LEARN_MAX, k[this.sector] + 0.006);
      }
      this.sector = sec; this.trouble = false;
    }
    if (Math.abs(car.vLat) > 2.6 || Math.abs(me.lateral) > tr.halfWidth + 0.5) this.trouble = true;
    const sAhead = me.s + 5 + speed * 0.2;
    const secAhead = Math.floor(((sAhead % tr.total) / tr.total) * SECTORS + SECTORS) % SECTORS;
    let vT = this.at(this.profile, sAhead) * this.pace * this.learned[secAhead];
    if (this.mistakeLeft > 0) vT *= 1.07; // braking too late
    if (blocked < 18) vT = Math.min(vT, blockerSpeed + (blocked - 8) * 0.6);
    let throttle = 0, brake = 0;
    const err = vT - speed;
    // traction-aware: feed the throttle in while sliding
    const slide = Math.min(1, Math.abs(car.vLat) / 3);
    if (err > 0.5) throttle = Math.min(1, 0.5 + err * 0.4) * (1 - 0.5 * slide);
    else if (err < -1) brake = Math.min(1, 0.4 - err * 0.4);
    else throttle = 0.3;

    // --- mistakes: now and then, a corner taken too fast and wide
    const ci = Math.floor(me.s / 120);
    if (ci !== this.mistakeCorner) {
      this.mistakeCorner = ci;
      if (Math.random() < 0.06 * (1.4 - this.def.consistency)) this.mistakeLeft = 1.4;
    }
    this.mistakeLeft -= dt;

    // --- thrusters
    if (launching) this.boostHold = Math.random() < 0.4 + aggr * 0.5 ? 1.5 : 0;
    else if (this.boostHold <= 0 && throttle > 0.95 && blocked > 25 && jets.tank > 0.2 + (1 - aggr) * 0.25
      && this.straightAhead(me.s, Math.max(45, speed * 1.3), speed)) this.boostHold = 0.6 + aggr * 1.2;
    if (brake > 0 || blocked < 15) this.boostHold = 0;
    this.boostHold -= dt;
    const hop = this.hopNext; this.hopNext = false;

    // --- recovery
    if (speed < 2 && !launching) this.stuckTime += dt; else this.stuckTime = 0;
    if (this.stuckTime > 3) { this.needsReset = true; this.stuckTime = 0; }

    return {
      inp: { steer, throttle, brake, handbrake: false },
      jet: { boost: this.boostHold > 0, hop, airRoll: false },
    };
  }

  /** after a reset: forget the lane and any mistake in progress */
  settle() { this.lane = this.laneTarget = 0; this.mistakeLeft = 0; this.boostHold = 0; }
}
