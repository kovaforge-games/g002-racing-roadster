// Invite gate tests: npm run worker-test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './index';

const CODE = 'test-invite-code-123';
let calls: string[] = [];
const env = (code: string | null = CODE) => ({
  INVITE_CODE: code ?? undefined,
  ASSETS: { fetch: async (r: Request) => { calls.push(new URL(r.url).pathname); return new Response('<title>game</title>', { headers: { 'Content-Type': 'text/html' } }); } },
  PARTY: { idFromName: () => { calls.push('DO'); return {}; }, get: () => ({ fetch: async () => new Response('do') }) },
}) as any;
const ctx = { waitUntil() {} } as any;
const go = (url: string, e = env(), headers: Record<string, string> = {}) => { calls = []; return worker.fetch(new Request(url, { headers }), e, ctx); };

async function cookieFor(host: string, e = env()) {
  const r = await go(`https://${host}/?invite=${CODE}`, e);
  return (r.headers.get('Set-Cookie') ?? '').split(';')[0];
}

for (const host of ['g002-roadster.kovaforge.workers.dev', 'kovaforge.org/games/g002']) {
  test(`${host}: no cookie is a plain 404`, async () => {
    const r = await go(`https://${host}/`);
    assert.equal(r.status, 404);
    assert.equal(await r.text(), '');
    assert.deepEqual(calls, []);
  });
  test(`${host}: wrong invite is a 404`, async () => {
    const r = await go(`https://${host}/?invite=nope`);
    assert.equal(r.status, 404);
    assert.equal(r.headers.get('Set-Cookie'), null);
  });
  test(`${host}: right invite sets the cookie and redirects without the code`, async () => {
    const r = await go(`https://${host}/?invite=${CODE}&x=1`);
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('Location'), `https://${host}/?x=1`);
    const c = r.headers.get('Set-Cookie') ?? '';
    assert.match(c, /HttpOnly/); assert.match(c, /Secure/); assert.match(c, /SameSite=Lax/); assert.match(c, /Max-Age=2592000/);
    assert.match(c, host.includes('workers.dev') ? /Path=\/;/ : /Path=\/games\/g002;/);
    assert.ok(!c.includes(CODE));
  });
  test(`${host}: the cookie opens the game, with noindex`, async () => {
    const r = await go(`https://${host}/`, env(), { Cookie: await cookieFor(host) });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('X-Robots-Tag'), 'noindex, nofollow, noarchive');
    assert.deepEqual(calls, ['/games/g002/']);
  });
}

test('robots.txt is open and disallows everything', async () => {
  for (const u of ['https://g002-roadster.kovaforge.workers.dev/robots.txt', 'https://kovaforge.org/games/g002/robots.txt']) {
    const r = await go(u, env(null));
    assert.equal(r.status, 200);
    assert.equal(await r.text(), 'User-agent: *\nDisallow: /\n');
    assert.equal(r.headers.get('X-Robots-Tag'), 'noindex, nofollow, noarchive');
  }
});

test('404s carry noindex too', async () => {
  assert.equal((await go('https://kovaforge.org/games/g002/')).headers.get('X-Robots-Tag'), 'noindex, nofollow, noarchive');
});

test('no INVITE_CODE secret fails closed, even with the invite', async () => {
  for (const u of ['https://kovaforge.org/games/g002/', 'https://kovaforge.org/games/g002/?invite=', `https://kovaforge.org/games/g002/?invite=${CODE}`]) {
    const r = await go(u, env(null));
    assert.equal(r.status, 404);
    assert.equal(r.headers.get('Set-Cookie'), null);
  }
});

test('rotating INVITE_CODE invalidates old cookies', async () => {
  const old = await cookieFor('kovaforge.org/games/g002');
  const r = await go('https://kovaforge.org/games/g002/', env('rotated-code-456'), { Cookie: old });
  assert.equal(r.status, 404);
});

test('party WebSocket is 404 without the cookie', async () => {
  for (const p of ['ws?create=1', 'ws?code=123456']) {
    for (const host of ['https://kovaforge.org/games/g002/', 'https://g002-roadster.kovaforge.workers.dev/']) {
      const r = await go(host + p, env(), { Upgrade: 'websocket' });
      assert.equal(r.status, 404, host + p);
      assert.deepEqual(calls, [], host + p);
    }
  }
});

// Full flow like a browser: open the invite link, follow redirects, and send back only the
// cookies whose Path path-matches the request (RFC 6265 5.1.4) on the same host.
function pathMatch(reqPath: string, cookiePath: string) {
  if (reqPath === cookiePath) return true;
  if (!reqPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith('/') || reqPath[cookiePath.length] === '/';
}
async function browse(start: string, e = env()) {
  const jar: { host: string; path: string; pair: string }[] = [];
  let url = start;
  for (let hop = 0; hop < 5; hop++) {
    const u = new URL(url);
    const sent = jar.filter(c => c.host === u.hostname && pathMatch(u.pathname, c.path)).map(c => c.pair).join('; ');
    const r = await go(url, e, sent ? { Cookie: sent } : {});
    const sc = r.headers.get('Set-Cookie');
    if (sc) {
      const path = /;\s*Path=([^;]*)/i.exec(sc)?.[1] ?? '/';
      jar.push({ host: u.hostname, path, pair: sc.split(';')[0] });
    }
    if (r.status !== 301 && r.status !== 302) return { r, url, jar };
    url = new URL(r.headers.get('Location')!, url).toString();
  }
  throw new Error('too many redirects');
}

for (const start of [
  'https://g002-roadster.kovaforge.workers.dev/', 'https://g002-roadster.kovaforge.workers.dev',
  'https://kovaforge.org/games/g002/', 'https://kovaforge.org/games/g002',
]) {
  test(`full flow from ${start}?invite= opens the game`, async () => {
    const { r, url, jar } = await browse(start + '?invite=' + CODE);
    assert.equal(r.status, 200, url);
    assert.ok(!url.includes(CODE));
    assert.equal(jar.length, 1);
    // later visits without the code still work, on both slash forms, and the ws path gets the cookie
    for (const p of ['', '/', '/ws']) {
      const h = new URL(url).hostname, base = h.endsWith('.workers.dev') ? '' : '/games/g002';
      assert.ok(pathMatch(base + p || '/', jar[0].path), base + p);
    }
    const again = await browse(start);
    assert.equal(again.r.status, 404); // a fresh browser with no cookie is still shut out
  });
}

test('kovaforge.org cookie does not leak to a sibling path like /games/g002x', () => {
  assert.equal(pathMatch('/games/g002x/', '/games/g002'), false);
  assert.equal(pathMatch('/games/g002', '/games/g002'), true);
  assert.equal(pathMatch('/games/g002/ws', '/games/g002'), true);
});

// Party passes: the QR code on an invited player's lobby lets a friend's phone in for that party
async function passFor(party: string, host = 'kovaforge.org/games/g002') {
  // the game asks at its base path on both hosts (import.meta.env.BASE_URL)
  const r = await go(`https://${host.replace('/games/g002', '')}/games/g002/party-pass?code=${party}`, env(), { Cookie: await cookieFor(host) });
  assert.equal(r.status, 200);
  return (await r.json()).pass as string;
}

test('an invited player gets a short pass for their party', async () => {
  const p = await passFor('123456');
  assert.match(p, /^[0-9a-z]+\.[A-Za-z0-9_-]{22}$/);
  assert.ok(!p.includes(CODE));
});

test('party-pass is a 404 without the invite', async () => {
  const r = await go('https://kovaforge.org/games/g002/party-pass?code=123456');
  assert.equal(r.status, 404);
});

for (const start of ['https://g002-roadster.kovaforge.workers.dev/', 'https://kovaforge.org/games/g002/']) {
  test(`scanning the QR code from ${start} opens the game and keeps the party code`, async () => {
    const host = start.replace('https://', '').replace(/\/$/, '');
    const pass = await passFor('482913', host);
    const { r, url, jar } = await browse(`${start}?code=482913&pass=${encodeURIComponent(pass)}`);
    assert.equal(r.status, 200, url);
    assert.equal(new URL(url).search, '?code=482913');
    assert.equal(jar.length, 1);
    assert.match(jar[0].pair, /^kf_g002_guest=/);
    // the guest cookie opens the party WebSocket too
    const ws = await go(start + 'ws?code=482913', env(), { Upgrade: 'websocket', Cookie: jar[0].pair });
    assert.notEqual(ws.status, 404);
    assert.deepEqual(calls, ['DO']);
  });
}

test('the guest cookie lasts as long as the pass', async () => {
  const pass = await passFor('482913');
  const r = await go(`https://kovaforge.org/games/g002/?code=482913&pass=${pass}`);
  const age = Number(/Max-Age=(\d+)/.exec(r.headers.get('Set-Cookie') ?? '')?.[1]);
  assert.ok(age > 12 * 3600 - 60 && age <= 12 * 3600, String(age));
});

test('a pass only works for its own party, and forged passes are a 404', async () => {
  const pass = await passFor('482913');
  for (const q of [`code=111111&pass=${pass}`, `pass=${pass}`, `code=482913&pass=${pass.slice(0, -1)}A`, 'code=482913&pass=zzzzzz.AAAAAAAAAAAAAAAAAAAAAA', 'code=482913&pass=']) {
    const r = await go(`https://kovaforge.org/games/g002/?${q}`);
    assert.equal(r.status, 404, q);
    assert.equal(r.headers.get('Set-Cookie'), null, q);
  }
});

test('an expired pass and an expired guest cookie are a 404', async () => {
  const pass = await passFor('482913');
  const guest = (await go(`https://kovaforge.org/games/g002/?code=482913&pass=${pass}`)).headers.get('Set-Cookie')!.split(';')[0];
  const now = Date.now;
  Date.now = () => now() + 13 * 3600 * 1000;
  try {
    assert.equal((await go(`https://kovaforge.org/games/g002/?code=482913&pass=${pass}`)).status, 404);
    assert.equal((await go('https://kovaforge.org/games/g002/', env(), { Cookie: guest })).status, 404);
  } finally { Date.now = now; }
});

test("a guest's passes never outlast their own, and an invited player keeps their own cookie", async () => {
  const pass = await passFor('482913');
  const now = Date.now;
  const guest = (await go(`https://kovaforge.org/games/g002/?code=482913&pass=${pass}`)).headers.get('Set-Cookie')!.split(';')[0];
  Date.now = () => now() + 10 * 3600 * 1000; // ten hours in, the guest makes their own party
  try {
    const r = await go('https://kovaforge.org/games/g002/party-pass?code=555555', env(), { Cookie: guest });
    assert.equal(r.status, 200);
    const next = (await r.json()).pass as string;
    assert.equal(next.split('.')[0], pass.split('.')[0]); // runs out with the first pass, not 12 hours later
    const friend = await go(`https://kovaforge.org/games/g002/?code=555555&pass=${next}`);
    const age = Number(/Max-Age=(\d+)/.exec(friend.headers.get('Set-Cookie') ?? '')?.[1]);
    assert.ok(age > 2 * 3600 - 60 && age <= 2 * 3600, String(age));
  } finally { Date.now = now; }
  const r = await go(`https://kovaforge.org/games/g002/?code=482913&pass=${pass}`, env(), { Cookie: await cookieFor('kovaforge.org/games/g002') });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('Set-Cookie'), null);
  assert.equal(r.headers.get('Location'), 'https://kovaforge.org/games/g002/?code=482913');
});

test('rotating INVITE_CODE invalidates passes and guest cookies', async () => {
  const pass = await passFor('482913');
  const guest = (await go(`https://kovaforge.org/games/g002/?code=482913&pass=${pass}`)).headers.get('Set-Cookie')!.split(';')[0];
  assert.equal((await go(`https://kovaforge.org/games/g002/?code=482913&pass=${pass}`, env('rotated-code-456'))).status, 404);
  assert.equal((await go('https://kovaforge.org/games/g002/', env('rotated-code-456'), { Cookie: guest })).status, 404);
});
