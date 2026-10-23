// Serves the built game from Workers static assets. The files live under /games/g002/ so the
// same build works on kovaforge.org/games/g002/ and at the root of roadster.kovaforge.org.
interface Env { ASSETS: { fetch(request: Request): Promise<Response> } }

const BASE = '/games/g002';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === BASE) return Response.redirect(`${url.origin}${BASE}/`, 301);
    if (!url.pathname.startsWith(`${BASE}/`)) url.pathname = BASE + url.pathname;
    return env.ASSETS.fetch(new Request(url.toString(), request));
  },
};
