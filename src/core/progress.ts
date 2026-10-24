// Career progress, kept in localStorage: the cars you own, your license test medals, the licenses
// you hold and your best championship finishes. ?unlock in the address opens everything (testing).
import type { ClassId } from '../sim/classes';
import type { ChampRun } from '../sim/championship';

export type Medal = 'gold' | 'silver' | 'bronze';

export interface Progress {
  cars: ClassId[];
  /** best medal in each license test, by license id then test number */
  medals: Record<string, (Medal | null)[]>;
  licenses: string[];
  /** best overall finish in each championship */
  champs: Record<string, number>;
  /** the championship in progress, if any */
  run: ChampRun | null;
}

const KEY = 'rd-progress';
const DEFAULT: Progress = { cars: ['rental'], medals: {}, licenses: [], champs: {}, run: null };

function load(): Progress {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return v && typeof v === 'object' ? { ...DEFAULT, ...v } : JSON.parse(JSON.stringify(DEFAULT));
  } catch { return JSON.parse(JSON.stringify(DEFAULT)); }
}

export const progress: Progress = load();
const everything = typeof location !== 'undefined' && new URLSearchParams(location.search).has('unlock');

export function saveProgress() { try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch { /* private mode */ } }

export const ownsCar = (c: ClassId) => everything || progress.cars.includes(c);
export const hasLicense = (id: string) => everything || progress.licenses.includes(id);

/** add a car to the garage; true when it is new */
export function giveCar(c: ClassId) {
  if (progress.cars.includes(c)) return false;
  progress.cars.push(c); saveProgress();
  return true;
}
