// Heads-up display: speed and motor power, the air tank, lap timing, race position and
// standings, a minimap, messages and overlays (title, help, pause, results).
import type { Track } from '../sim/track';

export function formatTime(t: number | null) {
  if (t === null || !isFinite(t)) return '–:––.–––';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string) => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  parent?.appendChild(e);
  return e;
};

export class Hud {
  readonly root = el('div', 'hud');
  private speed: HTMLElement; private unit: HTMLElement;
  private powerArc: SVGPathElement; private regenArc: SVGPathElement; private power: HTMLElement;
  private lap: HTMLElement; private current: HTMLElement; private last: HTMLElement; private best: HTMLElement; private delta: HTMLElement;
  private toast: HTMLElement; private toastTimer = 0;
  private map: HTMLCanvasElement; private mapBg: HTMLCanvasElement;
  private mapScale = 1; private mapOx = 0; private mapOz = 0;
  private lights: HTMLElement; private lightDots: HTMLElement[] = []; private countdown: HTMLElement;
  readonly title: HTMLElement; readonly help: HTMLElement; readonly paused: HTMLElement;
  private info: HTMLElement;
  private air: HTMLElement; private airFill: HTMLElement; private airPct: HTMLElement; private hopDot: HTMLElement; private airGain: HTMLElement;
  private gainTimer = 0;
  private standings: HTMLElement; private posEl: HTMLElement; private lapOf: HTMLElement; private rows: HTMLElement;
  readonly results: HTMLElement;

  constructor(private track: Track) {
    document.body.appendChild(this.root);
    // timing, top left
    const timing = el('div', 'panel timing', this.root);
    this.lap = el('div', 'lap', timing, 'OUT LAP');
    this.current = el('div', 'time big', timing, formatTime(null));
    const rows = el('div', 'rows', timing);
    const row = (label: string) => { const r = el('div', 'row', rows); el('span', 'label', r, label); return el('span', 'value', r, formatTime(null)); };
    this.last = row('LAST'); this.best = row('BEST');
    this.delta = el('div', 'delta', timing);

    // speed and power, bottom right
    const dash = el('div', 'panel dash', this.root);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 200 120'); svg.classList.add('gauge');
    const arc = (cls: string) => { const p = document.createElementNS(ns, 'path'); p.setAttribute('class', cls); svg.appendChild(p); return p; };
    arc('track-arc').setAttribute('d', this.arcPath(-1, 1));
    this.regenArc = arc('regen-arc'); this.powerArc = arc('power-arc');
    dash.appendChild(svg);
    const read = el('div', 'readout', dash);
    this.speed = el('div', 'speed', read, '0');
    this.unit = el('div', 'unit', read, 'KM/H');
    this.power = el('div', 'power', dash, '0 kW');

    // air tank, left of the dash
    this.air = el('div', 'panel air', this.root);
    el('div', 'label', this.air, 'AIR');
    const tank = el('div', 'tank', this.air);
    this.airFill = el('div', 'fill', tank);
    el('div', 'ticks', tank);
    this.airPct = el('div', 'pct', this.air, '100');
    this.hopDot = el('div', 'hop ready', this.air);
    this.airGain = el('div', 'gain', this.air);

    // minimap, bottom left
    const mapWrap = el('div', 'panel mapwrap', this.root);
    this.mapBg = el('canvas', 'map', mapWrap);
    this.map = el('canvas', 'map', mapWrap);
    this.drawMapBg();

    // race position and standings, top right
    this.standings = el('div', 'panel standings hidden', this.root);
    const head = el('div', 'head', this.standings);
    this.posEl = el('div', 'pos', head);
    this.lapOf = el('div', 'lapof', head);
    this.rows = el('div', 'list', this.standings);

    this.toast = el('div', 'toast', this.root);
    this.lights = el('div', 'startlights', this.root);
    for (let k = 0; k < 5; k++) this.lightDots.push(el('div', 'light', this.lights));
    this.countdown = el('div', 'countdown', this.root);
    this.info = el('div', 'info', this.root);

    this.title = el('div', 'overlay title', document.body);
    this.title.innerHTML = `
      <div class="brand">ROADSTER</div>
      <div class="tag">Electric. Instant. Yours to drive.</div>
      <a class="showroom-link" href="#showroom">See the car in the showroom ›</a>
      <div class="loading">Loading…</div>`;
    this.help = el('div', 'overlay help hidden', document.body);
    this.help.innerHTML = `
      <h2>Controls</h2>
      <table>
        <tr><td>Accelerate / brake</td><td>W S or ↑ ↓ · RT LT</td></tr>
        <tr><td>Steer</td><td>A D or ← → · left stick</td></tr>
        <tr><td>Reverse</td><td>hold brake when stopped</td></tr>
        <tr><td>Boost (rear jets)</td><td>Shift · B</td></tr>
        <tr><td>Hop (underbody jets)</td><td>E or Enter · A</td></tr>
        <tr><td>In the air: pitch / yaw</td><td>W S / A D · triggers, stick</td></tr>
        <tr><td>In the air: roll</td><td>hold Space + A D · RB + stick</td></tr>
        <tr><td>Handbrake</td><td>Space · RB</td></tr>
        <tr><td>Look back</td><td>B · LB</td></tr>
        <tr><td>Camera</td><td>C · Y</td></tr>
        <tr><td>Reset to track</td><td>R · Back</td></tr>
        <tr><td>Paint colour</td><td>P · X</td></tr>
        <tr><td>Driving help</td><td>1 Easy · 2 Medium · 3 Off</td></tr>
        <tr><td>Time of day</td><td>T</td></tr>
        <tr><td>Mute</td><td>M</td></tr>
        <tr><td>Pause</td><td>Esc · Start</td></tr>
      </table>
      <p>Boost, hops and air control all use the air tank. Drive through the glowing canisters to refill it.</p>
      <p>Press H to close</p>`;
    this.results = el('div', 'overlay results hidden', document.body);
    this.paused = el('div', 'overlay paused hidden', document.body);
  }

  private arcPath(from: number, to: number) {
    // gauge arc from -1 (left end) to 1 (right end), centred at the top
    const cx = 100, cy = 105, r = 88;
    const ang = (v: number) => Math.PI + (v + 1) / 2 * Math.PI;
    const a0 = ang(from), a1 = ang(to);
    const p = (a: number) => `${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)}`;
    return `M ${p(a0)} A ${r} ${r} 0 ${Math.abs(a1 - a0) > Math.PI ? 1 : 0} 1 ${p(a1)}`;
  }

  private drawMapBg() {
    const t = this.track, size = 220, pad = 14;
    for (const c of [this.map, this.mapBg]) { c.width = size * devicePixelRatio; c.height = size * devicePixelRatio; c.style.width = c.style.height = `${size}px`; }
    const w = t.maxX - t.minX, h = t.maxZ - t.minZ;
    this.mapScale = (size - 2 * pad) / Math.max(w, h);
    this.mapOx = pad + (size - 2 * pad - w * this.mapScale) / 2 - t.minX * this.mapScale;
    this.mapOz = pad + (size - 2 * pad - h * this.mapScale) / 2 - t.minZ * this.mapScale;
    const c = this.mapBg.getContext('2d')!;
    c.scale(devicePixelRatio, devicePixelRatio);
    c.lineJoin = 'round';
    const path = () => {
      c.beginPath();
      for (let i = 0; i <= t.n; i++) { const k = i % t.n; const [x, y] = this.mapXY(t.px[k], t.pz[k]); if (i) c.lineTo(x, y); else c.moveTo(x, y); }
    };
    c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 7; path(); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 3.5; path(); c.stroke();
    const [sx, sy] = this.mapXY(t.px[0], t.pz[0]);
    c.fillStyle = '#38e8ff'; c.fillRect(sx - 2, sy - 6, 4, 12);
  }

  /** air canister rows as cyan dots on the map */
  markAir(list: { x: number; z: number }[]) {
    const c = this.mapBg.getContext('2d')!;
    c.fillStyle = '#38e8ff';
    for (const p of list) { const [x, y] = this.mapXY(p.x, p.z); c.beginPath(); c.arc(x, y, 2.2, 0, Math.PI * 2); c.fill(); }
  }

  /** map x is world x mirrored, so the map matches the view from above with +z up the screen */
  private mapXY(x: number, z: number): [number, number] {
    const size = 220;
    return [size - (x * this.mapScale + this.mapOx), size - (z * this.mapScale + this.mapOz)];
  }

  update(dt: number, o: { speed: number; powerKw: number; lap: number; current: number | null; last: number | null; best: number | null; x: number; z: number; heading: number; help: string; paint: string;
    others?: { x: number; z: number; color: string }[] }) {
    const kmh = Math.abs(o.speed) * 3.6;
    this.speed.textContent = kmh.toFixed(0);
    this.unit.textContent = o.speed < -0.5 ? 'KM/H · R' : 'KM/H';
    const p = Math.max(-1, Math.min(1, o.powerKw / 560));
    this.powerArc.setAttribute('d', p > 0.005 ? this.arcPath(0, p) : 'M 0 0');
    this.regenArc.setAttribute('d', p < -0.005 ? this.arcPath(p, 0) : 'M 0 0');
    this.power.textContent = `${o.powerKw >= 0 ? '' : 'REGEN '}${Math.abs(o.powerKw).toFixed(0)} kW`;
    if (this.standings.classList.contains('hidden')) this.lap.textContent = o.lap > 0 ? `LAP ${o.lap}` : 'OUT LAP';
    this.current.textContent = formatTime(o.current);
    this.last.textContent = formatTime(o.last);
    this.best.textContent = formatTime(o.best);
    this.info.textContent = `${o.paint} · Driving help: ${o.help}`;

    const c = this.map.getContext('2d')!;
    c.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    c.clearRect(0, 0, 220, 220);
    for (const r of o.others ?? []) {
      const [rx, ry] = this.mapXY(r.x, r.z);
      c.fillStyle = r.color; c.strokeStyle = 'rgba(0,0,0,0.7)'; c.lineWidth = 1.5;
      c.beginPath(); c.arc(rx, ry, 4, 0, Math.PI * 2); c.fill(); c.stroke();
    }
    const [x, y] = this.mapXY(o.x, o.z);
    c.save(); c.translate(x, y); c.rotate(-o.heading);
    c.fillStyle = '#ff3b47'; c.strokeStyle = '#fff'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(0, -8); c.lineTo(5.5, 6); c.lineTo(0, 3); c.lineTo(-5.5, 6); c.closePath(); c.fill(); c.stroke();
    c.restore();

    if (this.toastTimer > 0 && (this.toastTimer -= dt) <= 0) this.toast.classList.remove('show');
  }

  /** race position and the field in order; null hides the panel (free practice) */
  setRace(r: { pos: number; total: number; lap: number; laps: number; field: { pos: number; name: string; color: string; you: boolean; gap: string }[] } | null) {
    this.standings.classList.toggle('hidden', !r);
    if (!r) return;
    this.posEl.innerHTML = `P${r.pos}<small>/${r.total}</small>`;
    this.lapOf.textContent = r.lap === 0 ? 'GRID' : r.lap > r.laps ? 'FINISHED' : `LAP ${r.lap}/${r.laps}`;
    this.lap.textContent = r.lap === 0 ? 'START' : r.lap > r.laps ? 'FINISHED' : `LAP ${r.lap}/${r.laps}`;
    const html = r.field.map(f => `<div class="row${f.you ? ' you' : ''}"><b>${f.pos}</b><i style="background:${f.color}"></i><span>${f.name}</span><em>${f.gap}</em></div>`).join('');
    if (this.rows.innerHTML !== html) this.rows.innerHTML = html;
  }

  /** the results table after the player crosses the line (or the session is finished early) */
  showResults(title: string, sub: string, rows: { pos: number | string; name: string; time: string; best: string; you: boolean }[],
    actions: { label: string; primary?: boolean; run: () => void }[], note = '') {
    this.results.innerHTML = `<h2>${title}</h2><div class="sub">${sub}</div><table>${rows.map(r =>
      `<tr class="${r.you ? 'you' : ''}"><td>${r.pos}</td><td>${r.name}</td><td></td><td>${r.time}</td><td>${r.best}</td></tr>`).join('')}</table>
      ${note ? `<p>${note}</p>` : ''}<div class="row"></div>`;
    const row = this.results.querySelector('.row')!;
    for (const a of actions) {
      const b = el('button', `btn big${a.primary ? ' primary' : ''}`, row as HTMLElement, a.label);
      b.onclick = a.run;
    }
    this.results.setAttribute('data-ui', '');
    this.results.classList.remove('hidden');
    (row.firstElementChild as HTMLElement | null)?.focus({ preventScroll: true });
  }

  /** air tank 0..1, whether the rear jets are firing and whether a hop is ready */
  setAir(tank: number, boosting: boolean, hopReady: boolean, dt: number) {
    this.airFill.style.height = `${(tank * 100).toFixed(1)}%`;
    this.airPct.textContent = (tank * 100).toFixed(0);
    this.air.classList.toggle('boost', boosting);
    this.air.classList.toggle('low', tank < 0.2);
    this.hopDot.classList.toggle('ready', hopReady);
    if (this.gainTimer > 0 && (this.gainTimer -= dt) <= 0) this.airGain.classList.remove('show');
  }

  /** "+12" over the gauge when a canister is collected */
  airGained(amount: number) {
    this.airGain.textContent = `+${Math.round(amount * 100)}`;
    this.airGain.classList.remove('show'); void this.airGain.offsetWidth; this.airGain.classList.add('show');
    this.gainTimer = 0.9;
  }

  showDelta(delta: number | null) {
    if (delta === null) { this.delta.textContent = ''; return; }
    this.delta.textContent = `${delta <= 0 ? '−' : '+'}${Math.abs(delta).toFixed(3)}`;
    this.delta.className = `delta ${delta <= 0 ? 'faster' : 'slower'}`;
  }

  message(text: string, seconds = 2.2) {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    this.toastTimer = seconds;
  }

  /** start lights: n red lit (1..5) with the countdown under them (5 down to 1), 0 = off, -1 = hide */
  setLights(n: number) {
    this.lights.classList.toggle('show', n >= 0);
    this.lightDots.forEach((d, k) => d.classList.toggle('on', k < n));
    const text = n >= 1 && n <= 5 ? String(6 - n) : '';
    if (this.countdown.textContent !== text) {
      this.countdown.textContent = text;
      // restart the pop-in animation for each new number
      this.countdown.classList.remove('tick'); void this.countdown.offsetWidth; if (text) this.countdown.classList.add('tick');
    }
  }

  ready() { this.title.querySelector('.loading')?.remove(); this.title.classList.add('ready'); }
}
