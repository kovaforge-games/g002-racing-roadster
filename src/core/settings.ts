// The player's settings and their last race setup, kept in localStorage.
import type { DrivingHelp } from '../sim/assist';
import type { Difficulty } from '../sim/rival';
import type { CameraMode } from '../render/cameras';
import type { Quality } from '../render/graphics';
import type { TimeOfDay } from '../render/environment';

export interface Settings {
  help: DrivingHelp;
  camera: CameraMode;
  /** 'auto' picks a preset for the device; a change applies the next time the game loads */
  quality: 'auto' | Quality;
  sound: boolean;
}

export type SessionMode = 'race' | 'practice' | 'timetrial';

/** what the race setup screen picks */
export interface RaceSetup {
  tod: TimeOfDay;
  difficulty: Difficulty;
  opponents: number;
  laps: number;
}

const DEFAULT_SETTINGS: Settings = { help: 'easy', camera: 'chase', quality: 'auto', sound: true };
const DEFAULT_SETUP: RaceSetup = { tod: 'noon', difficulty: 'club', opponents: 5, laps: 3 };

function load<T extends object>(key: string, defaults: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null');
    return v && typeof v === 'object' ? { ...defaults, ...v } : { ...defaults };
  } catch { return { ...defaults }; }
}
function save(key: string, v: object) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } }

export const settings: Settings = load('rd-settings', DEFAULT_SETTINGS);
export const setup: RaceSetup = load('rd-setup', DEFAULT_SETUP);
export function saveSettings() { save('rd-settings', settings); }
export function saveSetup() { save('rd-setup', setup); }
