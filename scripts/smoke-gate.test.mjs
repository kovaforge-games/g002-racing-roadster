// Runs the smoke test's gate check against a local stub of the gated Worker: npm run smoke-gate-test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';

// stub: robots.txt only at robotsPath, everything else an empty 404 (or 200 when leaky)
function stub(robotsPath, leaky = false) {
  return new Promise(res => {
    const s = createServer((req, out) => {
      const path = new URL(req.url, 'http://x').pathname;
      if (path === robotsPath) { out.writeHead(200, { 'Content-Type': 'text/plain' }); return out.end('User-agent: *\nDisallow: /\n'); }
      out.writeHead(leaky ? 200 : 404); out.end();
    }).listen(0, '127.0.0.1', () => res(s));
  });
}
function smoke(base) {
  return new Promise(res => {
    const env = { ...process.env }; delete env.INVITE_CODE;
    execFile(process.execPath, ['scripts/smoke-test.mjs', base], { env }, (err, stdout, stderr) => res({ code: err ? err.code : 0, out: stdout + stderr }));
  });
}

for (const [form, prefix] of [['workers.dev root', '/'], ['kovaforge.org path', '/games/g002/']]) {
  test(`gate check passes on the ${form} form`, async () => {
    const s = await stub(prefix + 'robots.txt');
    const r = await smoke(`http://127.0.0.1:${s.address().port}${prefix}`);
    s.close();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ok  gate/);
  });
  test(`gate check fails when the ${form} form is open without an invite`, async () => {
    const s = await stub(prefix + 'robots.txt', true);
    const r = await smoke(`http://127.0.0.1:${s.address().port}${prefix}`);
    s.close();
    assert.equal(r.code, 1, r.out);
  });
}

test('kovaforge.org form reads robots.txt under the game path, not the hub root', async () => {
  const s = await stub('/robots.txt'); // only the root has robots.txt
  const r = await smoke(`http://127.0.0.1:${s.address().port}/games/g002/`);
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /robots\.txt returned 404/);
});
