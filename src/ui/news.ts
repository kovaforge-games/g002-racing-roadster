// What's new and how-to-play tips, for the loading screen and the home screen's What's new card.
// For each update, add a day at the top of NEWS; the loading screen shows the latest days.
import { h } from './dom';

export const NEWS: { date: string; items: string[] }[] = [
  {
    date: '2026-10-24',
    items: [
      'Steer in the air: while you jump or hover, steering turns the car and the way it is flying, even with an empty tank.',
      'Faster loading, with tips and this list while the game starts.',
      'Party QR codes work again: scan one to join the party.',
      'Crash damage, and a flying tow Roadster that carries a crashed car back to the track.',
      'A sharper picture, no more freezing when the time of day changes, and the Graphics setting works.',
      'Road Thruster controls: Space jumps, hold it to hover, and Q / E fire the side thrusters.',
      'Championships, licenses and race weekends, with the 0x1.5, 0x2.5 and 0x3.5 cars to earn.',
    ],
  },
  {
    date: '2026-10-23',
    items: [
      'Rocket boost and air canisters on the track.',
      'Eleven rivals to race, with five difficulties.',
      'Parties: race your friends with a join code.',
    ],
  },
];

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

/** the latest `days` of NEWS as a list */
export function newsList(days = NEWS.length) {
  return h('div', { class: 'news' }, ...NEWS.slice(0, days).map(d => h('div', { class: 'news-day' },
    h('div', { class: 'news-date' }, dateLabel(d.date)),
    h('ul', null, ...d.items.map(t => h('li', null, t))))));
}

/** fill the loading screen: a tip that changes every few seconds, and what's new. Returns a stop function */
export function showBootInfo(boot: Element) {
  const list = tips();
  let k = Math.floor(Math.random() * list.length);
  const tip = h('div', { class: 'boot-tip-text' }, list[k]);
  boot.append(
    h('div', { class: 'boot-tip' }, h('div', { class: 'boot-label' }, 'Tip'), tip),
    h('div', { class: 'boot-news' }, h('div', { class: 'boot-label' }, "What's new"), newsList(1)),
  );
  const timer = setInterval(() => { k = (k + 1) % list.length; tip.textContent = list[k]; }, 3500);
  return () => clearInterval(timer);
}
