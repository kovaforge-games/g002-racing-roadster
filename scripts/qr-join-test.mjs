// Party QR code through the real Worker with the invite gate on: the host opens the invite link and
// makes a party, a phone with no invite opens the link in the QR code and joins. Screenshots go
// to test-results/qr-*.png (or the folder given).
//   echo "INVITE_CODE=<any test code>" > .dev.vars; npm run build:kovaforge
//   npx wrangler dev --port 8790, then: npm run qr-join-test [folder/]
import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync } from 'node:fs';
import jsQR from 'jsqr';
const invite = /INVITE_CODE=(.*)/.exec(readFileSync('.dev.vars', 'utf8'))[1].trim();
const base = 'http://localhost:8790/games/g002/';
const out = process.argv[2] ?? 'test-results/';
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = false; const check = (ok, m) => { console.log(`${ok ? '  ok ' : 'FAIL '} ${m}`); if (!ok) failed = true; };
const hostCtx = await b.newContext({ viewport: { width: 1100, height: 720 } });
await hostCtx.addInitScript(() => localStorage.setItem('rd-name', 'Jasmine'));
const host = await hostCtx.newPage(); host.setDefaultTimeout(200000);
const r0 = await host.goto(`${base}?invite=${invite}&quality=low`);
check(r0.status() === 200 && !host.url().includes(invite), 'the invite link opens the game');
await host.waitForFunction(() => window.__game, null, { timeout: 200000 });
await host.click('button:has-text("Make party"):visible');
await host.waitForSelector('.code-big');
const code = (await host.textContent('.code-big')).replace(/\D/g, '');
const decode = () => host.$eval('canvas.qr', c => { const x = c.getContext('2d').getImageData(0, 0, c.width, c.height); return { w: c.width, h: c.height, d: Array.from(x.data) }; })
  .then(q => jsQR(Uint8ClampedArray.from(q.d), q.w, q.h)?.data ?? '');
let link = '';
for (let k = 0; k < 40 && !link.includes('pass='); k++) { link = await decode(); await host.waitForTimeout(250); }
check(link.includes(`?code=${code}&pass=`), `the QR code holds the join link with a pass (${link.length} characters)`);
await host.screenshot({ path: out + 'qr-1-lobby.png' });

// the bug: the plain link (what the live QR code held) is a 404 on a phone with no invite
const before = await (await b.newContext()).newPage();
// Chromium shows its own error page for an empty 404, so read the status from the response
const plain = await before.request.get(`${base}?code=${code}`);
check(plain.status() === 404, `without a pass a scanned phone gets a 404 (${plain.status()}), which was the bug`);
await before.goto(`${base}?code=${code}`).catch(() => {});
await before.screenshot({ path: out + 'qr-0-before-fix-phone.png' });

// a phone with no invite scans the QR code
const phoneCtx = await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await phoneCtx.addInitScript(() => localStorage.setItem('rd-name', 'Phone'));
const phone = await phoneCtx.newPage(); phone.setDefaultTimeout(200000);
const r1 = await phone.goto(link + '&quality=low');
check(r1.status() === 200, `the scanned link opens the game on the phone (${r1.status()})`);
check(!phone.url().includes('pass='), 'the pass is taken out of the address');
await phone.waitForFunction(() => document.querySelectorAll('.players li').length === 2, null, { timeout: 200000 });
check(true, 'the phone joins the party');
await host.waitForFunction(() => document.querySelectorAll('.players li').length === 2);
check((await host.$$eval('.players li .pname', e => e.map(x => x.textContent))).join() === 'Jasmine,Phone', 'the host sees the phone in the lobby');
let phoneLink = '';
for (let k = 0; k < 40 && !phoneLink.includes('pass='); k++) {
  phoneLink = await phone.$eval('canvas.qr', c => { const x = c.getContext('2d').getImageData(0, 0, c.width, c.height); return { w: c.width, h: c.height, d: Array.from(x.data) }; })
    .then(q => jsQR(Uint8ClampedArray.from(q.d), q.w, q.h)?.data ?? '');
  await phone.waitForTimeout(250);
}
check(phoneLink.includes(`?code=${code}&pass=`), "the phone's own QR code can bring in the next friend");
await phone.screenshot({ path: out + 'qr-2-phone-joined.png' });
await host.screenshot({ path: out + 'qr-3-host-sees-phone.png' });
await b.close();
process.exit(failed ? 1 : 0);
