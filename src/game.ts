// The game: builds the world, runs physics at a fixed 120 Hz with interpolated rendering,
// and handles the sessions (a race against the AI rivals, time trial or practice) with the
// countdown and the pause menu, party races against friends, lap timing, thrusters and air
// pickups, resets and the player's settings.
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
import { Race, type Entrant } from './sim/race';
import { Renderer, type GraphicsSettings } from './render/renderer';
import type { Quality } from './render/graphics';
import { Environment, type TimeOfDay } from './render/environment';
import { TrackScene } from './render/trackScene';
import { CarModel, PAINTS } from './render/carModel';
import { ReflectionProbe } from './render/reflections';
import { CameraRig } from './render/cameras';
import { SkidMarks } from './render/skids';
import { Vapour, JetFx } from './render/vapour';
import { CanisterScene } from './render/canisterScene';
import { cloneModel } from './render/cloneModel';
import { NameTag } from './render/nameTag';
import { RemoteCars, paintCss } from './render/remoteCars';
import { input, type DriveInput } from './core/input';
import { audio } from './core/audio';
import { Hud, formatTime } from './ui/hud';
import { PartyUi, type PartyGame } from './ui/partyUi';
import { Menu, type MenuGame } from './ui/menu';
import { TouchControls, touchDevice } from './ui/touch';
import { settings, setup, saveSettings, type SessionMode } from './core/settings';
import type { PartyClient } from './net/party';

const TIMES: TimeOfDay[] = ['noon', 'sunset', 'night', 'morning'];
const TRACK_NAME = 'Roadster Circuit';
/** air temperature (°C) at each time of day, for the tyres */
const AMBIENT: Record<TimeOfDay, number> = { morning: 14, noon: 26, sunset: 20, night: 12 };
/** the countdown: one light a second, then lights out */
const COUNTDOWN = 5;
const HELP_LABEL: Record<DrivingHelp, string> = { easy: 'Easy', medium: 'Medium', off: 'Off' };
const GRID_S = -32; // in practice the car starts 32 m before the line, so lap 1 is a flying lap
/** time trial: a standing start on pole */
const TRIAL_S = -10;
const JET_MESSAGES: Partial<Record<JetEvent, [string, number]>> = {
  launch: ['Perfect launch!', 1.4], flip: ['Flip!', 1.2], roll: ['Barrel roll!', 1.2], spin: ['360!', 1.2],
  'clean-landing': ['Clean landing', 1], empty: ['Air tank empty', 1.6],
};
/** average speed round a lap, for turning distance gaps into rough time gaps */
const GAP_SPEED = 41;
/** party grid: staggered pairs like the race grid, 5 m apart */
const partySlot = (k: number) => [-10 - 5 * k, k % 2 ? 2.8 : -2.8] as const;
/** car states sent to the party per second */
const NET_RATE = 20;

function store(): Storage | null { try { return localStorage; } catch { return null; } }

type Phase = 'title' | 'lights' | 'driving' | 'finished';
type Snap = { p: THREE.Vector3; q: THREE.Quaternion };
const snap = (): Snap => ({ p: new THREE.Vector3(), q: new THREE.Quaternion() });
const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;

/** a rival's car on screen: model, thruster effects, skid marks and interpolation snapshots */
interface RivalView { e: Entrant; model: CarModel; fx: JetFx; skids: SkidMarks; tag: NameTag; prev: Snap; curr: Snap; hop: boolean }

export interface GameOptions { quality?: Quality; safe?: boolean; tod?: TimeOfDay; autodrive?: boolean }

export class Game implements PartyGame, MenuGame {
  readonly track = new Track();
  readonly terrain: Terrain;
  readonly world;
  readonly car: Car;
  readonly scene = new THREE.Scene();
  readonly renderer: Renderer;
  private env!: Environment;
  private trackScene: TrackScene;
  readonly model = new CarModel();
  private probe: ReflectionProbe | null = null;
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
  /** null in practice, time trial and party races */
  race: Race | null;
  session: SessionMode = 'race';
  readonly trackName = TRACK_NAME;
  readonly menu: Menu;
  readonly touch = new TouchControls();
  /** time trial: laps to drive, and each lap's time */
  private trialLaps = 3;
  private lapTimes: number[] = [];
  private trialStart = 0;
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
  help: DrivingHelp = settings.help;
  private todIndex = 0;
  private acc = 0;
  private last = performance.now();
  private hint = 0;
  private lightsT = 0;
  private flipT = 0;
  private kerb = 0;
  private inp: DriveInput = { steer: 0, throttle: 0, brake: 0, handbrake: false, lookBack: false, boost: false, hop: false, pitch: 0 };
  private prev = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  private curr = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  private titleAngle = 0;
  private airHeading: number | null = null;
  // party races: no AI rivals, the friends' cars come from the server
  readonly partyUi: PartyUi;
  party: PartyClient | null = null;
  private remote: RemoteCars;
  /** the current party race: lights and start come from the server, time is wall-clock */
  netRace: { laps: number; slot: number; startedAt: number | null; finished: boolean; finishDist: number } | null = null;
  private netT = 0;
  private netPos = new Map<string, number>();
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

    this.todIndex = Math.max(0, TIMES.indexOf(opts.tod ?? setup.tod));
    this.buildEnvironment();
    this.trackScene = new TrackScene(this.track, this.terrain, quality);
    this.canisters = new Canisters(this.track);
    this.canisterScene = new CanisterScene(this.canisters);
    this.scene.add(this.trackScene.group, this.canisterScene.group, this.model.root, this.skids.mesh, this.vapour.points);
    if (quality === 'high' || quality === 'ultra') {
      this.probe = new ReflectionProbe(quality === 'ultra' ? 256 : 128, quality === 'ultra' ? 2 : 4);
      this.model.setReflections(this.probe.texture);
    }
    this.model.onSpoiler = up => { if (this.phase === 'driving') this.hud.message(up ? 'Spoiler up' : 'Spoiler down', 1); };

    const g = this.track.pointAt(GRID_S, 0);
    this.car = new Car(this.world, g.x, g.y, g.z, this.track.headingAt(GRID_S));
    this.setHelp(this.help);
    this.race = null;
    this.jetFx = new JetFx(this.model.root, this.vapour);
    this.buildRace();
    this.resetLaps();
    const best = Number(store()?.getItem('rd-best') ?? 0);
    if (best > 0) this.bestLap = best;
    this.autodrive = !!opts.autodrive;
    if (opts.autodrive) { this.pilot = new Autopilot(this.track); }

    this.hud = new Hud(this.track);
    this.hud.markAir(this.canisters.list);
    this.hud.setLights(-1);
    this.settle();
    this.remote = new RemoteCars(this.model, this.car.wheels.reduce((a, w) => a + w.suspension, 0) / 4);
    this.remote.setNight(this.env.preset.night);
    this.scene.add(this.remote.group);
    this.hud.ready();
    this.partyUi = new PartyUi(this);
    this.menu = new Menu(this, this.hud.title, this.hud.paused, this.partyUi.buttons);
    this.applySettings();
    input.onAny = () => audio.unlock();
  }

  /** the race puts everyone on the grid; the rivals sit there behind the title screen */
  private buildRace() {
    this.race = new Race(this.track, this.world, this.canisters, this.car, this.jets, { opponents: setup.opponents, laps: setup.laps, difficulty: setup.difficulty });
    for (const e of this.race.rivals) {
      // copies of the player's model: building one from scratch takes seconds
      const model = cloneModel(this.model);
      model.onSpoiler = undefined; // only the player's spoiler gets a call-out
      for (let k = 0; k < PAINTS.length && model.paintName !== PAINTS[e.paint].name; k++) model.nextPaint();
      model.setNight(this.env.preset.night);
      const tag = new NameTag(e.name, css(PAINTS[e.paint].color));
      const view: RivalView = { e, model, fx: new JetFx(model.root, this.vapour), skids: new SkidMarks(), tag, prev: snap(), curr: snap(), hop: false };
      this.scene.add(model.root, view.skids.mesh, tag.sprite);
      this.rivals.push(view);
    }
  }

  private dropRace() {
    if (!this.race) return;
    this.race.dispose();
    for (const r of this.rivals) { this.scene.remove(r.model.root, r.skids.mesh, r.tag.sprite); }
    this.rivals = [];
    this.race = null;
  }

  private buildEnvironment() {
    this.env?.dispose();
    const tod = TIMES[this.todIndex];
    this.env = new Environment(this.scene, this.renderer.gl, tod, this.renderer.quality);
    this.renderer.setBloom(this.env.preset.night ? 0.8 : 0.12, this.env.preset.night ? 0.85 : 1.6);
    this.model.setNight(this.env.preset.night);
    this.vapour.setNight(this.env.preset.night);
    for (const r of this.rivals ?? []) r.model.setNight(this.env.preset.night);
    this.remote?.setNight(this.env.preset.night);
  }

  /** from the setup screen: a race, time trial or practice with the current race setup */
  startSession(mode: SessionMode) {
    audio.unlock();
    if (this.partyUi.active) return;
    this.resume();
    this.session = mode;
    const tod = Math.max(0, TIMES.indexOf(setup.tod));
    if (tod !== this.todIndex) { this.todIndex = tod; this.buildEnvironment(); }
    this.hud.title.classList.add('hidden');
    if (mode === 'race') {
      const r = this.race;
      if (!r || r.laps !== setup.laps || r.difficulty !== setup.difficulty || r.rivals.length !== setup.opponents) { this.dropRace(); this.buildRace(); }
      this.restartRace();
    } else if (mode === 'timetrial') {
      this.trialLaps = setup.laps;
      this.soloStart(TRIAL_S);
      this.restartCommon();
    } else {
      this.soloStart(GRID_S);
      this.restartCommon(false);
      this.touch.recentre();
      this.phase = 'driving';
    }
  }

  private beginLights() {
    this.touch.recentre();
    this.phase = 'lights';
    this.lightsT = 0;
    this.rig.reset();
    this.hud.setLights(1); this.trackScene.setStartLights(1);
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

  /** drop the rivals and drive alone, from a point s metres along the lap */
  private soloStart(s: number) {
    this.dropRace();
    const g = this.track.pointAt(s, 0);
    this.car.place(g.x, g.y, g.z, this.track.headingAt(s));
  }

  /** everyone back on the grid for another race */
  private restartRace() {
    this.race?.grid();
    this.restartCommon();
  }

  private restartCommon(lights = true) {
    this.jets.reset(); this.jets.tank = 1;
    this.canisters.reset();
    // fresh tyres for everyone; the air temperature sets how fast they cool
    for (const c of [this.car, ...this.rivals.map(r => r.e.car)]) { c.ambient = AMBIENT[TIMES[this.todIndex]]; c.resetTyres(); }
    this.skids.clear(); this.vapour.clear();
    for (const r of this.rivals) r.skids.clear();
    this.pilot = this.autodrive ? new Autopilot(this.track) : null;
    this.finishT = 0; this.resultsShown = false; this.lastPos = 0; this.lastRaceLap = 0; this.lapTimes = [];
    this.hud.results.classList.add('hidden');
    this.settle();
    this.resetLaps();
    this.hud.setRace(null);
    if (lights) this.beginLights();
  }

  // ---- party races (the screens are in ui/partyUi.ts)

  get paintIndex() { return Math.max(0, PAINTS.findIndex(p => p.name === this.model.paintName)); }

  setPaint(n: number) { for (let k = 0; k < PAINTS.length && this.paintIndex !== n; k++) this.model.nextPaint(); }

  message(text: string, seconds?: number) { this.hud.message(text, seconds); }

  closeMenu() { if (this.netRace) this.hud.paused.classList.add('hidden'); else if (this.paused) { this.paused = false; this.hud.paused.classList.add('hidden'); } }

  /** leave a race, practice or the pause screen for the title, everyone back on the grid */
  toTitle() {
    this.paused = false;
    this.hud.paused.classList.add('hidden');
    if (this.phase === 'title') return;
    this.phase = 'title';
    this.hud.setLights(-1); this.trackScene.setStartLights(0);
    if (!this.race && !this.party) this.buildRace();
    if (this.race) this.race.grid();
    else { const g = this.track.pointAt(GRID_S, 0); this.car.place(g.x, g.y, g.z, this.track.headingAt(GRID_S)); }
    this.restartCommon(false);
    this.rig.reset();
  }

  // ---- the pause menu (the screens are in ui/menu.ts)

  get inParty() { return !!this.party; }

  togglePause() {
    if (this.phase === 'title') return;
    // a party race keeps running: this only opens the menu (with Leave party)
    if (this.netRace) {
      const open = this.hud.paused.classList.toggle('hidden') === false;
      if (open) this.menu.showPause();
      return;
    }
    if (this.paused) { this.resume(); return; }
    this.paused = true;
    this.menu.showPause();
    this.hud.paused.classList.remove('hidden');
  }

  resume() { this.paused = false; this.hud.paused.classList.add('hidden'); }

  /** the same session again from the start */
  restart() {
    if (this.party) { this.resume(); return; }
    this.startSession(this.session);
  }

  /** end the session now and show how it went */
  finishSession() {
    this.resume();
    if (this.netRace || this.phase === 'title') return;
    if (this.race) {
      this.race.finishNow();
      this.phase = 'finished';
      this.pilot = new Autopilot(this.track);
      this.showResults();
      this.finishT = 2;
    } else {
      this.phase = 'finished';
      this.pilot = new Autopilot(this.track);
      this.showTrialResults(true);
    }
  }

  quitToMenu() {
    if (this.party) { this.resume(); return; }
    this.toTitle();
    this.menu.home();
    this.hud.title.classList.remove('hidden');
  }

  leaveParty() { this.partyUi.leave(); }

  /** settings changed in the menu */
  applySettings() {
    this.setHelp(settings.help);
    this.rig.mode = settings.camera;
    if (audio.muted === settings.sound) audio.toggleMute();
    const touch = settings.controls === 'touch' || (settings.controls === 'auto' && touchDevice());
    document.body.classList.toggle('touch-mode', touch);
    input.touch = touch ? this.touch : null;
    this.touch.setSteering(settings.steering);
  }

  /** in a party the AI rivals step aside: the race is against the friends */
  joinedParty(pc: PartyClient) {
    this.party = pc;
    document.body.classList.add('in-party');
    this.hud.title.classList.add('hidden');
    this.resume();
    if (this.race) { this.dropRace(); this.toPartyGrid(0); }
  }

  leftParty() {
    this.party = null;
    this.netRace = null;
    this.remote.clear();
    document.body.classList.remove('in-party');
    this.toTitle();
    this.menu.home();
    this.hud.title.classList.remove('hidden');
  }

  private toPartyGrid(slot: number) {
    const [s, d] = partySlot(slot);
    const g = this.track.pointAt(s, d);
    this.car.place(g.x, g.y, g.z, this.track.headingAt(s));
    this.restartCommon(false);
    this.rig.reset();
  }

  beginPartyRace(slot: number, laps: number) {
    audio.unlock();
    this.paused = false; this.hud.paused.classList.add('hidden');
    this.dropRace();
    this.netRace = { laps, slot, startedAt: null, finished: false, finishDist: 0 };
    this.toPartyGrid(slot);
    this.phase = 'lights';
    this.hud.title.classList.add('hidden');
    this.hud.setLights(0); this.trackScene.setStartLights(0);
    this.hud.message(`${laps} lap${laps > 1 ? 's' : ''}`, 1.6);
  }

  partyLights(n: number) { this.hud.setLights(n); this.trackScene.setStartLights(n); }

  partyGo() {
    if (!this.netRace || this.phase !== 'lights') return;
    this.phase = 'driving';
    this.netRace.startedAt = performance.now();
    this.jets.armLaunch();
    this.partyLights(0);
    this.hud.message('GO!', 1.2);
    setTimeout(() => this.hud.setLights(-1), 900);
  }

  endPartyRace() {
    this.netRace = null;
    this.party?.snapshots.clear();
    this.remote.clear();
    this.toTitle();
    this.toPartyGrid(0);
  }

  /** race progress in metres, for the standings: negative on the grid, then laps × length */
  private raceDist(s: number) { return this.lap > 0 ? (this.lap - 1) * this.track.total + s : s - this.track.total; }

  private finishPartyRace() {
    const r = this.netRace!;
    r.finished = true;
    const time = (performance.now() - (r.startedAt ?? performance.now())) / 1000;
    // finishers rank ahead of everyone still racing, the quickest first
    r.finishDist = (r.laps + 10) * this.track.total - time;
    this.party?.sendFinish(time, this.bestLap);
    this.hud.message(`Finished · ${formatTime(time)}`, 3);
    // a cool-down lap on the autopilot while the others finish
    this.phase = 'finished';
    this.pilot = new Autopilot(this.track);
  }

  /** party race: send our car at NET_RATE, draw the others, update the standings */
  private netFrame(dt: number) {
    const pc = this.party!, r = this.netRace!;
    const t = this.car.body.translation(), q = this.car.body.rotation();
    const dist = r.finished ? r.finishDist : this.raceDist(this.prevS);
    this.netT += dt;
    if (this.netT >= 1 / NET_RATE) {
      this.netT = 0;
      const braking = this.inp.brake > 0.1 && this.car.speed > 0.5 ? 1 : 0;
      const r3 = (v: number) => Math.round(v * 1000) / 1000;
      pc.sendState([r3(t.x), r3(t.y), r3(t.z), r3(q.x), r3(q.y), r3(q.z), r3(q.w), Math.round(dist), r3(this.car.speed), r3(this.car.wheels[0].steer),
        braking | (this.jets.boosting ? 2 : 0), this.paintIndex]);
    }
    const players = pc.lobby?.players ?? [];
    const others = this.remote.update(pc.snapshots, players, this.rig.cam, dt, this.netPos);
    const field = [{ id: pc.id, dist, paint: this.paintIndex }, ...others]
      .filter(x => x.id === pc.id || players.some(p => p.id === x.id))
      .sort((a, b) => b.dist - a.dist);
    field.forEach((x, k) => this.netPos.set(x.id, k + 1));
    const lead = field[0];
    const lap = Math.min(this.lap, r.laps + 1);
    this.hud.setRace({
      pos: this.netPos.get(pc.id) ?? 1, total: field.length, lap: r.finished ? r.laps + 1 : lap, laps: r.laps,
      field: field.map((x, k) => ({
        pos: k + 1, name: players.find(p => p.id === x.id)?.name ?? 'You', color: paintCss(x.paint), you: x.id === pc.id,
        gap: k === 0 ? '' : `+${((lead.dist - x.dist) / GAP_SPEED).toFixed(1)}`,
      })),
    });
    return others.map(o => ({ x: o.x, z: o.z, color: paintCss(o.paint) }));
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
    // Esc: back out of a menu screen first, otherwise pause or resume
    if (input.consume('pause') && !this.menu.back()) this.togglePause();
    if (input.consume('help')) this.hud.help.classList.toggle('hidden');
    if (input.consume('camera')) { this.rig.next(); settings.camera = this.rig.mode; saveSettings(); this.hud.message(`Camera: ${this.rig.mode}`, 1.2); }
    if (input.consume('paint')) { this.model.nextPaint(); this.hud.message(this.model.paintName, 1.4); this.party?.setProfile({ paint: this.paintIndex }); }
    if (input.consume('time')) { this.todIndex = (this.todIndex + 1) % TIMES.length; this.buildEnvironment(); this.hud.message(`Time of day: ${TIMES[this.todIndex]}`, 1.4); }
    if (input.consume('mute')) { settings.sound = !audio.toggleMute(); saveSettings(); this.hud.message(settings.sound ? 'Sound on' : 'Sound off', 1.2); }
    if (input.consume('reset') && this.phase === 'driving' && !this.paused) { this.resetCar(); this.hud.message('Reset', 1); }
    for (const [a, h] of [['assist1', 'easy'], ['assist2', 'medium'], ['assist3', 'off']] as const) {
      if (input.consume(a)) { this.setHelp(h); settings.help = h; saveSettings(); this.hud.message(`Driving help: ${HELP_LABEL[h]}`, 1.4); }
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
        if (me.lap === this.race.laps && this.race.laps > 1) this.hud.message('Final lap!', 2);
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
        this.lapTimes.push(t);
        if (this.bestLap === null || t < this.bestLap) { this.bestLap = t; store()?.setItem('rd-best', String(t)); this.hud.message('Best lap!', 2.5); }
        this.hud.showDelta(delta);
      }
      if (this.lapStart === null || this.passedHalf) {
        this.lap++; this.lapStart = this.simTime; this.passedHalf = false;
        if (this.netRace && !this.netRace.finished && this.lap > this.netRace.laps) this.finishPartyRace();
        if (!this.netRace && this.session === 'timetrial' && this.lap > this.trialLaps) this.finishTrial();
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

    // the countdown: a light a second from 5 down to 1, then lights out
    if (this.phase === 'lights' && !this.paused && !this.netRace) {
      this.lightsT += dt;
      const lit = Math.min(5, Math.floor(this.lightsT) + 1);
      if (this.lightsT < COUNTDOWN) { this.hud.setLights(lit); this.trackScene.setStartLights(lit); }
      else {
        this.phase = 'driving';
        if (this.race) this.race.go(); else this.jets.armLaunch();
        this.trialStart = this.simTime;
        this.hud.setLights(0); this.trackScene.setStartLights(0); this.hud.message('GO!', 1.2);
        setTimeout(() => { if (this.phase !== 'lights') this.hud.setLights(-1); }, 900);
      }
    }
    document.body.classList.toggle('in-session', this.phase !== 'title' && !this.resultsShown);
    document.body.classList.toggle('on-title', this.phase === 'title' && !this.party);

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
    const friends = this.party && this.netRace ? this.netFrame(dt) : [];
    this.probe?.update(this.renderer.gl, this.scene, new THREE.Vector3(focus.x, focus.y + 0.35, focus.z), root,
      () => this.env.setProbeMode(true), () => this.env.setProbeMode(false));

    const slip = Math.max(...this.car.wheels.map(w => w.slip));
    audio.update(this.car.speed, Math.max(-1, Math.min(1, this.car.powerKw / 300)), slip, this.kerb, this.paused || this.phase === 'title');
    audio.jets(Math.max(this.jets.boosting ? 1 : 0, nearBoost * 0.45), this.jets.attitude, this.jets.tank, this.paused || this.phase === 'title');
    this.hud.setAir(this.jets.tank, this.jets.boosting, this.jets.hopCooldown <= 0 && this.jets.tank >= 0.1, dt);
    // one-speed EV: D, or R when backing up
    const gear = this.car.speed < -0.5 ? 'R' : 'D';
    if (input.touch) this.touch.show(gear, this.car.motorRpm, Math.abs(this.car.speed) * 3.6, this.car.tyreTemp);
    this.hud.update(dt, {
      speed: this.car.speed, powerKw: this.car.powerKw, lap: this.lap,
      current: this.lapStart !== null ? this.simTime - this.lapStart : null, last: this.lastLap, best: this.bestLap,
      x: focus.x, z: focus.z, heading: e.y, help: HELP_LABEL[this.help], paint: this.model.paintName,
      steer: this.inp.steer, gear, rpm: this.car.motorRpm, tyres: this.car.tyreTemp,
      others: [...this.rivals.map(r => ({ x: r.model.root.position.x, z: r.model.root.position.z, color: css(PAINTS[r.e.paint].color) })), ...friends],
    });
    this.renderer.render(this.scene, this.rig.cam);
  }

  private updateRaceHud(dt: number) {
    const race = this.race!, me = race.player;
    if (this.phase === 'finished') {
      this.finishT += dt;
      if (this.finishT > 2 && (!this.resultsShown || Math.floor(this.finishT) !== Math.floor(this.finishT - dt))) this.showResults();
    }
    // a quick call-out when the player gains places
    if (this.phase === 'driving' && this.lastPos && me.pos < this.lastPos && race.time > 3) this.hud.message(`P${me.pos}`, 1.1);
    if (this.phase !== 'title') this.lastPos = me.pos;
    if ((this.raceHudT -= dt) > 0) return;
    this.raceHudT = 0.2;
    const order = race.standings, lead = order[0];
    this.hud.setRace({
      pos: me.pos, total: order.length, lap: me.lap, laps: race.laps,
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
    const est = (e: Entrant) => e.estimated ? ' (est.)' : '';
    const rows = order.map(e => ({
      pos: e.pos, name: e.name, you: e === race.player, best: `best ${formatTime(e.bestLap)}`,
      time: !e.finished ? 'racing…' : e === lead ? formatTime(e.finishTime) + est(e) : `+${(e.finishTime! - lead.finishTime!).toFixed(3)}${est(e)}`,
    }));
    const me = race.player.pos;
    this.hud.showResults(me === 1 ? 'YOU WIN' : `P${me}`, 'RESULTS', rows, this.afterActions(),
      order.some(e => e.estimated) ? 'Session finished early: times for drivers still racing are estimates.' : '');
    this.resultsShown = true;
  }

  /** the buttons under the results */
  private afterActions() {
    const again = this.session === 'race' ? 'Race again' : this.session === 'timetrial' ? 'Try again' : 'Drive again';
    return [{ label: again, primary: true, run: () => this.restart() }, { label: 'Menu', run: () => this.quitToMenu() }];
  }

  /** time trial over: total time and every lap */
  private finishTrial() {
    this.phase = 'finished';
    this.pilot = new Autopilot(this.track);
    this.showTrialResults(false);
  }

  /** the laps of a time trial or practice; `early` when the session was finished from the pause menu */
  private showTrialResults(early: boolean) {
    const laps = this.lapTimes, best = Math.min(...laps);
    const rows = laps.map((t, k) => ({ pos: k + 1, name: `Lap ${k + 1}`, time: formatTime(t), best: t === best ? 'best' : '', you: t === best }));
    let title: string, note = '';
    if (this.session === 'timetrial' && !early) {
      const total = this.simTime - this.trialStart;
      const key = `rd-trial-${this.trialLaps}`;
      const record = Number(store()?.getItem(key) ?? 0);
      title = formatTime(total);
      if (!record || total < record) { store()?.setItem(key, String(total)); note = record ? `New record! ${(record - total).toFixed(3)} s faster than before.` : 'Your first record.'; }
      else note = `Record ${formatTime(record)} (+${(total - record).toFixed(3)} s)`;
    } else {
      title = laps.length ? `Best ${formatTime(best)}` : 'No laps';
      note = `${laps.length} lap${laps.length === 1 ? '' : 's'} completed`;
    }
    this.hud.showResults(title, this.session === 'timetrial' ? 'TIME TRIAL' : 'PRACTICE', rows, this.afterActions(), note);
    this.resultsShown = true;
  }

  run() {
    const loop = (t: number) => { this.frame(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
}
