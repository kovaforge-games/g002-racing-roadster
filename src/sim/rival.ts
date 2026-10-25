// AI rivals, ported from g001's bot drivers: pure-pursuit steering along the racing line, speed
// from the track's speed profile, overtaking and following in traffic, a pace learned per
// sector, occasional mistakes and recovery. On top of that they use the thrusters: boost on the
// straights, a hop over a slow car in their lane, and a detour through the air canisters when
// their tank runs low.
import { steerLockAt, type Car, type CarInputs } from './car';
import type { JetInputs, Jets } from './jets';
import type { Track } from './track';
import type { Canisters } from './canisters';
import { PIT, laneD, type PitStop } from './pits';

export interface RivalDef {
  name: string;
  /** multiplies the speed profile */
  pace: number;
  /** 0..1: how readily they pass, boost and hop */
  aggression: number;
  /** 0..1: fewer mistakes */
  consistency: number;
}

/** the bots, in order: Bot 1 is the quickest. A race with fewer opponents takes the first ones */
export const RIVALS: RivalDef[] = [
  { name: 'Lionelinni Bannanini', pace: 1.02, aggression: 0.75, consistency: 0.93 },
  { name: 'Gunvini Uvinini', pace: 1.012, aggression: 0.6, consistency: 0.95 },
  { name: 'Ramanini Banannini', pace: 1.005, aggression: 0.85, consistency: 0.85 },
  { name: 'Arvinini Chegenini', pace: 0.998, aggression: 0.5, consistency: 0.92 },
  { name: 'Jakobini Chananini', pace: 0.99, aggression: 0.7, consistency: 0.88 },
  { name: 'Joaquinini Borquezini', pace: 0.983, aggression: 0.8, consistency: 0.8 },
  { name: 'Orionini Siuinini', pace: 0.976, aggression: 0.55, consistency: 0.9 },
  { name: 'Jakeinnini Bananinni', pace: 0.97, aggression: 0.65, consistency: 0.84 },
  { name: 'Asherinini Basketballini', pace: 0.963, aggression: 0.9, consistency: 0.78 },
  { name: 'Danielini Caperrinini', pace: 0.956, aggression: 0.45, consistency: 0.9 },
  // the wildcard: not the quickest, but the first to boost and hop
  { name: 'Nico the Bird', pace: 0.95, aggression: 1, consistency: 0.72 },
];

export type Difficulty = 'newbie' | 'beginner' | 'club' | 'expert' | 'pro';
export const DIFFICULTY_ORDER: Difficulty[] = ['newbie', 'beginner', 'club', 'expert', 'pro'];

/** how the bots drive at each difficulty: pace multiplies their own, consistency and aggression
 *  shift theirs, `ease` is how much they slow down when well ahead of the player and `push` how
 *  much harder they try when well behind */
export const DIFFICULTIES: Record<Difficulty, { label: string; about: string; pace: number; consistency: number; aggression: number; ease: number; push: number }> = {
  newbie: { label: 'Newbie', about: 'Gentle bots that brake early and wait for you.', pace: 0.8, consistency: -0.25, aggression: -0.4, ease: 0.08, push: 0.01 },
  beginner: { label: 'Beginner', about: 'Relaxed bots that make mistakes.', pace: 0.89, consistency: -0.15, aggression: -0.25, ease: 0.06, push: 0.025 },
  club: { label: 'Club', about: 'A fair fight for a driver who knows the track.', pace: 0.95, consistency: -0.05, aggression: -0.1, ease: 0.04, push: 0.04 },
  expert: { label: 'Expert', about: 'Quick, tidy bots that pass when they can.', pace: 1, consistency: 0, aggression: 0, ease: 0.03, push: 0.06 },
  pro: { label: 'Pro', about: 'Flat out and hardly any mistakes.', pace: 1.035, consistency: 0.06, aggression: 0.1, ease: 0.01, push: 0.06 },
};

/** a bot's driving at a difficulty */
export function rivalAt(def: RivalDef, d: Difficulty): RivalDef {
  const k = DIFFICULTIES[d], clamp = (v: number) => Math.max(0, Math.min(1, v));
  return { name: def.name, pace: def.pace * k.pace, aggression: clamp(def.aggression + k.aggression), consistency: clamp(def.consistency + k.consistency) };
}

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
  /** backing out of a wall: seconds left, and whether it was tried since the car last moved */
  private backT = 0;
  private backedOut = false;
  private mistakeLeft = 0;
  private mistakeCorner = -1;
  private learned = new Float32Array(SECTORS).fill(1);
  private sector = -1;
  private trouble = false;
  /** commits to boosting for a whole straight instead of flickering on and off */
  private boostHold = 0;
  private hopNext = false;
  /** Fun Mode: somewhere on the road to aim for (a ring of fire, an item box) and whether to
   *  jump now; null drives the normal race */
  aim: ((s: number, speed: number) => { s: number; d: number; hop: boolean } | null) | null = null;
  /** this car's pit stop (set by the race), and whether to come in next time round */
  pit: PitStop | null = null;
  wantPit = false;

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

  /** coming into the pits: where to be across the road and how fast, or null on a normal lap */
  private pitPath(s: number) {
    const pit = this.pit, tr = this.track;
    if (!pit) return null;
    const going = pit.phase !== 'none' || this.wantPit;
    if (!going) return null;
    // the run to the entry: keep to the right
    if (pit.phase === 'none') {
      // braking for the entry in time: 26 m/s at the entry, then down to the limit at the wall
      if (s > tr.total - 220 || s < PIT.entry) return { d: 4.8, v: Math.sqrt(26 ** 2 + 2 * 7 * ((PIT.entry - s + tr.total) % tr.total)) };
      if (s < PIT.wallFrom) return { d: laneD(s + 14) ?? 4.8, v: 26 - (26 - PIT.limit) * (s - PIT.entry) / (PIT.wallFrom - PIT.entry) };
      return null;
    }
    if (pit.phase === 'service') return { d: PIT.boxD, v: 0 };
    const lane = laneD(s) ?? PIT.d;
    const fast = s < PIT.wallFrom || s > PIT.wallTo ? lane : PIT.fast;
    // (pushed into the lane without meaning to stop: drive through it)
    if (pit.phase === 'in' && this.wantPit) {
      const to = pit.boxS - s;
      // swing into the box over the last 22 m and brake to a stop in it
      const d = to < 22 && to > -3 ? fast + (PIT.boxD - fast) * Math.min(1, (22 - to) / 14) : fast;
      return { d, v: Math.min(PIT.limit, Math.sqrt(Math.max(0, 2 * 4.5 * (to - 0.3)))) };
    }
    return { d: fast, v: s < PIT.limitTo ? PIT.limit : Infinity };
  }

  drive(me: CarView, others: CarView[], jets: Jets, canisters: Canisters, dt: number, launching: boolean): { inp: CarInputs; jet: JetInputs } {
    const tr = this.track, car = me.car;
    const speed = car.speed;
    const look = 9 + Math.max(0, speed) * 0.42;
    const aggr = this.def.aggression;
    const pitting = this.pitPath(me.s);

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
        if (!pitting && ds < 28 && speed > o.speed * 0.97 && Math.random() < aggr * 0.9) {
          const target = canL && (!canR || Math.abs(passL - myLine) < Math.abs(passR - myLine)) ? passL : canR ? passR : myLine;
          this.laneTarget = target - lineHere;
        }
        // a much slower car right in front: hop it if there's air to spare
        if (ds < 9 && speed > o.speed + 7 && speed > 12 && jets.tank > 0.35 && Math.random() < aggr * 0.05) this.hopNext = true;
      }
    }

    // --- low on air: steer through the next row of canisters that still has some
    let seek: number | null = null;
    if (!pitting && blocked > 15 && jets.tank < 0.55) {
      let bestDs = Infinity;
      for (const c of canisters.list) {
        if (c.respawn > 0) continue;
        const ds = (c.s - me.s + tr.total) % tr.total;
        if (ds > 20 && ds < 140 && ds < bestDs) { bestDs = ds; seek = c.d - this.at(this.line, c.s); }
      }
    }
    const goal = pitting ? null : this.aim?.(me.s, speed) ?? null;
    if (goal?.hop) this.hopNext = true;
    if (goal && blocked > 12) seek = goal.d - this.at(this.line, goal.s);
    if (seek !== null) this.laneTarget = seek;
    else if (blocked === Infinity) this.laneTarget *= Math.exp(-dt * 0.6);
    this.lane += (this.laneTarget - this.lane) * Math.min(1, dt * 1.5);

    // --- steering: pure pursuit to a point on the racing line plus the lane offset
    const sT = me.s + look;
    const lim = tr.halfWidth - 1.3;
    let off = Math.max(-lim, Math.min(lim, this.at(this.line, sT) + this.lane));
    if (Math.abs(me.lateral) > tr.halfWidth + 1) off *= 0.3; // off the road: aim for the middle
    // into the pits: follow the lane instead (looking a short way ahead, it's slow)
    const pitAhead = pitting ? this.pitPath(me.s + Math.min(look, 6 + speed * 0.3)) : null;
    if (pitting) off = (pitAhead ?? pitting).d;
    if (this.mistakeLeft > 0) off += Math.sign(off || 1) * 2;
    const p = tr.pointAt(pitting ? me.s + Math.min(look, 6 + speed * 0.3) : sT, off);
    const pos = car.body.translation();
    const { fwd, right } = car.axes();
    const dx = p.x - pos.x, dz = p.z - pos.z;
    const lf = dx * fwd.x + dz * fwd.z, lr = dx * right.x + dz * right.z;
    const alpha = Math.atan2(lr, Math.max(lf, 1));
    const S = car.spec;
    let delta = Math.atan((2 * S.wheelbase * Math.sin(alpha)) / look);
    const aMax = S.grip * 0.95 * (9.81 + (0.6 * S.liftArea * speed * speed) / S.mass);
    const dMax = Math.atan((S.wheelbase * aMax) / Math.max(speed * speed, 1)) * 1.4;
    delta = Math.max(-dMax, Math.min(dMax, delta));
    const steer = Math.max(-1, Math.min(1, delta / (steerLockAt(speed, S.steerLock) || 1e-3)));

    // --- speed: profile ahead, scaled by pace and what this driver has learned per sector
    const sec = Math.floor((me.s / tr.total) * SECTORS) % SECTORS;
    if (sec !== this.sector) {
      if (this.sector >= 0) {
        const k = this.learned;
        k[this.sector] = this.trouble ? Math.max(0.93, k[this.sector] - 0.03) : Math.min(LEARN_MAX, k[this.sector] + 0.006);
      }
      this.sector = sec; this.trouble = false;
    }
    if (!pitting && (Math.abs(car.vLat) > 2.6 || Math.abs(me.lateral) > tr.halfWidth + 0.5)) this.trouble = true;
    const sAhead = me.s + 5 + speed * 0.2;
    const secAhead = Math.floor(((sAhead % tr.total) / tr.total) * SECTORS + SECTORS) % SECTORS;
    let vT = this.at(this.profile, sAhead) * this.pace * this.learned[secAhead];
    if (this.mistakeLeft > 0) vT *= 1.07; // braking too late
    if (pitting) vT = Math.min(vT, pitting.v);
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
    if (ci !== this.mistakeCorner && !pitting) {
      this.mistakeCorner = ci;
      if (Math.random() < 0.06 * (1.4 - this.def.consistency)) this.mistakeLeft = 1.4;
    }
    this.mistakeLeft -= dt;

    // --- thrusters
    if (launching) this.boostHold = Math.random() < 0.4 + aggr * 0.5 ? 1.5 : 0;
    else if (this.boostHold <= 0 && throttle > 0.95 && blocked > 25 && jets.tank > 0.2 + (1 - aggr) * 0.25
      && this.straightAhead(me.s, Math.max(45, speed * 1.3), speed)) this.boostHold = 0.6 + aggr * 1.2;
    if (brake > 0 || blocked < 15 || pitting) this.boostHold = 0;
    this.boostHold -= dt;
    const hop = this.hopNext; this.hopNext = false;

    // --- recovery: wedged against a wall or a car, back out with the wheel the other way and
    // drive on; still stuck after that, the race puts the car back on the road
    if (this.backT > 0) {
      this.backT -= dt;
      if (this.backT > 0) return { inp: { steer: -Math.sign(steer || 1), throttle: 0, brake: 1, handbrake: false }, jet: { boost: false, hop: false, airRoll: false } };
    }
    if (speed < 2 && !launching && !this.pit?.holding) this.stuckTime += dt; else { this.stuckTime = 0; this.backedOut = false; }
    // (only against the outside barriers: in the pit lane or in a jam on the road, wait)
    if (this.stuckTime > 1.2 && !this.backedOut && !pitting && Math.abs(me.lateral) > tr.halfWidth + 3) { this.backT = 1.4; this.backedOut = true; }
    if (this.stuckTime > 4.5) { this.needsReset = true; this.stuckTime = 0; this.backedOut = false; }

    return {
      inp: { steer, throttle, brake, handbrake: false },
      jet: { boost: this.boostHold > 0, hop, airRoll: false },
    };
  }

  /** after a reset: forget the lane and any mistake in progress */
  settle() { this.lane = this.laneTarget = 0; this.mistakeLeft = 0; this.boostHold = 0; this.backT = 0; this.backedOut = false; this.stuckTime = 0; }
}
