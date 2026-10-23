// Air canisters: the only way to refill a tank. They sit in short rows off the racing line, so
// taking air means committing to one side of the road; each one comes back a few seconds after
// it is taken, by anyone.
import type { Track } from './track';

/** arc length of each row and its side of the road (negative = left) */
const ROWS: [number, number][] = [[300, -4], [720, 3.8], [1110, -3.6], [1520, 4], [1900, -3.8], [2260, 3.6]];
const PER_ROW = 3, SPACING = 7;
export const CANISTER_AIR = 0.12;
export const CANISTER_RESPAWN = 8;
const RADIUS = 2.3;

export interface Canister { x: number; y: number; z: number; s: number; d: number; respawn: number }

export class Canisters {
  readonly list: Canister[] = [];

  constructor(track: Track) {
    for (const [s0, d] of ROWS) for (let k = 0; k < PER_ROW; k++) {
      const s = s0 + k * SPACING;
      const p = track.pointAt(s, d);
      this.list.push({ x: p.x, y: p.y, z: p.z, s, d, respawn: 0 });
    }
  }

  get rows() { return ROWS; }

  step(dt: number) { for (const c of this.list) if (c.respawn > 0) c.respawn = Math.max(0, c.respawn - dt); }

  /** a car at (x, y, z) picks up any canister it drives through; returns how many */
  collect(x: number, y: number, z: number) {
    let n = 0;
    for (const c of this.list) {
      if (c.respawn > 0) continue;
      if ((c.x - x) ** 2 + (c.z - z) ** 2 < RADIUS * RADIUS && Math.abs(c.y + 0.6 - y) < 3) { c.respawn = CANISTER_RESPAWN; n++; }
    }
    return n;
  }

  reset() { for (const c of this.list) c.respawn = 0; }
}
