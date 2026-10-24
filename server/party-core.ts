// Party logic shared by the Node dev server (server.ts) and the Cloudflare Durable Object
// (worker/index.ts), ported from g001: lobbies keyed by a 6-digit code, start lights, a state
// relay between the cars, and results.

export interface Conn { send(data: string): void; close(): void; isOpen(): boolean; }

export interface Player {
  id: string; name: string; paint: number; conn: Conn | null;
  /** on the grid of the current race (players who join mid-race wait for the next one) */
  racing: boolean;
  finished: { time: number; best: number | null } | null; dist: number;
  lastState: number[] | null; lastStateAt: number; flagged: number;
}

export interface PartySettings { laps: number }

export interface Party {
  code: string; hostId: string; players: Map<string, Player>; settings: PartySettings;
  phase: 'lobby' | 'lights' | 'racing'; emptySince: number | null;
  timers: ReturnType<typeof setTimeout>[]; raceId: number; firstFinish: number | null;
}

/** where parties live: a Map on the Node server, a single party inside a Durable Object */
export interface PartyStore {
  newCode(): string;
  get(code: string): Party | undefined;
  add(p: Party): void;
}

export const MAX_PLAYERS = 8;
export const EMPTY_TTL = 30 * 60 * 1000;
export const CODE_LENGTH = 6;
/** state arrays: [x, y, z, qx, qy, qz, qw, dist, speed, steer, flags, paint]; dist is race progress in metres */
export const STATE_DIST = 7;

/** six digits, never starting with 0 so it reads the same as a number */
export function randomCode() {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return String(100000 + (b[0] % 900000));
}

export const cleanCode = (c: unknown) => String(c ?? '').replace(/\D/g, '').slice(0, CODE_LENGTH);

const cleanLaps = (n: unknown) => Math.max(1, Math.min(10, Math.round(Number(n)) || 3));

function sendTo(c: Conn | null, msg: unknown) { if (c?.isOpen()) c.send(JSON.stringify(msg)); }

function broadcast(p: Party, msg: unknown, except?: string) {
  const data = JSON.stringify(msg);
  for (const pl of p.players.values()) if (pl.id !== except && pl.conn?.isOpen()) pl.conn.send(data);
}

function lobbyState(p: Party) {
  return {
    t: 'party', code: p.code, hostId: p.hostId, phase: p.phase, settings: p.settings,
    players: [...p.players.values()].map(x => ({ id: x.id, name: x.name, paint: x.paint, racing: x.racing, online: !!x.conn })),
  };
}

export function clearTimers(p: Party) { p.timers.forEach(clearTimeout); p.timers = []; }

function startRace(p: Party) {
  clearTimers(p);
  p.phase = 'lights';
  p.raceId++;
  p.firstFinish = null;
  const grid: string[] = [];
  for (const pl of p.players.values()) {
    pl.finished = null; pl.dist = 0; pl.lastState = null; pl.flagged = 0;
    pl.racing = !!pl.conn;
    if (pl.racing) grid.push(pl.id);
  }
  broadcast(p, { t: 'race', settings: p.settings, grid, raceId: p.raceId });
  broadcast(p, lobbyState(p));
  // 2 s to settle on the grid, then the 5 second countdown: a light a second, then lights out
  const base = 2000;
  for (let n = 1; n <= 5; n++) p.timers.push(setTimeout(() => broadcast(p, { t: 'lights', n }), base + (n - 1) * 1000));
  p.timers.push(setTimeout(() => { p.phase = 'racing'; broadcast(p, { t: 'go' }); }, base + 5000));
}

function results(p: Party) {
  if (p.phase === 'lobby') return;
  clearTimers(p);
  const order = [...p.players.values()].filter(pl => pl.racing)
    .map(pl => ({ id: pl.id, name: pl.name, time: pl.finished?.time ?? null, best: pl.finished?.best ?? null, dist: pl.dist }))
    .sort((a, b) => (a.time !== null && b.time !== null ? a.time - b.time : a.time !== null ? -1 : b.time !== null ? 1 : b.dist - a.dist));
  p.phase = 'lobby';
  for (const pl of p.players.values()) pl.racing = false;
  broadcast(p, { t: 'results', order, raceId: p.raceId });
  broadcast(p, lobbyState(p));
}

function everyoneDone(p: Party) {
  return [...p.players.values()].every(x => !x.racing || x.finished || !x.conn);
}

function leave(p: Party, id: string) {
  p.players.delete(id);
  broadcast(p, { t: 'left', id });
  if (p.hostId === id) {
    const next = p.players.keys().next();
    if (!next.done) p.hostId = next.value; // host migration
  }
  if (!p.players.size) { p.emptySince = Date.now(); clearTimers(p); p.phase = 'lobby'; return; }
  if (p.phase !== 'lobby' && everyoneDone(p)) results(p);
  broadcast(p, lobbyState(p));
}

export function createPartyHandler(store: PartyStore) {
  const state = new Map<Conn, { party: Party | null; me: Player | null }>();

  function join(p: Party, conn: Conn, m: Record<string, unknown>): Player {
    const id = String(m.clientId || Math.random().toString(36).slice(2, 10)).slice(0, 24);
    const pl: Player = p.players.get(id) ?? { id, name: '', paint: 0, conn: null, racing: false, finished: null, dist: 0, lastState: null, lastStateAt: 0, flagged: 0 };
    pl.name = String(m.name ?? '').trim().slice(0, 16) || 'Driver';
    pl.paint = Math.max(0, Math.min(15, Math.floor(Number(m.paint) || 0)));
    if (pl.conn && pl.conn !== conn) pl.conn.close();
    pl.conn = conn;
    p.players.set(id, pl);
    return pl;
  }

  return {
    open(conn: Conn) { state.set(conn, { party: null, me: null }); },

    message(conn: Conn, raw: string) {
      const st = state.get(conn) ?? { party: null, me: null };
      state.set(conn, st);
      let m: Record<string, any>;
      try { m = JSON.parse(raw); } catch { return; }
      if (!m || typeof m.t !== 'string') return;
      const { party, me } = st;

      switch (m.t) {
        case 'create': {
          if (party) return;
          const code = store.newCode();
          const p: Party = { code, hostId: '', players: new Map(), settings: { laps: cleanLaps(m.settings?.laps) }, phase: 'lobby', emptySince: null, timers: [], raceId: 0, firstFinish: null };
          store.add(p);
          st.party = p;
          st.me = join(p, conn, m);
          p.hostId = st.me.id;
          sendTo(conn, { t: 'joined', you: st.me.id, code });
          broadcast(p, lobbyState(p));
          break;
        }
        case 'join': {
          const code = cleanCode(m.code);
          const p = store.get(code);
          if (!p || (!p.players.size && p.emptySince && Date.now() - p.emptySince > EMPTY_TTL)) { sendTo(conn, { t: 'error', msg: 'No party with that code' }); return; }
          const existing = m.clientId && p.players.get(String(m.clientId));
          if (!existing && p.players.size >= MAX_PLAYERS) { sendTo(conn, { t: 'error', msg: `That party is full (${MAX_PLAYERS} drivers)` }); return; }
          st.party = p;
          st.me = join(p, conn, m);
          p.emptySince = null;
          if (!p.hostId || !p.players.has(p.hostId)) p.hostId = st.me.id;
          sendTo(conn, { t: 'joined', you: st.me.id, code, raceId: p.raceId, phase: p.phase });
          broadcast(p, lobbyState(p));
          break;
        }
        case 'leave': if (party && me) { leave(party, me.id); st.party = null; st.me = null; } break;
        case 'profile': {
          if (!party || !me) return;
          if (typeof m.name === 'string') me.name = m.name.trim().slice(0, 16) || me.name;
          if (m.paint !== undefined) me.paint = Math.max(0, Math.min(15, Math.floor(Number(m.paint) || 0)));
          broadcast(party, lobbyState(party));
          break;
        }
        case 'settings':
          if (party && me && me.id === party.hostId && party.phase === 'lobby') { party.settings = { laps: cleanLaps(m.settings?.laps) }; broadcast(party, lobbyState(party)); }
          break;
        case 'start': if (party && me && me.id === party.hostId && party.phase === 'lobby') startRace(party); break;
        case 'state': {
          if (!party || !me || !me.racing || !Array.isArray(m.s) || m.s.length > 16) return;
          const s = (m.s as unknown[]).map(Number);
          if (s.some(v => !Number.isFinite(v))) return;
          // plausibility: cars cannot move faster than ~160 m/s between updates
          const now = Date.now();
          if (me.lastState) {
            const dt = Math.max(0.02, (now - me.lastStateAt) / 1000);
            if (Math.hypot(s[0] - me.lastState[0], s[2] - me.lastState[2]) / dt > 160 && ++me.flagged > 40) return;
          }
          me.lastState = s; me.lastStateAt = now; me.dist = s[STATE_DIST] ?? me.dist;
          broadcast(party, { t: 'st', id: me.id, s }, me.id);
          break;
        }
        case 'finish': {
          if (!party || !me || !me.racing || me.finished || party.phase !== 'racing') return;
          me.finished = { time: Number(m.time) || 0, best: m.best == null ? null : Number(m.best) };
          broadcast(party, { t: 'finished', id: me.id, time: me.finished.time });
          if (party.firstFinish === null) {
            party.firstFinish = Date.now();
            const p = party;
            p.timers.push(setTimeout(() => results(p), 60_000)); // the others get 60 s to finish
          }
          if (everyoneDone(party)) results(party);
          break;
        }
        case 'ping': sendTo(conn, { t: 'pong', c: m.c, s: Date.now() }); break;
      }
    },

    close(conn: Conn) {
      const st = state.get(conn);
      state.delete(conn);
      if (!st?.party || !st.me || st.me.conn !== conn) return;
      const p = st.party, id = st.me.id;
      st.me.conn = null;
      broadcast(p, lobbyState(p));
      if (p.phase !== 'lobby' && everyoneDone(p)) results(p);
      // grace period for reconnects (same clientId) before removing the player
      setTimeout(() => { const pl = p.players.get(id); if (pl && !pl.conn) leave(p, id); }, 10_000);
    },

    /** true while the party has drivers, or was emptied too recently to hand its code out again */
    inUse(p: Party | undefined) { return !!p && (p.players.size > 0 || (p.emptySince !== null && Date.now() - p.emptySince < EMPTY_TTL)); },
  };
}
