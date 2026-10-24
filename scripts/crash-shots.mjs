// Screenshots of a crash and the flying tow: the car is driven into the barrier, then shots of
// the damage, the tow coming down, hooking, carrying, dropping the car and flying through the
// rings of fire.   node scripts/crash-shots.mjs [url]   (start `npm run dev` first)
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const exe = process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const out = process.env.OUT ?? 'test-results';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('pageerror', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('console', m.text()); });
const sep = url.includes('?') ? '&' : '?';
await page.goto(url + `${sep}quality=${process.env.QUALITY ?? 'high'}&tod=${process.env.TOD ?? 'sunset'}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game, null, { timeout: 90000 });
await page.evaluate(() => window.__game.startSession('practice'));
await page.waitForTimeout(1500);
// aim the car at the barrier at 95 km/h
await page.evaluate(() => {
  const g = window.__game, tr = g.track, s = 420;
  const a = tr.pointAt(s, 4), b = tr.pointAt(s + 5, 14);
  const head = Math.atan2(b.x - a.x, b.z - a.z);
  g.car.place(a.x, a.y, a.z, head);
  g.hint = tr.nearest(a.x, a.z).i;
  const v = 30;
  g.car.body.setLinvel({ x: Math.sin(head) * v, y: 0, z: Math.cos(head) * v }, true);
  // (no crash from the push itself)
  g.car.prevVel = { x: Math.sin(head) * v, y: 0, z: Math.cos(head) * v };
});
const shot = async name => {
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(name, JSON.stringify(await page.evaluate(() => { const g = window.__game, p = g.car.body.translation(); return { t: g.simTime.toFixed(2), stage: g.tow?.stage, worst: g.damage.worst.toFixed(2), speed: g.car.speed.toFixed(1), p: [p.x.toFixed(1), p.y.toFixed(1), p.z.toFixed(1)] }; })));
};
await page.waitForFunction(() => window.__game.damage.worst > 0.3, null, { timeout: 240000 }).catch(() => console.log('no hit?'));
await page.waitForTimeout(250);
await shot('crash-1-impact');
console.log('damage', JSON.stringify(await page.evaluate(() => window.__game.damage.zones)));
await page.waitForFunction(() => window.__game.tow, null, { timeout: 240000 });
await page.waitForTimeout(600);
await shot('crash-2-tow-coming');
// a close look at the dents, from the side the car was hit
await page.evaluate(() => {
  const g = window.__game, c = g.car.body.translation(), { fwd, right } = g.car.axes();
  g.debugCam = { pos: [c.x + fwd.x * 4.2 - right.x * 2.6, c.y + 1.5, c.z + fwd.z * 4.2 - right.z * 2.6], target: [c.x + fwd.x * 1.4, c.y + 0.2, c.z + fwd.z * 1.4] };
});
await page.waitForTimeout(400);
await shot('crash-3-dents');
await page.evaluate(() => { window.__game.debugCam = null; });
await page.waitForFunction(() => window.__game.tow?.stage === 'hook', null, { timeout: 240000 });
await page.waitForTimeout(300);
await shot('crash-4-hook');
await page.waitForFunction(() => window.__game.tow?.stage === 'carry', null, { timeout: 240000 });
await page.waitForTimeout(500);
await shot('crash-5-carry');
await page.waitForFunction(() => window.__game.tow?.stage === 'unhook', null, { timeout: 240000 });
await shot('crash-6-drop');
await page.waitForFunction(() => window.__game.tow?.rings[0]?.passed, null, { timeout: 240000 });
await page.waitForTimeout(200);
await shot('crash-7-rings');
// from behind the rings, looking back at the tow flying through
await page.evaluate(() => {
  const g = window.__game, r = g.tow.rings;
  const a = r[2].pos, b = r[0].pos;
  g.debugCam = { pos: [a.x + (a.x - b.x) * 0.35, a.y + 3, a.z + (a.z - b.z) * 0.35], target: [r[1].pos.x, r[1].pos.y, r[1].pos.z] };
});
await page.waitForFunction(() => window.__game.tow?.rings[1]?.passed, null, { timeout: 240000 }).catch(() => {});
await shot('crash-8-through-the-ring');
await page.evaluate(() => { window.__game.debugCam = null; });
await page.waitForFunction(() => !window.__game.tow, null, { timeout: 240000 }).catch(() => console.log('tow still flying'));
await shot('crash-9-after');
await browser.close();
