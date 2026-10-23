// Drives the real game in headless Chromium: title screen, start lights, keyboard driving, the
// race field, boost and hop, and the autopilot demo. Saves screenshots to test-results/ and fails on page errors or if the car
// doesn't move.   node scripts/browser-test.mjs [url]   (start `npm run dev` or `npm run preview` first)
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const exe = process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
mkdirSync('test-results', { recursive: true });
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 620 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const sep = url.includes('?') ? '&' : '?';
// software rendering is slow, so test on Low unless asked otherwise
const quality = `${sep}quality=${process.env.QUALITY ?? 'low'}`;
let failed = false;
const check = (ok, msg) => { console.log(`${ok ? '  ok ' : 'FAIL '} ${msg}`); if (!ok) failed = true; };
const state = () => page.evaluate(() => { const g = window.__game; const p = g.car.body.translation(); return { phase: g.phase, speed: g.car.speed, x: p.x, z: p.z, lap: g.lap, quality: g.renderer.quality }; });

await page.goto(url + quality, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game, null, { timeout: 90000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: 'test-results/1-title.png' });
console.log('graphics', (await state()).quality);

await page.keyboard.press('Enter');
await page.waitForTimeout(2500);
await page.screenshot({ path: 'test-results/2-lights.png' });
await page.waitForFunction(() => window.__game.phase === 'driving', null, { timeout: 90000 });
const s0 = await state();
await page.keyboard.down('KeyW');
await page.waitForFunction(() => window.__game.car.speed > 25, null, { timeout: 90000 }).catch(() => {});
await page.screenshot({ path: 'test-results/3-launch.png' });
await page.keyboard.down('KeyD');
await page.waitForTimeout(2500);
await page.screenshot({ path: 'test-results/4-steer.png' });
await page.keyboard.up('KeyD');
await page.keyboard.up('KeyW');
const s1 = await state();
console.log(`after launch: ${(s1.speed * 3.6).toFixed(0)} km/h, moved ${Math.hypot(s1.x - s0.x, s1.z - s0.z).toFixed(0)} m`);
check(s1.speed > 15, 'car accelerates under keyboard throttle');
await page.keyboard.down('KeyS'); await page.waitForTimeout(6000); await page.keyboard.up('KeyS');
check((await state()).speed < s1.speed - 10, 'car brakes');

// race and thrusters: five rivals on the grid, boost drains the tank, a hop costs air
check(await page.evaluate(() => window.__game.race?.entrants.length === 6 && !document.querySelector('.standings').classList.contains('hidden')), 'race: six cars and the standings panel');
const tank0 = await page.evaluate(() => window.__game.jets.tank);
await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
await page.waitForTimeout(3000);
await page.keyboard.up('ShiftLeft');
const tank1 = await page.evaluate(() => window.__game.jets.tank);
await page.keyboard.press('KeyE');
await page.waitForTimeout(2500);
await page.screenshot({ path: 'test-results/4b-hop.png' });
await page.keyboard.up('KeyW');
const tank2 = await page.evaluate(() => window.__game.jets.tank);
console.log(`air tank: ${(tank0 * 100).toFixed(0)}% -> boost ${(tank1 * 100).toFixed(0)}% -> hop ${(tank2 * 100).toFixed(0)}%`);
check(tank1 < tank0 - 0.02, 'boost uses air');
check(tank2 < tank1 - 0.1, 'hop uses air');

// cameras
for (let k = 1; k <= 3; k++) { await page.keyboard.press('KeyC'); await page.waitForTimeout(500); await page.screenshot({ path: `test-results/5-camera-${k}.png` }); }
await page.keyboard.press('KeyC');

// autopilot lap: frame rate and progress
await page.goto(url + quality + '&autodrive', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.phase === 'driving', null, { timeout: 90000 });
const fps = await page.evaluate(() => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 4000) requestAnimationFrame(f); else r(n / 4); }; requestAnimationFrame(f); }));
await page.waitForTimeout(20000);
await page.screenshot({ path: 'test-results/6-autodrive.png' });
await page.waitForTimeout(20000);
await page.screenshot({ path: 'test-results/7-autodrive.png' });
const s2 = await state();
console.log(`autodrive: ${(s2.speed * 3.6).toFixed(0)} km/h, ${fps.toFixed(0)} fps (software rendering)`);
check(s2.speed > 10, 'autopilot is driving');
check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
await browser.close();
process.exit(failed ? 1 : 0);
