// Licenses: drive from gate A to gate B inside the target times. Five tests per license, each in
// that license's car from a standing start at A; silver or better in all five earns the license
// and opens the next one. The targets come from a reference driver (the bots' line and braking
// at full pace, no mistakes) over the same section, timed by scripts/license-times.ts.
import type { ClassId } from './classes';
import type { Track } from './track';
import type { Medal } from '../core/progress';

export interface LicenseTest {
  name: string;
  /** what to watch for, shown before the test */
  tip: string;
  /** gate A (the start) and gate B (the finish), metres along the lap; a == b is a full lap */
  a: number;
  b: number;
  /** the reference driver's time (s) */
  ref: number;
}

export interface License {
  id: string;
  name: string;
  cls: ClassId;
  tests: LicenseTest[];
  /** the license you need first */
  needs: string | null;
  /** the car that comes with it */
  car: ClassId | null;
}

/** each medal's time as a multiple of the reference time: gold about expert pace, silver about
 *  club pace, bronze about beginner pace */
export const MEDAL_FACTOR: Record<Medal, number> = { gold: 1.02, silver: 1.07, bronze: 1.15 };
export const MEDALS: Medal[] = ['gold', 'silver', 'bronze'];

export const LICENSES: License[] = [
  { id: 'nat-b', name: 'National B', cls: 'model3', needs: null, car: 'model3', tests: [
    { name: 'Launch and brake', a: 200, b: 520, ref: 9.53, tip: 'Full power off the line, then brake hard and turn in for the long right.' },
    { name: 'The long right', a: 460, b: 800, ref: 11.67, tip: 'One long corner: be patient on the throttle and keep a smooth arc.' },
    { name: 'The hairpin', a: 1820, b: 2010, ref: 7.76, tip: 'The tightest corner on the track. Brake early, turn late, power out.' },
    { name: 'Left complex', a: 790, b: 1100, ref: 10.82, tip: 'Three lefts in a row: the middle one is the slowest.' },
    { name: 'Full lap', a: 0, b: 0, ref: 64.12, tip: 'Everything together: one clean lap from a standing start.' },
  ] },
  { id: 'nat-a', name: 'National A', cls: 'modelx', needs: 'nat-b', car: null, tests: [
    { name: 'The esses', a: 1540, b: 1840, ref: 9.10, tip: 'Left, right, left: set up each corner from the one before.' },
    { name: 'Right complex', a: 1090, b: 1560, ref: 13.47, tip: 'A long run of rights with the tightest corner in the middle.' },
    { name: 'The sweeper', a: 2270, b: 520, ref: 15.38, tip: 'The Model X is heavy: be smooth through the long sweeper and let it carry its speed.' },
    { name: 'Final sector', a: 1820, b: 2510, ref: 16.98, tip: 'Hairpin, the long right sweeper, then flat out to the line.' },
    { name: 'Full lap', a: 0, b: 0, ref: 60.29, tip: 'One clean lap in the Model X.' },
  ] },
  { id: 'int-a', name: 'International A', cls: 'models', needs: 'nat-a', car: null, tests: [
    { name: 'First sector', a: 0, b: 800, ref: 18.27, tip: 'Down the main straight at over 300 km/h and into the long right.' },
    { name: 'Middle sector', a: 790, b: 1660, ref: 22.45, tip: 'Both complexes back to back. Rhythm matters more than bravery.' },
    { name: 'Last sector', a: 1650, b: 2510, ref: 20.22, tip: 'The esses, the hairpin and the sweeper.' },
    { name: 'Hairpin to hairpin', a: 1300, b: 2010, ref: 18.37, tip: 'From the tightest right to the tightest left.' },
    { name: 'Full lap', a: 0, b: 0, ref: 56.36, tip: 'The Model S Plaid, the fastest car in the career: one perfect lap.' },
  ] },
];

export const licenseById = (id: string) => LICENSES.find(l => l.id === id)!;

/** the time each medal needs, rounded to a tenth */
export const medalTime = (t: LicenseTest, m: Medal) => Math.round(t.ref * MEDAL_FACTOR[m] * 10) / 10;

export function medalFor(t: LicenseTest, time: number): Medal | null {
  for (const m of MEDALS) if (time <= medalTime(t, m)) return m;
  return null;
}

/** silver or gold counts towards the license */
export const passes = (m: Medal | null | undefined) => m === 'gold' || m === 'silver';
const RANK: Record<Medal, number> = { gold: 3, silver: 2, bronze: 1 };
export const better = (a: Medal | null | undefined, b: Medal | null | undefined) => ((a ? RANK[a] : 0) >= (b ? RANK[b] : 0) ? a : b) ?? null;

/** distance driven from gate A towards gate B, from the track position each step */
export class TestProgress {
  dist = 0;
  private prevS: number;
  readonly length: number;

  constructor(private track: Track, readonly test: LicenseTest) {
    this.prevS = test.a;
    const L = ((test.b - test.a) % track.total + track.total) % track.total;
    this.length = L < 1 ? track.total : L;
  }

  update(s: number) {
    const T = this.track.total;
    let d = s - this.prevS;
    if (d > T / 2) d -= T;
    if (d < -T / 2) d += T;
    this.dist += d;
    this.prevS = s;
  }

  get done() { return this.dist >= this.length; }
}
