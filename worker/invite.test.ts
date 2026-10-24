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
    assert.match(c, host.includes('workers.dev') ? /Path=\/;/ : /Path=\/games\/g002\/;/);
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
