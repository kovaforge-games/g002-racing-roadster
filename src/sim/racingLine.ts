// The racing line and the speed it allows, per centreline sample. Shared by the AI drivers and
// the rubbered-in stripe drawn on the road.
import type { Track } from './track';

/** lateral offset (m, positive = right) towards the inside of each corner, smoothed */
export function racingLine(track: Track) {
  const hw = track.halfWidth;
  let off = Array.from(track.curv, c => -Math.max(-1, Math.min(1, c * 500)) * (hw - 1.8));
  for (let pass = 0; pass < 3; pass++) {
    off = off.map((_, i) => {
      let sum = 0;
      for (let k = -14; k <= 14; k++) sum += off[track.wrap(i + k)];
      return sum / 29;
    });
  }
  return Float64Array.from(off);
}

/** the fastest speed (m/s) at each sample for a driver using `grip` g in corners and braking at
 *  `brake` m/s² before them; `aero` is the extra cornering grip from downforce, in m/s² per (m/s)² */
export function speedProfile(track: Track, grip = 1.3, brake = 10, vCap = 92, aero = 0) {
  const n = track.n, step = track.total / n;
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // average over ±10 m: the sampled curvature is noisy, and the line cuts across the corner
    let c = 0;
    for (let k = -5; k <= 5; k++) c += Math.abs(track.curv[track.wrap(i + k)]) / 11;
    // v² c = grip (g + aero v²): with enough downforce a corner is flat out
    const room = Math.max(c, 1e-4) - grip * aero;
    v[i] = room <= 1e-6 ? vCap : Math.min(vCap, Math.sqrt(grip * 9.81 / room));
  }
  // braking zones: walk backwards (twice round, so the wrap at the line is covered)
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      const next = v[(i + 1) % n];
      v[i] = Math.min(v[i], Math.sqrt(next * next + 2 * brake * step));
    }
  }
  return v;
}
