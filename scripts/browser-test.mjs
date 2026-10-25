// Drives the real game in headless Chromium: home screen, race setup, countdown, keyboard driving,
// the race field, the pause menu, boost, jump and hover, the iPad controls, the autopilot demo, the career modes (licenses, race weekend, a Model S race), the Garage and Fun Mode. Saves screenshots to test-results/ and fails on page errors or if the car
// doesn't move.   node scripts/browser-test.mjs [url]   (start `npm run dev` or `npm run preview` first)
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';

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

// home screen -> Quick Race setup -> Start: the 5 second countdown, then lights out
check(await page.locator('.tile').count() === 10, 'home screen: ten tiles (the modes, Fun Mode and the Garage)');
// the version banner pulses as NEW UPDATE until the changelog is opened, which lists every version
const updates = JSON.parse(readFileSync(new URL('../src/data/updates.json', import.meta.url), 'utf8'));
check(await page.locator('.update-banner.fresh').textContent().then(t => t.includes(`v${updates[0].version}`)), `home screen: NEW UPDATE banner shows v${updates[0].version}`);
await page.click('.update-banner');
check(await page.locator('.news-card .news-day').count() === updates.length, `changelog lists all ${updates.length} versions`);
await page.screenshot({ path: 'test-results/1a-changelog.png' });
await page.click('.news-card button');
check(await page.locator('.update-banner').count() === 1 && await page.locator('.update-banner.fresh').count() === 0, 'banner stops pulsing once the changelog has been opened');
await page.click('.tile-quick');
await page.screenshot({ path: 'test-results/1b-setup.png' });
await page.click('button.start');
await page.waitForTimeout(2500);
await page.screenshot({ path: 'test-results/2-lights.png' });
const t0 = Date.now();
await page.waitForFunction(() => window.__game.phase === 'driving', null, { timeout: 90000 });
console.log(`countdown done ${((Date.now() - t0) / 1000 + 2.5).toFixed(1)} s after Start`);
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
// software rendering runs the game slower than real time, so wait for the slowdown rather than a fixed time
await page.keyboard.down('KeyS');
await page.waitForFunction(v => window.__game.car.speed < v, s1.speed - 10, { timeout: 30000 }).catch(() => {});
await page.keyboard.up('KeyS');
check((await state()).speed < s1.speed - 10, 'car brakes');

// race and thrusters: five rivals on the grid, boost drains the tank, a jump and a hover cost air
check(await page.evaluate(() => window.__game.race?.entrants.length === 6 && !document.querySelector('.standings').classList.contains('hidden')), 'race: six cars and the standings panel');
const tank0 = await page.evaluate(() => window.__game.jets.tank);
await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
await page.waitForTimeout(3000);
await page.keyboard.up('ShiftLeft');
const tank1 = await page.evaluate(() => window.__game.jets.tank);
// Road Thruster controls: Space jumps and holding it hovers
await page.keyboard.down('Space');
const hovered = await page.waitForFunction(() => window.__game.jets.hovering, null, { timeout: 30000 }).then(() => true, () => false);
await page.screenshot({ path: 'test-results/4b-hop.png' });
await page.keyboard.up('Space');
check(hovered, 'holding jump hovers');
await page.keyboard.up('KeyW');
const tank2 = await page.evaluate(() => window.__game.jets.tank);
console.log(`air tank: ${(tank0 * 100).toFixed(0)}% -> boost ${(tank1 * 100).toFixed(0)}% -> hop ${(tank2 * 100).toFixed(0)}%`);
check(tank1 < tank0 - 0.02, 'boost uses air');
check(tank2 < tank1 - 0.1, 'jump and hover use air');

// pause menu: Esc pauses, Resume carries on
await page.keyboard.press('Escape');
// (software rendering runs at a couple of frames a second: give the key a few frames)
check(await page.waitForFunction(() => window.__game.paused && !document.querySelector('.overlay.paused').classList.contains('hidden'), null, { timeout: 10000 }).then(() => true, () => false), 'Esc opens the pause menu');
await page.screenshot({ path: 'test-results/4c-pause.png' });
await page.click('.pause-list button:has-text("Resume")');
check(await page.evaluate(() => !window.__game.paused), 'Resume closes it');

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
await page.close();

// iPad mode: the pedals drive the car, the slider steers, the tyres and the readout show
{
  const tp = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  tp.on('pageerror', e => errors.push(e.message));
  await tp.addInitScript(() => localStorage.setItem('rd-settings', JSON.stringify({ controls: 'touch' })));
  await tp.goto(url + quality, { waitUntil: 'load' });
  await tp.waitForFunction(() => window.__game, null, { timeout: 90000 });
  await tp.click('.tile-practice', { timeout: 90000 }); await tp.click('button.start');
  await tp.waitForSelector('.pedal.gas', { state: 'visible', timeout: 60000 });
  const gas = await tp.locator('.pedal.gas').boundingBox();
  await tp.mouse.move(gas.x + gas.width / 2, gas.y + gas.height / 2); await tp.mouse.down();
  await tp.waitForFunction(() => window.__game.car.speed > 8, null, { timeout: 60000 }).catch(() => {});
  check(await tp.evaluate(() => window.__game.car.speed > 8), 'iPad: the gas pedal drives');
  await tp.evaluate(() => { const s = document.querySelector('.slider'), r = s.getBoundingClientRect();
    s.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, clientX: r.left + r.width * 0.9, clientY: r.top + 20, bubbles: true })); });
  check(await tp.waitForFunction(() => window.__game.inp.steer > 0.5, null, { timeout: 10000 }).then(() => true, () => false), 'iPad: the slider steers');
  await tp.screenshot({ path: 'test-results/8-ipad.png' });
  await tp.mouse.up();
  check(await tp.evaluate(() => document.querySelectorAll('.pedal-row .tyre').length === 4 && /\d/.test(document.querySelector('.rd-kmh').textContent)), 'iPad: four tyres and the speed readout');
  await tp.close();
}

// career: locked cars and championships, a license test, a race weekend, and a Model S race
{
  const cp = await browser.newPage({ viewport: { width: 1100, height: 620 } });
  cp.on('pageerror', e => errors.push(e.message));
  await cp.goto(url + quality, { waitUntil: 'load' });
  await cp.waitForFunction(() => window.__game, null, { timeout: 90000 });
  await cp.click('.tile-championship', { timeout: 90000 });
  check(await cp.locator('.champ .locked-note').count() === 2, 'championship: both locked until you have the cars');
  await cp.click('.card button:has-text("Back")');
  await cp.click('.tile-licenses');
  check(await cp.locator('.test-btn:not([disabled])').count() === 5, 'licenses: the five National B tests are open, the rest locked');
  await cp.click('.test-btn >> nth=0'); await cp.click('button.start');
  await cp.waitForFunction(() => window.__game.test && window.__game.cls === 'model3' && !document.querySelector('.testpanel').classList.contains('hidden'), null, { timeout: 30000 });
  check(true, 'license test: in the Model 3 with the test clock showing');
  await cp.waitForFunction(() => window.__game.phase === 'driving', null, { timeout: 60000 });
  await cp.keyboard.press('KeyR');
  check(await cp.waitForFunction(() => /TEST FAILED/.test(document.querySelector('.overlay.results')?.textContent ?? ''), null, { timeout: 10000 }).then(() => true, () => false), 'license test: a reset fails the test');
  await cp.screenshot({ path: 'test-results/9-license.png' });
  await cp.click('.results button:has-text("Licenses")');
  await cp.click('.card button:has-text("Back")');
  await cp.click('.tile-weekend');
  await cp.click('button.start');
  await cp.waitForFunction(() => window.__game.weekend?.stage === 'practice' && window.__game.phase === 'driving', null, { timeout: 30000 });
  await cp.evaluate(() => { window.__game.lapTimes.push(1); window.__game.finishSession(); });
  await cp.click('.results button:has-text("Go to qualifying")');
  await cp.waitForFunction(() => window.__game.weekend?.stage === 'qualifying', null, { timeout: 30000 });
  await cp.evaluate(() => { window.__game.lapTimes.push(1); window.__game.finishSession(); });
  check(await cp.locator('.overlay.results h2:has-text("POLE")').count() === 1, 'weekend: a quick qualifying lap takes pole');
  await cp.click('.results button:has-text("Race")');
  check(await cp.waitForFunction(() => window.__game.race?.entrants[0].name === 'You', null, { timeout: 30000 }).then(() => true, () => false), 'weekend: the race starts from pole');
  await cp.close();

  const up = await browser.newPage({ viewport: { width: 1100, height: 620 } });
  up.on('pageerror', e => errors.push(e.message));
  await up.goto(url + quality + '&unlock', { waitUntil: 'load' });
  await up.waitForFunction(() => window.__game, null, { timeout: 90000 });
  await up.click('.tile-quick', { timeout: 90000 });
  await up.click('button.seg-btn:has-text("Model S")');
  await up.click('button.start');
  await up.waitForFunction(() => window.__game.phase === 'driving', null, { timeout: 90000 });
  await up.keyboard.down('ArrowUp');
  await up.waitForFunction(() => window.__game.car.speed > 15, null, { timeout: 60000 }).catch(() => {});
  check(await up.evaluate(() => window.__game.cls === 'models' && window.__game.race.entrants.every(e => e.car.spec.topSpeed === window.__game.car.spec.topSpeed) && window.__game.car.speed > 15), 'Model S race: every car is a Model S and it drives');
  await up.screenshot({ path: 'test-results/10-models.png' });
  await up.close();
}

// the garage: a livery, rim colour and wing show on the car and are kept; then Fun Mode, where the
// course is built, every car joins in and F uses an item
{
  const fp = await browser.newPage({ viewport: { width: 1100, height: 620 } });
  fp.on('pageerror', e => errors.push(e.message));
  await fp.goto(url + quality, { waitUntil: 'load' });
  await fp.waitForFunction(() => window.__game, null, { timeout: 90000 });
  await fp.click('.tile-garage', { timeout: 90000 });
  const field = name => fp.locator('.garage-card .field', { has: fp.locator('.field-label', { hasText: new RegExp(`^${name}$`) }) });
  await field('Pattern').locator('.seg-btn', { hasText: 'Flames' }).click();
  await field('Rim colour').locator('.swatch-btn[title="Neon green"]').click();
  await field('Rear wing').locator('.seg-btn', { hasText: 'Fixed' }).click();
  const saved = await fp.evaluate(() => JSON.parse(localStorage.getItem('rd-garage') ?? '{}'));
  check(saved.pattern === 'flames' && saved.rimColor === '#7dff3a' && saved.wing === 'fixed', 'garage: the choices are saved');
  check(await fp.evaluate(() => window.__game.car.spec.liftArea > 0.9 && window.__game.model.livery?.uniforms.uLivPat.value === 4), 'garage: the wing changes the handling and the flames are on the car');
  await fp.screenshot({ path: 'test-results/11-garage.png' });
  await fp.click('.garage-card button:has-text("Done")');
  await fp.click('.tile-fun');
  await fp.click('button.start');
  await fp.waitForFunction(() => window.__game.phase === 'driving', null, { timeout: 120000 });
  const fun = await fp.evaluate(() => { const f = window.__game.fun; return f && { rings: f.layout.rings.length, ramps: f.layout.ramps.length, cars: f.cars.length }; });
  check(fun && fun.rings >= 9 && fun.ramps === 3 && fun.cars === 6, 'fun mode: rings of fire, three ramps and all six cars');
  check(await fp.evaluate(() => !document.querySelector('.funpanel').classList.contains('hidden')), 'fun mode: the item and stunt panel shows');
  await fp.evaluate(() => { const f = window.__game.fun.player; f.item = 'turbo'; f.charges = 1; });
  await fp.keyboard.press('KeyF');
  check(await fp.waitForFunction(() => window.__game.fun.player.item === null, null, { timeout: 10000 }).then(() => true, () => false), 'fun mode: F uses the item');
  await fp.screenshot({ path: 'test-results/12-fun.png' });
  await fp.close();
}

check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
await browser.close();
process.exit(failed ? 1 : 0);
