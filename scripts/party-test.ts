// Party server test: two drivers create and join a party by its 6-digit code, race through the
// start lights, see each other's cars and get results.
//   npm run party-test               (starts its own Node party server)
//   npm run party-test -- ws://localhost:8787/games/g002/ws   (e.g. against `wrangler dev`)
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

let url = process.argv[2];
let server: ReturnType<typeof spawn> | null = null;
if (!url) {
  const port = 18000 + Math.floor(Math.random() * 1000);
  server = spawn(process.execPath, ['--import', 'tsx','server/server.ts'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise<void>(r => server!.stdout!.once('data', () => r()));
  url = `ws://localhost:${port}/ws`;
}

let failed = false;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? '  ok ' : 'FAIL '} ${msg}`); if (!ok) failed = true; };

type Msg = Record<string, any>;
class Client {
  ws!: WebSocket;
  msgs: Msg[] = [];
  private waiters: { pred: (m: Msg) => boolean; resolve: (m: Msg) => void }[] = [];
  async open(query: string) {
    this.ws = new WebSocket(`${url}?${query}`);
    this.ws.on('message', d => {
      const m = JSON.parse(String(d)); this.msgs.push(m);
      this.waiters = this.waiters.filter(w => (w.pred(m) ? (w.resolve(m), false) : true));
    });
    await new Promise((r, j) => { this.ws.once('open', r); this.ws.once('error', j); });
    return this;
  }
  send(m: Msg) { this.ws.send(JSON.stringify(m)); }
  wait(pred: (m: Msg) => boolean, ms = 15000): Promise<Msg> {
    const seen = this.msgs.find(pred);
    if (seen) { this.msgs.splice(this.msgs.indexOf(seen), 1); return Promise.resolve(seen); }
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timed out waiting for a message')), ms);
      this.waiters.push({ pred, resolve: m => { clearTimeout(t); this.msgs.splice(this.msgs.indexOf(m), 1); resolve(m); } });
    });
  }
}

try {
  const host = await new Client().open('create=1');
  host.send({ t: 'create', clientId: 'host1', name: 'Ana', paint: 2, settings: { laps: 2 } });
  const joined = await host.wait(m => m.t === 'joined');
  check(/^[1-9]\d{5}$/.test(joined.code), `create gives a 6-digit code (${joined.code})`);

  const bad = await new Client().open('code=000000');
  bad.send({ t: 'join', code: '000000', clientId: 'x', name: 'X' });
  check((await bad.wait(m => m.t === 'error')).msg === 'No party with that code', 'an unknown code is refused');
  bad.ws.close();

  const guest = await new Client().open(`code=${joined.code}`);
  guest.send({ t: 'join', code: `${joined.code.slice(0, 3)} ${joined.code.slice(3)}`, clientId: 'guest1', name: 'Ben', paint: 4 });
  check((await guest.wait(m => m.t === 'joined')).code === joined.code, 'a friend joins with the code (spaces ignored)');
  const lobby = await host.wait(m => m.t === 'party' && m.players.length === 2);
  check(lobby.hostId === 'host1' && lobby.players.map((p: Msg) => p.name).join() === 'Ana,Ben', 'both drivers are in the lobby');
  check(lobby.settings.laps === 2, 'race settings are shared');

  guest.send({ t: 'start' });
  host.send({ t: 'start' });
  const race = await guest.wait(m => m.t === 'race');
  check(race.grid.join() === 'host1,guest1', 'the host starts the race with both on the grid');
  const lights = await guest.wait(m => m.t === 'lights' && m.n === 5);
  check(!!lights, 'start lights count up to five');
  await guest.wait(m => m.t === 'go');
  check(true, 'lights out');

  host.send({ t: 'state', s: [1, 2, 3, 0, 0, 0, 1, 50, 30, 0, 0, 2] });
  const st = await guest.wait(m => m.t === 'st');
  check(st.id === 'host1' && st.s[7] === 50, "each driver receives the other's car state");

  host.send({ t: 'finish', time: 61.5, best: 30.2 });
  guest.send({ t: 'finish', time: 63.25, best: 31 });
  const res = await guest.wait(m => m.t === 'results');
  check(res.order.map((r: Msg) => r.name).join() === 'Ana,Ben' && res.order[0].time === 61.5, 'results are in finishing order');
  check((await guest.wait(m => m.t === 'party' && m.phase === 'lobby')).phase === 'lobby', 'everyone is back in the lobby');

  host.send({ t: 'leave' });
  const after = await guest.wait(m => m.t === 'party' && m.players.length === 1);
  check(after.hostId === 'guest1', 'the host can leave and the party carries on with a new host');
  host.ws.close(); guest.ws.close();
} catch (e) {
  check(false, String(e));
}
server?.kill();
process.exit(failed ? 1 : 0);
