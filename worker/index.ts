// Serves the built game from Workers static assets, and hosts each multiplayer party in its own
// Durable Object (WebSockets at /games/g002/ws). The files live under /games/g002/ so the same
// build works on the games path and at the root of the workers.dev address. Everything sits
// behind the invite gate in ./invite.
import { DurableObject } from 'cloudflare:workers';
import { createPartyHandler, randomCode, cleanCode, CODE_LENGTH, type Conn, type Party } from '../server/party-core';
import { inviteGate, type InviteEnv } from './invite';

interface Env extends InviteEnv { ASSETS: Fetcher; PARTY: DurableObjectNamespace<PartyRoom> }

const BASE = '/games/g002';

/** a new party: try random codes until a room says it is free (6 digits can collide) */
async function createParty(req: Request, env: Env): Promise<Response> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = randomCode();
    const url = new URL(req.url);
    url.searchParams.set('code', code);
    url.searchParams.set('create', '1');
    const res = await env.PARTY.get(env.PARTY.idFromName(code)).fetch(new Request(url, req));
    if (res.status !== 409) return res;
  }
  return new Response('No free party code, try again', { status: 503 });
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === BASE) return Response.redirect(`${url.origin}${BASE}/${url.search}`, 301);
  if (!url.pathname.startsWith(`${BASE}/`)) url.pathname = BASE + url.pathname;
  if (url.pathname === `${BASE}/ws`) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    if (url.searchParams.has('create')) return createParty(request, env);
    const code = cleanCode(url.searchParams.get('code'));
    if (code.length !== CODE_LENGTH) return new Response('Bad party code', { status: 400 });
    url.searchParams.set('code', code);
    return env.PARTY.get(env.PARTY.idFromName(code)).fetch(new Request(url, request));
  }
  return env.ASSETS.fetch(new Request(url.toString(), request));
}

export default { fetch: inviteGate<Env, unknown>('g002', `${BASE}/`, handle) };

/** one party (lobby + races) per Durable Object, addressed by its 6-digit code */
export class PartyRoom extends DurableObject<Env> {
  private party: Party | undefined;
  private code = '';
  /** a create was accepted but its first message has not arrived yet */
  private reservedAt = 0;
  private handler = createPartyHandler({
    newCode: () => this.code,
    get: code => (code === this.code ? this.party : undefined),
    add: p => { this.party = p; this.reservedAt = 0; },
  });

  async fetch(req: Request): Promise<Response> {
    const q = new URL(req.url).searchParams;
    this.code ||= q.get('code') ?? '';
    if (q.has('create') && (this.handler.inUse(this.party) || Date.now() - this.reservedAt < 15_000)) return new Response('Code in use', { status: 409 });
    if (q.has('create')) this.reservedAt = Date.now();
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    const conn: Conn = { send: d => server.send(d), close: () => server.close(), isOpen: () => server.readyState === WebSocket.READY_STATE_OPEN };
    this.handler.open(conn);
    server.addEventListener('message', e => this.handler.message(conn, String(e.data)));
    server.addEventListener('close', () => this.handler.close(conn));
    server.addEventListener('error', () => this.handler.close(conn));
    return new Response(null, { status: 101, webSocket: client });
  }
}
