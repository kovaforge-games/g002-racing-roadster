// The player's settings and their last race setup, kept in localStorage.
import type { DrivingHelp } from '../sim/assist';
import type { Difficulty } from '../sim/rival';
import type { CameraMode } from '../render/cameras';
import type { Quality } from '../render/graphics';
import type { TimeOfDay } from '../render/environment';
import { migrateClass, type ClassId } from '../sim/classes';

export interface Settings {
  help: DrivingHelp;
  camera: CameraMode;
  /** 'auto' picks a preset for the device; a change applies the next time the game loads */
  quality: 'auto' | Quality;
  sound: boolean;
  /** on-screen touch controls: 'auto' shows them on touch devices */
  controls: 'auto' | 'touch' | 'keyboard';
  /** how the touch controls steer */
  steering: 'slider' | 'buttons' | 'tilt';
}

export type SessionMode = 'race' | 'practice' | 'timetrial';

/** what the race setup screen picks */
export interface RaceSetup {
  tod: TimeOfDay;
  difficulty: Difficulty;
  opponents: number;
  laps: number;
  /** the car class you race in */
  cls: ClassId;
}

const DEFAULT_SETTINGS: Settings = { help: 'easy', camera: 'chase', quality: 'auto', sound: true, controls: 'auto', steering: 'slider' };
const DEFAULT_SETUP: RaceSetup = { tod: 'noon', difficulty: 'club', opponents: 5, laps: 3, cls: 'roadster' };

function load<T extends object>(key: string, defaults: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null');
    return v && typeof v === 'object' ? { ...defaults, ...v } : { ...defaults };
  } catch { return { ...defaults }; }
}
function save(key: string, v: object) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } }

export const settings: Settings = load('rd-settings', DEFAULT_SETTINGS);
export const setup: RaceSetup = load('rd-setup', DEFAULT_SETUP);
// saves from before the Tesla line-up name the old classes
setup.cls = migrateClass(setup.cls);
export function saveSettings() { save('rd-settings', settings); }
export function saveSetup() { save('rd-setup', setup); }
/** Fun Mode's switches: rings of fire, ramps and boost pads, item boxes */
export const funSetup: { rings: boolean; ramps: boolean; items: boolean } = load('rd-fun', { rings: true, ramps: true, items: true });
export function saveFunSetup() { save('rd-fun', funSetup); }
