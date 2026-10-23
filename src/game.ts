// The game: builds the world, runs physics at a fixed 120 Hz with interpolated rendering,
// and handles the start lights, lap timing, thrusters and air pickups, resets, the player's
// options and party races.
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
import { Renderer, type GraphicsSettings } from './render/renderer';
import type { Quality } from './render/graphics';
import { Environment, type TimeOfDay } from './render/environment';
import { TrackScene } from './render/trackScene';
import { CarModel } from './render/carModel';
import { CameraRig } from './render/cameras';
import { SkidMarks } from './render/skids';
import { Vapour, JetFx } from './render/vapour';
import { CanisterScene } from './render/canisterScene';
import { RemoteCars } from './render/remoteCars';
import { PAINTS } from './render/carModel';
import { input, type DriveInput } from './core/input';
import { audio } from './core/audio';
import { Hud, formatTime } from './ui/hud';
import { PartyUi, type PartyGame } from './ui/partyUi';
import type { PartyClient } from './net/party';

const TIMES: TimeOfDay[] = ['noon', 'sunset', 'night', 'morning'];
const HELP_LABEL: Record<DrivingHelp, string> = { easy: 'Easy', medium: 'Medium', off: 'Off' };
const GRID_S = -32;
const JET_MESSAGES: Partial<Record<JetEvent, [string, number]>> = {
  launch: ['Perfect launch!', 1.4], flip: ['Flip!', 1.2], roll: ['Barrel roll!', 1.2], spin: ['360!', 1.2],
  'clean-landing': ['Clean landing', 1], empty: ['Air tank empty', 1.6],
}; // the car starts 32 m before the line, so lap 1 is a flying lap
/** party grid: two by two, staggered, behind the solo start spot */
const GRID_GAP = 4.5, GRID_SIDE = 2.4;
/** car states sent to the party per second */
const NET_RATE = 20;

function store(): Storage | null { try { return localStorage; } catch { return null; } }

type Phase = 'title' | 'lights' | 'driving';

export interface GameOptions { quality?: Quality; safe?: boolean; tod?: TimeOfDay; autodrive?: boolean }

export class Game implements PartyGame {
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
  // party races
  readonly partyUi: PartyUi;
  party: PartyClient | null = null;
  private remote: RemoteCars;
  /** the current party race: lights and start come from the server, time is wall-clock */
  race: { laps: number; slot: number; startedAt: number | null; finished: boolean } | null = null;
  private netT = 0;
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
    this.jetFx = new JetFx(this.model.root, this.vapour);
    this.scene.add(this.trackScene.group, this.canisterScene.group, this.model.root, this.skids.mesh, this.vapour.points);

    const g = this.track.pointAt(GRID_S, 0);
    this.car = new Car(this.world, g.x, g.y, g.z, this.track.headingAt(GRID_S));
    this.setHelp(this.help);
    this.hint = this.track.nearest(g.x, g.z).i;
    this.prevS = this.track.nearest(g.x, g.z).s;
    const best = Number(store()?.getItem('rd-best') ?? 0);
    if (best > 0) this.bestLap = best;
    if (opts.autodrive) { this.pilot = new Autopilot(this.track); }

    this.hud = new Hud(this.track);
    this.hud.markAir(this.canisters.list);
    this.hud.setLights(-1);
    // let the car settle on its springs before the first frame
    for (let k = 0; k < 120; k++) { this.car.step({ steer: 0, throttle: 0, brake: 0, handbrake: true }); this.world.step(); }
    this.snapshot(this.curr); this.snapshot(this.prev);
    this.remote = new RemoteCars(this.car.wheels.reduce((a, w) => a + w.suspension, 0) / 4);
    this.remote.setNight(this.env.preset.night);
    this.scene.add(this.remote.group);
    this.hud.ready();
    this.partyUi = new PartyUi(this, this.hud.title, this.hud.paused);
    input.onAny = () => this.start();
  }

  private buildEnvironment() {
    this.env?.dispose();
    const tod = TIMES[this.todIndex];
    this.env = new Environment(this.scene, this.renderer.gl, tod, this.renderer.quality);
    this.renderer.setBloom(this.env.preset.night ? 0.8 : 0.12, this.env.preset.night ? 0.85 : 1.6);
    this.model.setNight(this.env.preset.night);
    this.remote?.setNight(this.env.preset.night);
    this.vapour.setNight(this.env.preset.night);
  }

  start() {
    audio.unlock();
    if (this.phase !== 'title' || this.partyUi.active || this.partyUi.open) return;
    this.phase = 'lights';
    this.lightsT = 0;
    this.lightsHold = 0.4 + Math.random() * 0.8;
    this.hud.title.classList.add('hidden');
    this.rig.reset();
    this.hud.setLights(0);
  }

  private setHelp(h: DrivingHelp) {
    this.help = h;
    this.car.stability = HELP_STABILITY[h];
    this.car.tractionControl = h !== 'off';
    this.car.abs = h !== 'off';
  }

  private snapshot(into: { p: THREE.Vector3; q: THREE.Quaternion }) {
    const t = this.car.body.translation(), r = this.car.body.rotation();
    into.p.set(t.x, t.y, t.z); into.q.set(r.x, r.y, r.z, r.w);
  }

  /** put the car at a standing start: the solo spot, or a party grid slot */
  private toGrid(slot = -1) {
    const s = slot < 0 ? GRID_S : GRID_S - slot * GRID_GAP;
    const g = this.track.pointAt(s, slot < 0 ? 0 : (slot % 2 ? -GRID_SIDE : GRID_SIDE));
    this.car.place(g.x, g.y, g.z, this.track.headingAt(s));
    this.jets.reset();
    this.skids.clear();
    this.rig.reset();
    const near = this.track.nearest(g.x, g.z);
    this.hint = near.i; this.prevS = near.s;
    this.lap = 0; this.lapStart = null; this.lastLap = null; this.passedHalf = false;
    this.hud.showDelta(null);
    this.snapshot(this.curr); this.snapshot(this.prev);
  }

  get paintIndex() { return Math.max(0, PAINTS.findIndex(p => p.name === this.model.paintName)); }

  setPaint(n: number) { for (let k = 0; k < PAINTS.length && this.paintIndex !== n; k++) this.model.nextPaint(); }

  message(text: string, seconds?: number) { this.hud.message(text, seconds); }

  closeMenu() { if (this.race) this.hud.paused.classList.add('hidden'); else if (this.paused) { this.paused = false; this.hud.paused.classList.add('hidden'); } }

  /** leave solo driving (or the pause screen) for the title, ready for a party */
  toTitle() {
    this.paused = false;
    this.hud.paused.classList.add('hidden');
    if (this.phase === 'title') return;
    this.phase = 'title';
    this.pilot = null;
    this.hud.setLights(-1); this.trackScene.setStartLights(0);
    this.toGrid();
  }

  joinedParty(pc: PartyClient) {
    this.party = pc;
    document.body.classList.add('in-party');
    this.hud.title.classList.add('hidden');
  }

  leftParty() {
    this.party = null;
    this.race = null;
    this.remote.clear();
    this.hud.setStandings(null);
    document.body.classList.remove('in-party');
    this.toTitle();
    this.hud.title.classList.remove('hidden');
  }

  beginPartyRace(slot: number, laps: number) {
    audio.unlock();
    this.paused = false; this.hud.paused.classList.add('hidden');
    this.pilot = null;
    this.race = { laps, slot, startedAt: null, finished: false };
    this.toGrid(slot);
    this.phase = 'lights';
    this.hud.title.classList.add('hidden');
    this.hud.setLights(0); this.trackScene.setStartLights(0);
    this.hud.message(`${laps} lap${laps > 1 ? 's' : ''}`, 1.6);
  }

  partyLights(n: number) { this.hud.setLights(n); this.trackScene.setStartLights(n); }

  partyGo() {
    if (!this.race || this.phase !== 'lights') return;
    this.phase = 'driving';
    this.race.startedAt = performance.now();
    this.jets.armLaunch();
    this.partyLights(0);
    this.hud.message('GO!', 1.2);
    setTimeout(() => this.hud.setLights(-1), 900);
  }

  endPartyRace() {
    this.race = null;
    this.party?.snapshots.clear();
    this.remote.clear();
    this.hud.setStandings(null);
    this.phase = 'title';
    this.pilot = null;
    this.paused = false; this.hud.paused.classList.add('hidden');
    this.hud.setLights(-1); this.trackScene.setStartLights(0);
    this.toGrid();
  }

  /** race progress in metres, for standings: negative on the grid, then laps × length */
  private raceDist(s: number) { return this.lap > 0 ? (this.lap - 1) * this.track.total + s : s - this.track.total; }

  private finishRace() {
    const r = this.race!;
    r.finished = true;
    const time = (performance.now() - (r.startedAt ?? performance.now())) / 1000;
    this.party?.sendFinish(time, this.bestLap);
    this.hud.message(`Finished · ${formatTime(time)}`, 3);
    // a cool-down lap on the autopilot while the others finish
    this.pilot = new Autopilot(this.track);
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
    if (input.consume('pause') && this.phase !== 'title') {
      // a party race keeps running: Esc only opens the menu (with Leave party)
      if (this.race) this.hud.paused.classList.toggle('hidden');
      else { this.paused = !this.paused; this.hud.paused.classList.toggle('hidden', !this.paused); }
    }
    if (input.consume('help')) this.hud.help.classList.toggle('hidden');
    if (input.consume('camera')) { this.rig.next(); this.hud.message(`Camera: ${this.rig.mode}`, 1.2); }
    if (input.consume('paint')) { this.model.nextPaint(); this.hud.message(this.model.paintName, 1.4); this.party?.setProfile({ paint: this.paintIndex }); }
    if (input.consume('time')) { this.todIndex = (this.todIndex + 1) % TIMES.length; this.buildEnvironment(); this.hud.message(`Time of day: ${TIMES[this.todIndex]}`, 1.4); }
    if (input.consume('mute')) this.hud.message(audio.toggleMute() ? 'Sound off' : 'Sound on', 1.2);
    if (input.consume('reset') && this.phase === 'driving' && !this.paused) { this.resetCar(); this.hud.message('Reset', 1); }
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
    if (this.pilot && this.phase === 'driving') inp = { ...this.pilot.drive(this.car, near.i, near.s, dt), lookBack: false, boost: false, hop: false, pitch: 0 };
    if (this.phase !== 'driving') inp = { steer: 0, throttle: 0, brake: 0, handbrake: true, lookBack: false, boost: false, hop: false, pitch: 0 };
    const assisted = applyDrivingHelp(this.help, inp, this.car);
    this.car.step(assisted);
    // in the air the raw sticks drive the attitude jets (the driving help only shapes steering)
    this.jets.step(this.car, inp, { boost: inp.boost, hop: inp.hop, airRoll: inp.handbrake, pitch: inp.pitch }, dt, this.help !== 'off');
    this.frameEvents.push(...this.jets.events);
    if (this.jets.hopped) this.frameHop = true;
    this.world.step();
    this.simTime += dt;

    this.canisters.step(dt);
    const p = this.car.body.translation();
    const got = this.canisters.collect(p.x, p.y, p.z);
    if (got) { this.jets.refill(got * CANISTER_AIR); this.frameAir += got * CANISTER_AIR; }

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
      if (this.lapStart === null || this.passedHalf) {
        this.lap++; this.lapStart = this.simTime; this.passedHalf = false;
        if (this.race && !this.race.finished && this.lap > this.race.laps) this.finishRace();
      }
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
    // a frame timestamp can predate a long task (such as building the world): never step backwards
    const dt = Math.max(0, Math.min(0.1, (now - this.last) / 1000));
    this.last = now;
    this.handleActions();
    this.inp = input.poll(dt);
    if (this.inp.hop) this.hopQueued = true;

    if (this.phase === 'lights' && !this.paused && !this.race) {
      this.lightsT += dt;
      const lit = Math.min(5, Math.floor(this.lightsT / 0.8));
      if (this.lightsT < 4.0 + this.lightsHold) { this.hud.setLights(lit); this.trackScene.setStartLights(lit); }
      else { this.phase = 'driving'; this.jets.armLaunch(); this.hud.setLights(0); this.trackScene.setStartLights(0); this.hud.message('GO!', 1.2); setTimeout(() => this.hud.setLights(-1), 900); }
    }

    if (!this.paused) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= PHYSICS_DT && steps < 12) {
        this.snapshot(this.prev);
        this.physicsStep();
        this.snapshot(this.curr);
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
    const others = this.party && this.race ? this.netFrame(dt) : [];

    const slip = Math.max(...this.car.wheels.map(w => w.slip));
    audio.update(this.car.speed, Math.max(-1, Math.min(1, this.car.powerKw / 300)), slip, this.kerb, this.paused || this.phase === 'title');
    audio.jets(this.jets.boosting ? 1 : 0, this.jets.attitude, this.jets.tank, this.paused || this.phase === 'title');
    this.hud.setAir(this.jets.tank, this.jets.boosting, this.jets.hopCooldown <= 0 && this.jets.tank >= 0.1, dt);
    this.hud.update(dt, {
      speed: this.car.speed, powerKw: this.car.powerKw, lap: this.lap,
      current: this.lapStart !== null ? this.simTime - this.lapStart : null, last: this.lastLap, best: this.bestLap,
      x: focus.x, z: focus.z, heading: e.y, help: HELP_LABEL[this.help], paint: this.model.paintName,
      lapText: this.race ? (this.race.finished ? 'FINISHED' : this.lap > 0 ? `LAP ${this.lap}/${this.race.laps}` : 'GRID') : undefined,
      others,
    });
    this.renderer.render(this.scene, this.rig.cam);
  }

  /** party race: send our car at NET_RATE, draw the others, update the standings */
  private netFrame(dt: number) {
    const pc = this.party!;
    const t = this.car.body.translation(), q = this.car.body.rotation();
    // after the flag the cool-down lap keeps counting, so finishers stay ahead in finishing order
    const dist = this.raceDist(this.prevS);
    this.netT += dt;
    if (this.netT >= 1 / NET_RATE) {
      this.netT = 0;
      const braking = this.inp.brake > 0.1 && this.car.speed > 0.5 ? 1 : 0;
      const r3 = (v: number) => Math.round(v * 1000) / 1000;
      pc.sendState([r3(t.x), r3(t.y), r3(t.z), r3(q.x), r3(q.y), r3(q.z), r3(q.w), Math.round(dist), r3(this.car.speed), r3(this.car.wheels[0].steer),
        braking | (this.jets.boosting ? 2 : 0), this.paintIndex]);
    }
    const players = pc.lobby?.players ?? [];
    const others = this.remote.update(pc.snapshots, players, this.rig.cam, dt);
    const rows = [{ id: pc.id, dist }, ...others.map(o => ({ id: o.id, dist: o.dist }))]
      .filter(x => x.id === pc.id || players.some(p => p.id === x.id))
      .sort((a, b) => b.dist - a.dist)
      .map(x => ({ name: players.find(p => p.id === x.id)?.name ?? 'You', me: x.id === pc.id }));
    this.hud.setStandings(rows);
    return others.map(o => ({ x: o.x, z: o.z, heading: o.heading }));
  }

  run() {
    const loop = (t: number) => { this.frame(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
}
