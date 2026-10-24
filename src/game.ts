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
import { buildModel, type BodyModel } from './render/models';
import { OpenWheelModel } from './render/openWheel';
import { CLASSES, type ClassId } from './sim/classes';
import { ownsCar, giveCar, progress, saveProgress } from './core/progress';
import { licenseById, medalFor, medalTime, passes, better, MEDALS, TestProgress } from './sim/licenses';
import { Gates } from './render/gates';
import { qualifyingOrder, QUALI_LAPS, type Weekend, type WeekendStage } from './sim/weekend';
import { champById, scoreRound, standings, isOver, CHAMP_OPPONENTS, REWARD_PLACE, type ChampRun } from './sim/championship';
import { ReflectionProbe } from './render/reflections';
import { CameraRig } from './render/cameras';
import { SkidMarks } from './render/skids';
import { Vapour, JetFx } from './render/vapour';
import { CanisterScene } from './render/canisterScene';
import { cloneModel } from './render/cloneModel';
import { disposeResources } from './render/resources';
import { NameTag } from './render/nameTag';
import { RemoteCars, paintCss } from './render/remoteCars';
import { input, type DriveInput } from './core/input';
import { audio } from './core/audio';
import { Hud, formatTime } from './ui/hud';
import { PartyUi, type PartyGame } from './ui/partyUi';
import { Menu, type MenuGame } from './ui/menu';
import { TouchControls, touchDevice } from './ui/touch';
import { settings, setup, saveSettings, type SessionMode, type RaceSetup } from './core/settings';
import type { PartyClient } from './net/party';
import { showErrorBanner } from './core/health';
import { Damage, DAMAGE } from './sim/damage';
import { Tow, type TowEvent } from './sim/tow';
import { BodyDents } from './render/damage';
import { DamageFx } from './render/damageFx';
import { TowScene } from './render/towScene';
import { DamageHud } from './ui/damageHud';
import { Fun, FUN_DEFAULTS, ITEM_ICON, ITEM_LABEL, type FunCar, type FunOptions } from './sim/fun';
import { racingLine } from './sim/racingLine';
import { FunScene } from './render/funScene';
import { Sparks, Smoke } from './render/effects';
import { Trackside } from './render/trackside';
import { applyFinish, type LiveryConfig, type Pattern } from './render/livery';
import { garage, saveGarage, tunedSpec, fitTyres, hex, GLASS, GLOWS } from './core/garage';

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
/** the bots' liveries, by grid number: a pattern and a second colour each */
const BOT_LIVERY: [Pattern, number][] = [['stripes', 0xffffff], ['side', 0x111214], ['twotone', 0x111214], ['flames', 0x111214], ['stripes', 0x111214],
  ['solid', 0xffffff], ['side', 0xffffff], ['twotone', 0xe6e8e6], ['flames', 0xffffff], ['stripes', 0xd9c414], ['twotone', 0xff2d95]];
/** the bots' wheels and glass: the roadster's own */
const BOT_PARTS = { rims: 'aero' as const, rimColor: 0x0e0f11, wing: 'active' as const, glass: 0x7a5c22, glow: 0 };
const TYRE_SMOKE = new THREE.Color(0xe4e6e8), GRASS_DUST = new THREE.Color(0x8a7656);
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
interface RivalView { e: Entrant; model: BodyModel; fx: JetFx; skids: SkidMarks; tag: NameTag; prev: Snap; curr: Snap; hop: boolean; damage: Damage; dents: BodyDents; resets: number }

export interface GameOptions { quality?: Quality; safe?: boolean; tod?: TimeOfDay; autodrive?: boolean }

export class Game implements PartyGame, MenuGame {
  readonly track = new Track();
  readonly terrain: Terrain;
  readonly world;
  car: Car;
  /** the class the player drives; the car and model change with it */
  cls: ClassId = 'rental';
  readonly scene = new THREE.Scene();
  readonly renderer: Renderer;
  private env!: Environment;
  private trackScene: TrackScene;
  /** the roadster body: the Rental's model, and the friends' cars in a party are copies of it */
  private readonly roadModel = new CarModel();
  /** each class's model and its thruster effects, built the first time the class is driven */
  private views = new Map<ClassId, { model: BodyModel; fx: JetFx }>();
  model: BodyModel = this.roadModel;
  private probe: ReflectionProbe | null = null;
  readonly rig = new CameraRig();
  private skids = new SkidMarks();
  readonly hud: Hud;
  private pilot: Autopilot | null = null;
  readonly jets = new Jets();
  readonly canisters: Canisters;
  private canisterScene: CanisterScene;
  private vapour = new Vapour();
  private jetFx!: JetFx;
  /** a hop was pressed this frame and not yet given to the physics */
  private hopQueued = false;
  /** a side thruster was pressed this frame and not yet given to the physics (-1 or 1) */
  private sideQueued = 0;
  /** jet events and pickups since the last frame */
  private frameEvents: JetEvent[] = [];
  private frameHop = false;
  private frameAir = 0;
  /** null in practice, time trial and party races */
  race: Race | null;
  session: SessionMode = 'race';
  /** the setup the current session was started with (Restart uses it again) */
  private current: RaceSetup = { ...setup };
  /** the championship this race is a round of */
  champ: ChampRun | null = null;
  /** the race weekend this session is part of */
  weekend: Weekend | null = null;
  private standingsShown = false;
  /** the license test being driven: which one, how far along, and how long off the road */
  test: { id: string; k: number; prog: TestProgress; offT: number; over: boolean; time: number | null } | null = null;
  private gates: Gates;
  /** the results still have cars racing, so they refresh every second */
  private resultsPending = false;
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
  /** crash damage: the zones (sim), the dents on the model, the debris, and the meter */
  readonly damage = new Damage();
  private dents!: BodyDents;
  private damageFx = new DamageFx();
  private damageHud!: DamageHud;
  /** seconds since the car was wrecked (the tow comes once it has stopped) */
  private wreckT = 0;
  /** the flying tow, while it's on its way, carrying the car or flying off */
  tow: Tow | null = null;
  private towScene!: TowScene;
  private towEvents: TowEvent[] = [];
  // Fun Mode: the course, its rules for every car, and what it looks like
  fun: Fun | null = null;
  private funScene: FunScene | null = null;
  private funOpts: FunOptions | null = null;
  private funCars = new Map<Entrant, FunCar>();
  private funKey = '';
  // realism: sparks, tyre smoke and dust, trackside boards
  private sparks = new Sparks();
  private smoke = new Smoke();
  private smokeAcc = 0;
  private wasAirborne = false;
  private slipT = 0;
  /** the garage screen is open: the camera frames the car beside it */
  garageOpen = false;

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
  private inp: DriveInput = { steer: 0, throttle: 0, brake: 0, handbrake: false, lookBack: false, boost: false, hop: false, hover: false, side: 0, sidePress: 0, pitch: 0 };
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
    this.renderer = new Renderer(container, !opts.safe);
    const graphics: GraphicsSettings = opts.safe
      ? { graphicsMode: 'custom', quality: 'low', resolutionScale: 1, shadows: false, postfx: false }
      : opts.quality
        ? { graphicsMode: 'custom', quality: opts.quality, resolutionScale: 1, shadows: true, postfx: opts.quality !== 'low' }
        : { graphicsMode: 'auto', quality: 'high', resolutionScale: 1, shadows: true, postfx: true };
    this.renderer.configure(graphics);
    const quality = this.renderer.quality;

    this.todIndex = Math.max(0, TIMES.indexOf(opts.tod ?? setup.tod));
    this.buildEnvironment();
    this.trackScene = new TrackScene(this.track, this.terrain, quality);
    this.canisters = new Canisters(this.track);
    this.canisterScene = new CanisterScene(this.canisters);
    this.gates = new Gates(this.track);
    this.scene.add(this.gates.group);
    this.scene.add(this.trackScene.group, this.canisterScene.group, this.skids.mesh, this.vapour.points);
    this.towScene = new TowScene(this.roadModel, this.vapour, quality);
    this.scene.add(this.damageFx.group, this.towScene.group);
    this.scene.add(new Trackside(this.track).group, this.sparks.points, this.smoke.points);
    this.touch.onItem = () => this.useItem();
    if (quality === 'high' || quality === 'ultra') this.probe = new ReflectionProbe(quality === 'ultra' ? 256 : 128, quality === 'ultra' ? 2 : 4);
    if (this.probe) this.towScene.setReflections(this.probe.texture);
    this.towScene.setNight(this.env.preset.night);
    this.roadModel.onSpoiler = up => { if (this.phase === 'driving') this.hud.message(up ? 'Spoiler up' : 'Spoiler down', 1); };

    this.cls = ownsCar(setup.cls) ? setup.cls : 'rental';
    const g = this.track.pointAt(GRID_S, 0);
    this.car = this.newCar(this.cls, g);
    this.setHelp(this.help);
    this.race = null;
    this.useModel(this.cls);
    this.buildRace();
    this.resetLaps();
    this.loadBest();
    this.autodrive = !!opts.autodrive;
    if (opts.autodrive) { this.pilot = new Autopilot(this.track); }

    this.hud = new Hud(this.track);
    this.hud.markAir(this.canisters.list);
    this.damageHud = new DamageHud(this.hud.root);
    this.hud.setLights(-1);
    this.settle();
    this.remote = new RemoteCars(this.roadModel, this.car.wheels.reduce((a, w) => a + w.suspension, 0) / 4);
    this.remote.setNight(this.env.preset.night);
    this.scene.add(this.remote.group);
    this.hud.ready();
    this.partyUi = new PartyUi(this);
    this.menu = new Menu(this, this.hud.title, this.hud.paused, this.partyUi.buttons);
    this.applySettings();
    input.onAny = () => audio.unlock();
  }

  /** show the class's model as the player's car (building it the first time), in the same paint */
  private useModel(cls: ClassId) {
    const paint = this.paintIndex;
    let v = this.views.get(cls);
    if (!v) {
      const model = cls === 'rental' ? this.roadModel : buildModel(cls);
      if (this.probe) model.setReflections(this.probe.texture);
      model.setNight(this.env.preset.night);
      v = { model, fx: new JetFx(model.root, this.vapour) };
      this.views.set(cls, v);
    }
    this.scene.remove(this.model.root);
    this.dents?.repair();
    this.model = v.model; this.jetFx = v.fx;
    this.dents = new BodyDents(this.model);
    this.setPaint(paint);
    this.applyGarageLook();
    this.scene.add(this.model.root);
  }

  /** the physics car for a class, with the garage's wing and tyres fitted */
  private newCar(cls: ClassId, g: THREE.Vector3) {
    const car = new Car(this.world, g.x, g.y, g.z, this.track.headingAt(GRID_S), tunedSpec(CLASSES[cls].spec, CLASSES[cls].body === 'road'));
    fitTyres(car);
    return car;
  }

  /** the garage's paint, finish, livery, number and parts on the player's model */
  private applyGarageLook() {
    const m = this.model, gc = garage;
    if (gc.paint >= 0) this.setPaint(gc.paint);
    else m.paint.color.setHex(hex(gc.custom));
    applyFinish(m.paint, gc.finish);
    m.setLivery(this.playerLivery());
    if (m instanceof OpenWheelModel) m.setNumber(gc.number);
    m.setParts({ rims: gc.rims, rimColor: hex(gc.rimColor), wing: gc.wing, glass: GLASS.find(x => x[0] === gc.glass)?.[2] ?? GLASS[0][2], glow: GLOWS.find(x => x[0] === gc.glow)?.[2] ?? 0 });
  }

  private playerLivery(): LiveryConfig {
    return { pattern: garage.pattern, second: hex(garage.second), number: garage.showNumber ? garage.number : null };
  }

  /** the garage changed something: show it, and refit the wing and tyres (a new physics car if
   *  the wing changed, since it changes the downforce and drag) */
  applyGarage() {
    saveGarage();
    this.applyGarageLook();
    const spec = tunedSpec(CLASSES[this.cls].spec, CLASSES[this.cls].body === 'road');
    if (spec.liftArea !== this.car.spec.liftArea || spec.dragArea !== this.car.spec.dragArea) {
      this.dropRace();
      this.car.dispose();
      this.car = this.newCar(this.cls, this.track.pointAt(GRID_S, 0));
      this.setHelp(this.help);
      if (!this.party) this.buildRace();
      this.toTitleGrid();
    } else fitTyres(this.car);
  }

  /** the garage screen opens or closes: the camera frames the car beside the panel */
  garageView(on: boolean) { this.garageOpen = on; document.body.classList.toggle('garage-open', on); }

  /** the colour the player's car shows on the map and in the standings */
  private get playerCss() { return css(this.model.paint.color.getHex()); }

  /** drive another class: a new physics car with that class's spec, and its model */
  setClass(cls: ClassId) {
    if (cls === this.cls) return;
    this.dropRace();
    this.endTow();
    this.car.dispose();
    this.cls = cls;
    this.car = this.newCar(cls, this.track.pointAt(GRID_S, 0));
    this.setHelp(this.help);
    this.useModel(cls);
    this.skids.clear();
    this.loadBest();
  }

  /** each class has its own lap record */
  private loadBest() {
    const best = Number(store()?.getItem(`rd-best-${this.cls}`) ?? 0);
    this.bestLap = best > 0 ? best : null;
  }

  /** the race puts everyone on the grid; the rivals sit there behind the title screen */
  private buildRace() {
    const s = this.current, w = this.weekend;
    const grid = w?.stage === 'race' ? w.quali?.map(r => r.name) : undefined;
    this.race = new Race(this.track, this.world, this.canisters, this.car, this.jets, { opponents: s.opponents, laps: s.laps, difficulty: s.difficulty, cls: this.cls, grid });
    // the rivals are copies of the player's model, so copy it as new
    this.repairCar();
    for (const e of this.race.rivals) {
      // copies of the player's model: building one from scratch takes seconds
      const model = cloneModel(this.model);
      model.onSpoiler = undefined; // only the player's spoiler gets a call-out
      for (let k = 0; k < PAINTS.length && model.paintName !== PAINTS[e.paint].name; k++) model.nextPaint();
      applyFinish(model.paint, 'factory');
      // every bot has its own livery and its number on the doors (a single-seater has its own decals)
      const [pattern, second] = BOT_LIVERY[(e.number - 1) % BOT_LIVERY.length];
      model.setLivery({ pattern, second, number: e.number });
      model.setParts(BOT_PARTS);
      if (model instanceof OpenWheelModel) model.setNumber(e.number);
      model.setNight(this.env.preset.night);
      const tag = new NameTag(e.name, css(PAINTS[e.paint].color));
      const view: RivalView = { e, model, fx: new JetFx(model.root, this.vapour), skids: new SkidMarks(), tag, prev: snap(), curr: snap(), hop: false, damage: new Damage(), dents: new BodyDents(model), resets: 0 };
      this.scene.add(model.root, view.skids.mesh, tag.sprite);
      this.rivals.push(view);
    }
    this.bindFunCars();
  }

  private dropRace() {
    if (!this.race) return;
    this.race.dispose();
    for (const r of this.rivals) { this.scene.remove(r.model.root, r.skids.mesh, r.tag.sprite); this.disposeRival(r); }
    this.rivals = [];
    this.race = null;
  }

  /** free the GPU memory a rival's car held: its own materials, effects, skid marks and name tag
   *  (the geometry and textures are shared with the player's models, so those stay) */
  private disposeRival(r: RivalView) {
    const shared = new Set<unknown>();
    for (const v of this.views.values()) v.model.root.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.geometry) shared.add(m.geometry);
      for (const mat of m.material ? [m.material].flat() : []) shared.add(mat);
    });
    r.model.root.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.geometry && !shared.has(m.geometry)) m.geometry.dispose();
      for (const mat of m.material ? [m.material].flat() : []) if (!shared.has(mat)) mat.dispose();
    });
    disposeResources(r.skids.mesh);
    r.tag.dispose();
  }

  private buildEnvironment() {
    this.env?.dispose();
    const tod = TIMES[this.todIndex];
    this.env = new Environment(this.scene, this.renderer.gl, tod, this.renderer.quality);
    // bloom only at night (lights, light bars): in daylight it bled the bright sky over the whole
    // picture as a milky haze
    this.renderer.setBloom(this.env.preset.night ? 0.8 : 0, 0.85);
    for (const v of this.views.values()) v.model.setNight(this.env.preset.night);
    this.towScene?.setNight(this.env.preset.night);
    this.vapour.setNight(this.env.preset.night);
    for (const r of this.rivals ?? []) r.model.setNight(this.env.preset.night);
    this.remote?.setNight(this.env.preset.night);
  }

  /** from the setup screen: a race, time trial or practice with the race setup (a championship
   *  round brings its own; so does each session of a race weekend) */
  startSession(mode: SessionMode, s: RaceSetup = setup, extra: { champ?: ChampRun | null; weekend?: Weekend | null; fun?: FunOptions | null } = {}) {
    audio.unlock();
    if (this.partyUi.active) return;
    this.resume();
    this.session = mode;
    this.current = { ...s };
    this.champ = extra.champ ?? null;
    this.weekend = extra.weekend ?? null;
    const fun = mode === 'race' ? extra.fun ?? null : null;
    if (!fun) this.endFun();
    this.endTest();
    const tod = Math.max(0, TIMES.indexOf(s.tod));
    if (tod !== this.todIndex) { this.todIndex = tod; this.buildEnvironment(); }
    this.hud.title.classList.add('hidden');
    // in Fun Mode every car is yours to try
    if (ownsCar(s.cls) || fun) this.setClass(s.cls);
    if (mode === 'race') {
      const r = this.race;
      if (!r || r.laps !== s.laps || r.difficulty !== s.difficulty || r.rivals.length !== s.opponents || r.cls !== this.cls || this.weekend) { this.dropRace(); this.buildRace(); }
      if (fun) this.startFun(fun);
      this.restartRace();
    } else if (mode === 'timetrial') {
      this.trialLaps = s.laps;
      this.soloStart(TRIAL_S);
      this.restartCommon();
    } else {
      this.soloStart(GRID_S);
      this.restartCommon(false);
      this.touch.recentre();
      this.phase = 'driving';
    }
  }

  /** Fun Mode on top of the race: the course for this class (built again if the class or the
   *  options changed) and every car in it */
  private startFun(opts: FunOptions) {
    const key = `${this.cls}|${opts.rings}|${opts.ramps}|${opts.items}|${this.car.spec.topSpeed}`;
    if (!this.fun || key !== this.funKey) {
      this.endFun();
      this.fun = new Fun(this.track, this.world, this.car.spec, opts, racingLine(this.track));
      this.funScene = new FunScene(this.track, this.fun, this.renderer.quality);
      this.scene.add(this.funScene.group);
      this.funKey = key;
    }
    this.funOpts = opts;
    this.bindFunCars();
    document.body.classList.add('in-fun');
  }

  /** the race's cars (after it was rebuilt) join the fun, the bots aim for rings and boxes */
  private bindFunCars() {
    const fun = this.fun, race = this.race;
    if (!fun || !race) return;
    fun.clearCars(); this.funCars.clear();
    for (const e of race.entrants) {
      const fc = fun.add(e.name, e.car, e.jets, e, e === race.player, !!e.driver);
      this.funCars.set(e, fc);
      if (e.driver) { const d = e.driver; d.aim = (s, speed) => fun.aim(fc, s, speed, d.def.aggression); }
    }
    race.onRivalStep = (e, dt) => { const fc = this.funCars.get(e); if (fc) fun.preStep(fc, dt); };
  }

  private endFun() {
    if (!this.fun) return;
    this.fun.dispose();
    if (this.funScene) { this.scene.remove(this.funScene.group); this.funScene.dispose(); }
    this.fun = null; this.funScene = null; this.funOpts = null; this.funKey = '';
    this.funCars.clear();
    if (this.race) { this.race.onRivalStep = null; for (const e of this.race.rivals) if (e.driver) e.driver.aim = null; }
    this.hud.setFun(null);
    this.touch.setItem(null);
    for (const r of this.rivals) r.model.setSoot(0);
    this.model.setSoot(0);
    document.body.classList.remove('in-fun');
  }

  /** from the Fun Mode setup screen */
  startFunMode(s: RaceSetup, opts: FunOptions = FUN_DEFAULTS) {
    this.startSession('race', s, { fun: opts });
    this.hud.message('Fun Mode: ramps, rings of fire, boost pads and items!', 3);
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
    this.skids.clear(); this.vapour.clear(); this.sparks.clear(); this.smoke.clear();
    for (const r of this.rivals) { r.skids.clear(); r.damage.repair(); r.dents.repair(); }
    this.endTow(); this.repairCar(); this.damageFx.clear();
    if (this.fun) { this.bindFunCars(); this.fun.reset(); }
    this.pilot = this.autodrive ? new Autopilot(this.track) : null;
    this.finishT = 0; this.resultsShown = false; this.standingsShown = false; this.lastPos = 0; this.lastRaceLap = 0; this.lapTimes = [];
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

  /** everyone back on the grid behind the title screen */
  private toTitleGrid() {
    if (this.race) this.race.grid();
    else { const g = this.track.pointAt(GRID_S, 0); this.car.place(g.x, g.y, g.z, this.track.headingAt(GRID_S)); }
    this.restartCommon(false);
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
    if (this.test) { this.startLicenseTest(this.test.id, this.test.k); return; }
    this.startSession(this.session, this.current, { champ: this.champ, weekend: this.weekend, fun: this.funOpts });
  }

  /** a license test: the license's car alone at gate A, a 3-second countdown, then drive to B */
  startLicenseTest(id: string, k: number) {
    audio.unlock();
    if (this.partyUi.active) return;
    const lic = licenseById(id), test = lic.tests[k];
    this.resume();
    this.champ = null; this.weekend = null;
    this.endFun();
    this.hud.title.classList.add('hidden');
    this.setClass(lic.cls);
    this.soloStart(test.a);
    this.test = { id, k, prog: new TestProgress(this.track, test), offT: 0, over: false, time: null };
    this.gates.show(test.a, test.b);
    document.body.classList.add('in-test');
    this.restartCommon();
    this.lightsT = COUNTDOWN - 3;
    this.hud.message(`${lic.name} · Test ${k + 1}: ${test.name}`, 3);
  }

  private endTest() {
    if (!this.test) return;
    this.test = null;
    this.gates.hide();
    this.hud.setTest(null);
    document.body.classList.remove('in-test');
  }

  /** one physics step of a test: progress towards B, and the ways to fail it */
  private stepTest(lateral: number, s: number) {
    const t = this.test!;
    if (t.over || this.phase !== 'driving') return;
    t.prog.update(s);
    if (Math.abs(lateral) > this.track.halfWidth + 2.5) t.offT += PHYSICS_DT; else t.offT = 0;
    if (t.offT > 0.4) this.testOver(null, 'Off the track! Keep the car on the road all the way to B.');
    else if (t.prog.dist < -15) this.testOver(null, 'Wrong way! Gate B is ahead of you.');
    else if (t.prog.done) this.testOver(this.simTime - this.trialStart);
  }

  /** the test is over: a time (or why it failed), the medal, and what it earned */
  private testOver(time: number | null, why = '') {
    const t = this.test!, lic = licenseById(t.id), test = lic.tests[t.k];
    t.over = true; t.time = time;
    this.phase = 'finished';
    this.pilot = new Autopilot(this.track);
    this.pilot.aggression = 0.7;
    const medal = time === null ? null : medalFor(test, time);
    const medals = (progress.medals[lic.id] ??= [null, null, null, null, null]);
    const hadLicense = progress.licenses.includes(lic.id);
    medals[t.k] = better(medals[t.k], medal);
    let note = why;
    if (time !== null) {
      note = medal ? (passes(medal) ? 'Silver or better: this test counts towards the license.' : 'Bronze. Silver or better counts towards the license.')
        : `No medal: bronze is ${medalTime(test, 'bronze').toFixed(1)} s.`;
    }
    if (!hadLicense && medals.every(passes)) {
      progress.licenses.push(lic.id);
      note = `You earned the ${lic.name} license!`;
      if (lic.car && giveCar(lic.car)) note += ` The ${CLASSES[lic.car].name} is yours: pick it before a race.`;
    }
    saveProgress();
    const rows = MEDALS.map(m => ({ name: m.toUpperCase(), t: medalTime(test, m), you: false }));
    if (time !== null) rows.push({ name: 'You', t: time, you: true });
    rows.sort((a, b) => a.t - b.t);
    const next = t.k + 1 < lic.tests.length ? t.k + 1 : -1;
    const actions: { label: string; primary?: boolean; run: () => void }[] = [];
    if (passes(medal) && next >= 0) actions.push({ label: 'Next test', primary: true, run: () => this.startLicenseTest(lic.id, next) });
    actions.push({ label: 'Try again', primary: !actions.length, run: () => this.startLicenseTest(lic.id, t.k) });
    actions.push({ label: 'Licenses', run: () => { this.quitToMenu(); this.menu.licenses(); } });
    this.hud.showResults(medal ? medal.toUpperCase() : time === null ? 'TEST FAILED' : 'NO MEDAL', `${lic.name} · Test ${t.k + 1}: ${test.name}`,
      rows.map(r => ({ pos: '', name: r.name, time: `${r.t.toFixed(time !== null && r.you ? 3 : 1)} s`, best: '', you: r.you })), actions, note);
    this.resultsShown = true;
  }

  /** a race weekend: free practice first */
  startWeekend(s: RaceSetup) {
    this.weekendStage({ stage: 'practice', setup: { ...s }, quali: null }, 'practice');
  }

  private weekendStage(w: Weekend, stage: WeekendStage) {
    w.stage = stage;
    if (stage === 'practice') {
      this.startSession('practice', w.setup, { weekend: w });
      this.hud.message('Practice: learn the track. Pause and pick Go to qualifying when you are ready.', 4);
    } else if (stage === 'qualifying') {
      this.startSession('timetrial', { ...w.setup, laps: QUALI_LAPS }, { weekend: w });
      this.hud.message(`Qualifying: your best of ${QUALI_LAPS} laps sets your grid slot`, 3);
    } else {
      this.startSession('race', w.setup, { weekend: w });
    }
  }

  /** what the pause menu's Finish session button does here */
  get finishLabel() {
    return this.weekend?.stage === 'practice' ? 'Go to qualifying' : this.weekend?.stage === 'qualifying' ? 'End qualifying' : 'Finish session';
  }

  /** qualifying is over: the grid from everyone's best lap (the bots keep their times on a retry) */
  private showQualifying() {
    const w = this.weekend!, s = w.setup;
    const best = this.lapTimes.length ? Math.min(...this.lapTimes) : null;
    const bots = w.quali?.filter(r => r.name !== 'You');
    const order = bots ? [{ name: 'You', time: best }, ...bots].sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity))
      : qualifyingOrder(best, s.opponents, this.cls, s.difficulty);
    w.quali = order;
    const pole = order[0].time ?? 0, me = order.findIndex(r => r.name === 'You') + 1;
    const rows = order.map((r, k) => ({ pos: k + 1, name: r.name, you: r.name === 'You',
      time: r.time === null ? 'no time' : k === 0 ? formatTime(r.time) : `+${(r.time - pole).toFixed(3)}`, best: '' }));
    this.hud.showResults(me === 1 ? 'POLE POSITION!' : `P${me} ON THE GRID`, 'QUALIFYING', rows, [
      { label: 'Race', primary: true, run: () => this.weekendStage(w, 'race') },
      { label: 'Retry qualifying', run: () => this.restart() },
    ], best === null ? 'No lap time, so you start from the back.' : `Your best lap: ${formatTime(best)}.`);
    this.resultsShown = true;
  }

  /** the next round of a championship */
  startChampionship(run: ChampRun) {
    const c = champById(run.id), r = c.rounds[run.round];
    progress.run = run; saveProgress();
    this.startSession('race', { tod: r.tod, laps: r.laps, difficulty: run.difficulty, opponents: CHAMP_OPPONENTS, cls: c.cls }, { champ: run });
    this.hud.message(`${c.name} · Round ${run.round + 1} of ${c.rounds.length}`, 3);
  }

  /** score the round, then show the championship standings (and the prize after the last round) */
  private champRoundDone() {
    const run = this.champ!, c = champById(run.id), race = this.race!;
    if (race.standings.some(e => !e.finished)) race.finishNow();
    const gained = scoreRound(run, race.standings);
    const table = standings(run), me = table.findIndex(r => r.name === 'You') + 1;
    const rows = table.map((r, k) => ({ pos: k + 1, name: r.name, you: r.name === 'You', time: `${r.points} pts`, best: gained[r.name] ? `+${gained[r.name]}` : '' }));
    let title: string, note = '';
    const actions: { label: string; primary?: boolean; run: () => void }[] = [];
    if (isOver(run)) {
      title = me === 1 ? 'CHAMPION!' : `P${me} OVERALL`;
      progress.champs[c.id] = Math.min(progress.champs[c.id] ?? 99, me);
      progress.run = null;
      const prize = CLASSES[c.reward].name;
      if (me <= REWARD_PLACE) note = giveCar(c.reward) ? `You earned the ${prize}! Pick it in the Car row before a race.` : `Top ${REWARD_PLACE} again. You already have the ${prize}.`;
      else note = `Finish in the top ${REWARD_PLACE} overall to earn the ${prize}. Try again!`;
      this.champ = null;
      actions.push({ label: 'Menu', primary: true, run: () => this.quitToMenu() });
    } else {
      title = `ROUND ${run.round} OF ${c.rounds.length}`;
      note = `You are P${me} with ${run.points.You ?? 0} points. Top ${REWARD_PLACE} at the end earns the ${CLASSES[c.reward].name}.`;
      progress.run = run;
      actions.push({ label: `Round ${run.round + 1}`, primary: true, run: () => this.startChampionship(run) }, { label: 'Menu', run: () => this.quitToMenu() });
    }
    saveProgress();
    this.standingsShown = true;
    this.hud.showResults(title, c.name.toUpperCase(), rows, actions, note);
  }

  /** end the session now and show how it went */
  finishSession() {
    this.resume();
    if (this.netRace || this.phase === 'title') return;
    if (this.test) { if (!this.test.over) this.testOver(null, 'Test stopped from the pause menu.'); return; }
    if (this.race) {
      this.race.finishNow();
      this.phase = 'finished';
      this.pilot = new Autopilot(this.track);
      this.showResults();
      this.finishT = 2;
    } else {
      this.phase = 'finished';
      this.pilot = new Autopilot(this.track);
      if (this.weekend?.stage === 'qualifying') this.showQualifying(); else this.showTrialResults(true);
    }
  }

  quitToMenu() {
    if (this.party) { this.resume(); return; }
    // a championship in progress stays saved: Continue picks it up from the menu
    this.champ = null;
    this.weekend = null;
    this.endTest();
    this.endFun();
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
    this.endFun();
    document.body.classList.add('in-party');
    this.hud.title.classList.add('hidden');
    this.resume();
    // everyone in a party drives the Rental, so the cars match the friends' copies
    this.setClass('rental');
    if (this.race) this.dropRace();
    this.toPartyGrid(0);
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

  // ---- crash damage and the flying tow

  /** good as new: no damage, no dents */
  private repairCar() {
    this.damage.repair(); this.dents?.repair(); this.wreckT = 0;
    this.damageHud?.update(this.damage);
  }

  /** the tow comes for the car: it's dropped back on the road a little behind where it is now */
  callTow(why: string) {
    const t = this.car.body.translation(), r = this.car.body.rotation();
    const near = this.track.nearest(t.x, t.z, this.hint);
    const s = near.s - 5;
    this.tow = new Tow(this.track, { p: new THREE.Vector3(t.x, t.y, t.z), q: new THREE.Quaternion(r.x, r.y, r.z, r.w) }, s, Math.max(-3, Math.min(3, near.lateral)), this.car.spec.comHeight);
    this.towScene.start(this.tow);
    this.flipT = 0; this.wreckT = 0;
    this.hud.message(why, 2.2);
    if (this.test && !this.test.over && this.phase === 'driving') this.testOver(null, 'The car had to be towed back to the road. Try again!');
  }

  /** one physics step of the tow; true while it holds the car */
  private stepTow(dt: number) {
    const tow = this.tow!;
    const was = tow.holding;
    tow.step(dt);
    this.towEvents.push(...tow.takeEvents());
    const b = this.car.body;
    if (tow.holding) {
      const p = b.translation();
      b.setTranslation(tow.carPos, true);
      b.setRotation(tow.carQuat, true);
      b.setLinvel({ x: (tow.carPos.x - p.x) / dt, y: (tow.carPos.y - p.y) / dt, z: (tow.carPos.z - p.z) / dt }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.car.speed = 0; this.car.powerKw = 0;
      return true;
    }
    if (was) {
      // set down on the road, repaired and ready to go
      const g = this.track.pointAt(tow.s, tow.lateral);
      this.car.place(g.x, g.y, g.z, this.track.headingAt(tow.s));
      this.jets.reset();
      this.repairCar();
      const near = this.track.nearest(g.x, g.z, this.hint);
      this.hint = near.i; this.prevS = near.s;
    }
    return false;
  }

  /** call off the tow (a new session, or a reset) */
  private endTow() {
    this.tow = null;
    this.towEvents.length = 0;
    this.towScene?.stop();
  }

  /** crash damage for this frame: the player's hits dent the car, throw debris and fill the
   *  meter; the rivals' hits dent theirs */
  private crashFrame(dt: number, jetKick: boolean) {
    const cars = [{ car: this.car, damage: this.damage, dents: this.dents, root: this.model.root, paint: this.model.paint.color, you: true }];
    for (const r of this.rivals) {
      // a rival put back on the road by the race is fixed up too
      if (r.e.resets !== r.resets) { r.resets = r.e.resets; r.damage.repair(); r.dents.repair(); }
      cars.push({ car: r.e.car, damage: r.damage, dents: r.dents, root: r.model.root, paint: r.model.paint.color, you: false });
    }
    const at = new THREE.Vector3(), out = new THREE.Vector3();
    for (const c of cars) {
      // the player's impact is also read (and cleared) by the camera shake below
      const impact = c.car.impact;
      if (!c.you) c.car.takeImpact();
      if (impact > DAMAGE.threshold && !(c.you && (jetKick || this.tow?.holding)) && this.phase !== 'title') {
        const hit = c.damage.hit(c.car, c.car.impactVec);
        if (hit) {
          c.dents.add(hit);
          c.dents.contact(hit, at);
          at.applyMatrix4(c.root.matrixWorld);
          const { fwd, right } = c.car.axes();
          out.set(-right.x * hit.dir.x + fwd.x * hit.dir.z, 0, -right.z * hit.dir.x + fwd.z * hit.dir.z).normalize();
          const t = c.car.body.translation();
          this.damageFx.crash(at, out, c.car.body.linvel(), hit.amount, c.paint, t.y - c.car.spec.comHeight);
          if (c.you && hit.amount > 0.25) this.hud.message(c.damage.wrecked ? 'WRECKED!' : 'Big hit!', 1.2);
        }
      }
      c.dents.update();
      c.root.updateMatrixWorld();
      this.damageFx.smokeFrom(c.root, c.damage.worst, c.car.body.linvel(), dt);
    }
    this.damageFx.update(dt, this.rig.cam, this.renderer.gl.domElement.height);
    this.damageHud.update(this.damage);
  }

  /** the tow's moments that need a message or a sound */
  private towFrame(dt: number) {
    for (const ev of this.towEvents) {
      if (ev === 'hooked') this.hud.message('Hooked!', 1);
      else if (ev === 'release') { this.hud.message('Back on track!', 1.6); this.rig.reset(); this.skids.clear(); this.snapshot(this.prev); this.snapshot(this.curr); }
      else if (ev === 'ring') audio.hop();
      else if (ev === 'gone') { this.tow = null; this.towScene.stop(); }
    }
    this.towEvents.length = 0;
    const tp = this.tow?.pos;
    const ground = tp ? this.track.pointAt(this.track.nearest(tp.x, tp.z).s, 0).y : 0;
    this.towScene.update(dt, this.rig.cam, this.renderer.gl.domElement.height, ground);
  }

  resetCar() {
    this.endTow();
    const near = this.track.nearest(this.curr.p.x, this.curr.p.z, this.hint);
    const s = near.s - 5;
    const p = this.track.pointAt(s, Math.max(-3, Math.min(3, near.lateral)));
    this.car.place(p.x, p.y, p.z, this.track.headingAt(s));
    this.jets.reset();
    this.skids.clear();
    const fc = this.fun?.player;
    if (fc) this.fun!.teleported(fc);
    this.rig.reset();
    this.snapshot(this.curr); this.snapshot(this.prev);
  }

  private handleActions() {
    // Esc: back out of a menu screen first, otherwise pause or resume
    if (input.consume('pause') && !this.menu.back()) this.togglePause();
    if (input.consume('help')) this.hud.help.classList.toggle('hidden');
    if (input.consume('camera')) { this.rig.next(); settings.camera = this.rig.mode; saveSettings(); this.hud.message(`Camera: ${this.rig.mode}`, 1.2); }
    if (input.consume('paint')) {
      this.model.nextPaint(); garage.paint = this.paintIndex; saveGarage(); applyFinish(this.model.paint, garage.finish);
      this.hud.message(this.model.paintName, 1.4); this.party?.setProfile({ paint: this.paintIndex });
    }
    if (input.consume('item')) this.useItem();
    if (input.consume('time')) { this.todIndex = (this.todIndex + 1) % TIMES.length; this.buildEnvironment(); this.hud.message(`Time of day: ${TIMES[this.todIndex]}`, 1.4); }
    if (input.consume('mute')) { settings.sound = !audio.toggleMute(); saveSettings(); this.hud.message(settings.sound ? 'Sound on' : 'Sound off', 1.2); }
    if (input.consume('reset') && this.phase === 'driving' && !this.paused) {
      if (!this.tow?.holding) this.callTow('Tow on the way!');
    }
    for (const [a, h] of [['assist1', 'easy'], ['assist2', 'medium'], ['assist3', 'off']] as const) {
      if (input.consume(a)) { this.setHelp(h); settings.help = h; saveSettings(); this.hud.message(`Driving help: ${HELP_LABEL[h]}`, 1.4); }
    }
  }

  /** Fun Mode: use the item you hold */
  useItem() {
    const fc = this.fun?.player;
    if (fc && this.phase === 'driving' && !this.paused && this.fun!.useItem(fc)) audio.hop();
  }

  private physicsStep() {
    const dt = PHYSICS_DT;
    const pos = this.car.body.translation();
    const near = this.track.nearest(pos.x, pos.z, this.hint, 20);
    this.hint = near.i;
    this.kerb = updateSurface(this.car, this.track, this.hint);
    let inp: DriveInput = { ...this.inp, hop: this.hopQueued, sidePress: this.sideQueued };
    this.hopQueued = false; this.sideQueued = 0;
    const moving = this.phase === 'driving' || this.phase === 'finished';
    if (this.pilot && moving) inp = { ...this.pilot.drive(this.car, near.i, near.s, dt), lookBack: false, boost: false, hop: false, hover: false, side: 0, sidePress: 0, pitch: 0 };
    if (!moving) inp = { steer: 0, throttle: 0, brake: 0, handbrake: true, lookBack: false, boost: false, hop: false, hover: false, side: 0, sidePress: 0, pitch: 0 };
    // while the tow has the car, it goes where the tow takes it
    const held = this.tow ? this.stepTow(dt) : false;
    if (!held) {
      this.damage.applyTo(this.car);
      const assisted = applyDrivingHelp(this.help, inp, this.car);
      this.car.step(assisted);
      // in the air the raw sticks drive the attitude jets (the driving help only shapes steering)
      // no thrusters in a license test: it's about the driving
      const jetsOn = !this.test;
      this.jets.step(this.car, inp, { boost: jetsOn && inp.boost, hop: jetsOn && inp.hop, airRoll: jetsOn && inp.handbrake, pitch: inp.pitch,
        hover: jetsOn && inp.hover, side: jetsOn ? inp.side : 0, sidePress: jetsOn ? inp.sidePress : 0 }, dt, this.help !== 'off');
      this.frameEvents.push(...this.jets.events);
    }
    if (this.jets.hopped) this.frameHop = true;
    const funMe = this.fun?.player;
    if (funMe) this.fun!.preStep(funMe, dt);
    this.race?.stepRivals(dt);
    this.world.step();
    this.simTime += dt;

    this.canisters.step(dt);
    const p = this.car.body.translation();
    const got = this.canisters.collect(p.x, p.y, p.z);
    if (got) { this.jets.refill(got * CANISTER_AIR); this.frameAir += got * CANISTER_AIR; }
    if (this.race) {
      this.race.afterStep(dt);
      this.fun?.afterStep(dt, this.race.running && (this.phase === 'driving' || this.phase === 'finished'));
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
        if (this.bestLap === null || t < this.bestLap) { this.bestLap = t; store()?.setItem(`rd-best-${this.cls}`, String(t)); this.hud.message('Best lap!', 2.5); }
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
    if (this.test) this.stepTest(near.lateral, s);

    // flipped, wrecked or far off the map: the tow comes to put the car back
    if (held) return;
    if (this.car.axes().up.y < 0.25 && Math.abs(this.car.speed) < 4) this.flipT += dt; else this.flipT = 0;
    if (this.damage.wrecked) this.wreckT += dt;
    if (this.flipT > 1.5 || pos.y < -50 || near.dist > this.track.wallOffset + 40 || this.wreckT > 2.5 || (this.wreckT > 0.8 && Math.abs(this.car.speed) < 3)) {
      this.callTow(this.damage.wrecked ? 'Wrecked! Tow on the way' : this.flipT > 1.5 ? 'Tow on the way!' : 'Lost? Tow on the way!');
    }
  }

  frame(now = performance.now()) {
    // a frame timestamp can predate a long task (such as building the world): never step backwards
    const dt = Math.max(0, Math.min(0.1, (now - this.last) / 1000));
    this.last = now;
    this.handleActions();
    this.inp = input.poll(dt);
    if (this.inp.hop) this.hopQueued = true;
    if (this.inp.sidePress) this.sideQueued = this.inp.sidePress;

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
    this.effects(dt);
    if (this.fun) this.funFrame(dt);
    if (this.frameHop || this.frameEvents.includes('dodge')) audio.hop();
    if (this.frameAir > 0) { audio.pickup(); this.hud.airGained(this.frameAir); }
    for (const ev of this.frameEvents) { const m = JET_MESSAGES[ev]; if (m) this.hud.message(m[0], m[1]); }
    const jetKick = this.frameEvents.some(e => e === 'dodge' || e === 'launch');
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
    this.crashFrame(dt, jetKick);
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
      // slow orbit around the car on the grid (closer in the garage, with the car beside the panel)
      this.titleAngle += dt * (this.garageOpen ? 0.12 : 0.18);
      const r = this.garageOpen ? 6 : 7.5, a = e.y + 2.4 + this.titleAngle;
      this.rig.cam.position.set(focus.x + Math.sin(a) * r, focus.y + (this.garageOpen ? 1.6 : 1.3), focus.z + Math.cos(a) * r);
      this.rig.cam.lookAt(focus.x, focus.y + 0.2, focus.z);
      if (this.garageOpen && innerWidth > 700) this.rig.cam.translateX(-1.9);
    } else this.rig.update(focus, dt, this.inp.lookBack);
    if (this.tow?.holding) this.towScene.camera(this.rig.cam, dt);
    this.towFrame(dt);
    if (this.debugCam) { this.rig.cam.position.set(...this.debugCam.pos); this.rig.cam.lookAt(...this.debugCam.target); }
    this.env.follow(focus.x, focus.y, focus.z);
    const friends = this.party && this.netRace ? this.netFrame(dt) : [];
    this.probe?.update(this.renderer.gl, this.scene, new THREE.Vector3(focus.x, focus.y + 0.35, focus.z), root,
      () => this.env.setProbeMode(true), () => this.env.setProbeMode(false));

    const slip = Math.max(...this.car.wheels.map(w => w.slip));
    audio.update(this.car.speed, Math.max(-1, Math.min(1, this.car.powerKw / 300)), slip, this.kerb, this.paused || this.phase === 'title');
    // the tow car's hover jets are heard too, louder the closer it is
    const towJets = this.tow && !this.tow.done ? 0.8 * Math.max(0, 1 - this.tow.pos.distanceTo(this.rig.cam.position) / 45) : 0;
    audio.jets(Math.max(this.jets.boosting ? 1 : 0, nearBoost * 0.45, towJets), this.jets.attitude, this.jets.tank, this.paused || this.phase === 'title');
    this.hud.setAir(this.jets.tank, this.jets.boosting, this.jets.hopCooldown <= 0 && this.jets.tank >= 0.1, dt);
    // the gear number on a gearbox car; a one-speed EV shows D, and R when backing up
    const gear = this.car.speed < -0.5 ? 'R' : this.car.gear ? String(this.car.gear) : 'D';
    if (input.touch) this.touch.show(gear, this.car.motorRpm, Math.abs(this.car.speed) * 3.6, this.car.tyreTemp);
    this.hud.update(dt, {
      speed: this.car.speed, powerKw: this.car.powerKw, lap: this.lap,
      current: this.lapStart !== null ? this.simTime - this.lapStart : null, last: this.lastLap, best: this.bestLap,
      x: focus.x, z: focus.z, heading: e.y, help: HELP_LABEL[this.help], paint: garage.paint < 0 ? 'Custom paint' : this.model.paintName,
      steer: this.inp.steer, gear, rpm: this.car.motorRpm, tyres: this.car.tyreTemp,
      others: [...this.rivals.map(r => ({ x: r.model.root.position.x, z: r.model.root.position.z, color: css(PAINTS[r.e.paint].color) })), ...friends],
    });
    if (this.test) {
      const t = this.test, test = licenseById(t.id).tests[t.k];
      this.hud.setTest({ name: test.name, time: t.over ? t.time : this.phase === 'driving' ? this.simTime - this.trialStart : null,
        medals: MEDALS.map(m => medalTime(test, m)), done: t.prog.dist / t.prog.length });
    }
    this.renderer.render(this.scene, this.rig.cam);
  }

  /** realism: tyre smoke from sliding tyres, dust off the grass, sparks when the car bottoms out
   *  on a landing or scrapes a wall, and a call-out in someone's slipstream */
  private effects(dt: number) {
    this.smokeAcc += dt;
    const emit = this.smokeAcc > 1 / 40;
    if (emit) this.smokeAcc = 0;
    const cars = [{ car: this.car, root: this.model.root }, ...this.rivals.map(r => ({ car: r.e.car, root: r.model.root }))];
    if (emit) for (const { car, root } of cars) {
      if (root.position.distanceToSquared(this.rig.cam.position) > 120 * 120) continue;
      const v = car.body.linvel();
      car.wheels.forEach((w, i) => {
        if (!w.contact) return;
        const p = w.contactPoint, speed = Math.abs(car.speed);
        if (w.slip > 0.45 && speed > 3) this.smoke.puff(p.x, p.y + 0.15, p.z, v.x * 0.25, 0.5, v.z * 0.25, 0.5 + w.slip * 0.5, 1.6, TYRE_SMOKE, 0.12 + w.slip * 0.22);
        if (car.surface[i] < 0.95 && speed > 6) this.smoke.puff(p.x, p.y + 0.1, p.z, v.x * 0.3, 0.8, v.z * 0.3, 0.45, 1.1, GRASS_DUST, Math.min(0.35, speed / 90));
      });
    }
    // a hard landing scrapes the floor; a wall hit throws sparks off the side
    const impact = this.car.impact;
    if (this.wasAirborne && !this.car.airborne) {
      const v = this.car.body.linvel(), p = this.model.root.position;
      if (Math.abs(v.y) > 3 || impact > 4) this.sparks.burst(p.x, p.y - 0.25, p.z, -v.x * 0.03, 0.3, -v.z * 0.03, 40, Math.max(4, Math.hypot(v.x, v.z) * 0.25));
    } else if (impact > 4 && Math.abs(this.car.speed) > 8) {
      const p = this.model.root.position, { right } = this.car.axes();
      const side = this.car.latAccel > 0 ? -1 : 1;
      this.sparks.burst(p.x + right.x * side, p.y, p.z + right.z * side, right.x * side * 0.4, 0.4, right.z * side * 0.4, 30, 6);
    }
    this.wasAirborne = this.car.airborne;
    this.sparks.update(dt, this.rig.cam, this.renderer.gl.domElement.height);
    this.smoke.update(dt, this.rig.cam, this.renderer.gl.domElement.height);
    // a tow in someone's slipstream
    if (this.phase === 'driving' && this.car.draft > 0.45) { this.slipT += dt; if (this.slipT > 0.7 && this.slipT - dt <= 0.7) this.hud.message('Slipstream', 1); }
    else this.slipT = 0;
  }

  /** Fun Mode each frame: messages and sounds for the player, embers, soot, the HUD panel */
  private funFrame(dt: number) {
    const fun = this.fun!, me = fun.player;
    const night = this.env.preset.night;
    this.funScene?.update(dt, this.rig.cam, this.renderer.gl.domElement.height, night);
    for (const fc of fun.cars) {
      for (const ev of fc.events) {
        if (ev.kind === 'ring' && ev.ring) this.funScene?.embers(ev.ring, (x, y, z, dx, dy, dz, n, sp) => this.sparks.burst(x, y, z, dx, dy, dz, n, sp));
        if (fc !== me) continue;
        if (ev.kind === 'ring') { audio.whoosh(); this.rig.kick(0.3); }
        else if (ev.kind === 'singed') audio.impact(5);
        else if (ev.kind === 'pad' || ev.kind === 'box') audio.pickup();
        else if (ev.kind === 'spun') audio.impact(7);
        else if (ev.kind === 'mega') audio.hop();
        if (ev.text) this.hud.message(ev.text, ev.kind === 'pad' ? 0.8 : 1.6);
      }
      fc.events.length = 0;
    }
    // soot on the paint of anyone who brushed the flames
    if (me) this.model.setSoot(me.soot);
    for (const r of this.rivals) r.model.setSoot(this.funCars.get(r.e)?.soot ?? 0);
    // the roar of the nearest ring
    const cam = this.rig.cam.position;
    let near = Infinity;
    for (const r of fun.layout.rings) near = Math.min(near, Math.hypot(r.x - cam.x, r.y - cam.y, r.z - cam.z));
    audio.fire(this.paused || this.phase === 'title' ? 0 : Math.max(0, 1 - near / 40));
    if (me) {
      this.hud.setFun({ icon: me.item ? ITEM_ICON[me.item] : '', name: me.item ? ITEM_LABEL[me.item] : 'No item', charges: me.charges, stunt: me.stunt, rings: me.rings });
      this.touch.setItem(me.item ? ITEM_ICON[me.item] : null);
    }
  }

  private updateRaceHud(dt: number) {
    const race = this.race!, me = race.player;
    if (this.phase === 'finished') {
      this.finishT += dt;
      if (this.finishT > 2 && !this.standingsShown && (!this.resultsShown || this.resultsPending && Math.floor(this.finishT) !== Math.floor(this.finishT - dt))) this.showResults();
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
        return { pos: e.pos, name: e.name, color: e === me ? this.playerCss : css(PAINTS[e.paint].color), you: e === me, gap };
      }),
    });
  }

  private showResults() {
    const race = this.race!, order = race.standings, lead = order[0];
    const est = (e: Entrant) => e.estimated ? ' (est.)' : '';
    const stunt = (e: Entrant) => { const fc = this.funCars.get(e); return fc ? `${fc.stunt.toLocaleString('en-US')} pts` : ''; };
    const rows = order.map(e => ({
      pos: e.pos, name: e.name, you: e === race.player, best: this.fun ? stunt(e) : `best ${formatTime(e.bestLap)}`,
      time: !e.finished ? 'racing…' : e === lead ? formatTime(e.finishTime) + est(e) : `+${(e.finishTime! - lead.finishTime!).toFixed(3)}${est(e)}`,
    }));
    const me = race.player.pos;
    this.resultsPending = order.some(e => !e.finished);
    let note = order.some(e => e.estimated) ? 'Session finished early: times for drivers still racing are estimates.' : '';
    const fc = this.fun?.player;
    if (fc) {
      const key = `rd-fun-best-${this.cls}`, best = Number(store()?.getItem(key) ?? 0);
      if (fc.stunt > best && !this.resultsShown) store()?.setItem(key, String(fc.stunt));
      const top = [...this.funCars.values()].sort((a, b) => b.stunt - a.stunt)[0];
      note = `Stunt points ${fc.stunt.toLocaleString('en-US')}${fc.stunt > best ? ' (your best!)' : ` · best ${best.toLocaleString('en-US')}`} · rings of fire ${fc.rings} · longest jump ${fc.bestAir.toFixed(1)} s`
        + (top && top !== fc ? ` · stunt king: ${top.name}` : '') + (note ? `. ${note}` : '');
    }
    this.hud.showResults(me === 1 ? 'YOU WIN' : `P${me}`, this.fun ? 'FUN MODE RESULTS' : 'RESULTS', rows, this.afterActions(), note);
    this.resultsShown = true;
  }

  /** the buttons under the results */
  private afterActions() {
    if (this.champ && this.session === 'race') return [{ label: 'Standings', primary: true, run: () => this.champRoundDone() }, { label: 'Retry round', run: () => this.restart() }];
    const w = this.weekend;
    if (w?.stage === 'practice') return [{ label: 'Go to qualifying', primary: true, run: () => this.weekendStage(w, 'qualifying') }, { label: 'More practice', run: () => this.restart() }];
    const again = this.session === 'race' ? 'Race again' : this.session === 'timetrial' ? 'Try again' : 'Drive again';
    return [{ label: again, primary: true, run: () => this.restart() }, { label: 'Menu', run: () => this.quitToMenu() }];
  }

  /** time trial over: total time and every lap */
  private finishTrial() {
    this.phase = 'finished';
    this.pilot = new Autopilot(this.track);
    if (this.weekend?.stage === 'qualifying') this.showQualifying(); else this.showTrialResults(false);
  }

  /** the laps of a time trial or practice; `early` when the session was finished from the pause menu */
  private showTrialResults(early: boolean) {
    const laps = this.lapTimes, best = Math.min(...laps);
    const rows = laps.map((t, k) => ({ pos: k + 1, name: `Lap ${k + 1}`, time: formatTime(t), best: t === best ? 'best' : '', you: t === best }));
    let title: string, note = '';
    if (this.session === 'timetrial' && !early) {
      const total = this.simTime - this.trialStart;
      const key = `rd-trial-${this.cls}-${this.trialLaps}`;
      const record = Number(store()?.getItem(key) ?? 0);
      title = formatTime(total);
      if (!record || total < record) { store()?.setItem(key, String(total)); note = record ? `New record! ${(record - total).toFixed(3)} s faster than before.` : 'Your first record.'; }
      else note = `Record ${formatTime(record)} (+${(total - record).toFixed(3)} s)`;
    } else {
      title = laps.length ? `Best ${formatTime(best)}` : 'No laps';
      note = `${laps.length} lap${laps.length === 1 ? '' : 's'} completed`;
    }
    this.hud.showResults(title, this.session === 'timetrial' ? 'TIME TRIAL' : this.weekend ? 'WEEKEND PRACTICE' : 'PRACTICE', rows, this.afterActions(), note);
    this.resultsShown = true;
  }

  run() {
    // the next frame is booked first, so an error in one frame can never stop the game for good
    let errors = 0;
    const loop = (t: number) => {
      requestAnimationFrame(loop);
      try { this.frame(t); }
      catch (e) {
        if (errors++ % 300 === 0) console.error(e);
        showErrorBanner(String((e as Error)?.message ?? e));
      }
    };
    requestAnimationFrame(loop);
  }
}
