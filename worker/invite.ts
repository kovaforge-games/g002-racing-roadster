// Invite gate: the game is private. A friend opens the link with ?invite=<code>, which sets a
// cookie and redirects to the same address without the code. Everything else (pages, assets,
// WebSockets, AI endpoints) is a plain 404 without that cookie. robots.txt stays open and every
// response says noindex, so nothing is crawled or listed. INVITE_CODE is a Worker secret; with no
// secret set every request is a 404, and rotating it invalidates every old cookie.
//
// Party passes: an invited player's party QR code carries ?code=<party>&pass=<pass>, a signed pass
// for that one party that runs out after PASS_TTL. A friend who scans it gets a guest cookie that
// lasts as long as the pass. A guest's own party QR codes carry passes too, but never past their
// own cookie, so everyone a pass brings in is out again when that first pass runs out.
//
// Hub invites: the admin makes invites on kovaforge.org/games, each with its own code and two links,
// kovaforge.org/games/<game>/<code> and <worker>.workers.dev/<code>, that can be revoked one by one.
// Opening one asks the hub (HUB, a service binding to kovaforge-home) whether that link is live, and
// sets a cookie carrying the code, signed with INVITE_CODE. The cookie is checked with the hub again
// at most once every HUB_RECHECK_MS, so a revoked link shuts out people who already opened it.

export interface InviteEnv { INVITE_CODE?: string; HUB?: Fetcher }

const ROBOTS = 'User-agent: *\nDisallow: /\n';
const NOINDEX = 'noindex, nofollow, noarchive';
const MAX_AGE = 30 * 24 * 3600;
export const PASS_TTL = 12 * 3600;
const HUB_CODE = /^[A-Za-z0-9_-]{22}$/;
export const HUB_RECHECK_MS = 60_000;

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
/** 16 bytes as URL-safe base64: short enough to keep the QR code easy to scan */
const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf).slice(0, 16))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(code: string, msg: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
}

/** the cookie value: an HMAC of the game name keyed by the invite code, never the code itself */
async function token(code: string, game: string) {
  return hex(await hmac(code, `kovaforge-invite-v1:${game}`));
}

/** the cookie for a hub invite: "<code>.<signature>", for this game and link only */
async function hubToken(code: string, game: string, link: string, invite: string) {
  return `${invite}.${hex(await hmac(code, `kovaforge-hub-invite-v1:${game}:${link}:${invite}`))}`;
}

// links the hub said were live, and when it said so (per isolate)
const hubLive = new Map<string, number>();

/** asks the hub whether this invite's link is still live; anything but a 200 is a no. Opening a link
 *  always asks (`fresh`), so a revoked link stops letting new people in at once. */
async function hubSays(hub: Fetcher | undefined, game: string, link: string, invite: string, fresh = false) {
  const key = `${game}:${link}:${invite}`;
  const at = hubLive.get(key);
  if (!fresh && at !== undefined && Date.now() - at < HUB_RECHECK_MS) return true;
  let ok = false;
  try {
    ok = !!hub && (await hub.fetch(`https://kovaforge.org/home-api/games/${game}/invites/${invite}?link=${link}`)).status === 200;
  } catch { ok = false; }
  if (hubLive.size > 1000) hubLive.clear();
  if (ok) hubLive.set(key, Date.now()); else hubLive.delete(key);
  return ok;
}

/** a pass for one party until `exp` (unix seconds): "<exp in base 36>.<signature>" */
export async function partyPass(code: string, game: string, party: string, exp: number) {
  const e = exp.toString(36);
  return `${e}.${b64(await hmac(code, `kovaforge-pass-v1:${game}:${party}:${e}`))}`;
}

/** the guest cookie: "<exp in base 36>.<signature>", good until exp */
async function guestToken(code: string, game: string, exp: string) {
  return `${exp}.${b64(await hmac(code, `kovaforge-guest-v1:${game}:${exp}`))}`;
}

/** seconds left on a signed "<exp>.<sig>" value, or 0 when it is forged or has run out */
async function secondsLeft(value: string, sign: (exp: string) => Promise<string>) {
  const exp = value.split('.')[0];
  if (!/^[0-9a-z]{1,10}$/.test(exp) || !(await same(value, await sign(exp)))) return 0;
  return Math.max(0, parseInt(exp, 36) - Math.floor(Date.now() / 1000));
}

/** constant-time compare (hashes both sides first so lengths always match) */
async function same(a: string, b: string) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const p = new Uint8Array(x), q = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < p.length; i++) diff |= p[i] ^ q[i];
  return diff === 0;
}

function cookie(req: Request, name: string) {
  for (const part of (req.headers.get('Cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

export function noindex(res: Response): Response {
  if (res.status === 101 || res.webSocket) return res; // WebSocket upgrades keep their own response
  const out = new Response(res.body, res);
  out.headers.set('X-Robots-Tag', NOINDEX);
  return out;
}

const notFound = () => new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });

/** wraps a Worker fetch handler so the invite check runs before anything else, on every host and path */
export function inviteGate<E extends InviteEnv, C>(game: string, base: string, inner: (req: Request, env: E, ctx: C) => Promise<Response>) {
  const name = `kf_${game}_invite`, guestName = `kf_${game}_guest`;
  return async (req: Request, env: E, ctx: C): Promise<Response> => {
    const url = new URL(req.url);
    if (url.pathname === '/robots.txt' || url.pathname === base + 'robots.txt') {
      return new Response(ROBOTS, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': NOINDEX } });
    }
    const secret = env.INVITE_CODE ?? '';
    if (!secret) return noindex(notFound()); // fail closed
    const expected = await token(secret, game);
    const link = url.hostname.endsWith('.workers.dev') ? 'workers' : 'kovaforge';
    const held = cookie(req, name);
    const hubInvite = /^([A-Za-z0-9_-]{22})\.[0-9a-f]{64}$/.exec(held)?.[1];
    const invited = (await same(held, expected))
      || (!!hubInvite && (await same(held, await hubToken(secret, game, link, hubInvite))) && (await hubSays(env.HUB, game, link, hubInvite)));
    const guestLeft = invited ? 0 : await secondsLeft(cookie(req, guestName), exp => guestToken(secret, game, exp));
    // workers.dev serves the game at its root; kovaforge.org only under the game's path
    // no trailing slash: RFC 6265 path-match sends it to /games/gNNN, /games/gNNN/... and the ws,
    // but not to /games/gNNNx, so the no-slash address works before its slash redirect
    const path = url.hostname.endsWith('.workers.dev') ? '/' : base.replace(/\/+$/, '');
    const redirect = (setCookie: string | null) => {
      const headers: Record<string, string> = { Location: url.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': NOINDEX };
      if (setCookie) headers['Set-Cookie'] = `${setCookie}; Path=${path}; HttpOnly; Secure; SameSite=Lax`;
      return new Response(null, { status: 302, headers });
    };

    // a hub invite link: <code> right after the game's base (workers.dev: right after the root)
    const rest = link === 'workers' ? url.pathname.slice(1) : url.pathname.startsWith(base) ? url.pathname.slice(base.length) : '';
    if (HUB_CODE.test(rest)) {
      if (!(await hubSays(env.HUB, game, link, rest, true))) return noindex(notFound());
      url.pathname = link === 'workers' ? '/' : base;
      return redirect(`${name}=${await hubToken(secret, game, link, rest)}; Max-Age=${MAX_AGE}`);
    }

    const offered = url.searchParams.get('invite');
    if (offered !== null) {
      if (!(await same(offered, secret))) return noindex(notFound());
      url.searchParams.delete('invite');
      return redirect(`${name}=${expected}; Max-Age=${MAX_AGE}`);
    }
    const pass = url.searchParams.get('pass');
    if (pass !== null) {
      const party = url.searchParams.get('code') ?? '';
      const left = await secondsLeft(pass, exp => partyPass(secret, game, party, parseInt(exp, 36)));
      if (!left) return noindex(notFound());
      url.searchParams.delete('pass'); // keep ?code= so the game joins the party
      if (invited) return redirect(null); // an invited player keeps their own, longer cookie
      const exp = pass.split('.')[0];
      return redirect(`${guestName}=${await guestToken(secret, game, exp)}; Max-Age=${left}`);
    }

    if (!invited && !guestLeft) return noindex(notFound());
    if (url.pathname === base + 'party-pass') {
      const party = url.searchParams.get('code') ?? '';
      if (!/^\d{1,12}$/.test(party)) return noindex(new Response('Bad party code', { status: 400 }));
      const p = await partyPass(secret, game, party, Math.floor(Date.now() / 1000) + (invited ? PASS_TTL : guestLeft));
      return noindex(Response.json({ pass: p }, { headers: { 'Cache-Control': 'no-store' } }));
    }
    return noindex(await inner(req, env, ctx));
  };
}
