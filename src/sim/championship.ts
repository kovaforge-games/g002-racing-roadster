// Championships: a run of races in one class against a full field, scored with the usual points
// (25, 18, 15, 12, 10, 8, 6, 4, 2, 1). Finish in the top 3 overall to earn the next class.
import type { ClassId } from './classes';
import type { Difficulty } from './rival';
import type { TimeOfDay } from '../render/environment';

export interface Round { tod: TimeOfDay; laps: number }

export interface Championship {
  id: string;
  name: string;
  cls: ClassId;
  rounds: Round[];
  /** the class you earn by finishing in the top 3 overall */
  reward: ClassId;
}

export const CHAMPIONSHIPS: Championship[] = [
  { id: '0x1.5', name: '0x1.5 Championship', cls: '0x1.5', reward: '0x2.5',
    rounds: [{ tod: 'noon', laps: 3 }, { tod: 'sunset', laps: 3 }, { tod: 'night', laps: 4 }] },
  { id: '0x2.5', name: '0x2.5 Championship', cls: '0x2.5', reward: '0x3.5',
    rounds: [{ tod: 'morning', laps: 3 }, { tod: 'noon', laps: 4 }, { tod: 'sunset', laps: 4 }, { tod: 'night', laps: 5 }] },
];

export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
/** rivals in every championship race */
export const CHAMP_OPPONENTS = 7;
/** the overall finish that earns the reward */
export const REWARD_PLACE = 3;

/** a championship in progress (saved, so it can be continued later) */
export interface ChampRun {
  id: string;
  difficulty: Difficulty;
  /** the next round to race (0-based); equal to the number of rounds once it's over */
  round: number;
  points: Record<string, number>;
  /** everyone's finishing place in each round so far (the player is 'You') */
  finishes: Record<string, number[]>;
}

export const champById = (id: string) => CHAMPIONSHIPS.find(c => c.id === id)!;

export function newRun(id: string, difficulty: Difficulty): ChampRun {
  return { id, difficulty, round: 0, points: {}, finishes: {} };
}

/** score a finished round (the finishing order, winner first, the player named 'You'):
 *  adds the points, moves to the next round, and returns the points each driver scored */
export function scoreRound(run: ChampRun, order: { name: string }[]) {
  const gained: Record<string, number> = {};
  order.forEach((e, k) => {
    const p = POINTS[k] ?? 0;
    gained[e.name] = p;
    run.points[e.name] = (run.points[e.name] ?? 0) + p;
    (run.finishes[e.name] ??= []).push(k + 1);
  });
  run.round++;
  return gained;
}

/** the standings, most points first; a tie goes to whoever has more wins, then more seconds… */
export function standings(run: ChampRun) {
  const rows = Object.entries(run.points).map(([name, points]) => ({ name, points }));
  const count = (name: string, place: number) => (run.finishes[name] ?? []).filter(p => p === place).length;
  return rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    for (let p = 1; p <= 10; p++) { const d = count(b.name, p) - count(a.name, p); if (d) return d; }
    return 0;
  });
}

export const isOver = (run: ChampRun) => run.round >= champById(run.id).rounds.length;
