// The changelog and how-to-play tips, for the loading screen and the home screen's What's new card.
// For each update, add a version at the top of src/data/updates.json (and bump package.json to match);
// the newest entry is the version the game shows.
import { h } from './dom';
import updatesJson from '../data/updates.json';

export interface Update { version: string; date: string; title: string; items: string[] }
export const UPDATES = updatesJson as Update[];
/** the version being played: the newest entry in the changelog */
export const VERSION = UPDATES[0].version;

const SEEN_KEY = 'roadster-seen-update';
/** true until the player opens the changelog for this version */
export function updateIsNew() {
  try { return localStorage.getItem(SEEN_KEY) !== VERSION; } catch { return false; }
}
export function markUpdateSeen() {
  try { localStorage.setItem(SEEN_KEY, VERSION); } catch { /* private mode */ }
}

const KEY_TIPS = [
  'W or ↑ is gas, S or ↓ brakes, and A / D or ← / → steer.',
  'Tap Space to jump. Hold it to hover.',
  'Q and E fire the side thrusters: a quick dodge on the road, a flip in the air.',
  'Shift fires the rocket boost. It uses air, so grab the canisters on the track.',
  'Keep steering in the air to line the car up with the next corner.',
  'R puts you back on the track, and C changes the camera.',
  'Esc pauses the race.',
];
const TOUCH_TIPS = [
  'Steer with the slider on the left. Gas and brake are on the right.',
  'Tap JUMP to jump. Hold it to hover.',
  'The ◀◀ and ▶▶ side thrusters dodge on the road and flip the car in the air.',
  'BOOST fires the rocket. It uses air, so grab the canisters on the track.',
  'Keep steering in the air to line the car up with the next corner.',
  'You can switch the slider to tilt or buttons in Settings.',
];
const COMMON_TIPS = [
  'Lift off before a corner and get back on the gas as you turn in.',
  'Land with the wheels down to keep your speed.',
  'Win silver in all five tests of a license to earn it and unlock the next car.',
  'Finish in the top three of a championship to win its car.',
  'Qualify on a race weekend to start nearer the front.',
];

export function tips() {
  const touch = matchMedia('(pointer: coarse)').matches;
  return [...(touch ? TOUCH_TIPS : KEY_TIPS), ...COMMON_TIPS];
}

const dateLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

/** the latest `count` versions of the changelog as a list */
export function newsList(count = UPDATES.length) {
  return h('div', { class: 'news' }, ...UPDATES.slice(0, count).map(u => h('div', { class: 'news-day' },
    h('div', { class: 'news-head' }, h('span', { class: 'news-ver' }, `v${u.version}`), h('b', null, u.title), h('span', { class: 'news-date' }, dateLabel(u.date))),
    h('ul', null, ...u.items.map(t => h('li', null, t))))));
}

/** fill the loading screen: a tip that changes every few seconds, and what's new. Returns a stop function */
export function showBootInfo(boot: Element) {
  const list = tips();
  let k = Math.floor(Math.random() * list.length);
  const tip = h('div', { class: 'boot-tip-text' }, list[k]);
  boot.append(
    h('div', { class: 'boot-tip' }, h('div', { class: 'boot-label' }, 'Tip'), tip),
    h('div', { class: 'boot-news' }, h('div', { class: 'boot-label' }, `What's new in v${VERSION}`), newsList(1)),
    h('div', { class: 'boot-version' }, `Version ${VERSION}`),
  );
  const timer = setInterval(() => { k = (k + 1) % list.length; tip.textContent = list[k]; }, 3500);
  return () => clearInterval(timer);
}
