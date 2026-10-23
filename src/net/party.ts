// Multiplayer party client (WebSocket), ported from g001. The server (server/party-core.ts) keeps
// the lobby and runs the start lights; each driver simulates their own car and shares its state.

export interface LobbyPlayer { id: string; name: string; paint: number; racing: boolean; online: boolean }
export interface LobbyState { code: string; hostId: string; phase: 'lobby' | 'lights' | 'racing'; settings: { laps: number }; players: LobbyPlayer[] }
export interface RaceResult { id: string; name: string; time: number | null; best: number | null; dist: number }
export interface Snapshot { t: number; s: number[] }

function store(): Storage | null { try { return localStorage; } catch { return null; } }

function clientId() {
  try {
    let id = sessionStorage.getItem('rd-party-client');
    if (!id) { id = Math.random().toString(36).slice(2, 12); sessionStorage.setItem('rd-party-client', id); }
    return id;
  } catch { return Math.random().toString(36).slice(2, 12); }
}

/** the driver's name, remembered between visits */
export function savedName() {
  let n = store()?.getItem('rd-name');
  if (!n) { n = `Driver ${100 + Math.floor(Math.random() * 900)}`; store()?.setItem('rd-name', n); }
  return n;
}
export function saveName(n: string) { store()?.setItem('rd-name', n); }

/** "482913" -> "482 913" */
export const formatCode = (c: string) => c.replace(/\D/g, '').slice(0, 6).replace(/^(\d{3})(?=\d)/, '$1 ');
/** the address the QR code points at: this page with ?code=, so scanning it joins the party */
export const joinUrl = (code: string) => `${location.origin}${location.pathname}?code=${code}`;

export class PartyClient {
  private ws: WebSocket | null = null;
  readonly id = clientId();
  code = '';
  lobby: LobbyState | null = null;
  private profile: { name: string; paint: number } = { name: '', paint: 0 };
  private closedByUser = false;
  /** car states from the other drivers, newest last */
  readonly snapshots = new Map<string, Snapshot[]>();
  on: {
    lobby?(s: LobbyState): void; error?(msg: string): void; status?(text: string): void;
    race?(m: { grid: string[]; settings: { laps: number }; raceId: number }): void;
    lights?(n: number): void; go?(): void; finished?(id: string, time: number): void;
    results?(order: RaceResult[]): void; left?(id: string): void;
  } = {};

  get isHost() { return this.lobby?.hostId === this.id; }
  get active() { return !!this.code || !!this.ws; }

  /** the code (or create flag) in the URL lets the Cloudflare Worker route to that party's Durable Object */
  private url(code: string | null) {
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${import.meta.env.BASE_URL}ws?${code ? `code=${code}` : 'create=1'}`;
  }

  /** connect with a few retries: a dropped handshake should not fail a join */
  private async connectRetry(code: string | null) {
    let last: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (this.closedByUser) throw new Error('Cancelled');
      try { await this.connect(code); return; } catch (e) { last = e; await new Promise(r => setTimeout(r, 400 * 2 ** attempt)); }
    }
    throw last;
  }

  private connect(code: string | null): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url(code));
      this.ws = ws;
      const timer = setTimeout(() => { reject(new Error('Could not reach the party server')); ws.close(); }, 10000);
      ws.onopen = () => { clearTimeout(timer); resolve(); };
      ws.onerror = () => { clearTimeout(timer); if (this.ws === ws) this.ws = null; reject(new Error('Could not reach the party server')); };
      ws.onmessage = e => this.handle(JSON.parse(e.data));
      ws.onclose = () => {
        if (this.ws !== ws || this.closedByUser || !this.code) return;
        this.on.status?.('Reconnecting…');
        setTimeout(() => this.rejoin(), 1500);
      };
    });
  }

  private async rejoin() {
    if (this.closedByUser || !this.code) return;
    try { await this.connectRetry(this.code); this.send({ t: 'join', code: this.code, clientId: this.id, ...this.profile }); this.on.status?.(''); }
    catch { setTimeout(() => this.rejoin(), 3000); }
  }

  async create(profile: { name: string; paint: number }, laps: number) {
    this.profile = profile; this.closedByUser = false;
    await this.connectRetry(null);
    this.send({ t: 'create', clientId: this.id, settings: { laps }, ...profile });
  }

  async join(code: string, profile: { name: string; paint: number }) {
    this.profile = profile; this.closedByUser = false;
    const c = code.replace(/\D/g, '');
    await this.connectRetry(c);
    this.send({ t: 'join', code: c, clientId: this.id, ...profile });
  }

  leave() {
    this.closedByUser = true;
    this.send({ t: 'leave' });
    this.ws?.close();
    this.ws = null; this.code = ''; this.lobby = null;
    this.snapshots.clear();
  }

  setProfile(p: Partial<{ name: string; paint: number }>) { Object.assign(this.profile, p); this.send({ t: 'profile', ...p }); }
  setLaps(laps: number) { this.send({ t: 'settings', settings: { laps } }); }
  start() { this.send({ t: 'start' }); }
  sendState(s: number[]) { this.send({ t: 'state', s }); }
  sendFinish(time: number, best: number | null) { this.send({ t: 'finish', time, best }); }

  private send(m: unknown) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }

  private handle(m: any) {
    switch (m.t) {
      case 'joined': this.code = m.code; break;
      case 'party': this.lobby = m; this.on.lobby?.(m); break;
      case 'error':
        // a failed join leaves no party behind
        if (!this.code) { this.closedByUser = true; this.ws?.close(); this.ws = null; }
        this.on.error?.(m.msg);
        break;
      case 'race': this.snapshots.clear(); this.on.race?.(m); break;
      case 'lights': this.on.lights?.(m.n); break;
      case 'go': this.on.go?.(); break;
      case 'st': {
        const buf = this.snapshots.get(m.id) ?? [];
        buf.push({ t: performance.now() / 1000, s: m.s });
        if (buf.length > 30) buf.splice(0, buf.length - 30);
        this.snapshots.set(m.id, buf);
        break;
      }
      case 'finished': this.on.finished?.(m.id, m.time); break;
      case 'results': this.on.results?.(m.order); break;
      case 'left': this.snapshots.delete(m.id); this.on.left?.(m.id); break;
    }
  }
}
