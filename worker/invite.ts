// Invite gate: the game is private. A friend opens the link with ?invite=<code>, which sets a
// cookie and redirects to the same address without the code. Everything else (pages, assets,
// WebSockets, AI endpoints) is a plain 404 without that cookie. robots.txt stays open and every
// response says noindex, so nothing is crawled or listed. INVITE_CODE is a Worker secret; with no
// secret set every request is a 404, and rotating it invalidates every old cookie.

export interface InviteEnv { INVITE_CODE?: string }

const ROBOTS = 'User-agent: *\nDisallow: /\n';
const NOINDEX = 'noindex, nofollow, noarchive';
const MAX_AGE = 30 * 24 * 3600;

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

/** the cookie value: an HMAC of the game name keyed by the invite code, never the code itself */
async function token(code: string, game: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`kovaforge-invite-v1:${game}`)));
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
  const name = `kf_${game}_invite`;
  return async (req: Request, env: E, ctx: C): Promise<Response> => {
    const url = new URL(req.url);
    if (url.pathname === '/robots.txt' || url.pathname === base + 'robots.txt') {
      return new Response(ROBOTS, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': NOINDEX } });
    }
    const secret = env.INVITE_CODE ?? '';
    if (!secret) return noindex(notFound()); // fail closed
    const expected = await token(secret, game);
    const offered = url.searchParams.get('invite');
    if (offered !== null) {
      if (!(await same(offered, secret))) return noindex(notFound());
      url.searchParams.delete('invite');
      // workers.dev serves the game at its root; kovaforge.org only under the game's path
      // no trailing slash: RFC 6265 path-match sends it to /games/gNNN, /games/gNNN/... and the ws,
      // but not to /games/gNNNx, so the no-slash address works before its slash redirect
      const path = url.hostname.endsWith('.workers.dev') ? '/' : base.replace(/\/+$/, '');
      return new Response(null, {
        status: 302,
        headers: {
          Location: url.toString(),
          'Set-Cookie': `${name}=${expected}; Max-Age=${MAX_AGE}; Path=${path}; HttpOnly; Secure; SameSite=Lax`,
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
          'X-Robots-Tag': NOINDEX,
        },
      });
    }
    if (!(await same(cookie(req, name), expected))) return noindex(notFound());
    return noindex(await inner(req, env, ctx));
  };
}
