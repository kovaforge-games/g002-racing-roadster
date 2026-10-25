// The garage: how the player's car looks and which parts it wears, kept in localStorage. Paint
// (one of the presets or any colour), its finish, a livery pattern with a second colour, the race
// number, the rims and their colour, the rear wing, the tyres, the glass tint and underglow. The
// wing and tyres change the handling too: tunedSpec and fitTyres apply them to the physics car.
import type { CarSpec, Car } from '../sim/car';
import type { Pattern, Finish } from '../render/livery';

export type RimStyle = 'aero' | 'open' | 'painted';
export type WingStyle = 'active' | 'fixed' | 'none';
export type TyreChoice = 'road' | 'sport' | 'drift';
export type GlassTint = 'gold' | 'smoke' | 'blue' | 'clear';
export type Glow = 'off' | 'cyan' | 'pink' | 'lime' | 'purple' | 'orange';

export interface GarageConfig {
  /** a preset paint (index into PAINTS), or -1 for the custom colour */
  paint: number;
  custom: string;
  finish: Finish;
  pattern: Pattern;
  second: string;
  number: number;
  showNumber: boolean;
  rims: RimStyle;
  rimColor: string;
  wing: WingStyle;
  tyres: TyreChoice;
  glass: GlassTint;
  glow: Glow;
}

export const RIM_STYLES: [RimStyle, string, string][] = [
  ['aero', 'Aero', 'Coloured spokes over white aero covers.'],
  ['open', 'Open spoke', 'Coloured spokes over a dark barrel.'],
  ['painted', 'Painted', 'The whole wheel face in the rim colour.'],
];
export const RIM_COLORS: [string, string][] = [['#0e0f11', 'Black'], ['#c9ced4', 'Silver'], ['#d4a72c', 'Gold'], ['#f2f2ef', 'White'], ['#d01818', 'Red'], ['#2fe6ff', 'Neon blue'], ['#7dff3a', 'Neon green'], ['#ff2d95', 'Neon pink']];
export const WINGS: [WingStyle, string, string][] = [
  ['active', 'Active', 'Pops up at speed, flattens for top speed and stands up under braking.'],
  ['fixed', 'Fixed high wing', 'Always up: more downforce in corners, more drag on the straights.'],
  ['none', 'Ducktail', 'Stays flush: less drag and a higher top speed, but less grip at speed.'],
];
export const TYRES: [TyreChoice, string, string][] = [
  ['road', 'Road', 'The class\'s own tyres.'],
  ['sport', 'Sport', '5% more grip, but they heat up faster and go off when overheated.'],
  ['drift', 'Drift', 'Less grip at the rear: easy slides (and slide boosts in Fun Mode).'],
];
export const GLASS: [GlassTint, string, number][] = [['gold', 'Gold', 0x7a5c22], ['smoke', 'Smoke', 0x1a1c20], ['blue', 'Blue', 0x1f4a7a], ['clear', 'Clear', 0x9aa4ad]];
export const GLOWS: [Glow, string, number][] = [['off', 'Off', 0], ['cyan', 'Cyan', 0x2fe6ff], ['pink', 'Pink', 0xff2d95], ['lime', 'Lime', 0x7dff3a], ['purple', 'Purple', 0x9b4bff], ['orange', 'Orange', 0xff8a1a]];

/** the player's number unless changed (the bots carry 1 to 11) */
export const PLAYER_NUMBER = 12;
const DEFAULT: GarageConfig = {
  paint: 0, custom: '#e10600', finish: 'factory', pattern: 'solid', second: '#111214', number: PLAYER_NUMBER, showNumber: true,
  rims: 'aero', rimColor: '#0e0f11', wing: 'active', tyres: 'road', glass: 'smoke', glow: 'off',
};
const KEY = 'rd-garage';

function load(): GarageConfig {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return v && typeof v === 'object' ? { ...DEFAULT, ...v } : { ...DEFAULT };
  } catch { return { ...DEFAULT }; }
}

export const garage: GarageConfig = load();
export function saveGarage() { try { localStorage.setItem(KEY, JSON.stringify(garage)); } catch { /* private mode */ } }
export const hex = (css: string) => parseInt(css.replace('#', ''), 16) || 0;

/** the class's spec with the wing fitted (road cars only: the single-seaters keep theirs) */
export function tunedSpec(spec: CarSpec, roadCar: boolean, g: GarageConfig = garage): CarSpec {
  if (!roadCar || g.wing === 'active') return spec;
  // (only the active wing doubles as an airbrake)
  if (g.wing === 'fixed') return { ...spec, liftArea: spec.liftArea + 0.45, dragArea: spec.dragArea + 0.06, airbrake: 0.15 };
  return { ...spec, liftArea: Math.max(0.15, spec.liftArea - 0.3), dragArea: Math.max(0.4, spec.dragArea - 0.05), airbrake: 0 };
}

/** put the chosen tyres on a physics car (front left, front right, rear left, rear right) */
export function fitTyres(car: Car, g: GarageConfig = garage) {
  const grip = g.tyres === 'sport' ? [1.05, 1.05, 1.05, 1.05] : g.tyres === 'drift' ? [1, 1, 0.84, 0.84] : [1, 1, 1, 1];
  grip.forEach((v, i) => { car.gripMul[i] = v; });
  car.heatMul = g.tyres === 'sport' ? 1.45 : 1;
}
