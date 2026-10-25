// The pit lane: a lane on the right of the main straight, behind a pit wall, with a box for
// every car in front of the Charge Hub. Turn in at the pit entry, keep to the speed limit, stop
// in your box and the crew fit fresh tyres, fix the bodywork and top up the thrusters; then drive
// down the lane and rejoin the track at the exit. The bots stop once in a long race (or when
// their car is badly damaged). Plain math, shared by the physics test and the renderer.
import type { Car } from './car';
import type { Track } from './track';

export const PIT = {
  /** where the lane leaves the track edge, and where it has fully joined it again (arc length) */
  entry: 15, exit: 420,
  /** the lane's centre and half width (metres right of the centreline), and the fast lane
   *  beside the boxes that cars drive down */
  d: 10.6, half: 2.6, fast: 9.3,
  /** the pit wall between the track and the lane: its face (lateral) and where it runs */
  wallD: 7.7, wallFrom: 85, wallTo: 340,
  /** the speed limit (m/s, 80 km/h) and the lines where it starts and stops */
  limit: 22.2, limitFrom: 90, limitTo: 250,
  /** the boxes: the first box's arc length, the spacing, and their lateral centre */
  box0: 112, boxGap: 8, boxD: 11.8,
  /** a stop: wheels and bodywork; the longest the repairs can take */
  tyres: 2.4, repairMax: 4.5,
  /** how close (m) and how slow (m/s) a car must be to stop in its box */
  stopDist: 2.6, stopSpeed: 1.6,
};

/** the box for grid slot k */
export const boxS = (k: number) => PIT.box0 + k * PIT.boxGap;

/** the lane's centre line, lateral offset at arc length s (curving out from the track edge at
 *  the entry and back in at the exit), or null outside the lane */
export function laneD(s: number): number | null {
  if (s < PIT.entry || s > PIT.exit) return null;
  const inLen = PIT.wallFrom - PIT.entry, outLen = PIT.exit - PIT.wallTo;
  const ease = (t: number) => t * t * (3 - 2 * t);
  const edge = 5.2;
  if (s < PIT.wallFrom) return edge + (PIT.d - edge) * ease((s - PIT.entry) / inLen);
  if (s > PIT.wallTo) return PIT.d + (edge - PIT.d) * ease((s - PIT.wallTo) / outLen);
  return PIT.d;
}

/** is a point (arc length, lateral) on the pit lane's tarmac? */
export function onPitLane(s: number, d: number) {
  const c = laneD(s);
  return c !== null && Math.abs(d - c) < PIT.half + 0.4 && d > 6;
}

/** inside the speed-limit zone, in the lane */
export const inLimitZone = (s: number, d: number) => s > PIT.limitFrom && s < PIT.limitTo && onPitLane(s, d);

export type PitPhase = 'none' | 'in' | 'service' | 'out';

/** one car's pit stop, from the lane entry to the exit */
export class PitStop {
  phase: PitPhase = 'none';
  /** seconds of service left, and the whole stop's length */
  left = 0;
  total = 0;
  /** stops made this race */
  stops = 0;
  /** the time lost in the lane on the last stop, for the commentary */
  laneTime = 0;
  private entered = 0;

  constructor(readonly box: number) {}

  get boxS() { return boxS(this.box); }

  /** each step: the car's place on the track; returns 'stopped' when the service starts,
   *  'done' when it ends and 'exit' when the car leaves the lane */
  update(car: Car, s: number, d: number, time: number, dt: number, damage: number): 'stopped' | 'done' | 'exit' | null {
    const lane = onPitLane(s, d);
    car.limit = inLimitZone(s, d) ? PIT.limit : Infinity;
    if (this.phase === 'none') {
      // in the lane once past the start of the pit wall on its far side (running wide onto the
      // entry road and back doesn't count)
      if (lane && d > PIT.wallD + 0.3 && s > PIT.wallFrom - 12 && s < PIT.wallFrom + 15) { this.phase = 'in'; this.entered = time; }
      return null;
    }
    if (this.phase === 'in') {
      if (!lane) { this.phase = 'none'; return null; }
      if (Math.abs(s - this.boxS) < PIT.stopDist && Math.abs(d - PIT.boxD) < 1.8 && Math.abs(car.speed) < PIT.stopSpeed) {
        this.phase = 'service';
        this.total = this.left = PIT.tyres + PIT.repairMax * Math.min(1, damage);
        return 'stopped';
      }
      // drove past the box: a drive-through
      if (s > this.boxS + 12) this.phase = 'out';
      return null;
    }
    if (this.phase === 'service') {
      this.left -= dt;
      if (this.left <= 0) { this.left = 0; this.phase = 'out'; this.stops++; return 'done'; }
      return null;
    }
    // out: down the lane to the exit
    if (!lane || s > PIT.exit - 5) { this.phase = 'none'; car.limit = Infinity; this.laneTime = time - this.entered; return 'exit'; }
    return null;
  }

  /** the car is held still in its box while the crew work */
  get holding() { return this.phase === 'service'; }

  reset() { this.phase = 'none'; this.left = this.total = 0; this.stops = 0; }
}

/** fresh tyres on a car */
export function freshTyres(car: Car) { car.resetTyres(); }

/** pit lane geometry for the renderer: points along the lane's edges */
export function laneEdges(track: Track, step = 2) {
  const left: { s: number; d: number }[] = [], right: { s: number; d: number }[] = [];
  for (let s = PIT.entry; s <= PIT.exit; s += step) {
    const c = laneD(s)!;
    // the inner edge never crosses into the racing surface
    left.push({ s, d: Math.max(track.halfWidth + 0.4, c - PIT.half) });
    right.push({ s, d: c + PIT.half });
  }
  return { left, right };
}
