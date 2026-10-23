// Party screens: Create party / Join party on the title screen, the lobby with the QR code and the
// 6-digit code, and the results after each race.
import QRCode from 'qrcode';
import { PartyClient, formatCode, joinUrl, savedName, saveName, type LobbyState, type RaceResult } from '../net/party';
import { PAINTS } from '../render/carModel';
import { formatTime } from './hud';

/** what the party screens need from the game */
export interface PartyGame {
  readonly paintIndex: number;
  setPaint(n: number): void;
  /** solo driving or paused: back to the title before a party opens */
  toTitle(): void;
  joinedParty(pc: PartyClient): void;
  leftParty(): void;
  beginPartyRace(slot: number, laps: number): void;
  partyLights(n: number): void;
  partyGo(): void;
  endPartyRace(): void;
  message(text: string, seconds?: number): void;
  closeMenu(): void;
}

type Attrs = Record<string, string | boolean | number | ((e: Event) => void)>;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null, ...kids: (Node | string | null | false)[]) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (typeof v === 'function') e.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') e.className = String(v);
    else if (typeof v === 'boolean') { if (v) e.setAttribute(k, ''); }
    else e.setAttribute(k, String(v));
  }
  for (const c of kids) if (c) e.append(c);
  return e;
}

const hex = (n: number) => `#${PAINTS[n % PAINTS.length].color.toString(16).padStart(6, '0')}`;

export class PartyUi {
  private pc: PartyClient | null = null;
  private screen = h('div', { class: 'overlay party hidden', 'data-ui': true });
  private lastResults: RaceResult[] | null = null;
  private status = '';
  private qrFor = '';
  private qr = h('canvas', { class: 'qr', width: 240, height: 240 });
  private racing = false;
  private lastCode = '';
  private shown = '';

  constructor(private game: PartyGame, title: HTMLElement, pause: HTMLElement) {
    document.body.appendChild(this.screen);
    const buttons = () => h('div', { class: 'party-buttons', 'data-ui': true },
      h('button', { class: 'btn big primary', onclick: () => this.create() }, 'Create party'),
      h('button', { class: 'btn big', onclick: () => this.joinScreen() }, 'Join party'));
    title.querySelector('.prompt')?.after(buttons());
    pause.append(h('div', { class: 'solo-only' }, h('p', null, 'Race friends'), buttons()),
      h('div', { class: 'party-only', 'data-ui': true }, h('p', null, 'The race keeps going while this is open.'),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => this.game.closeMenu() }, 'Back to the race'), h('button', { class: 'btn', onclick: () => this.leave() }, 'Leave party'))));
    const code = new URLSearchParams(location.search).get('code');
    if (code) this.joinScreen(code);
  }

  /** a party is open (lobby or racing): the title's "any key" does not start a solo drive */
  get active() { return !!this.pc; }
  /** the lobby is on screen */
  get open() { return !this.screen.classList.contains('hidden'); }

  private show(...kids: Node[]) { this.shown = ''; this.screen.replaceChildren(h('div', { class: 'party-card' }, ...kids)); this.screen.classList.remove('hidden'); }
  private hide() { this.screen.classList.add('hidden'); }

  private client() {
    this.pc?.leave();
    const pc = (this.pc = new PartyClient());
    let painted = false;
    pc.on.lobby = s => {
      // on joining, take a paint colour nobody else in the party has, so every car looks different
      const me = s.players.find(p => p.id === pc.id);
      if (!painted && me) {
        painted = true;
        const taken = new Set(s.players.filter(p => p.id !== pc.id).map(p => p.paint));
        if (taken.has(me.paint)) {
          const free = PAINTS.findIndex((_, k) => !taken.has(k));
          if (free >= 0) { this.game.setPaint(free); pc.setProfile({ paint: free }); }
        }
      }
      if (!this.racing) this.lobby(s);
    };
    pc.on.error = msg => {
      if (pc.code) { this.game.message(msg, 3); return; }
      // the join was refused (no such party, or full)
      if (this.pc === pc) this.pc = null;
      this.game.leftParty();
      this.joinScreen(this.lastCode, msg);
    };
    pc.on.status = t => { this.status = t; if (t) this.game.message(t, 2); };
    pc.on.race = m => {
      const slot = m.grid.indexOf(pc.id);
      if (slot < 0) { this.status = 'A race is on: you will be on the grid for the next one'; if (pc.lobby) this.lobby(pc.lobby); return; }
      this.racing = true; this.hide();
      this.game.beginPartyRace(slot, m.settings.laps);
    };
    pc.on.lights = n => { if (this.racing) this.game.partyLights(n); };
    pc.on.go = () => { if (this.racing) this.game.partyGo(); };
    pc.on.finished = id => {
      if (!this.racing || id === pc.id) return;
      const p = pc.lobby?.players.find(x => x.id === id);
      if (p) this.game.message(`${p.name} finished`, 1.6);
    };
    pc.on.results = order => {
      this.lastResults = order;
      if (this.racing) { this.racing = false; this.game.endPartyRace(); }
      if (pc.lobby) this.lobby(pc.lobby);
    };
    return pc;
  }

  private profile() { return { name: savedName(), paint: this.game.paintIndex }; }

  async create() {
    this.game.toTitle();
    this.lastResults = null; this.status = '';
    this.show(h('h2', null, 'Creating party…'), h('p', { class: 'dim' }, 'Getting a code for your friends'));
    const pc = this.client();
    try { await pc.create(this.profile(), 3); this.game.joinedParty(pc); }
    catch (e) {
      if (this.pc !== pc) return;
      this.pc = null;
      this.show(h('h2', null, 'Could not create a party'), h('p', { class: 'dim' }, `${(e as Error).message}. Running locally? Start it with npm run party-server.`),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => this.create() }, 'Try again'), h('button', { class: 'btn', onclick: () => this.close() }, 'Back')));
    }
  }

  joinScreen(code?: string, error = '') {
    this.game.toTitle();
    const input = h('input', { class: 'code-input', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: '000 000', maxlength: 7, 'aria-label': 'Party code' }) as HTMLInputElement;
    input.value = code ? formatCode(code) : '';
    const err = h('p', { class: 'error' }, error);
    const go = async () => {
      const c = input.value.replace(/\D/g, '');
      this.lastCode = c;
      if (c.length !== 6) { err.textContent = 'Party codes have 6 digits'; return; }
      err.textContent = '';
      this.lastResults = null; this.status = '';
      this.show(h('h2', null, `Joining ${formatCode(c)}…`));
      const pc = this.client();
      try { await pc.join(c, this.profile()); this.game.joinedParty(pc); }
      catch (e) { if (this.pc === pc) { this.pc = null; this.joinScreen(c, (e as Error).message); } }
    };
    input.addEventListener('input', () => {
      err.textContent = '';
      input.value = formatCode(input.value);
      if (input.value.replace(/\D/g, '').length === 6) go();
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); if (e.key === 'Escape') this.close(); });
    this.show(h('h2', null, 'Join a party'), h('p', { class: 'dim' }, 'Type the 6-digit code from your friend\'s screen, or scan their QR code with your phone camera.'),
      input, err,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: go }, 'Join'), h('button', { class: 'btn', onclick: () => this.close() }, 'Back')));
    setTimeout(() => input.focus(), 0);
    if (code && !error && code.replace(/\D/g, '').length === 6) go();
  }

  private close() {
    this.pc?.leave(); this.pc = null; this.racing = false;
    this.hide();
    // drop ?code= so a reload doesn't rejoin
    if (location.search.includes('code=')) history.replaceState(null, '', location.pathname);
    this.game.leftParty();
  }

  /** Leave party from the race menu */
  leave() { this.close(); }

  private lobby(st: LobbyState) {
    const pc = this.pc!;
    // rebuild only when something shown changed, so a click is never lost to a redraw
    const key = JSON.stringify([st, this.lastResults, this.status]);
    if (this.open && key === this.shown) return;
    const host = st.hostId === pc.id;
    const url = joinUrl(st.code);
    if (this.qrFor !== url) {
      this.qrFor = url;
      QRCode.toCanvas(this.qr, url, { width: 240, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#0b0f14', light: '#ffffff' } }).catch(() => {});
    }
    const copy = h('button', { class: 'btn', onclick: async () => {
      try { await navigator.clipboard.writeText(url); copy.textContent = 'Link copied'; } catch { copy.textContent = url; }
      setTimeout(() => { copy.textContent = 'Copy link'; }, 2000);
    } }, 'Copy link');
    const share = 'share' in navigator ? h('button', { class: 'btn', onclick: () => navigator.share({ title: 'Roadster party', text: `Join my Roadster race: code ${formatCode(st.code)}`, url }).catch(() => {}) }, 'Share') : null;

    const name = h('input', { class: 'text', type: 'text', maxlength: 16, value: pc.lobby?.players.find(p => p.id === pc.id)?.name ?? savedName(), 'aria-label': 'Your name' }) as HTMLInputElement;
    name.addEventListener('change', () => { const n = name.value.trim(); if (n) { saveName(n); pc.setProfile({ name: n }); } });
    name.addEventListener('keydown', e => { if (e.key === 'Enter') name.blur(); });

    const laps = st.settings.laps;
    const lapsRow = h('div', { class: 'laps' }, h('span', { class: 'dim' }, 'Laps'),
      host ? h('button', { class: 'btn small', onclick: () => pc.setLaps(laps - 1), ...(laps <= 1 ? { disabled: true } : {}) }, '−') : null,
      h('b', null, String(laps)),
      host ? h('button', { class: 'btn small', onclick: () => pc.setLaps(laps + 1), ...(laps >= 10 ? { disabled: true } : {}) }, '+') : null);

    const racing = st.phase !== 'lobby';
    const results = this.lastResults && this.lastResults.length ? h('div', { class: 'party-results' }, h('h3', null, 'Last race'),
      h('ol', null, ...this.lastResults.map(r => h('li', { class: r.id === pc.id ? 'me' : '' }, h('span', null, r.name), h('span', { class: 'time' }, r.time !== null ? formatTime(r.time) : 'DNF'))))) : null;

    this.show(
      h('div', { class: 'qr-side' },
        h('div', { class: 'label' }, 'SCAN TO JOIN'),
        this.qr,
        h('div', { class: 'code-big' }, formatCode(st.code)),
        h('p', { class: 'dim small' }, `or enter the code under Join party at ${location.host}`),
        h('div', { class: 'row' }, copy, share)),
      h('div', { class: 'lobby-side' },
        h('h2', null, host ? 'Your party' : 'Party'),
        h('label', { class: 'name' }, h('span', { class: 'dim' }, 'Your name'), name),
        h('ul', { class: 'players' }, ...st.players.map(p => h('li', { class: p.id === pc.id ? 'me' : '' },
          h('span', { class: 'swatch', style: `background:${hex(p.paint)}` }),
          h('span', { class: 'pname' }, p.name),
          h('em', null, [p.id === st.hostId ? 'Host' : '', !p.online ? 'offline' : '', racing && p.racing ? 'racing' : ''].filter(Boolean).join(' · '))))),
        h('p', { class: 'dim small' }, `${st.players.length} of 8 drivers`),
        lapsRow,
        results,
        this.status ? h('p', { class: 'status' }, this.status) : null,
        h('div', { class: 'row' },
          host ? h('button', { class: 'btn big primary', onclick: () => pc.start(), ...(racing ? { disabled: true } : {}) }, racing ? 'Race in progress' : 'Start race')
            : h('p', { class: 'dim' }, racing ? 'A race is on: you will join the next one' : 'Waiting for the host to start…'),
          h('button', { class: 'btn', onclick: () => this.close() }, 'Leave'))));
    this.shown = key;
  }
}
