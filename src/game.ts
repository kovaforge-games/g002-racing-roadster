// The game: builds the world, runs physics at a fixed 120 Hz with interpolated rendering,
// and handles the start lights, the race against the AI rivals (or free practice), lap timing,
// thrusters and air pickups, resets and the player's options.
import * as THREE from 'three';
import { Track } from './sim/track';
import { Terrain } from './sim/terrain';
import { buildWorld, PHYSICS_DT } from './sim/world';
import { Car } from './sim/car';
import { applyDrivingHelp, HELP_STABILITY, type DrivingHelp } from './sim/assist';
import { updateSurface } from './sim/surface';
import { Autopilot } from './sim/autopilot';
import { Jets, type JetEvent } from './sim/jets';
import { Canisters, CANISTER_AIR } from './sim/canisters';
import { Race, RACE_LAPS, type Entrant } from './sim/race';
import { Renderer, type GraphicsSettings } from './render/renderer';
import type { Quality } from './render/graphics';
import { Environment, type TimeOfDay } from './render/environment';
import { TrackScene } from './render/trackScene';
import { CarModel, PAINTS } from './render/carModel';
import { CameraRig } from './render/cameras';
import { SkidMarks } from './render/skids';
import { Vapour, JetFx } from './render/vapour';
import { CanisterScene } from './render/canisterScene';
import { cloneModel } from './render/cloneModel';
import { NameTag } from './render/nameTag';
import { input, type DriveInput } from './core/input';
import { audio } from './core/audio';
import { Hud, formatTime } from './ui/hud';

const TIMES: TimeOfDay[] = ['noon', 'sunset', 'night', 'morning'];
const HELP_LABEL: Record<DrivingHelp, string> = { easy: 'Easy', medium: 'Medium', off: 'Off' };
const GRID_S = -32; // in free practice the car starts 32 m before the line, so lap 1 is a flying lap
const JET_MESSAGES: Partial<Record<JetEvent, [string, number]>> = {
  launch: ['Perfect launch!', 1.4], flip: ['Flip!', 1.2], roll: ['Barrel roll!', 1.2], spin: ['360!', 1.2],
  'clean-landing': ['Clean landing', 1], empty: ['Air tank empty', 1.6],
};
/** average speed round a lap, for turning distance gaps into rough time gaps */
const GAP_SPEED = 41;

function store(): Storage | null { try { return localStorage; } catch { return null; } }

type Phase = 'title' | 'lights' | 'driving' | 'finished';
type Snap = { p: THREE.Vector3; q: THREE.Quaternion };
const snap = (): Snap => ({ p: new THREE.Vector3(), q: new THREE.Quaternion() });
const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;

/** a rival's car on screen: model, thruster effects, skid marks and interpolation snapshots */
interface RivalView { e: Entrant; model: CarModel; fx: JetFx; skids: SkidMarks; tag: NameTag; prev: Snap; curr: Snap; hop: boolean }

export interface GameOptions { quality?: Quality; safe?: boolean; tod?: TimeOfDay; autodrive?: boolean }

export class Game {
  readonly track = new Track();
  readonly terrain: Terrain;
  readonly world;
  readonly car: Car;
  readonly scene = new THREE.Scene();
  readonly renderer: Renderer;
  private env!: Environment;
  private trackScene: TrackScene;
  readonly model = new CarModel();
  readonly rig = new CameraRig();
  private skids = new SkidMarks();
  readonly hud: Hud;
  private pilot: Autopilot | null = null;
  readonly jets = new Jets();
  readonly canisters: Canisters;
  private canisterScene: CanisterScene;
  private vapour = new Vapour();
  private jetFx: JetFx;
  /** a hop was pressed this frame and not yet given to the physics */
  private hopQueued = false;
  /** jet events and pickups since the last frame */
  private frameEvents: JetEvent[] = [];
  private frameHop = false;
  private frameAir = 0;
  /** null in free practice */
  race: Race | null;
  private rivals: RivalView[] = [];
  private autodrive: boolean;
  private finishT = 0;
  private resultsShown = false;
  private raceHudT = 0;
  private lastPos = 0;
  private lastRaceLap = 0;
  private washedPrev = false;

  phase: Phase = 'title';
  paused = false;
  help: DrivingHelp = 'easy';
  private todIndex = 0;
  private acc = 0;
  private last = performance.now();
  private hint = 0;
  private lightsT = 0; private lightsHold = 0;
  private flipT = 0;
  private kerb = 0;
  private inp: DriveInput = { steer: 0, throttle: 0, brake: 0, handbrake: false, lookBack: false, boost: false, hop: false, pitch: 0 };
  private prev = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  private curr = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  private titleAngle = 0;
  private airHeading: number | null = null;
  /** test hook: a fixed camera instead of the driving rig */
  debugCam: { pos: [number, number, number]; target: [number, number, number] } | null = null;

  // lap timing (in simulated seconds)
  private simTime = 0;
  lap = 0;
  private lapStart: number | null = null;
  lastLap: number | null = null;
  bestLap: number | null = null;
  private passedHalf = false;
  private prevS = 0;

  constructor(container: HTMLElement, opts: GameOptions = {}) {
    this.terrain = new Terrain(this.track);
    this.world = buildWorld(this.track, this.terrain);
    this.renderer = new Renderer(container);
    const graphics: GraphicsSettings = opts.safe
      ? { graphicsMode: 'custom', quality: 'low', resolutionScale: 1, shadows: false, postfx: false }
      : opts.quality
        ? { graphicsMode: 'custom', quality: opts.quality, resolutionScale: 1, shadows: opts.quality !== 'low', postfx: opts.quality !== 'low' }
        : { graphicsMode: 'auto', quality: 'high', resolutionScale: 1, shadows: true, postfx: true };
    this.renderer.configure(graphics);
    const quality = this.renderer.quality;

    if (opts.tod) this.todIndex = Math.max(0, TIMES.indexOf(opts.tod));
    this.buildEnvironment();
    this.trackScene = new TrackScene(this.track, this.terrain, quality);
    this.canisters = new Canisters(this.track);
    this.canisterScene = new CanisterScene(this.canisters);
    this.scene.add(this.trackScene.group, this.canisterScene.group, this.model.root, this.skids.mesh, this.vapour.points);

    const g = this.track.pointAt(GRID_S, 0);
    this.car = new Car(this.world, g.x, g.y, g.z, this.track.headingAt(GRID_S));
    this.setHelp(this.help);
    // the race puts everyone on the grid; the rivals sit there behind the title screen
    this.race = new Race(this.track, this.world, this.canisters, this.car, this.jets);
    for (const e of this.race.rivals) {
      // copies of the player's model: building one from scratch takes seconds
      const model = cloneModel(this.model);
      for (let k = 0; k < e.paint; k++) model.nextPaint();
      model.setNight(this.env.preset.night);
      const tag = new NameTag(e.name, css(PAINTS[e.paint].color));
      const view: RivalView = { e, model, fx: new JetFx(model.root, this.vapour), skids: new SkidMarks(), tag, prev: snap(), curr: snap(), hop: false };
      this.scene.add(model.root, view.skids.mesh, tag.sprite);
      this.rivals.push(view);
    }
    this.jetFx = new JetFx(this.model.root, this.vapour);
    this.resetLaps();
    const best = Number(store()?.getItem('rd-best') ?? 0);
    if (best > 0) this.bestLap = best;
    this.autodrive = !!opts.autodrive;
    if (opts.autodrive) { this.pilot = new Autopilot(this.track); }

    this.hud = new Hud(this.track);
    this.hud.markAir(this.canisters.list);
    this.hud.setLights(-1);
    this.settle();
    this.hud.ready();
    input.onAny = code => this.start(code);
  }

  private buildEnvironment() {
    this.env?.dispose();
    const tod = TIMES[this.todIndex];
    this.env = new Environment(this.scene, this.renderer.gl, tod, this.renderer.quality);
    this.renderer.setBloom(this.env.preset.night ? 0.8 : 0.12, this.env.preset.night ? 0.85 : 1.6);
    this.model.setNight(this.env.preset.night);
    this.vapour.setNight(this.env.preset.night);
    for (const r of this.rivals ?? []) r.model.setNight(this.env.preset.night);
  }

  /** from the title screen: any key races, F goes to free practice */
  start(code?: string) {
    audio.unlock();
    if (this.phase !== 'title') return;
    if (code === 'KeyF') this.practice();
    this.hud.title.classList.add('hidden');
    this.beginLights();
  }

  private beginLights() {
    this.phase = 'lights';
    this.lightsT = 0;
    this.lightsHold = 0.4 + Math.random() * 0.8;
    this.rig.reset();
    this.hud.setLights(0);
  }

  /** let every car settle on its springs, then take fresh interpolation snapshots */
  private settle() {
    const hold = { steer: 0, throttle: 0, brake: 0, handbrake: true };
    for (let k = 0; k < 120; k++) { this.car.step(hold); this.race?.stepRivals(); this.world.step(); }
    this.race?.afterStep();
    this.snapshot(this.curr); this.snapshot(this.prev);
    for (const r of this.rivals) { this.snapRival(r, r.curr); this.snapRival(r, r.prev); }
  }

  /** lap timing back to the start, from wherever the car is now */
  private resetLaps() {
    const t = this.car.body.translation();
    const near = this.track.nearest(t.x, t.z);
    this.hint = near.i; this.prevS = near.s;
    this.lap = 0; this.lapStart = null; this.lastLap = null; this.passedHalf = false;
    this.hud?.showDelta(null);
  }

  /** drop the rivals and drive alone, from the old flying-lap start */
  private practice() {
    if (this.race) {
      this.race.dispose();
      for (const r of this.rivals) { this.scene.remove(r.model.root, r.skids.mesh, r.tag.sprite); }
      this.rivals = [];
      this.race = null;
    }
    const g = this.track.pointAt(GRID_S, 0);
    this.car.place(g.x, g.y, g.z, this.track.headingAt(GRID_S));
    this.restartCommon();
  }

  /** everyone back on the grid for another race */
  private restartRace() {
    this.race?.grid();
    this.restartCommon();
  }

  private restartCommon() {
    this.jets.reset(); this.jets.tank = 1;
    this.canisters.reset();
    this.skids.clear(); this.vapour.clear();
    for (const r of this.rivals) r.skids.clear();
    this.pilot = this.autodrive ? new Autopilot(this.track) : null;
    this.finishT = 0; this.resultsShown = false; this.lastPos = 0; this.lastRaceLap = 0;
    this.hud.results.classList.add('hidden');
    this.settle();
    this.resetLaps();
    this.hud.setRace(null);
    this.beginLights();
  }

  private setHelp(h: DrivingHelp) {
    this.help = h;
    this.car.stability = HELP_STABILITY[h];
    this.car.tractionControl = h !== 'off';
    this.car.abs = h !== 'off';
  }

  private snapshot(into: Snap) {
    const t = this.car.body.translation(), r = this.car.body.rotation();
    into.p.set(t.x, t.y, t.z); into.q.set(r.x, r.y, r.z, r.w);
  }

  private snapRival(v: RivalView, into: Snap) {
    const t = v.e.car.body.translation(), r = v.e.car.body.rotation();
    into.p.set(t.x, t.y, t.z); into.q.set(r.x, r.y, r.z, r.w);
  }

  resetCar() {
    const near = this.track.nearest(this.curr.p.x, this.curr.p.z, this.hint);
    const s = near.s - 5;
    const p = this.track.pointAt(s, Math.max(-3, Math.min(3, near.lateral)));
    this.car.place(p.x, p.y, p.z, this.track.headingAt(s));
    this.jets.reset();
    this.skids.clear();
    this.rig.reset();
    this.snapshot(this.curr); this.snapshot(this.prev);
  }

  private handleActions() {
    if (input.consume('pause') && this.phase !== 'title') { this.paused = !this.paused; this.hud.paused.classList.toggle('hidden', !this.paused); }
    if (input.consume('help')) this.hud.help.classList.toggle('hidden');
    if (input.consume('camera')) { this.rig.next(); this.hud.message(`Camera: ${this.rig.mode}`, 1.2); }
    if (input.consume('paint')) { this.model.nextPaint(); this.hud.message(this.model.paintName, 1.4); }
    if (input.consume('time')) { this.todIndex = (this.todIndex + 1) % TIMES.length; this.buildEnvironment(); this.hud.message(`Time of day: ${TIMES[this.todIndex]}`, 1.4); }
    if (input.consume('mute')) this.hud.message(audio.toggleMute() ? 'Sound off' : 'Sound on', 1.2);
    if (input.consume('reset') && this.phase === 'driving' && !this.paused) { this.resetCar(); this.hud.message('Reset', 1); }
    if (input.consume('practice') && this.phase === 'finished' && this.resultsShown) this.practice();
    for (const [a, h] of [['assist1', 'easy'], ['assist2', 'medium'], ['assist3', 'off']] as const) {
      if (input.consume(a)) { this.setHelp(h); this.hud.message(`Driving help: ${HELP_LABEL[h]}`, 1.4); }
    }
  }

  private physicsStep() {
    const dt = PHYSICS_DT;
    const pos = this.car.body.translation();
    const near = this.track.nearest(pos.x, pos.z, this.hint, 20);
    this.hint = near.i;
    this.kerb = updateSurface(this.car, this.track, this.hint);
    let inp: DriveInput = { ...this.inp, hop: this.hopQueued };
    this.hopQueued = false;
    const moving = this.phase === 'driving' || this.phase === 'finished';
    if (this.pilot && moving) inp = { ...this.pilot.drive(this.car, near.i, near.s, dt), lookBack: false, boost: false, hop: false, pitch: 0 };
    if (!moving) inp = { steer: 0, throttle: 0, brake: 0, handbrake: true, lookBack: false, boost: false, hop: false, pitch: 0 };
    const assisted = applyDrivingHelp(this.help, inp, this.car);
    this.car.step(assisted);
    // in the air the raw sticks drive the attitude jets (the driving help only shapes steering)
    this.jets.step(this.car, inp, { boost: inp.boost, hop: inp.hop, airRoll: inp.handbrake, pitch: inp.pitch }, dt, this.help !== 'off');
    this.frameEvents.push(...this.jets.events);
    if (this.jets.hopped) this.frameHop = true;
    this.race?.stepRivals(dt);
    this.world.step();
    this.simTime += dt;

    this.canisters.step(dt);
    const p = this.car.body.translation();
    const got = this.canisters.collect(p.x, p.y, p.z);
    if (got) { this.jets.refill(got * CANISTER_AIR); this.frameAir += got * CANISTER_AIR; }
    if (this.race) {
      this.race.afterStep(dt);
      for (const r of this.rivals) if (r.e.jets.hopped) r.hop = true;
      const me = this.race.player;
      if (this.phase === 'driving' && me.lap !== this.lastRaceLap) {
        this.lastRaceLap = me.lap;
        if (me.lap === RACE_LAPS && RACE_LAPS > 1) this.hud.message('Final lap!', 2);
      }
      if (this.phase === 'driving' && me.finished) {
        // cross the line: the autopilot takes a cool-down lap while the results come in
        this.phase = 'finished';
        this.finishT = 0;
        this.pilot = new Autopilot(this.track);
        this.pilot.aggression = 0.8;
        this.hud.message(me.pos === 1 ? 'You win!' : `Finished P${me.pos}`, 3);
      }
    }

    // lap timing: crossing s = 0 forwards; a lap counts only if it went past halfway
    const s = near.s;
    if (Math.abs(s - this.track.total / 2) < 200) this.passedHalf = true;
    if (this.prevS > this.track.total - 80 && s < 80 && this.phase === 'driving') {
      if (this.lapStart !== null && this.passedHalf) {
        const t = this.simTime - this.lapStart;
        const delta = this.bestLap !== null ? t - this.bestLap : null;
        this.lastLap = t;
        if (this.bestLap === null || t < this.bestLap) { this.bestLap = t; store()?.setItem('rd-best', String(t)); this.hud.message('Best lap!', 2.5); }
        this.hud.showDelta(delta);
      }
      if (this.lapStart === null || this.passedHalf) { this.lap++; this.lapStart = this.simTime; this.passedHalf = false; }
    } else if (this.prevS < 80 && s > this.track.total - 80 && this.lapStart !== null) {
      // reversed back over the line: this lap no longer counts
      this.passedHalf = false;
    }
    this.prevS = s;

    // flipped or far off the map: put the car back
    if (this.car.axes().up.y < 0.25 && Math.abs(this.car.speed) < 4) this.flipT += dt; else this.flipT = 0;
    if (this.flipT > 1.5 || pos.y < -50 || near.dist > this.track.wallOffset + 40) { this.flipT = 0; this.resetCar(); }
  }

  frame(now = performance.now()) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.handleActions();
    this.inp = input.poll(dt);
    if (this.inp.hop) this.hopQueued = true;

    if (this.phase === 'lights' && !this.paused) {
      this.lightsT += dt;
      const lit = Math.min(5, Math.floor(this.lightsT / 0.8));
      if (this.lightsT < 4.0 + this.lightsHold) { this.hud.setLights(lit); this.trackScene.setStartLights(lit); }
      else { this.phase = 'driving'; if (this.race) this.race.go(); else this.jets.armLaunch(); this.hud.setLights(0); this.trackScene.setStartLights(0); this.hud.message('GO!', 1.2); setTimeout(() => this.hud.setLights(-1), 900); }
    }

    if (!this.paused) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= PHYSICS_DT && steps < 12) {
        this.snapshot(this.prev);
        for (const r of this.rivals) this.snapRival(r, r.prev);
        this.physicsStep();
        this.snapshot(this.curr);
        for (const r of this.rivals) this.snapRival(r, r.curr);
        this.acc -= PHYSICS_DT; steps++;
      }
      if (steps === 12) this.acc = 0;
    }
    const alpha = this.paused ? 1 : this.acc / PHYSICS_DT;
    const root = this.model.root;
    root.position.lerpVectors(this.prev.p, this.curr.p, alpha);
    root.quaternion.slerpQuaternions(this.prev.q, this.curr.q, alpha);
    const braking = this.phase === 'driving' && this.inp.brake > 0.1 && this.car.speed > 0.5;
    this.model.update(this.car, braking, dt);
    this.skids.update(this.car);
    const lv = this.car.body.linvel();
    this.jetFx.update(this.jets, this.frameHop, root, lv, dt);
    this.vapour.update(dt, this.rig.cam, this.renderer.gl.domElement.height);
    this.canisterScene.update(dt);
    if (this.frameHop) audio.hop();
    if (this.frameAir > 0) { audio.pickup(); this.hud.airGained(this.frameAir); }
    for (const ev of this.frameEvents) { const m = JET_MESSAGES[ev]; if (m) this.hud.message(m[0], m[1]); }
    this.frameEvents.length = 0; this.frameHop = false; this.frameAir = 0;
    this.rig.boost = this.jets.boosting ? 1 : 0;
    let nearBoost = 0;
    for (const r of this.rivals) {
      const rr = r.model.root;
      rr.position.lerpVectors(r.prev.p, r.curr.p, alpha);
      rr.quaternion.slerpQuaternions(r.prev.q, r.curr.q, alpha);
      r.model.update(r.e.car, r.e.braking, dt);
      r.skids.update(r.e.car);
      r.fx.update(r.e.jets, r.hop, rr, r.e.car.body.linvel(), dt);
      r.hop = false;
      const camDist = rr.position.distanceTo(this.rig.cam.position);
      r.tag.update(r.e.pos, rr.position.x, rr.position.y, rr.position.z, this.phase === 'title' ? 0 : camDist);
      // rivals' jets are heard when they boost close by
      if (r.e.jets.boosting) nearBoost = Math.max(nearBoost, 1 - camDist / 35);
    }
    const washed = (this.race?.player.washed ?? 0) > 0;
    if (washed && !this.washedPrev) this.hud.message('Jet wash!', 0.8);
    this.washedPrev = washed;
    if (this.race) this.updateRaceHud(dt);

    const impact = this.car.takeImpact();
    if (impact > 2.5) { this.rig.kick(Math.min(1, impact / 10)); audio.impact(impact); }

    const e = new THREE.Euler().setFromQuaternion(root.quaternion, 'YXZ');
    // in the air (flips, rolls) the chase camera follows the direction of travel, not the nose
    if (this.car.airborne && Math.hypot(lv.x, lv.z) > 4) this.airHeading = Math.atan2(lv.x, lv.z);
    else if (!this.car.airborne) this.airHeading = null;
    const focus = { x: root.position.x, y: root.position.y, z: root.position.z, heading: this.airHeading ?? e.y, pitch: e.x, roll: e.z, speed: this.car.speed };
    if (this.phase === 'title') {
      // slow orbit around the car on the grid
      this.titleAngle += dt * 0.18;
      const r = 7.5, a = e.y + 2.4 + this.titleAngle;
      this.rig.cam.position.set(focus.x + Math.sin(a) * r, focus.y + 1.3, focus.z + Math.cos(a) * r);
      this.rig.cam.lookAt(focus.x, focus.y + 0.2, focus.z);
    } else this.rig.update(focus, dt, this.inp.lookBack);
    if (this.debugCam) { this.rig.cam.position.set(...this.debugCam.pos); this.rig.cam.lookAt(...this.debugCam.target); }
    this.env.follow(focus.x, focus.y, focus.z);

    const slip = Math.max(...this.car.wheels.map(w => w.slip));
    audio.update(this.car.speed, Math.max(-1, Math.min(1, this.car.powerKw / 300)), slip, this.kerb, this.paused || this.phase === 'title');
    audio.jets(Math.max(this.jets.boosting ? 1 : 0, nearBoost * 0.45), this.jets.attitude, this.jets.tank, this.paused || this.phase === 'title');
    this.hud.setAir(this.jets.tank, this.jets.boosting, this.jets.hopCooldown <= 0 && this.jets.tank >= 0.1, dt);
    this.hud.update(dt, {
      speed: this.car.speed, powerKw: this.car.powerKw, lap: this.lap,
      current: this.lapStart !== null ? this.simTime - this.lapStart : null, last: this.lastLap, best: this.bestLap,
      x: focus.x, z: focus.z, heading: e.y, help: HELP_LABEL[this.help], paint: this.model.paintName,
      others: this.rivals.map(r => ({ x: r.model.root.position.x, z: r.model.root.position.z, color: css(PAINTS[r.e.paint].color) })),
    });
    this.renderer.render(this.scene, this.rig.cam);
  }

  private updateRaceHud(dt: number) {
    const race = this.race!, me = race.player;
    if (this.phase === 'finished') {
      this.finishT += dt;
      if (this.finishT > 2 && (!this.resultsShown || Math.floor(this.finishT) !== Math.floor(this.finishT - dt))) this.showResults();
      if (this.resultsShown && this.inp.hop) { this.restartRace(); return; }
    }
    // a quick call-out when the player gains places
    if (this.phase === 'driving' && this.lastPos && me.pos < this.lastPos && race.time > 3) this.hud.message(`P${me.pos}`, 1.1);
    if (this.phase !== 'title') this.lastPos = me.pos;
    if ((this.raceHudT -= dt) > 0) return;
    this.raceHudT = 0.2;
    const order = race.standings, lead = order[0];
    this.hud.setRace({
      pos: me.pos, total: order.length, lap: me.lap, laps: RACE_LAPS,
      field: order.map(e => {
        const behind = lead.dist - e.dist;
        const gap = e === lead ? (e.finished ? 'FIN' : '') : e.finished && lead.finished ? `+${(e.finishTime! - lead.finishTime!).toFixed(1)}`
          : behind > this.track.total ? `+${Math.floor(behind / this.track.total)} lap` : `+${(behind / GAP_SPEED).toFixed(1)}`;
        return { pos: e.pos, name: e.name, color: css(e === me ? PAINTS.find(p => p.name === this.model.paintName)!.color : PAINTS[e.paint].color), you: e === me, gap };
      }),
    });
  }

  private showResults() {
    const race = this.race!, order = race.standings, lead = order[0];
    const rows = order.map(e => ({
      pos: e.pos, name: e.name, you: e === race.player, best: formatTime(e.bestLap),
      time: !e.finished ? 'racing…' : e === lead ? formatTime(e.finishTime) : `+${(e.finishTime! - lead.finishTime!).toFixed(3)}`,
    }));
    const me = race.player.pos;
    this.hud.showResults(me === 1 ? 'YOU WIN' : `P${me}`, rows);
    this.resultsShown = true;
  }

  run() {
    const loop = (t: number) => { this.frame(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
}
