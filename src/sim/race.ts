// A race: the player and the AI rivals on a staggered grid, laps and positions for everyone,
// rival driving, air pickups and recovery. The player's own driving, lap timing and resets stay
// in the game; the race only tracks the player's progress for the standings.
import type RAPIER from '@dimforge/rapier3d-compat';
import { CAR, Car, type CarSpec } from './car';
import { CLASSES, aeroOf, type ClassId } from './classes';
import { Jets } from './jets';
import { DIFFICULTIES, RIVALS, RivalDriver, rivalAt, type CarView, type Difficulty } from './rival';
import { racingLine, speedProfile } from './racingLine';
import { updateSurface } from './surface';
import { applyDrivingHelp } from './assist';
import { CANISTER_AIR, type Canisters } from './canisters';
import type { Track } from './track';
import { PHYSICS_DT } from './world';
import { PitStop, freshTyres } from './pits';

export const RACE_LAPS = 3;
export const MAX_OPPONENTS = RIVALS.length;
/** jet wash on a car right behind a boosting one (N, at closest range) */
const JET_WASH = 7000;
/** grid slot k (front row first): arc length and side, staggered pairs 5 m apart */
export const gridSlot = (k: number) => [-10 - 5 * k, k % 2 ? 2.8 : -2.8] as const;
/** the player's slot (0-based): towards the back, so there is a field to race through (fifth of six) */
export const playerSlot = (opponents: number) => Math.min(opponents, Math.round(opponents * 0.7));

export interface RaceOptions { opponents?: number; laps?: number; difficulty?: Difficulty; cls?: ClassId; /** the grid by name, pole first (a race weekend's qualifying); otherwise fastest bots first with the player in their slot */ grid?: string[] }

export interface Entrant extends CarView {
  name: string;
  jets: Jets;
  driver: RivalDriver | null;
  /** index into the car paints */
  paint: number;
  /** race number on the car: a bot's own number (bot 1 to bot 11); 0 for the player */
  number: number;
  hint: number;
  /** line crossings: 0 on the grid, 1 on the first lap, laps + 1 when finished */
  lap: number;
  passedHalf: boolean;
  prevS: number;
  /** distance raced, for the order */
  dist: number;
  pos: number;
  finished: boolean;
  finishTime: number | null;
  /** the session was ended early: finishTime is an estimate from the pace so far */
  estimated: boolean;
  lapStart: number | null;
  bestLap: number | null;
  flipT: number;
  /** air picked up this step, for effects */
  gotAir: number;
  /** times this rival was put back on the road */
  resets: number;
  /** brake lights */
  braking: boolean;
  /** seconds left of being hit by someone's jet wash, for a message */
  washed: number;
  /** the pit stop (the box matches the grid slot), and the lap a bot plans to stop on */
  pit: PitStop;
  pitLap: number | null;
}

export class Race {
  readonly entrants: Entrant[] = [];
  readonly player: Entrant;
  readonly laps: number;
  readonly difficulty: Difficulty;
  /** the class everyone races in; null is the original road car */
  readonly cls: ClassId | null;
  /** seconds since the lights went out */
  time = 0;
  running = false;
  private launchPending = false;
  /** called for each rival after its car and jets step, before the world steps (Fun Mode adds
   *  its boosts and spin-outs here) */
  onRivalStep: ((e: Entrant, dt: number) => void) | null = null;
  /** how damaged a car is (0..1, from the game's crash damage): a badly damaged bot pits */
  damageOf: (e: Entrant) => number = () => 0;
  /** a car stopped in its box, finished its stop, or left the pit lane */
  onPit: ((e: Entrant, ev: 'stopped' | 'done' | 'exit') => void) | null = null;
  private line: Float64Array;
  private profile: Float64Array;

  constructor(private track: Track, world: RAPIER.World, private canisters: Canisters, playerCar: Car, playerJets: Jets, opts: RaceOptions = {}) {
    const rivals = Math.max(1, Math.min(MAX_OPPONENTS, opts.opponents ?? 5));
    this.laps = Math.max(1, opts.laps ?? RACE_LAPS);
    this.difficulty = opts.difficulty ?? 'expert';
    this.cls = opts.cls ?? null;
    const spec: CarSpec = this.cls ? CLASSES[this.cls].spec : CAR;
    this.line = racingLine(track);
    this.profile = this.cls ? speedProfile(track, spec.grip, CLASSES[this.cls].brake, spec.topSpeed + 8, aeroOf(spec)) : speedProfile(track, 1.55);
    const blank = (name: string, car: Car, jets: Jets, driver: RivalDriver | null, paint: number, number = 0): Entrant => ({
      name, car, jets, driver, paint, number, s: 0, lateral: 0, speed: 0, hint: -1, lap: 0, passedHalf: false, prevS: 0,
      dist: 0, pos: 0, finished: false, finishTime: null, estimated: false, lapStart: null, bestLap: null, flipT: 0, gotAir: 0, resets: 0, braking: false, washed: 0,
      pit: new PitStop(0), pitLap: null,
    });
    this.player = blank('You', playerCar, playerJets, null, 0);
    for (let k = 0; k < rivals; k++) {
      const def = rivalAt(RIVALS[k], this.difficulty);
      const car = new Car(world, 0, 0, 0, 0, spec);
      car.stability = 0.6;
      this.entrants.push(blank(def.name, car, new Jets(), new RivalDriver(def, track, this.line, this.profile), k + 1, k + 1));
    }
    // fastest rivals at the front, the player in their slot (or the qualifying order)
    this.entrants.splice(playerSlot(rivals), 0, this.player);
    const order = opts.grid;
    if (order) this.entrants.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
    this.grid();
  }

  get rivals() { return this.entrants.filter(e => e.driver); }

  /** everyone back on the grid, laps cleared */
  grid() {
    this.entrants.forEach((e, k) => {
      const [s, d] = gridSlot(k);
      const p = this.track.pointAt(s, d);
      e.car.place(p.x, p.y, p.z, this.track.headingAt(s));
      e.jets.reset(); e.jets.tank = 1;
      e.driver?.settle();
      e.hint = this.track.nearest(p.x, p.z).i;
      e.s = e.prevS = this.track.nearest(p.x, p.z).s;
      e.lap = 0; e.passedHalf = false; e.finished = false; e.finishTime = null; e.estimated = false; e.lapStart = null; e.bestLap = null;
      e.flipT = 0; e.dist = 0; e.pos = k + 1; e.resets = 0;
      // each car's box is its grid slot; in a long race every bot plans one stop around half way
      e.pit = new PitStop(k); e.car.limit = Infinity;
      e.pitLap = e.driver && this.laps >= 4 ? Math.max(2, Math.min(this.laps - 1, Math.ceil(this.laps / 2) + (k % 3))) : null;
      if (e.driver) { e.driver.pit = e.pit; e.driver.wantPit = false; }
    });
    this.time = 0; this.running = false;
  }

  /** the lights are out */
  go() {
    this.running = true; this.launchPending = true;
    for (const e of this.entrants) e.jets.armLaunch();
  }

  /** drive every rival for one physics step; call after the player's car.step, before world.step */
  stepRivals(dt = PHYSICS_DT) {
    const launching = this.launchPending; this.launchPending = false;
    for (const e of this.entrants) {
      if (!e.driver) continue;
      updateSurface(e.car, this.track, e.hint);
      if (!this.running || e.pit.holding) {
        const hold = { steer: 0, throttle: 0, brake: e.pit.holding ? 1 : 0, handbrake: true };
        if (e.pit.holding) { e.car.body.setLinvel({ x: 0, y: Math.min(0, e.car.body.linvel().y), z: 0 }, true); e.car.body.setAngvel({ x: 0, y: 0, z: 0 }, true); }
        e.car.step(hold); e.jets.step(e.car, hold, { boost: false, hop: false, airRoll: false }, dt);
        continue;
      }
      // come in this time round? on the planned lap, or with a badly damaged car
      const next = e.s > this.track.total / 2 ? e.lap + 1 : e.lap;
      e.driver.wantPit = !e.finished && next <= this.laps && ((next === e.pitLap && e.pit.stops === 0) || (this.damageOf(e) > 0.55 && e.pit.stops < 2));
      const others = this.entrants.filter(o => o !== e);
      const { inp, jet } = e.driver.drive(e, others, e.jets, this.canisters, dt, launching);
      const assisted = applyDrivingHelp('medium', inp, e.car);
      e.braking = assisted.brake > 0.1 && e.car.speed > 0.5;
      e.car.step(assisted);
      e.jets.step(e.car, assisted, jet, dt);
      this.onRivalStep?.(e, dt);
    }
    if (this.running) this.jetWash();
  }

  /** a car tucked in close behind a boosting car gets blasted back by its jets (not off the
   *  grid, where everyone sits right behind someone) */
  private jetWash() {
    if (this.time < 3) return;
    for (const e of this.entrants) {
      if (!e.jets.boosting) continue;
      const p = e.car.body.translation();
      const { fwd } = e.car.axes();
      for (const o of this.entrants) {
        if (o === e) continue;
        const q = o.car.body.translation();
        const dx = q.x - p.x, dz = q.z - p.z;
        const back = -(dx * fwd.x + dz * fwd.z);          // metres behind e
        const side = Math.abs(dx * fwd.z - dz * fwd.x);   // metres off e's centreline
        if (back < 2 || back > 10 || side > 1.8 || Math.abs(q.y - p.y) > 2) continue;
        const f = JET_WASH * (1 - back / 10) * (1 - side / 1.8);
        o.car.body.addForce({ x: -fwd.x * f, y: 0, z: -fwd.z * f }, true);
        o.washed = 0.3;
      }
    }
  }

  /** after world.step: progress, laps, air pickups and recovery for everyone */
  afterStep(dt = PHYSICS_DT) {
    const tr = this.track;
    if (this.running) this.time += dt;
    for (const e of this.entrants) {
      const pos = e.car.body.translation();
      const near = tr.nearest(pos.x, pos.z, e.hint, 20);
      e.hint = near.i; e.s = near.s; e.lateral = near.lateral; e.speed = e.car.speed;
      e.gotAir = 0;
      e.washed = Math.max(0, e.washed - dt);
      // the pit lane: the limiter, the stop in the box and the way out
      if (this.running || !e.driver) {
        const ev = e.pit.update(e.car, near.s, near.lateral, this.time, dt, this.damageOf(e));
        if (ev === 'done') { freshTyres(e.car); e.jets.refill(1); }
        if (ev) this.onPit?.(e, ev);
      }
      if (e.driver) {
        const got = this.canisters.collect(pos.x, pos.y, pos.z);
        if (got) { e.jets.refill(got * CANISTER_AIR); e.gotAir = got * CANISTER_AIR; }
      }

      // laps: crossing s = 0 forwards; a lap counts only if it went past halfway
      if (Math.abs(near.s - tr.total / 2) < 200) e.passedHalf = true;
      if (this.running && e.prevS > tr.total - 80 && near.s < 80) {
        if (e.lap === 0 || e.passedHalf) {
          if (e.lap > 0 && e.lapStart !== null) {
            const t = this.time - e.lapStart;
            if (e.bestLap === null || t < e.bestLap) e.bestLap = t;
          }
          e.lap++; e.lapStart = this.time; e.passedHalf = false;
          if (e.lap > this.laps && !e.finished) { e.finished = true; e.finishTime = this.time; }
        }
      } else if (e.prevS < 80 && near.s > tr.total - 80) e.passedHalf = false;
      e.prevS = near.s;
      e.dist = e.lap === 0 ? near.s - tr.total : (e.lap - 1) * tr.total + near.s;

      if (!e.driver) continue;
      // rivals: flipped, stuck or lost -> back on the road a little behind
      if (e.car.axes().up.y < 0.25 && Math.abs(e.car.speed) < 4) e.flipT += dt; else e.flipT = 0;
      if (e.flipT > 1.5 || e.driver.needsReset || pos.y < -50 || near.dist > tr.wallOffset + 40) {
        e.flipT = 0; e.driver.needsReset = false; e.resets++;
        const s = near.s - 5;
        const p = tr.pointAt(s, Math.max(-3, Math.min(3, near.lateral)));
        e.car.place(p.x, p.y, p.z, tr.headingAt(s));
        e.jets.reset(); e.driver.settle();
      }
    }

    this.slipstream();

    // order: finishers by time, then distance raced
    const sorted = [...this.entrants].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime! - b.finishTime!;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.dist - a.dist;
    });
    sorted.forEach((e, k) => { e.pos = k + 1; });

    // keep it close: rivals well behind the player push harder, ones far ahead ease off a little
    // (more so on the easier difficulties)
    const { ease, push } = DIFFICULTIES[this.difficulty];
    for (const e of this.entrants) {
      if (!e.driver) continue;
      const gap = e.dist - this.player.dist;
      e.driver.paceMul = gap < -40 ? 1 + Math.min(push, (-gap - 40) / 3000) : gap > 160 ? 1 - Math.min(ease, (gap - 160) / 4000) : 1;
    }
  }

  /** slipstream and dirty air: a car close behind another one and in line with it gets less drag
   *  (most right behind, fading out 35 m back) and, within 20 m, less downforce */
  private slipstream() {
    for (const o of this.entrants) {
      let draft = 0, dirty = 0;
      if (this.running && this.time > 3) {
        const q = o.car.body.translation();
        for (const e of this.entrants) {
          if (e === o || e.car.speed < 15) continue;
          const p = e.car.body.translation();
          const { fwd } = e.car.axes();
          const dx = q.x - p.x, dz = q.z - p.z;
          const back = -(dx * fwd.x + dz * fwd.z), side = Math.abs(dx * fwd.z - dz * fwd.x);
          if (back < 4 || back > 35 || side > 2.2 || Math.abs(q.y - p.y) > 2) continue;
          // strongest about two car lengths back, so the tow doesn't drag the car into the one in front
          const inLine = 1 - side / 2.2, near = Math.min(1, (back - 4) / 5);
          draft = Math.max(draft, near * (1 - (back - 4) / 31) * inLine);
          if (back < 20) dirty = Math.max(dirty, (1 - (back - 4) / 16) * inLine);
        }
      }
      o.car.draft = draft; o.car.dirtyAir = dirty;
    }
  }

  /** end the session now: everyone still racing gets a finishing time from their pace so far */
  finishNow() {
    const total = this.laps * this.track.total;
    for (const e of this.entrants) {
      if (e.finished) continue;
      const pace = this.time > 5 && e.dist > 50 ? e.dist / this.time : 40;
      e.finished = true; e.estimated = true;
      e.finishTime = this.time + Math.max(0, total - e.dist) / pace;
    }
    [...this.entrants].sort((a, b) => a.finishTime! - b.finishTime!).forEach((e, k) => { e.pos = k + 1; });
    this.running = false;
  }

  get standings() { return [...this.entrants].sort((a, b) => a.pos - b.pos); }

  get allFinished() { return this.entrants.every(e => e.finished); }

  dispose() {
    for (const e of this.entrants) if (e.driver) e.car.dispose();
  }
}
