// Node host for parties during development (the live game uses the Durable Object in
// worker/index.ts). `npm run party-server`, then `npm run dev`: Vite proxies /ws here.
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { createPartyHandler, randomCode, clearTimers, EMPTY_TTL, type Conn, type Party } from './party-core';

const PORT = Number(process.env.PORT ?? 8787);

const parties = new Map<string, Party>();
const handler = createPartyHandler({
  newCode() { let c; do { c = randomCode(); } while (handler.inUse(parties.get(c))); return c; },
  get: code => parties.get(code),
  add: p => { parties.set(p.code, p); },
});

const http = createServer((req, res) => {
  if (req.url === '/health') { res.end('ok'); return; }
  res.writeHead(404).end('Party server: connect a WebSocket to /ws');
});

// accept /ws and <base>/ws (e.g. /games/g002/ws)
const wss = new WebSocketServer({ noServer: true });
http.on('upgrade', (req, socket, head) => {
  const path = (req.url ?? '').split('?')[0];
  if (!path.endsWith('/ws')) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
});

wss.on('connection', (ws: WebSocket) => {
  const conn: Conn = { send: d => ws.send(d), close: () => ws.close(), isOpen: () => ws.readyState === WebSocket.OPEN };
  handler.open(conn);
  ws.on('message', raw => handler.message(conn, String(raw)));
  ws.on('close', () => handler.close(conn));
});

// forget parties that have been empty for 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [code, p] of parties) if (p.emptySince && now - p.emptySince > EMPTY_TTL) { clearTimers(p); parties.delete(code); }
}, 60_000);

http.listen(PORT, () => console.log(`Party server on http://localhost:${PORT}  (WebSocket path /ws)`));
