// Party flow in headless Chromium: the host creates a party and gets a QR code and a 6-digit
// code, one friend "scans" the QR code (opens the address it holds), another types the code, and
// all three race together. Saves screenshots to test-results/party-*.png.
//   npm run party-server & npm run dev, then: node scripts/party-browser-test.mjs [url]
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import jsQR from 'jsqr';

const url = process.argv[2] ?? 'http://localhost:5173/';
const exe = process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
mkdirSync('test-results', { recursive: true });
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = false;
const check = (ok, msg) => { console.log(`${ok ? '  ok ' : 'FAIL '} ${msg}`); if (!ok) failed = true; };
const errors = [];

async function open(name, address, viewport = { width: 960, height: 540 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(n => { try { localStorage.setItem('rd-name', n); } catch { /* none */ } }, name);
  ctx.setDefaultTimeout(120000);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  if (process.env.DEBUG) page.on('websocket', w => { console.log(name, 'ws', w.url()); w.on('framesent', f => console.log(name, '>', f.payload)); w.on('framereceived', f => console.log(name, '<', String(f.payload).slice(0, 120))); w.on('close', () => console.log(name, 'ws closed')); w.on('socketerror', e => console.log(name, 'ws error', e)); });
  const sep = address.includes('?') ? '&' : '?';
  await page.goto(`${address}${sep}quality=low`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game, null, { timeout: 90000 });
  return page;
}
const players = page => page.$$eval('.players li .pname', els => els.map(e => e.textContent));

try {
  const host = await open('Ana', url);
  await page_click(host, 'Create party');
  await host.waitForSelector('.code-big', { timeout: 90000 });
  const code = (await host.textContent('.code-big')).replace(/\D/g, '');
  check(/^[1-9]\d{5}$/.test(code), `Create party shows a 6-digit code (${code})`);
  const qr = await host.$eval('canvas.qr', c => { const x = c.getContext('2d').getImageData(0, 0, c.width, c.height); return { w: c.width, h: c.height, d: Array.from(x.data) }; });
  const decoded = jsQR(Uint8ClampedArray.from(qr.d), qr.w, qr.h);
  check(!!decoded && decoded.data.endsWith(`?code=${code}`), `the QR code holds the join link (${decoded?.data})`);
  await host.screenshot({ path: 'test-results/party-1-lobby.png' });

  // a phone scans the QR code: it opens the link and joins straight away
  const scan = await open('Ben', decoded.data, { width: 390, height: 780 });
  await scan.waitForFunction(() => document.querySelectorAll('.players li').length === 2, null, { timeout: 120000 });
  check(true, 'opening the QR link joins the party');
  await scan.screenshot({ path: 'test-results/party-2-phone-lobby.png' });

  // a friend types the code: a wrong one first
  const typed = await open('Cleo', url);
  await page_click(typed, 'Join party');
  await typed.waitForSelector('.code-input');
  await typed.type('.code-input', code === '999999' ? '999998' : '999999', { delay: 30 });
  await typed.waitForFunction(() => document.querySelector('.party-card .error')?.textContent?.length > 0, null, { timeout: 90000 });
  check((await typed.textContent('.party-card .error')).includes('No party'), 'a wrong code says there is no such party');
  await typed.fill('.code-input', '');
  await typed.type('.code-input', code.slice(0, 4), { delay: 60 });
  await typed.screenshot({ path: 'test-results/party-3-join.png' });
  await typed.type('.code-input', code.slice(4), { delay: 60 });
  await typed.waitForFunction(() => document.querySelectorAll('.players li').length === 3, null, { timeout: 120000 });
  check(true, 'typing the code joins the party');
  check((await players(host)).join() === 'Ana,Ben,Cleo', `the host sees everyone (${(await players(host)).join(', ')})`);

  // race: one lap, the host drives off, everyone sees the others
  await host.click('.laps button:has-text("−")'); await host.click('.laps button:has-text("−")');
  for (const p of [host, typed]) await p.waitForFunction(() => document.querySelector('.laps b')?.textContent === '1', null, { timeout: 60000 });
  check(true, 'the host sets the laps for everyone');
  await page_click(host, 'Start race');
  for (const p of [host, scan, typed]) await p.waitForFunction(() => window.__game.race !== null, null, { timeout: 90000 });
  check(true, 'everyone goes to the grid');
  await typed.screenshot({ path: 'test-results/party-4-grid.png' });
  for (const p of [host, scan, typed]) await p.waitForFunction(() => window.__game.phase === 'driving', null, { timeout: 120000 });
  check(true, 'lights out for everyone');
  await host.keyboard.down('KeyW');
  await typed.waitForTimeout(3500);
  await host.keyboard.up('KeyW');
  const seen = await typed.evaluate(() => { const g = window.__game; return { cars: g.party.snapshots.size, tags: [...document.querySelectorAll('.nametag')].filter(e => e.style.display !== 'none').map(e => e.textContent) }; });
  check(seen.cars === 2, `each driver sees the other two cars (${seen.cars})`);
  await typed.screenshot({ path: 'test-results/party-5-race.png' });
  await host.screenshot({ path: 'test-results/party-6-race-host.png' });
  const standings = await typed.$$eval('.standings .who', els => els.map(e => e.textContent));
  check(standings[0] === 'Ana', `the standings put the host in front (${standings.join(', ')})`);

  // finish: skip ahead to the flag on each car
  for (const p of [host, typed, scan]) await p.evaluate(() => window.__game['finishRace']());
  await host.waitForSelector('.results li', { timeout: 90000 });
  // each driver times their race from lights out, so on a slow test machine the order can differ from the call order
  const rows = await host.$$eval('.results li', els => els.map(e => [e.children[0].textContent, e.children[1].textContent]));
  const secs = rows.map(r => { const [m, s] = r[1].split(':'); return Number(m) * 60 + Number(s); });
  check(rows.map(r => r[0]).sort().join() === 'Ana,Ben,Cleo' && secs.every((t, k) => k === 0 || t >= secs[k - 1]),
    `results list everyone, fastest first (${rows.map(r => r.join(' ')).join(', ')})`);
  const paints = await host.$$eval('.players .swatch', els => new Set(els.map(e => e.style.background)).size);
  check(paints === 3, 'every driver gets a different paint colour');
  await host.screenshot({ path: 'test-results/party-7-results.png' });
} catch (e) {
  check(false, String(e));
  for (const [k, p] of browser.contexts().flatMap(c => c.pages()).entries()) {
    console.log(`page ${k}:`, (await p.evaluate(() => document.querySelector('.overlay.party')?.innerText ?? '').catch(() => '')).replace(/\s+/g, ' ').slice(0, 300));
    await p.screenshot({ path: `test-results/party-fail-${k}.png` }).catch(() => {});
  }
}
check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
await browser.close();
process.exit(failed ? 1 : 0);

async function page_click(page, text) { await page.click(`button:has-text("${text}"):visible`); }
