// The garage screen: paint (the twelve presets or any colour) and its finish, a livery pattern
// with its second colour, the race number, and the parts: rims and their colour, the rear wing,
// tyres, glass tint and underglow. Every change shows on the car straight away and is saved.
import { h } from './dom';
import { segmented, stepper, field } from './menu';
import { PAINTS } from '../render/carModel';
import { PATTERNS, FINISHES } from '../render/livery';
import { garage, RIM_STYLES, RIM_COLORS, WINGS, TYRES, GLASS, GLOWS } from '../core/garage';

const css = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** a row of colour swatches, plus a colour picker for any other colour */
function swatches(list: [string, string][], value: () => string, pick: (c: string) => void, custom?: (c: string) => void) {
  const row = h('div', { class: 'swatches' });
  const mark = () => row.querySelectorAll<HTMLElement>('.swatch-btn').forEach(b => b.classList.toggle('on', b.dataset.c === value()));
  for (const [c, name] of list) {
    row.append(h('button', { class: 'swatch-btn', title: name, 'aria-label': name, 'data-c': c, style: `--c:${c}`, onclick: () => { pick(c); mark(); } }));
  }
  if (custom) {
    const input = h('input', { type: 'color', class: 'swatch-pick', 'aria-label': 'Any colour', value: value().startsWith('#') ? value() : '#e10600' }) as HTMLInputElement;
    input.addEventListener('input', () => { custom(input.value); mark(); });
    row.append(h('label', { class: 'swatch-custom', title: 'Any colour' }, input, h('span', null, 'Any')));
  }
  mark();
  return row;
}

export function garageCard(apply: () => void, back: () => void) {
  const g = garage;
  const about = (text: string) => h('div', { class: 'field-about' }, text);
  const wingAbout = about(WINGS.find(w => w[0] === g.wing)![2]);
  const tyreAbout = about(TYRES.find(t => t[0] === g.tyres)![2]);
  const rimAbout = about(RIM_STYLES.find(r => r[0] === g.rims)![2]);
  const paintList: [string, string][] = PAINTS.map(p => [css(p.color), p.name]);
  const paintValue = () => g.paint >= 0 ? css(PAINTS[g.paint].color) : g.custom;
  return h('div', { class: 'card garage-card' },
    h('h2', null, 'Garage'),
    h('p', { class: 'dim' }, 'Make the car yours. Changes show straight away and are saved.'),
    h('h3', { class: 'garage-h' }, 'Paint'),
    field('Colour', swatches(paintList, paintValue, c => { g.paint = paintList.findIndex(p => p[0] === c); apply(); }, c => { g.paint = -1; g.custom = c; apply(); })),
    field('Finish', segmented(FINISHES, g.finish, v => { g.finish = v; apply(); })),
    h('h3', { class: 'garage-h' }, 'Livery'),
    field('Pattern', segmented(PATTERNS, g.pattern, v => { g.pattern = v; apply(); })),
    field('Second colour', swatches([['#111214', 'Black'], ['#ffffff', 'White'], ['#d01818', 'Red'], ['#d4a72c', 'Gold'], ['#15306a', 'Blue'], ['#2fe6ff', 'Neon blue'], ['#ff2d95', 'Neon pink'], ['#7dff3a', 'Neon green']],
      () => g.second, c => { g.second = c; apply(); }, c => { g.second = c; apply(); })),
    h('div', { class: 'field-pair' },
      field('Race number', stepper(g.number, 1, 99, v => { g.number = v; apply(); }, 'number')),
      field('Number on the car', segmented([['on', 'Show'], ['off', 'Hide']], g.showNumber ? 'on' : 'off', v => { g.showNumber = v === 'on'; apply(); }))),
    h('h3', { class: 'garage-h' }, 'Parts'),
    field('Rims', segmented(RIM_STYLES.map(([v, l]) => [v, l]), g.rims, v => { g.rims = v; rimAbout.textContent = RIM_STYLES.find(r => r[0] === v)![2]; apply(); }), rimAbout),
    field('Rim colour', swatches(RIM_COLORS, () => g.rimColor, c => { g.rimColor = c; apply(); }, c => { g.rimColor = c; apply(); })),
    field('Rear wing', segmented(WINGS.map(([v, l]) => [v, l]), g.wing, v => { g.wing = v; wingAbout.textContent = WINGS.find(w => w[0] === v)![2]; apply(); }), wingAbout),
    field('Tyres', segmented(TYRES.map(([v, l]) => [v, l]), g.tyres, v => { g.tyres = v; tyreAbout.textContent = TYRES.find(t => t[0] === v)![2]; apply(); }), tyreAbout),
    field('Glass', segmented(GLASS.map(([v, l]) => [v, l]), g.glass, v => { g.glass = v; apply(); })),
    field('Underglow', segmented(GLOWS.map(([v, l]) => [v, l]), g.glow, v => { g.glow = v; apply(); })),
    h('p', { class: 'dim small' }, 'The wing and tyres change the handling. The single-seaters keep their own wings and glass.'),
    h('div', { class: 'row' }, h('button', { class: 'btn big primary', autofocus: true, onclick: back }, 'Done')));
}
