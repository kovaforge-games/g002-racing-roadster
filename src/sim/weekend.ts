// Race weekend: free practice, then qualifying (your best lap sets your grid slot), then the race.
// The bots don't drive a qualifying session: their lap times come from each bot's pace at the
// chosen difficulty against the reference driver's flying lap in that class (timed by
// scripts/license-times.ts), with a little spread so the order isn't the same every weekend.
import type { ClassId } from './classes';
import type { RaceSetup } from '../core/settings';
import { RIVALS, rivalAt, type Difficulty } from './rival';

export type WeekendStage = 'practice' | 'qualifying' | 'race';

export interface Weekend {
  stage: WeekendStage;
  setup: RaceSetup;
  /** after qualifying: everyone's best lap (null: no lap set) and the grid, pole first */
  quali: { name: string; time: number | null }[] | null;
}

/** the reference driver's flying lap (s) in each class */
export const LAP_REF: Record<ClassId, number> = { roadster: 63.69, model3: 59.34, modelx: 56.02, models: 52.02, modely: 61.62, cybertruck: 64.23, cybercab: 64.63, semi: 72.03 };
/** qualifying laps (the first from a standing start, so the second is the flying one) */
export const QUALI_LAPS = 2;

/** a bot's qualifying lap: slower for a lower pace, with a spread that grows as consistency drops */
export function botQualiTime(k: number, cls: ClassId, d: Difficulty, rand = Math.random) {
  const def = rivalAt(RIVALS[k], d);
  return LAP_REF[cls] / def.pace * (1 + (rand() - 0.3) * 0.012 * (1.6 - def.consistency));
}

/** the qualifying order: everyone with a time, quickest first, then anyone without one */
export function qualifyingOrder(player: number | null, opponents: number, cls: ClassId, d: Difficulty, rand = Math.random) {
  const rows: { name: string; time: number | null }[] = [{ name: 'You', time: player }];
  for (let k = 0; k < opponents; k++) rows.push({ name: RIVALS[k].name, time: botQualiTime(k, cls, d, rand) });
  return rows.sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity));
}
