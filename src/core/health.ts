// Crash recovery and visible errors (ported from g001), mainly for iPad Safari, which silently reloads a tab
// that ran out of GPU/memory. A heartbeat in localStorage that is still fresh on the next
// load (no clean pagehide) means the last visit crashed, so we start in safe graphics.
const ALIVE = 'rd-alive', SAFE = 'rd-safe';

function store(): Storage | null { try { return localStorage; } catch { return null; } }

/** true once per load when the previous visit crashed or the player picked Safe mode */
export function safeModeRequested(): boolean {
  const ls = store();
  if (!ls) return false;
  const safe = ls.getItem(SAFE) === '1';
  const alive = Number(ls.getItem(ALIVE) ?? 0);
  ls.removeItem(SAFE);
  return safe || (alive > 0 && Date.now() - alive < 30000);
}

export function startHeartbeat() {
  const ls = store();
  if (!ls) return;
  const beat = () => { if (document.visibilityState === 'visible') ls.setItem(ALIVE, String(Date.now())); };
  beat();
  setInterval(beat, 3000);
  // a normal close, reload or switch to another tab is not a crash
  addEventListener('pagehide', () => ls.removeItem(ALIVE));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') ls.removeItem(ALIVE); else beat(); });
}

export function restartInSafeMode() {
  store()?.setItem(SAFE, '1');
  store()?.removeItem(ALIVE);
  location.reload();
}

let shown = 0;
/** small banner instead of a silent black screen; offers Safe mode and Reload */
export function showErrorBanner(msg: string) {
  if (shown++ > 2 || document.querySelector('.err-banner')) return;
  const el = document.createElement('div');
  el.className = 'err-banner';
  const p = document.createElement('p');
  p.textContent = 'Something went wrong in the game.';
  const code = document.createElement('code');
  code.textContent = msg.slice(0, 200);
  p.appendChild(code);
  const btn = (label: string, fn: () => void) => {
    const b = document.createElement('button'); b.className = 'btn small'; b.textContent = label; b.onclick = fn; return b;
  };
  el.append(p, btn('Safe mode', restartInSafeMode), btn('Reload', () => location.reload()), btn('✕', () => el.remove()));
  document.body.appendChild(el);
}

export function catchErrors() {
  addEventListener('error', e => {
    // resource load errors (images, fonts) are not crashes
    if (!(e instanceof ErrorEvent) || !e.message) return;
    showErrorBanner(e.message);
  });
  addEventListener('unhandledrejection', e => showErrorBanner(String((e.reason as Error)?.message ?? e.reason)));
}
