// The damage meter: the car from above with its four zones of bodywork, each green when it's
// fine, then yellow and red as it takes hits, and how much of the car is left.
import { h } from './dom';
import { ZONES, type Damage, type Zone } from '../sim/damage';

const CSS = `
.damage { right: 338px; bottom: 16px; width: 74px; height: 160px; display: flex; flex-direction: column; align-items: center; padding: 10px 0 8px; box-sizing: border-box; }
.damage .label { font-size: 10px; letter-spacing: 3px; color: var(--dim); font-weight: 700; }
.damage svg { width: 46px; height: 96px; margin-top: 6px; overflow: visible; }
.damage .zone { transition: fill 0.25s; stroke: rgba(0, 0, 0, 0.45); stroke-width: 1.5; }
.damage .glass { fill: rgba(10, 14, 20, 0.75); }
.damage .state { font-size: 12px; font-weight: 800; margin-top: 4px; letter-spacing: 1px; }
.damage.hit { animation: damage-hit 0.4s; }
@keyframes damage-hit { 30% { transform: scale(1.12); } }
body.on-title .damage { display: none; }
body.touch-mode .damage { right: auto; left: 16px; bottom: auto; top: 300px; transform: scale(0.8); transform-origin: top left; }
@media (max-width: 720px) { .damage { transform: scale(0.8); transform-origin: bottom right; right: 280px; } }
`;

/** zone shapes on a 46 × 96 car seen from above, nose up */
const SHAPES: Record<Zone, string> = {
  front: 'M 6 22 C 6 8 12 2 23 2 C 34 2 40 8 40 22 Z',
  rear: 'M 6 76 L 40 76 C 40 88 36 94 23 94 C 10 94 6 88 6 76 Z',
  left: 'M 4 24 L 13 24 L 13 74 L 4 74 C 2 60 2 38 4 24 Z',
  right: 'M 42 24 L 33 24 L 33 74 L 42 74 C 44 60 44 38 42 24 Z',
};

/** green through yellow to red */
function colour(d: number) {
  const hue = 130 * (1 - Math.min(1, d) ** 0.8);
  return `hsl(${hue.toFixed(0)}, 85%, ${d >= 1 ? 42 : 52}%)`;
}

export class DamageHud {
  readonly root = h('div', { class: 'panel damage' });
  private zones = new Map<Zone, SVGPathElement>();
  private state: HTMLElement;
  private last = '';

  constructor(parent: HTMLElement) {
    if (!document.getElementById('damage-css')) {
      const style = document.createElement('style');
      style.id = 'damage-css'; style.textContent = CSS;
      document.head.appendChild(style);
    }
    this.root.innerHTML = `<div class="label">CAR</div>
      <svg viewBox="0 0 46 96">${ZONES.map(z => `<path class="zone" data-zone="${z}" d="${SHAPES[z]}"/>`).join('')}
        <path class="zone core" d="M 13 24 L 33 24 L 33 74 L 13 74 Z" fill="hsl(130, 20%, 34%)"/>
        <path class="glass" d="M 15 30 L 31 30 L 30 54 L 16 54 Z"/></svg>
      <div class="state">100%</div>`;
    for (const z of ZONES) this.zones.set(z, this.root.querySelector(`[data-zone="${z}"]`)!);
    this.state = this.root.querySelector('.state')!;
    parent.appendChild(this.root);
    this.update(null);
  }

  update(d: Damage | null) {
    const zones = d?.zones ?? { front: 0, rear: 0, left: 0, right: 0 };
    const key = ZONES.map(z => zones[z].toFixed(2)).join();
    if (key === this.last) return;
    const hit = this.last !== '' && ZONES.some((z, k) => zones[z] > Number(this.last.split(',')[k]) + 0.01);
    this.last = key;
    for (const z of ZONES) this.zones.get(z)!.setAttribute('fill', colour(zones[z]));
    const left = Math.max(0, Math.round(100 * (1 - (d?.worst ?? 0))));
    this.state.textContent = d?.wrecked ? 'WRECKED' : `${left}%`;
    this.state.style.color = colour(d?.worst ?? 0);
    if (hit) { this.root.classList.remove('hit'); void this.root.offsetWidth; this.root.classList.add('hit'); }
  }
}
