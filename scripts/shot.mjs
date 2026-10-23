// Debug screenshots from fixed cameras around the car, all in one page load:
//   node scripts/shot.mjs "name:x,y,z:tx,ty,tz" ... [--query=quality=high]
// Positions starting with "car" are relative to the car (world axes).
import { chromium } from 'playwright-core';
const args = process.argv.slice(2);
const query = (args.find(a => a.startsWith('--query=')) ?? '--query=quality=high').slice(8);
const shots = args.filter(a => !a.startsWith('--')).map(a => a.split(':'));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('pageerror', e.message));
await page.goto('http://localhost:5173/?' + query);
await page.waitForFunction(() => window.__game, null, { timeout: 90000 });
await page.evaluate(() => document.querySelectorAll('.overlay, .hud').forEach(e => { e.style.display = 'none'; }));
for (const [name, pos, target] of shots) {
  await page.evaluate(([p, t]) => {
    const g = window.__game; const c = g.car.body.translation();
    const rel = s => s.startsWith('car') ? s.slice(3).split(',').map((v, i) => Number(v) + [c.x, c.y, c.z][i]) : s.split(',').map(Number);
    g.debugCam = { pos: rel(p), target: rel(t) };
  }, [pos, target]);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `test-results/${name}.png` });
}
await browser.close();
