// The menus: the home screen with every mode, the race setup screen, settings, and the pause
// menu. The party screens live in partyUi.ts; their buttons sit on the home screen.
import { h } from './dom';
import { settings, setup, saveSettings, saveSetup, type SessionMode } from '../core/settings';
import { DIFFICULTIES, DIFFICULTY_ORDER } from '../sim/rival';
import { MAX_OPPONENTS } from '../sim/race';
import { CAMERA_ORDER } from '../render/cameras';
import type { TimeOfDay } from '../render/environment';
import { TouchControls } from './touch';
import { CLASSES, CLASS_ORDER, type ClassId } from '../sim/classes';
import { ownsCar } from '../core/progress';

/** what the menus need from the game */
export interface MenuGame {
  /** start a session with the current race setup */
  startSession(mode: SessionMode): void;
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
  weekend: 'A full weekend at one track: a practice session, qualifying to set your grid slot, then the race.',
  championship: 'Start in the Rental car and race your way up: win 3 races to earn 0x2.5, then 4 more to earn 0x3.5.',
  licenses: 'National B, National A and International A: five A-to-B tests each in the 0x1.5, 0x2.5 and 0x3.5 cars. Silver in every test earns the license.',
  replays: 'Every race saved so you can watch it again from any camera.',
};

/** a row of choices, one of them picked */
function segmented<T extends string>(options: [T, string][], value: T, pick: (v: T) => void) {
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
function stepper(value: number, min: number, max: number, change: (v: number) => void, label: string) {
  let v = value;
  const out = h('b', { 'aria-live': 'polite' }, String(v));
  const minus = h('button', { class: 'btn step', 'aria-label': `Fewer ${label}` }, '−') as HTMLButtonElement;
  const plus = h('button', { class: 'btn step', 'aria-label': `More ${label}` }, '+') as HTMLButtonElement;
  const set = (n: number) => { v = Math.max(min, Math.min(max, n)); out.textContent = String(v); minus.disabled = v <= min; plus.disabled = v >= max; change(v); };
  minus.onclick = () => set(v - 1); plus.onclick = () => set(v + 1);
  minus.disabled = v <= min; plus.disabled = v >= max;
  return h('div', { class: 'stepper' }, minus, out, plus);
}

const field = (label: string, ...kids: (Node | null)[]) => h('div', { class: 'field' }, h('div', { class: 'field-label' }, label), ...kids);

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
    else if (id === 'timetrial') this.setupScreen('timetrial');
    else if (id === 'practice') this.setupScreen('practice');
    else if (id === 'settings') this.screen(() => this.home(), this.settingsCard(() => this.home()));
    else {
      const m = MODES.find(x => x.id === id)!;
      this.screen(() => this.home(), h('div', { class: 'card' },
        h('h2', null, m.name), h('p', { class: 'dim' }, SOON[id]), h('p', { class: 'soon' }, 'Coming in the next update'),
        h('div', { class: 'row' }, h('button', { class: 'btn big', autofocus: true, onclick: () => this.home() }, 'Back'))));
    }
  }

  /** before a session: time of day, and for races the difficulty, opponents and laps */
  setupScreen(mode: SessionMode) {
    const name = mode === 'race' ? 'Quick Race' : mode === 'timetrial' ? 'Time Trial' : 'Practice';
    const about = h('div', { class: 'field-about' }, DIFFICULTIES[setup.difficulty].about);
    if (!ownsCar(setup.cls)) setup.cls = 'rental';
    const start = () => { saveSetup(); this.game.startSession(mode); };
    const startBtn = h('button', { class: 'btn big primary start', autofocus: true, onclick: start }, mode === 'practice' ? 'Drive' : 'Start') as HTMLButtonElement;
    // the car: a locked class shows how to earn it, and can't be started
    const carAbout = h('div', { class: 'field-about class-about' });
    const showClass = (c: ClassId) => {
      const k = CLASSES[c], owned = ownsCar(c);
      carAbout.replaceChildren(k.about, owned ? '' : h('b', { class: 'locked-note' }, ` Locked: ${k.unlock}`));
      startBtn.disabled = !owned;
      if (owned) setup.cls = c;
    };
    const carField = field('Car', segmented(CLASS_ORDER.map(c => [c, `${ownsCar(c) ? '' : '🔒 '}${CLASSES[c].name}`]), setup.cls, showClass), carAbout);
    showClass(setup.cls);
    this.screen(() => this.home(), h('div', { class: 'card setup' },
      h('h2', null, name),
      h('div', { class: 'track-line' }, h('span', { class: 'dim' }, 'Track'), h('b', null, this.game.trackName)),
      carField,
      field('Time of day', segmented(TODS, setup.tod, v => { setup.tod = v; })),
      mode === 'race' ? field('Difficulty', segmented(DIFFICULTY_ORDER.map(d => [d, DIFFICULTIES[d].label]), setup.difficulty, v => { setup.difficulty = v; about.textContent = DIFFICULTIES[v].about; }), about) : null,
      mode === 'race' ? h('div', { class: 'field-pair' },
        field('Opponents', stepper(setup.opponents, 1, MAX_OPPONENTS, v => { setup.opponents = v; }, 'opponents')),
        field('Laps', stepper(setup.laps, 1, 10, v => { setup.laps = v; }, 'laps'))) : null,
      mode === 'timetrial' ? field('Laps', stepper(setup.laps, 1, 10, v => { setup.laps = v; }, 'laps')) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn big', onclick: () => this.home() }, 'Back'),
        startBtn)));
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
          h('button', { class: 'btn big', onclick: () => this.game.finishSession() }, 'Finish session'),
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
