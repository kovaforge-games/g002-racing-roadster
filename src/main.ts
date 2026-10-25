// Entry point: error handling and crash recovery (from g001), physics init, then the game.
import './style.css';
import { initPhysics } from './sim/world';
import { Game } from './game';
import { Showroom } from './showroom';
import { input } from './core/input';
import { catchErrors, safeModeRequested, startHeartbeat, showErrorBanner } from './core/health';
import type { Quality } from './render/graphics';
import type { TimeOfDay } from './render/environment';
import { CLASS_ORDER, type ClassId } from './sim/classes';
import { showBootInfo } from './ui/news';
import { settings } from './core/settings';

catchErrors();

function webgl2() {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
}

async function boot() {
  if (!webgl2()) {
    document.body.innerHTML = '<div class="overlay title"><div class="brand">ROADSTER</div><p>This game needs WebGL 2. Try a recent Chrome, Edge, Firefox or Safari.</p></div>';
    return;
  }
  const params = new URLSearchParams(location.search);
  const q = params.get('quality');
  const tod = params.get('tod');
  const safe = safeModeRequested() || params.has('safe');
  const boot = document.querySelector('.boot');
  const stopTips = boot && !params.has('showroom') ? showBootInfo(boot) : () => {};
  startHeartbeat();
  input.init();
  await initPhysics();
  // let the "Loading…" frame paint before the heavy world build
  await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  // #showroom works where the query string can't be set (an embedded preview); follow hash links
  addEventListener('hashchange', () => location.reload());
  if (params.has('showroom') || location.hash === '#showroom') {
    const car = params.get('car');
    const room = new Showroom(document.getElementById('app')!, q && ['low', 'medium', 'high', 'ultra'].includes(q) ? q as Quality : 'ultra',
      car && CLASS_ORDER.includes(car as ClassId) ? car as ClassId : 'roadster');
    boot?.remove();
    document.querySelector('.overlay.title')?.remove();
    (window as unknown as { __showroom: Showroom }).__showroom = room;
    room.run();
    return;
  }
  const game = new Game(document.getElementById('app')!, {
    // ?quality= first, then the Graphics setting (it did nothing before: Auto was always used)
    quality: q && ['low', 'medium', 'high', 'ultra'].includes(q) ? q as Quality : settings.quality !== 'auto' ? settings.quality : undefined,
    tod: tod && ['morning', 'noon', 'sunset', 'night'].includes(tod) ? tod as TimeOfDay : undefined,
    safe,
    autodrive: params.has('autodrive'),
  });
  // compile the shaders behind the loading screen (in parallel where the browser can), and keep it
  // up until the first frame is drawn, so the title doesn't sit frozen while that happens
  await game.renderer.gl.compileAsync(game.scene, game.rig.cam).catch(() => {});
  (window as unknown as { __game: Game }).__game = game;
  game.renderer.gl.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); showErrorBanner('The graphics context was lost.'); });
  if (params.has('autodrive')) game.startSession('race');
  game.run();
  requestAnimationFrame(() => requestAnimationFrame(() => { stopTips(); boot?.remove(); }));
}

boot().catch(e => showErrorBanner(String(e?.message ?? e)));
