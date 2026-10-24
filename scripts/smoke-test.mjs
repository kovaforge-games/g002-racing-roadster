// Post-deploy check from the public internet: node scripts/smoke-test.mjs [baseUrl]
// Without an invite the game must be a plain 404 and robots.txt 200. With INVITE_CODE set in the
// environment (never logged) it also opens the invite link and checks the game page loads.
const [base = 'https://kovaforge.org/games/g002/'] = process.argv.slice(2);
const INVITE = process.env.INVITE_CODE ?? '';
const mask = s => (INVITE ? String(s).split(INVITE).join('***') : String(s));
const fail = msg => { console.error('FAIL:', mask(msg)); process.exit(1); };

try {
  for (const p of ['', 'ws', '?invite=smoke-wrong-code']) {
    const r = await fetch(new URL(p, base), { redirect: 'manual' });
    if (r.status !== 404 || r.headers.get('set-cookie')) fail(`gate: ${new URL(p, base).pathname} returned ${r.status}, expected 404`);
  }
  const robots = await fetch(new URL('/robots.txt', base));
  if (robots.status !== 200 || !(await robots.text()).includes('Disallow: /')) fail(`robots.txt returned ${robots.status}`);
  console.log(`ok  gate: ${base} is 404 without invite, robots.txt 200`);
  if (!INVITE) { console.log('::notice::INVITE_CODE not set: skipped the page check behind the gate'); process.exit(0); }
  const r = await fetch(new URL('?invite=' + encodeURIComponent(INVITE), base), { redirect: 'manual' });
  const c = r.headers.get('set-cookie') ?? '';
  const loc = r.headers.get('location') ?? '';
  if (r.status !== 302 || !c || loc.includes(INVITE)) fail(`invite link returned ${r.status}`);
  const cookie = c.split(';')[0];
  let url = new URL(loc, base), page;
  for (let i = 0; i < 3; i++) {
    page = await fetch(url, { headers: { cookie }, redirect: 'manual' });
    if (page.status !== 301 && page.status !== 302) break;
    url = new URL(page.headers.get('location'), url);
  }
  if (page.status !== 200 || !(await page.text()).includes('<title>Roadster</title>')) fail(`game page with the invite cookie returned ${page.status}`);
  console.log('ok  invite link opens the game');
  process.exit(0);
} catch (e) { fail(e.message); }
