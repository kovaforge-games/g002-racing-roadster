// The menus: the home screen with every mode, the race setup screen, settings, and the pause
// menu. The party screens live in partyUi.ts; their buttons sit on the home screen.
import { h } from './dom';
import { settings, setup, saveSettings, saveSetup, funSetup, saveFunSetup, type SessionMode, type RaceSetup } from '../core/settings';
import { garageCard } from './garage';
import { DIFFICULTIES, DIFFICULTY_ORDER } from '../sim/rival';
import { MAX_OPPONENTS } from '../sim/race';
import { CAMERA_ORDER } from '../render/cameras';
import type { TimeOfDay } from '../render/environment';
import { TouchControls } from './touch';
import { CLASSES, CLASS_ORDER, type ClassId } from '../sim/classes';
import { ownsCar, progress, hasLicense } from '../core/progress';
import { LICENSES, MEDALS, medalTime, passes } from '../sim/licenses';
import { CHAMPIONSHIPS, CHAMP_OPPONENTS as CHAMP_FIELD, REWARD_PLACE, newRun, standings, type ChampRun } from '../sim/championship';

/** what the menus need from the game */
export interface MenuGame {
  /** start a session with the current race setup */
  startSession(mode: SessionMode): void;
  /** race the next round of a championship */
  startChampionship(run: ChampRun): void;
  /** drive test k of a license */
  startLicenseTest(id: string, k: number): void;
  /** practice, qualifying and a race with this setup */
  startWeekend(s: RaceSetup): void;
  /** a Fun Mode race: ramps, rings of fire, boost pads and items */
  startFunMode(s: RaceSetup, opts: { rings: boolean; ramps: boolean; items: boolean }): void;
  /** the garage screen opened or closed */
  garageView(on: boolean): void;
  /** the garage changed the car */
  applyGarage(): void;
  /** the pause menu's Finish session button (in a race weekend it moves on to the next session) */
  readonly finishLabel: string;
  resume(): void;
  /** the on-screen pause button and Esc: pause or resume (in a party, open or close the menu) */
  togglePause(): void;
  restart(): void;
  finishSession(): void;
  quitToMenu(): void;
  /** driving help, camera and sound changed */
  applySettings(): void;
  readonly inParty: boolean;
  leaveParty(): void;
  readonly trackName: string;
}

const TODS: [TimeOfDay, string][] = [['morning', 'Morning'], ['noon', 'Noon'], ['sunset', 'Sunset'], ['night', 'Night']];
const HELP: [typeof settings.help, string, string][] = [
  ['easy', 'Easy', 'Catches slides, traction control and ABS on.'],
  ['medium', 'Medium', 'Less help with slides, traction control and ABS on.'],
  ['off', 'Off', 'No help at all.'],
];
const CAMERA_LABEL: Record<string, string> = { chase: 'Chase', far: 'Far chase', hood: 'Hood', bumper: 'Bumper' };
const CONTROLS: [typeof settings.controls, string][] = [['auto', 'Auto'], ['touch', 'Touch'], ['keyboard', 'Keyboard']];
const STEERING: [typeof settings.steering, string, string][] = [
  ['slider', 'Slider', 'Slide your thumb left and right; let go to straighten up.'],
  ['buttons', 'Buttons', 'Hold the left and right buttons.'],
  ['tilt', 'Tilt', 'Tilt the iPad like a steering wheel. Hold it how you like at the start: that is straight ahead.'],
];
const QUALITY: [typeof settings.quality, string][] = [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']];

const MODES: { id: string; name: string; about: string }[] = [
  { id: 'quick', name: 'Quick Race', about: 'Jump straight into a race against the bots' },
  { id: 'fun', name: 'Fun Mode', about: 'Ramps, rings of fire, boost pads and items' },
  { id: 'garage', name: 'Garage', about: 'Paint, livery, number, rims and parts' },
  { id: 'weekend', name: 'Race Weekend', about: 'Practice, qualifying, then the race' },
  { id: 'championship', name: 'Championship', about: 'Win races and earn faster classes' },
  { id: 'licenses', name: 'Licenses', about: 'Drive from A to B inside the target times' },
  { id: 'timetrial', name: 'Time Trial', about: 'Just you and the clock' },
  { id: 'practice', name: 'Practice', about: 'Free driving, no pressure' },
  { id: 'replays', name: 'Replays', about: 'Watch your races again' },
  { id: 'settings', name: 'Settings', about: 'Controls, camera, graphics and sound' },
];
/** modes still being built: what the screen says about them */
const SOON: Record<string, string> = {
  replays: 'Every race saved so you can watch it again from any camera.',
};

/** a row of choices, one of them picked */
export function segmented<T extends string>(options: [T, string][], value: T, pick: (v: T) => void) {
  const row = h('div', { class: 'seg', role: 'radiogroup' });
  for (const [v, label] of options) {
    const b = h('button', { class: `seg-btn${v === value ? ' on' : ''}`, role: 'radio', 'aria-checked': String(v === value), onclick: () => {
      row.querySelectorAll('.seg-btn').forEach(x => { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); });
      b.classList.add('on'); b.setAttribute('aria-checked', 'true');
      pick(v);
    } }, label);
    row.append(b);
  }
  return row;
}

/** − n + */
export function stepper(value: number, min: number, max: number, change: (v: number) => void, label: string) {
  let v = value;
  const out = h('b', { 'aria-live': 'polite' }, String(v));
  const minus = h('button', { class: 'btn step', 'aria-label': `Fewer ${label}` }, '−') as HTMLButtonElement;
  const plus = h('button', { class: 'btn step', 'aria-label': `More ${label}` }, '+') as HTMLButtonElement;
  const set = (n: number) => { v = Math.max(min, Math.min(max, n)); out.textContent = String(v); minus.disabled = v <= min; plus.disabled = v >= max; change(v); };
  minus.onclick = () => set(v - 1); plus.onclick = () => set(v + 1);
  minus.disabled = v <= min; plus.disabled = v >= max;
  return h('div', { class: 'stepper' }, minus, out, plus);
}

const TOD_LABEL: Record<TimeOfDay, string> = Object.fromEntries(TODS) as Record<TimeOfDay, string>;
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

export const field = (label: string, ...kids: (Node | null)[]) => h('div', { class: 'field' }, h('div', { class: 'field-label' }, label), ...kids);

export class Menu {
  private view = h('div', { class: 'menu', 'data-ui': true });
  private pauseView = h('div', { class: 'menu pause-menu', 'data-ui': true });
  /** back from the current screen (Esc), or null on the home screen */
  private backFn: (() => void) | null = null;
  readonly pauseButton = h('button', { class: 'pause-btn', 'data-ui': true, 'aria-label': 'Pause' }, h('span', null), h('span', null));

  constructor(private game: MenuGame, private title: HTMLElement, private pause: HTMLElement, private partyButtons: HTMLElement) {
    title.querySelector('.tag')?.after(this.view);
    pause.replaceChildren(this.pauseView);
    pause.setAttribute('data-ui', '');
    this.pauseButton.addEventListener('click', () => this.game.togglePause());
    document.body.append(this.pauseButton);
    addEventListener('keydown', e => this.key(e));
    this.home();
  }

  private screen(back: (() => void) | null, ...kids: Node[]) {
    this.backFn = back;
    this.view.replaceChildren(...kids);
    this.title.classList.toggle('sub', !!back);
    (this.view.querySelector('[autofocus]') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  home() {
    const tiles = h('div', { class: 'tiles' }, ...MODES.map((m, k) => h('button', { class: `tile tile-${m.id}`, ...(k === 0 ? { autofocus: true } : {}), onclick: () => this.open(m.id) },
      h('span', { class: 'tile-name' }, m.name), h('span', { class: 'tile-about' }, m.about))));
    this.screen(null, tiles, this.partyButtons);
  }

  private open(id: string) {
    if (id === 'quick') this.setupScreen('race');
    else if (id === 'fun') this.setupScreen('fun');
    else if (id === 'garage') this.garage();
    else if (id === 'weekend') this.setupScreen('weekend');
    else if (id === 'timetrial') this.setupScreen('timetrial');
    else if (id === 'practice') this.setupScreen('practice');
    else if (id === 'championship') this.championships();
    else if (id === 'licenses') this.licenses();
    else if (id === 'settings') this.screen(() => this.home(), this.settingsCard(() => this.home()));
    else {
      const m = MODES.find(x => x.id === id)!;
      this.screen(() => this.home(), h('div', { class: 'card' },
        h('h2', null, m.name), h('p', { class: 'dim' }, SOON[id]), h('p', { class: 'soon' }, 'Coming in the next update'),
        h('div', { class: 'row' }, h('button', { class: 'btn big', autofocus: true, onclick: () => this.home() }, 'Back'))));
    }
  }

  /** before a session: time of day, and for races the difficulty, opponents and laps */
  setupScreen(mode: SessionMode | 'weekend' | 'fun') {
    const name = mode === 'race' ? 'Quick Race' : mode === 'weekend' ? 'Race Weekend' : mode === 'fun' ? 'Fun Mode' : mode === 'timetrial' ? 'Time Trial' : 'Practice';
    const race = mode === 'race' || mode === 'weekend' || mode === 'fun';
    const fun = mode === 'fun';
    // in Fun Mode every car is available, as in g001
    const owns = (c: ClassId) => fun || ownsCar(c);
    const about = h('div', { class: 'field-about' }, DIFFICULTIES[setup.difficulty].about);
    if (!owns(setup.cls)) setup.cls = 'rental';
    const start = () => {
      saveSetup();
      if (mode === 'weekend') this.game.startWeekend(setup);
      else if (mode === 'fun') { saveFunSetup(); this.game.startFunMode(setup, { ...funSetup }); }
      else this.game.startSession(mode);
    };
    const startBtn = h('button', { class: 'btn big primary start', autofocus: true, onclick: start }, mode === 'practice' ? 'Drive' : 'Start') as HTMLButtonElement;
    // the car: a locked class shows how to earn it, and can't be started
    const carAbout = h('div', { class: 'field-about class-about' });
    const showClass = (c: ClassId) => {
      const k = CLASSES[c], owned = owns(c);
      carAbout.replaceChildren(k.about, owned ? '' : h('b', { class: 'locked-note' }, ` Locked: ${k.unlock}`));
      startBtn.disabled = !owned;
      if (owned) setup.cls = c;
    };
    const carField = field('Car', segmented(CLASS_ORDER.map(c => [c, `${owns(c) ? '' : '🔒 '}${CLASSES[c].name}`]), setup.cls, showClass), carAbout);
    const onOff = (label: string, key: keyof typeof funSetup, about: string) => field(label,
      segmented([['on', 'On'], ['off', 'Off']], funSetup[key] ? 'on' : 'off', v => { funSetup[key] = v === 'on'; }), h('div', { class: 'field-about' }, about));
    showClass(setup.cls);
    this.screen(() => this.home(), h('div', { class: 'card setup' },
      h('h2', null, name),
      h('div', { class: 'track-line' }, h('span', { class: 'dim' }, 'Track'), h('b', null, this.game.trackName)),
      carField,
      field('Time of day', segmented(TODS, setup.tod, v => { setup.tod = v; })),
      mode === 'weekend' ? h('p', { class: 'dim' }, 'Free practice to learn the track, qualifying (your best lap sets your grid slot), then the race.') : null,
      fun ? h('p', { class: 'dim' }, 'Every car is yours to try. Score stunt points for big air, flips, rings of fire and slide boosts. F (or ITEM) uses an item.') : null,
      fun ? h('div', { class: 'field-pair fun-switches' },
        onOff('Rings of fire', 'rings', 'Drive through them, jump the raised ones.'),
        onOff('Ramps & pads', 'ramps', 'Red ramps, boost pads, neon borders.'),
        onOff('Item boxes', 'items', 'Turbo, Triple Turbo, Oil Slick, Mega Jump.')) : null,
      race ? field('Difficulty', segmented(DIFFICULTY_ORDER.map(d => [d, DIFFICULTIES[d].label]), setup.difficulty, v => { setup.difficulty = v; about.textContent = DIFFICULTIES[v].about; }), about) : null,
      race ? h('div', { class: 'field-pair' },
        field('Opponents', stepper(setup.opponents, 1, MAX_OPPONENTS, v => { setup.opponents = v; }, 'opponents')),
        field('Laps', stepper(setup.laps, 1, 10, v => { setup.laps = v; }, 'laps'))) : null,
      mode === 'timetrial' ? field('Laps', stepper(setup.laps, 1, 10, v => { setup.laps = v; }, 'laps')) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn big', onclick: () => this.home() }, 'Back'),
        startBtn)));
  }

  /** the garage: the car turns beside the panel while you change it */
  garage() {
    this.game.garageView(true);
    const back = () => { this.game.garageView(false); this.home(); };
    this.screen(back, garageCard(() => this.game.applyGarage(), back));
  }

  /** the championships: each one's races, what it earns, and Start or Continue */
  private championships() {
    const run = progress.run;
    const about = h('div', { class: 'field-about' }, DIFFICULTIES[setup.difficulty].about);
    const cards = CHAMPIONSHIPS.map(c => {
      const owned = ownsCar(c.cls), mine = run?.id === c.id ? run : null;
      const best = progress.champs[c.id];
      const rounds = h('ol', { class: 'rounds' }, ...c.rounds.map((r, k) => {
        const place = mine?.finishes.You?.[k];
        return h('li', { class: place ? 'done' : mine && k === mine.round ? 'next' : '' },
          h('span', null, `Round ${k + 1}`), h('span', { class: 'dim' }, `${TOD_LABEL[r.tod]} · ${r.laps} laps`), h('b', null, place ? ordinal(place) : ''));
      }));
      const status = !owned ? h('p', { class: 'locked-note' }, `🔒 Needs the ${CLASSES[c.cls].name}: ${CLASSES[c.cls].unlock}`)
        : mine ? h('p', { class: 'dim' }, `In progress: you are ${ordinal(standings(mine).findIndex(r => r.name === 'You') + 1)} with ${mine.points.You ?? 0} points.`)
        : best ? h('p', { class: 'dim' }, `Best finish: ${ordinal(best)} overall.`) : null;
      const go = (fresh: boolean) => { saveSetup(); this.game.startChampionship(fresh || !mine ? newRun(c.id, setup.difficulty) : mine); };
      const buttons = !owned ? [] : mine
        ? [h('button', { class: 'btn big primary', onclick: () => go(false) }, `Continue: round ${mine.round + 1}`), h('button', { class: 'btn big', onclick: () => go(true) }, 'Start over')]
        : [h('button', { class: 'btn big primary', onclick: () => go(true) }, 'Start')];
      return h('div', { class: `champ${owned ? '' : ' locked'}` },
        h('h3', null, c.name),
        h('p', null, `${c.rounds.length} races in the ${CLASSES[c.cls].name} against ${CHAMP_FIELD} bots. Finish in the top ${REWARD_PLACE} overall to earn the ${CLASSES[c.reward].name}.`),
        rounds, status, h('div', { class: 'row' }, ...buttons));
    });
    this.screen(() => this.home(), h('div', { class: 'card setup champs' },
      h('h2', null, 'Championship'),
      h('p', { class: 'dim' }, 'Points for the top 10 in every race: 25, 18, 15, 12, 10, 8, 6, 4, 2, 1.'),
      field('Difficulty', segmented(DIFFICULTY_ORDER.map(d => [d, DIFFICULTIES[d].label]), setup.difficulty, v => { setup.difficulty = v; about.textContent = DIFFICULTIES[v].about; }), about),
      ...cards,
      h('div', { class: 'row' }, h('button', { class: 'btn big', autofocus: true, onclick: () => this.home() }, 'Back'))));
  }

  /** the licenses: each one's five tests with your best medals; a test opens its briefing */
  licenses() {
    const cards = LICENSES.map(lic => {
      const open = !lic.needs || hasLicense(lic.needs), held = hasLicense(lic.id);
      const medals = progress.medals[lic.id] ?? [];
      const tests = h('ol', { class: 'tests' }, ...lic.tests.map((t, k) => {
        const m = medals[k];
        return h('li', null, h('button', { class: 'test-btn', disabled: !open, onclick: () => this.testBriefing(lic.id, k) },
          h('span', { class: 'test-k' }, String(k + 1)), h('span', null, t.name), h('i', { class: `medal ${m ?? 'none'}`, title: m ?? 'no medal yet' })));
      }));
      const passed = medals.filter(passes).length;
      const status = held ? h('p', { class: 'held' }, '✓ License earned')
        : !open ? h('p', { class: 'locked-note' }, `🔒 Earn the ${LICENSES.find(l => l.id === lic.needs)!.name} license first.`)
        : h('p', { class: 'dim' }, `${passed} of ${lic.tests.length} tests at silver or better.`);
      return h('div', { class: `champ${open ? '' : ' locked'}` },
        h('h3', null, `${lic.name} license`),
        h('p', null, `Five tests in the ${CLASSES[lic.cls].name}. Silver or better in all five earns the license${lic.car ? ` and the ${CLASSES[lic.car].name}` : ''}.`),
        tests, status);
    });
    this.screen(() => this.home(), h('div', { class: 'card setup champs' },
      h('h2', null, 'Licenses'),
      h('p', { class: 'dim' }, 'Drive from gate A to gate B inside the target times. No thrusters in a test, and stay on the road!'),
      ...cards,
      h('div', { class: 'row' }, h('button', { class: 'btn big', autofocus: true, onclick: () => this.home() }, 'Back'))));
  }

  private testBriefing(id: string, k: number) {
    const lic = LICENSES.find(l => l.id === id)!, t = lic.tests[k], best = progress.medals[id]?.[k];
    this.screen(() => this.licenses(), h('div', { class: 'card setup' },
      h('h2', null, `Test ${k + 1}: ${t.name}`),
      h('div', { class: 'track-line' }, h('span', { class: 'dim' }, lic.name), h('b', null, CLASSES[lic.cls].name)),
      h('p', null, t.tip),
      h('div', { class: 'targets' }, ...MEDALS.map(m => h('div', { class: `target ${m}${best === m ? ' mine' : ''}` }, h('i', { class: `medal ${m}` }), h('span', null, m.toUpperCase()), h('b', null, `${medalTime(t, m).toFixed(1)} s`)))),
      best ? h('p', { class: 'dim' }, `Your best: ${best}.`) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn big', onclick: () => this.licenses() }, 'Back'),
        h('button', { class: 'btn big primary start', autofocus: true, onclick: () => this.game.startLicenseTest(id, k) }, 'Start'))));
  }

  /** settings, from the home screen or the pause menu */
  private settingsCard(back: () => void) {
    const helpAbout = h('div', { class: 'field-about' }, HELP.find(x => x[0] === settings.help)![2]);
    const steerAbout = h('div', { class: 'field-about' }, STEERING.find(x => x[0] === settings.steering)![2]);
    const startQuality = settings.quality;
    const reload = h('div', { class: 'field-about reload hidden' }, 'Graphics change when the game reloads. ',
      h('button', { class: 'btn', onclick: () => location.reload() }, 'Reload now'));
    const change = () => { saveSettings(); this.game.applySettings(); };
    return h('div', { class: 'card settings' },
      h('h2', null, 'Settings'),
      field('Driving help', segmented(HELP.map(([v, l]) => [v, l]), settings.help, v => { settings.help = v; helpAbout.textContent = HELP.find(x => x[0] === v)![2]; change(); }), helpAbout),
      field('Camera', segmented(CAMERA_ORDER.map(c => [c, CAMERA_LABEL[c]]), settings.camera, v => { settings.camera = v; change(); })),
      field('Touch controls', segmented(CONTROLS, settings.controls, v => { settings.controls = v; change(); }),
        h('div', { class: 'field-about' }, 'Auto shows the pedals and steering on an iPad or phone.')),
      field('Steering', segmented(STEERING.map(([v, l]) => [v, l]), settings.steering, async v => {
        steerAbout.textContent = STEERING.find(x => x[0] === v)![2];
        // tilting needs permission on iPad, asked from this tap
        if (v === 'tilt' && !(await TouchControls.askTilt())) { steerAbout.textContent = 'Tilt needs motion access: allow it when asked, or pick Slider or Buttons.'; return; }
        settings.steering = v; change();
      }), steerAbout),
      field('Graphics', segmented(QUALITY, settings.quality, v => { settings.quality = v; reload.classList.toggle('hidden', v === startQuality); change(); }), reload),
      field('Sound', segmented([['on', 'On'], ['off', 'Off']], settings.sound ? 'on' : 'off', v => { settings.sound = v === 'on'; change(); })),
      h('div', { class: 'row' }, h('button', { class: 'btn big', autofocus: true, onclick: back }, 'Back')));
  }

  // ---- pause menu

  /** solo: Resume, Restart, Finish session, Settings, Quit to menu */
  showPause() {
    this.pauseBack = null;
    if (this.game.inParty) {
      this.pauseView.replaceChildren(h('div', { class: 'card' },
        h('h2', null, 'Menu'), h('p', { class: 'dim' }, 'The race keeps going while this is open.'),
        h('div', { class: 'pause-list' },
          h('button', { class: 'btn big primary', autofocus: true, onclick: () => this.game.togglePause() }, 'Back to the race'),
          h('button', { class: 'btn big', onclick: () => this.pauseSettings() }, 'Settings'),
          h('button', { class: 'btn big', onclick: () => this.game.leaveParty() }, 'Leave party'))));
    } else {
      this.pauseView.replaceChildren(h('div', { class: 'card' },
        h('h2', null, 'Paused'),
        h('div', { class: 'pause-list' },
          h('button', { class: 'btn big primary', autofocus: true, onclick: () => this.game.resume() }, 'Resume'),
          h('button', { class: 'btn big', onclick: () => this.game.restart() }, 'Restart'),
          h('button', { class: 'btn big', onclick: () => this.game.finishSession() }, this.game.finishLabel),
          h('button', { class: 'btn big', onclick: () => this.pauseSettings() }, 'Settings'),
          h('button', { class: 'btn big', onclick: () => this.game.quitToMenu() }, 'Quit to menu'))));
    }
    (this.pauseView.querySelector('[autofocus]') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  private pauseBack: (() => void) | null = null;
  private pauseSettings() {
    this.pauseBack = () => this.showPause();
    this.pauseView.replaceChildren(this.settingsCard(() => this.showPause()));
    (this.pauseView.querySelector('[autofocus]') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  /** Esc: back from a sub-screen (of the home screen, or settings in the pause menu); false if
   *  there was nowhere to go back to */
  back() {
    const onPause = !this.pause.classList.contains('hidden');
    const onTitle = !this.title.classList.contains('hidden');
    const fn = onPause ? this.pauseBack : onTitle ? this.backFn : null;
    fn?.();
    return !!fn;
  }

  private key(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement) return;
    const onTitle = !this.title.classList.contains('hidden');
    const onPause = !this.pause.classList.contains('hidden');
    // arrow keys move between the buttons on screen
    const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.code];
    const root = onPause ? this.pauseView : onTitle ? this.view : null;
    if (!dir || !root) return;
    const list = [...root.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    list[(at + dir + list.length) % list.length]?.focus();
  }
}
