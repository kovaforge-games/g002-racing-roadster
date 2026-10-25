// The rest of the line-up beside the Roadster: Model 3, Model Y, Model S, Model X, Cybercab,
// Cybertruck and Semi, each to its published dimensions. The rounded cars (and the Semi's cab)
// are lofted: every cross-section has a flat floor, sides that bulge out and lean in to a rounded
// shoulder, and a crowned top, following side and plan profiles along the car, with the wheel
// openings cut out of it and a glasshouse lofted on the shoulders. The Cybertruck is lofted from
// flat-sided sections and flat shaded, like its steel panels. Lights, seams and trim are projected
// onto the finished body like the Roadster's. Built in a ground frame (y = 0 is the road, +z
// forward, +x the car's left), then shifted so the group's origin is the centre of mass.
// No badges or logos: the names are only in the menus.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hardpointY, type Car, type CarSpec } from '../sim/car';
import { Projector, line, mirrorX, profile } from './carBody';
import { PAINTS, glowTexture, shadowTexture } from './carModel';
import { Livery, type LiveryConfig, type LiveryShape } from './livery';
import type { RimStyle, WingStyle } from '../core/garage';

export type TeslaKind = 'model3' | 'modely' | 'models' | 'modelx' | 'cybercab' | 'cybertruck' | 'semi';

type Keys = [number, number][];
/** a rounded car, in metres in the ground frame (the wheels at z = ±wheelbase / 2): the side
 *  view is three lines (the top of the body along its centre, the shoulder line where the side
 *  turns onto the top, and the bottom edge of the side), the plan view the half width at the
 *  widest point of each section, and the glasshouse sits on top. The figures follow each car's
 *  published length, width, height, wheelbase and overhangs */
export interface Shape {
  zF: number; zR: number;
  top: Keys; belt: Keys; bottom: Keys; plan: Keys;
  /** the side leans in this far from its widest point up to the shoulder; the shoulder radius */
  tumble: number; rs: number;
  glass: Glass;
  /** headlights and tail lights: a full-width bar, or lamps from x0 to x1 (fractions of the half
   *  width) at height y, h tall; swept lamps rise towards the corner */
  head: Lamp; tail: Lamp | null;
  /** a second, lower pair of headlamps in the bumper (the Model Y's under its light bar) */
  lowLamps?: Lamp;
  /** door seams (z) and the handles; black trim along the bottom of the body (m) */
  doors: number[]; cladding: number;
  mirrors: boolean;
  /** mirrors scaled up (the Semi's) */
  mirrorScale?: number;
  livery: LiveryShape;
}
interface Lamp { bar: boolean; y: number; h: number; x0: number; x1: number }
/** the glasshouse: from the cowl (base of the windscreen) to the end of the rear glass, with
 *  the roof line along its centre and which parts are painted */
interface Glass {
  g: [number, number];
  roof: Keys;
  roofW: number; inset: number;
  /** where the windscreen meets the roof, and where the roof meets the rear glass */
  rf: number; rr: number;
  /** how much of each section (from the belt up to the centre of the roof) is side window */
  uS: number;
  roofPaint: boolean;
  aPillar: Part; cPillar: Part;
  bPillars: number[];
  /** the trim round the side windows: black, or bright (the Model S) */
  frame: Part;
  /** the Model X: a seam down the middle of the roof between the falcon-wing doors */
  spine?: boolean;
  /** behind this the side is painted, not window (the Semi's cab) */
  sideEnd?: number;
  /** close the back of the glasshouse with a painted wall (the Semi's cab) */
  capRear?: boolean;
}
type Part = 'glass' | 'paint' | 'trim' | 'chrome';

const SHAPES: Record<'model3' | 'modely' | 'models' | 'modelx' | 'cybercab', Shape> = {
  // Model 3 (2024): 4720 long, 1850 wide, 1441 tall, 2875 wheelbase. A low, smooth nose with no
  // grille and slim swept headlamps, a long raked windscreen running into an all-glass roof, a
  // short boot with a lip, and C-shaped tail lamps wrapping round the rear corners
  model3: {
    zF: 2.31, zR: -2.41,
    top: [[2.31, 0.47], [2.295, 0.55], [2.26, 0.61], [2.19, 0.66], [2.05, 0.7], [1.6, 0.78], [1.2, 0.85], [0.98, 0.9], [0.5, 0.93], [-1.0, 0.96], [-1.82, 1.0], [-2.2, 1.03], [-2.34, 1.045], [-2.39, 1.0], [-2.41, 0.9]],
    belt: [[2.31, 0.47], [2.28, 0.58], [2.22, 0.66], [2.1, 0.72], [1.7, 0.8], [1.2, 0.88], [0.98, 0.92], [0, 0.95], [-1.0, 0.98], [-1.82, 1.01], [-2.25, 1.03], [-2.36, 1.0], [-2.41, 0.9]],
    bottom: [[2.31, 0.42], [2.29, 0.32], [2.24, 0.24], [2.12, 0.19], [1.6, 0.16], [0, 0.17], [-1.8, 0.18], [-2.2, 0.25], [-2.34, 0.33], [-2.39, 0.42], [-2.41, 0.5]],
    plan: [[2.31, 0.42], [2.29, 0.58], [2.25, 0.68], [2.18, 0.77], [2.05, 0.84], [1.85, 0.88], [1.5, 0.905], [0.5, 0.912], [-1.2, 0.925], [-1.9, 0.918], [-2.22, 0.89], [-2.33, 0.83], [-2.39, 0.72], [-2.41, 0.55]],
    tumble: 0.075, rs: 0.1,
    glass: { g: [0.98, -1.84], roof: [[0.98, 0.91], [0.6, 1.12], [0.2, 1.3], [-0.1, 1.39], [-0.5, 1.441], [-0.9, 1.42], [-1.2, 1.34], [-1.55, 1.19], [-1.84, 1.01]],
      roofW: 0.6, inset: 0.05, rf: -0.06, rr: -0.98, uS: 0.42, roofPaint: false, aPillar: 'paint', cPillar: 'glass', bPillars: [-0.44], frame: 'trim' },
    head: { bar: false, y: 0.66, h: 0.04, x0: 0.52, x1: 0.93 }, tail: { bar: false, y: 0.93, h: 0.07, x0: 0.5, x1: 0.97 },
    doors: [0.66, -0.42, -1.4], cladding: 0, mirrors: true,
    livery: { front: 2.31, rear: -2.41, stripe: [0.08, 0.24], side: [0.62, 0.68, 0.035], split: [0.95, 0.98], flames: [0.3, 0.92, 0.9], door: [-0.4, 0.6, 0.46], hood: [1.55, 0.5] },
  },
  // Model Y (2025): 4790 long, 1920 wide, 1624 tall, 2890 wheelbase. The 3's face lifted into a
  // taller crossover: a light bar right across the nose with the headlamps low in the bumper, a
  // glass roof sloping into a hatch, and a light bar right across the tail
  modely: {
    zF: 2.33, zR: -2.46,
    top: [[2.33, 0.56], [2.315, 0.64], [2.28, 0.7], [2.2, 0.76], [2.05, 0.8], [1.5, 0.9], [1.15, 0.97], [0.97, 1.01], [0, 1.05], [-1.2, 1.08], [-2.06, 1.1], [-2.28, 1.11], [-2.36, 1.14], [-2.42, 1.1], [-2.46, 0.98]],
    belt: [[2.33, 0.56], [2.3, 0.67], [2.24, 0.75], [2.12, 0.82], [1.6, 0.92], [1.0, 1.01], [0, 1.05], [-1.2, 1.09], [-2.06, 1.11], [-2.34, 1.11], [-2.42, 1.05], [-2.46, 0.94]],
    bottom: [[2.33, 0.5], [2.31, 0.4], [2.26, 0.3], [2.14, 0.24], [1.6, 0.21], [0, 0.22], [-1.8, 0.23], [-2.2, 0.3], [-2.36, 0.38], [-2.43, 0.47], [-2.46, 0.56]],
    plan: [[2.33, 0.45], [2.31, 0.6], [2.27, 0.71], [2.2, 0.8], [2.08, 0.88], [1.88, 0.93], [1.5, 0.95], [0, 0.957], [-1.2, 0.96], [-1.9, 0.955], [-2.22, 0.93], [-2.36, 0.87], [-2.43, 0.76], [-2.46, 0.58]],
    tumble: 0.08, rs: 0.11,
    glass: { g: [0.97, -2.27], roof: [[0.97, 1.02], [0.6, 1.24], [0.2, 1.45], [-0.15, 1.56], [-0.6, 1.62], [-1.1, 1.6], [-1.5, 1.535], [-1.8, 1.45], [-2.02, 1.35], [-2.18, 1.24], [-2.27, 1.13]],
      roofW: 0.66, inset: 0.05, rf: -0.12, rr: -1.6, uS: 0.45, roofPaint: false, aPillar: 'paint', cPillar: 'paint', bPillars: [-0.5], frame: 'trim' },
    head: { bar: true, y: 0.79, h: 0.022, x0: 0, x1: 0.92 }, tail: { bar: true, y: 1.04, h: 0.04, x0: 0, x1: 0.96 },
    lowLamps: { bar: false, y: 0.6, h: 0.05, x0: 0.6, x1: 0.88 },
    doors: [0.66, -0.45, -1.45], cladding: 0.1, mirrors: true,
    livery: { front: 2.33, rear: -2.46, stripe: [0.08, 0.25], side: [0.7, 0.76, 0.035], split: [1.06, 1.1], flames: [0.36, 1.0, 0.92], door: [-0.4, 0.68, 0.48], hood: [1.6, 0.52] },
  },
  // Model S (2021): 4970 long, 1964 wide, 1445 tall, 2960 wheelbase. Long and low: a long bonnet,
  // larger headlamps swept round the corners, a painted roof, bright trim round the side windows,
  // and a sloping liftback
  models: {
    zF: 2.38, zR: -2.59,
    top: [[2.38, 0.47], [2.365, 0.55], [2.33, 0.62], [2.26, 0.68], [2.1, 0.73], [1.5, 0.81], [1.12, 0.88], [0.5, 0.92], [-1.0, 0.95], [-2.15, 0.99], [-2.45, 1.0], [-2.54, 0.97], [-2.59, 0.88]],
    belt: [[2.38, 0.47], [2.35, 0.58], [2.29, 0.66], [2.16, 0.72], [1.7, 0.8], [1.12, 0.89], [0, 0.93], [-1.2, 0.96], [-2.15, 0.99], [-2.48, 0.98], [-2.55, 0.95], [-2.59, 0.88]],
    bottom: [[2.38, 0.42], [2.36, 0.32], [2.31, 0.24], [2.18, 0.18], [1.6, 0.15], [0, 0.16], [-1.8, 0.17], [-2.3, 0.25], [-2.47, 0.34], [-2.56, 0.43], [-2.59, 0.52]],
    plan: [[2.38, 0.42], [2.36, 0.6], [2.32, 0.71], [2.25, 0.8], [2.12, 0.88], [1.9, 0.94], [1.5, 0.96], [0, 0.97], [-1.4, 0.982], [-2.0, 0.976], [-2.35, 0.94], [-2.48, 0.88], [-2.56, 0.76], [-2.59, 0.58]],
    tumble: 0.08, rs: 0.1,
    glass: { g: [1.12, -2.17], roof: [[1.12, 0.88], [0.72, 1.08], [0.3, 1.28], [0, 1.37], [-0.4, 1.44], [-0.9, 1.43], [-1.3, 1.36], [-1.75, 1.19], [-2.17, 0.99]],
      roofW: 0.62, inset: 0.05, rf: -0.1, rr: -1.12, uS: 0.42, roofPaint: true, aPillar: 'paint', cPillar: 'paint', bPillars: [-0.52], frame: 'chrome' },
    head: { bar: false, y: 0.64, h: 0.055, x0: 0.5, x1: 0.94 }, tail: { bar: false, y: 0.92, h: 0.06, x0: 0.45, x1: 0.97 },
    doors: [0.7, -0.48, -1.5], cladding: 0, mirrors: true,
    livery: { front: 2.38, rear: -2.59, stripe: [0.08, 0.25], side: [0.6, 0.66, 0.035], split: [0.95, 0.98], flames: [0.3, 0.9, 0.92], door: [-0.45, 0.6, 0.46], hood: [1.65, 0.52] },
  },
  // Model X: 5036 long, 1999 wide, 1684 tall, 2965 wheelbase. A tall, rounded egg of a car: a
  // panoramic windscreen that sweeps back over the front seats into the roof, falcon-wing rear
  // doors hinged at a seam down the middle of the roof, and a short sloping tail
  modelx: {
    zF: 2.43, zR: -2.6,
    top: [[2.43, 0.54], [2.415, 0.63], [2.38, 0.71], [2.3, 0.78], [2.12, 0.84], [1.6, 0.93], [1.3, 0.99], [0.5, 1.03], [-1.0, 1.08], [-2.28, 1.12], [-2.48, 1.12], [-2.56, 1.07], [-2.6, 0.98]],
    belt: [[2.43, 0.54], [2.4, 0.66], [2.34, 0.75], [2.2, 0.83], [1.7, 0.93], [1.3, 1.0], [0, 1.04], [-1.3, 1.08], [-2.28, 1.12], [-2.5, 1.1], [-2.57, 1.05], [-2.6, 0.98]],
    bottom: [[2.43, 0.48], [2.41, 0.38], [2.36, 0.29], [2.22, 0.23], [1.6, 0.2], [0, 0.21], [-1.8, 0.22], [-2.3, 0.29], [-2.47, 0.38], [-2.56, 0.48], [-2.6, 0.58]],
    plan: [[2.43, 0.44], [2.41, 0.62], [2.37, 0.74], [2.3, 0.84], [2.16, 0.92], [1.95, 0.97], [1.5, 0.99], [0, 1.0], [-1.5, 1.0], [-2.1, 0.99], [-2.4, 0.95], [-2.52, 0.88], [-2.58, 0.76], [-2.6, 0.58]],
    tumble: 0.09, rs: 0.12,
    glass: { g: [1.32, -2.38], roof: [[1.32, 1.0], [0.95, 1.22], [0.5, 1.44], [0.1, 1.58], [-0.3, 1.66], [-0.8, 1.684], [-1.3, 1.665], [-1.75, 1.6], [-2.05, 1.5], [-2.25, 1.37], [-2.38, 1.17]],
      roofW: 0.66, inset: 0.05, rf: -0.2, rr: -1.85, uS: 0.3, roofPaint: false, aPillar: 'trim', cPillar: 'paint', bPillars: [-0.42], frame: 'trim', spine: true },
    head: { bar: false, y: 0.7, h: 0.055, x0: 0.5, x1: 0.93 }, tail: { bar: false, y: 1.04, h: 0.07, x0: 0.45, x1: 0.96 },
    doors: [0.78, -0.42], cladding: 0, mirrors: true,
    livery: { front: 2.43, rear: -2.6, stripe: [0.09, 0.26], side: [0.7, 0.76, 0.035], split: [1.06, 1.1], flames: [0.36, 1.02, 0.95], door: [-0.2, 0.7, 0.5], hood: [1.75, 0.55] },
  },
  // Cybercab: the two-seat robotaxi. Short and low, a light bar right across the nose, a glass
  // canopy over the cabin, then a painted fastback with no rear window running down to a light
  // bar across the tail; butterfly doors, covered wheels and no mirrors
  cybercab: {
    zF: 2.03, zR: -2.12,
    top: [[2.03, 0.47], [2.015, 0.55], [1.98, 0.62], [1.9, 0.68], [1.75, 0.73], [1.2, 0.83], [0.92, 0.87], [0, 0.9], [-0.86, 0.93], [-0.94, 1.27], [-1.3, 1.2], [-1.7, 1.09], [-1.98, 0.99], [-2.07, 0.95], [-2.12, 0.86]],
    belt: [[2.03, 0.47], [2.0, 0.58], [1.94, 0.66], [1.82, 0.72], [1.3, 0.81], [0.92, 0.87], [0, 0.9], [-0.9, 0.93], [-1.5, 0.96], [-1.95, 0.96], [-2.07, 0.93], [-2.12, 0.86]],
    bottom: [[2.03, 0.42], [2.01, 0.32], [1.96, 0.24], [1.84, 0.19], [1.6, 0.17], [0, 0.17], [-1.7, 0.18], [-1.96, 0.25], [-2.07, 0.34], [-2.12, 0.44]],
    plan: [[2.03, 0.42], [2.01, 0.6], [1.97, 0.71], [1.9, 0.8], [1.78, 0.87], [1.55, 0.92], [1.2, 0.935], [-0.5, 0.945], [-1.4, 0.935], [-1.8, 0.91], [-1.98, 0.86], [-2.08, 0.76], [-2.12, 0.6]],
    tumble: 0.08, rs: 0.1,
    glass: { g: [0.92, -1.0], roof: [[0.92, 0.87], [0.55, 1.08], [0.15, 1.27], [-0.25, 1.36], [-0.65, 1.35], [-1.0, 1.27]],
      roofW: 0.62, inset: 0.05, rf: -0.12, rr: -1.0, uS: 0.45, roofPaint: false, aPillar: 'paint', cPillar: 'paint', bPillars: [], frame: 'trim' },
    head: { bar: true, y: 0.69, h: 0.02, x0: 0, x1: 0.93 }, tail: { bar: true, y: 0.93, h: 0.03, x0: 0, x1: 0.95 },
    doors: [0.8, -0.85], cladding: 0, mirrors: false,
    livery: { front: 2.03, rear: -2.12, stripe: [0.08, 0.24], side: [0.62, 0.66, 0.035], split: [0.93, 0.96], flames: [0.3, 0.9, 0.9], door: [-0.1, 0.6, 0.46], hood: [1.4, 0.5] },
  },
};

/** the Roadster (2nd generation): a low 2+2 with a long nose, front wings standing proud of the
 *  bonnet, slim swept headlamps, a black glass canopy (windscreen, targa roof and rear window)
 *  with sail panels sweeping down into wide rear haunches, and a ducktail (the active wing rests
 *  on it). The CarModel builds it, with its wheels and wing */
export const ROADSTER: Shape = {
  zF: 2.2, zR: -2.2,
  top: [[2.2, 0.42], [2.185, 0.5], [2.15, 0.55], [2.05, 0.59], [1.8, 0.625], [1.3, 0.675], [0.95, 0.72], [0.5, 0.77], [-0.6, 0.85], [-1.3, 0.9], [-1.8, 0.93], [-2.05, 0.935], [-2.15, 0.905], [-2.2, 0.83]],
  belt: [[2.2, 0.42], [2.17, 0.55], [2.08, 0.66], [1.85, 0.77], [1.5, 0.81], [1.2, 0.79], [0.8, 0.75], [0.2, 0.75], [-0.6, 0.81], [-1.2, 0.875], [-1.6, 0.905], [-2.0, 0.92], [-2.15, 0.885], [-2.2, 0.81]],
  bottom: [[2.2, 0.36], [2.18, 0.26], [2.1, 0.18], [1.9, 0.135], [0, 0.125], [-1.8, 0.135], [-2.05, 0.2], [-2.17, 0.3], [-2.2, 0.4]],
  plan: [[2.2, 0.5], [2.18, 0.66], [2.13, 0.78], [2.03, 0.88], [1.85, 0.95], [1.5, 0.985], [1.0, 0.965], [0.3, 0.945], [-0.5, 0.965], [-1.3, 1.0], [-1.8, 0.99], [-2.05, 0.95], [-2.16, 0.87], [-2.2, 0.75]],
  tumble: 0.09, rs: 0.09,
  glass: { g: [0.95, -1.6], roof: [[0.95, 0.72], [0.6, 0.89], [0.25, 1.04], [-0.1, 1.135], [-0.45, 1.16], [-0.8, 1.13], [-1.1, 1.06], [-1.38, 0.98], [-1.6, 0.915]],
    roofW: 0.5, inset: 0.07, rf: 0.0, rr: -0.72, uS: 0.5, roofPaint: false, aPillar: 'trim', cPillar: 'paint', bPillars: [], frame: 'trim' },
  head: { bar: false, y: 0.565, h: 0.032, x0: 0.5, x1: 0.95 }, tail: { bar: false, y: 0.84, h: 0.035, x0: 0.36, x1: 0.97 },
  doors: [0.9, -0.72], cladding: 0, mirrors: true, mirrorScale: 0.8,
  livery: { front: 2.2, rear: -2.2, stripe: [0.09, 0.27], side: [0.45, 0.6, 0.035], split: [0.62, 0.8], flames: [0.3, 0.8, 0.95], door: [0.1, 0.46, 0.42], hood: [1.42, 0.5] },
};

interface Profiles { top: (z: number) => number; belt: (z: number) => number; bottom: (z: number) => number; plan: (z: number) => number }
const profilesOf = (S: Shape): Profiles => ({ top: profile(S.top), belt: profile(S.belt), bottom: profile(S.bottom), plan: profile(S.plan) });

/** the shoulder's inner edge at z: where the side has turned onto the top (x, and its height) */
function shoulderIn(S: Shape, f: Profiles, z: number) {
  const B = f.bottom(z), Sb = f.belt(z), W = f.plan(z), h = Sb - B;
  const rs = Math.min(S.rs, h * 0.35, W * 0.3), tumble = Math.min(S.tumble, W * 0.2);
  return { x: W - tumble - rs * 1.3, y: Sb, rs, tumble };
}

/** half a cross-section of the body at z, from the bottom centre round the side to the top
 *  centre: a flat floor, a small radius onto the side, the side bulging out to its widest and
 *  leaning in to the shoulder, the shoulder, and the top crowning (or dipping) to the centre */
function bodySection(S: Shape, f: Profiles, z: number): [number, number][] {
  const B = f.bottom(z), Sb = f.belt(z), T = f.top(z), W = f.plan(z), h = Sb - B;
  const { rs, tumble } = shoulderIn(S, f, z);
  const rb = Math.min(0.07, h * 0.25, W * 0.2);
  const Wb = W - 0.055, Wt = W - tumble, rsx = rs * 1.3;
  const pts: [number, number][] = [];
  for (let k = 0; k < 3; k++) pts.push([(Wb - rb) * k / 3, B]);
  for (let k = 0; k <= 3; k++) { const a = -Math.PI / 2 + (k / 3) * Math.PI / 2; pts.push([Wb - rb + rb * Math.cos(a), B + rb + rb * Math.sin(a)]); }
  const y0 = B + rb, y3 = Math.max(y0 + 0.01, Sb - rs), span = y3 - y0;
  const P = [[Wb, y0], [W, y0 + span * 0.35], [W, y0 + span * 0.62], [Wt, y3]];
  for (let k = 1; k <= 8; k++) {
    const t = k / 8, a = (1 - t) ** 3, b = 3 * (1 - t) ** 2 * t, c = 3 * (1 - t) * t * t, d = t ** 3;
    pts.push([a * P[0][0] + b * P[1][0] + c * P[2][0] + d * P[3][0], a * P[0][1] + b * P[1][1] + c * P[2][1] + d * P[3][1]]);
  }
  for (let k = 1; k <= 5; k++) { const a = (k / 5) * Math.PI / 2; pts.push([Wt - rsx + rsx * Math.cos(a), y3 + rs * Math.sin(a)]); }
  const xe = Wt - rsx, ye = y3 + rs;
  for (let k = 1; k <= 8; k++) { const x = xe * (1 - k / 8); pts.push([x, T + (ye - T) * (x / xe) ** 2]); }
  return pts;
}

/** bodySection's points up to the top of the side: the floor (3), the lower corner (4) and the
 *  side (8); the shoulder and the top after them are never cut by the arches */
const SIDE_POINTS = 15;

/** the top of the wheel openings at z: round arches a little bigger than the wheels (one radius
 *  for all of them, or one each) */
function archTop(z: number, wheels: number[], R: number | number[], gap: number) {
  let y = -Infinity;
  wheels.forEach((c, i) => {
    const r = Array.isArray(R) ? R[i] : R, ra = r + gap, dz = Math.abs(z - c);
    if (dz < ra) y = Math.max(y, r + Math.sqrt(ra * ra - dz * dz));
  });
  return y;
}

/** a mesh from rings of points along z, with each quad's material picked by `part` (from its
 *  centre); rings closed round (the body) or open (the glass) */
function ringMesh(rings: THREE.Vector3[][], closed: boolean, part: (c: THREE.Vector3, i: number, k: number) => number, parts: number) {
  const pos: number[] = [];
  const m = rings[0].length;
  for (const r of rings) for (const p of r) pos.push(p.x, p.y, p.z);
  const groups: number[][] = Array.from({ length: parts }, () => []);
  const c = new THREE.Vector3();
  for (let i = 1; i < rings.length; i++) {
    for (let k = 0; k < (closed ? m : m - 1); k++) {
      const k1 = (k + 1) % m, a = (i - 1) * m + k, b = (i - 1) * m + k1, d = i * m + k, e = i * m + k1;
      c.copy(rings[i - 1][k]).add(rings[i - 1][k1]).add(rings[i][k]).add(rings[i][k1]).multiplyScalar(0.25);
      groups[part(c, i, k)].push(a, d, b, b, d, e);
    }
  }
  return { pos, groups };
}

function finishGeometry(pos: number[], groups: number[][]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const idx: number[] = [];
  groups.forEach((list, mi) => { if (list.length) { g.addGroup(idx.length, list.length, mi); idx.push(...list); } });
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** the body: sections lofted from nose to tail with the wheel openings cut out of the sides,
 *  capped at both ends. Materials: 0 paint, 1 black trim (wheel wells, cladding) */
export function buildBody(S: Shape, wheels: number[], R: number | number[], n = 200, gap = 0.045) {
  const f = profilesOf(S);
  const rings: THREE.Vector3[][] = [];
  for (let i = 0; i <= n; i++) {
    const z = S.zF + ((S.zR - S.zF) * i) / n;
    const half = bodySection(S, f, z), A = archTop(z, wheels, R, gap);
    // the openings are cut up the sides; the floor between them rises with them as the wheel
    // wells, but stays under the bonnet where that is lower than the arches (the Roadster's)
    const T = f.top(z), well = Math.min(A, T - 0.04);
    const cut = (p: [number, number], k: number) => new THREE.Vector3(p[0], k < 3 ? Math.max(p[1], well) : k < SIDE_POINTS ? Math.max(p[1], A) : p[1], z);
    const ring = half.map(cut);
    for (let k = half.length - 2; k >= 1; k--) { const v = cut(half[k], k); v.x = -v.x; ring.push(v); }
    rings.push(ring);
  }
  // which point of the half section each ring point is (the second half is mirrored)
  const m = rings[0].length, nh = (m + 2) / 2, h = (j: number) => (j < nh ? j : m - j);
  const part = (c: THREE.Vector3, _i: number, k: number) => {
    const A = archTop(c.z, wheels, R, gap), lower = Math.max(h(k), h((k + 1) % m)) < SIDE_POINTS;
    if (A > 0 && lower && c.y < A + 0.004 && Math.abs(c.x) < f.plan(c.z) - 0.03) return 1;
    if (S.cladding && c.y < f.bottom(c.z) + S.cladding) return 1;
    return 0;
  };
  const { pos, groups } = ringMesh(rings, true, part, 2);
  // caps at the nose and the tail: a fan from each end ring's middle
  for (const [i, flip] of [[0, false], [n, true]] as const) {
    const r = rings[i], m = r.length, base = i * m;
    let cy = 0; for (const p of r) cy += p.y; cy /= m;
    const c = pos.length / 3; pos.push(0, cy, r[0].z);
    for (let k = 0; k < m; k++) { const k1 = (k + 1) % m; groups[0].push(...(flip ? [c, base + k1, base + k] : [c, base + k, base + k1])); }
  }
  return finishGeometry(pos, groups);
}

/** half a section of the glasshouse at z, from the shoulder up to the middle of the roof */
function glassSection(S: Shape, f: Profiles, roof: (z: number) => number, z: number, M: number) {
  const G = S.glass, sh = shoulderIn(S, f, z), T = f.top(z);
  const x0 = Math.max(0.05, sh.x - G.inset), y0 = T + (sh.y - T) * (x0 / Math.max(0.05, sh.x)) ** 2 - 0.006;
  const y1 = Math.max(y0, roof(z)), x1 = Math.min(x0, G.roofW), H = y1 - y0;
  const half: THREE.Vector3[] = [];
  for (let k = 0; k <= M; k++) {
    const ph = (k / M) * Math.PI / 2;
    const y = y0 + H * Math.pow(Math.sin(ph), 2 / 3.4);
    const A = x0 + (x1 - x0) * (H > 0.001 ? (y - y0) / H : 0);
    half.push(new THREE.Vector3(A * Math.pow(Math.cos(ph), 2 / 3.4), y, z));
  }
  return half;
}

/** the outline of the back of the Semi's cab above the skirts, carried on backwards as a thin
 *  shell (both faces): the cab extenders and the roof fairing */
function semiExtenders(S: Shape, depth: number) {
  const f = profilesOf(S), z = S.zR;
  const half = [
    ...bodySection(S, f, z).filter(([x, y]) => y > 1.1 && x > 0.5).map(([x, y]) => new THREE.Vector3(x, y, z)),
    ...glassSection(S, f, profile(S.glass.roof), z, 24),
  ];
  const ring = [...half, ...half.slice().reverse().map(v => new THREE.Vector3(-v.x, v.y, z))];
  const pos: number[] = [], idx: number[] = [], m = ring.length;
  for (const d of [0.02, -depth]) for (const p of ring) pos.push(p.x, p.y, z + d);
  for (let k = 0; k < m - 1; k++) idx.push(k, k + m, k + 1, k + 1, k + m, k + m + 1, k, k + 1, k + m, k + 1, k + m + 1, k + m);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const out = g.toNonIndexed();
  out.computeVertexNormals();
  return out;
}

/** the glasshouse, lofted on top of the body's shoulders. Materials: 0 glass, 1 paint, 2 black
 *  trim, 3 bright trim */
export function buildGlass(S: Shape, n = 180, M = 40) {
  const f = profilesOf(S), G = S.glass, roof = profile(G.roof);
  const rings: THREE.Vector3[][] = [];
  const zs: number[] = [];
  for (let i = 0; i <= n; i++) {
    const z = G.g[0] + ((G.g[1] - G.g[0]) * i) / n; zs.push(z);
    const half = glassSection(S, f, roof, z, M);
    const ring = [...half];
    for (let k = M - 1; k >= 0; k--) ring.push(new THREE.Vector3(-half[k].x, half[k].y, z));
    rings.push(ring);
  }
  const code: Record<Part, number> = { glass: 0, paint: 1, trim: 2, chrome: 3 };
  const part = (_c: THREE.Vector3, i: number, k: number) => {
    const z = (zs[i - 1] + zs[i]) / 2, kk = k + 0.5;
    const u = kk <= M ? kk / M : (2 * M - kk) / M;
    const aw = 0.05;
    if (u < 0.03) return code[G.frame];
    if (z > G.rf) {
      // the windscreen: the A-pillar runs from the cowl corner up to the front corner of the roof
      const uA = G.uS * (G.g[0] - z) / (G.g[0] - G.rf);
      if (Math.abs(u - uA) < aw) return code[G.aPillar];
      if (u < uA && Math.abs(u - uA) < aw + 0.03) return code[G.frame];
      return 0;
    }
    if (z < G.rr) {
      const uC = G.uS * (z - G.g[1]) / (G.rr - G.g[1]);
      if (Math.abs(u - uC) < aw) return code[G.frame];
      if (u < uC) return code[G.cPillar];
      return 0;
    }
    if (G.spine && u > 0.975) return code.trim;
    if (u > G.uS + 0.03) return G.roofPaint ? code.paint : 0;
    if (u > G.uS - 0.02) return code[G.frame];
    if (G.sideEnd !== undefined && z < G.sideEnd) return z > G.sideEnd - 0.06 ? code[G.frame] : code.paint;
    for (const b of G.bPillars) if (Math.abs(z - b) < 0.055) return code.trim;
    return 0;
  };
  const { pos, groups } = ringMesh(rings, false, part, 4);
  if (G.capRear) {
    // a fan from the middle of the last section's base, facing backwards
    const r = rings[n], base = n * r.length, c = pos.length / 3;
    pos.push(0, r[0].y, r[0].z);
    for (let k = 0; k < r.length - 1; k++) groups[1].push(c, base + k + 1, base + k);
  }
  return finishGeometry(pos, groups);
}

/** straight lines through (z, value) keys, z falling from the nose to the tail */
const lin = (keys: Keys) => (z: number) => {
  if (z >= keys[0][0]) return keys[0][1];
  for (let k = 0; k < keys.length - 1; k++) {
    const [z0, v0] = keys[k], [z1, v1] = keys[k + 1];
    if (z >= z1) return v0 + ((v1 - v0) * (z0 - z)) / (z0 - z1);
  }
  return keys[keys.length - 1][1];
};

/** the Cybertruck (5683 long, 2000 wide, 1791 tall): every section is a box with vertical sides
 *  up to the crease, upper panels leaning in from the crease to the top, and a flat top. The top
 *  runs straight from the nose up to the apex over the front seats (bonnet and windscreen in one
 *  plane) and straight down to the end of the bed */
const CT = {
  zF: 2.84, zR: -2.84, lean: 0.36,
  top: lin([[2.84, 1.06], [0.15, 1.79], [-2.84, 1.25]]),
  crease: lin([[2.84, 1.0], [-2.84, 1.2]]),
  bottom: lin([[2.84, 0.99], [2.74, 0.56], [2.6, 0.44], [-2.62, 0.44], [-2.8, 0.58], [-2.84, 0.62]]),
  plan: lin([[2.84, 0.95], [2.7, 1.0], [-2.84, 1.0]]),
};

/** the Cybertruck's arches: flat across the top, straight sides sloping down and out */
const cyberArchHalf = (R: number) => R * 0.62 + (2 * R + 0.1 - 0.44) / 1.7;
function cyberArch(z: number, wheels: number[], R: number) {
  let y = -Infinity;
  for (const c of wheels) {
    const dz = Math.abs(z - c), top = 2 * R + 0.1, flat = R * 0.62;
    if (dz < flat) y = Math.max(y, top);
    else if (top - (dz - flat) * 1.7 > 0) y = Math.max(y, top - (dz - flat) * 1.7);
  }
  return y;
}

function cyberSection(z: number) {
  const B = CT.bottom(z), T = CT.top(z), W = CT.plan(z);
  const c = Math.min(Math.max(CT.crease(z), B + 0.02), T - 0.02), H = T - c;
  const wt = W - CT.lean * H - 0.015, b = Math.min(0.05, (c - B) * 0.4);
  const pts: [number, number][] = [[0, B], [W * 0.5, B], [W - b, B]];
  for (let k = 0; k <= 6; k++) pts.push([W, B + b + ((c - B - b) * k) / 6]);
  // the upper panel, with rows where the side windows start and stop
  const u1 = Math.min(0.05 / H, 0.3), u2 = Math.max(1 - 0.06 / H, 0.7);
  for (const u of [u1, ...[1, 2, 3, 4, 5].map(k => u1 + ((u2 - u1) * k) / 6), u2, 1]) pts.push([W + (wt - W) * u, c + H * u]);
  for (const x of [wt - 0.06, (wt - 0.06) * 0.66, (wt - 0.06) * 0.33, 0]) pts.push([x, T]);
  return { pts, B, T, W, c, H, wt, u1, u2 };
}

/** the Cybertruck's body, flat shaded. Materials: 0 steel, 1 glass, 2 black */
function buildCyber(wheels: number[], R: number, n = 240) {
  const rings: THREE.Vector3[][] = [];
  for (let i = 0; i <= n; i++) {
    const z = CT.zF + ((CT.zR - CT.zF) * i) / n, { pts } = cyberSection(z), A = cyberArch(z, wheels, R);
    const ring: THREE.Vector3[] = [];
    const cut = (p: [number, number]) => new THREE.Vector3(p[0], Math.max(p[1], A), z);
    for (const p of pts) ring.push(cut(p));
    for (let k = pts.length - 2; k >= 1; k--) { const v = cut(pts[k]); v.x = -v.x; ring.push(v); }
    rings.push(ring);
  }
  const part = (p: THREE.Vector3) => {
    const z = p.z, x = Math.abs(p.x), { B, T, W, c, H, wt, u1, u2 } = cyberSection(z), A = cyberArch(z, wheels, R);
    if (A > 0 && p.y < A + 0.004 && x < W - 0.03) return 2;
    // under the body, and the lower bumpers below the nose and the tailgate
    if (p.y < B + 0.004 && x < W - 0.04) return z > 2.745 ? 0 : 2;
    if (p.y > T - 0.004) {
      if (x > wt - 0.06) return 0;
      // the windscreen up to the apex, the glass roof behind it, and the vault over the bed
      if ((z < 1.32 && z > 0.2) || (z < 0.1 && z > -0.78)) return 1;
      return z < -0.9 ? 2 : 0;
    }
    if (p.y > c + 0.002 && x < W - 0.002) {
      const u = (p.y - c) / H;
      if (Math.abs(z - 0.12) < 0.04 && u > u1 - 0.02) return 2;
      if (u > u1 && u < u2 && z < 1.2 && z > -0.8) return 1;
    }
    return 0;
  };
  const { pos, groups } = ringMesh(rings, true, part, 3);
  for (const [i, flip] of [[0, false], [n, true]] as const) {
    const r = rings[i], m = r.length, base = i * m;
    let cy = 0; for (const p of r) cy += p.y; cy /= m;
    const c = pos.length / 3; pos.push(0, cy, r[0].z);
    for (let k = 0; k < m; k++) { const k1 = (k + 1) % m; groups[0].push(...(flip ? [c, base + k1, base + k] : [c, base + k, base + k1])); }
  }
  const g = finishGeometry(pos, groups).toNonIndexed();
  g.computeVertexNormals();
  return g;
}

const TRUCK_LIVERY: LiveryShape = { front: 2.84, rear: -2.84, stripe: [0.1, 0.3], side: [0.75, 0.8, 0.04], split: [1.1, 1.2], flames: [0.5, 1.05, 0.95], door: [0.2, 0.8, 0.55], hood: [1.9, 0.6] };
/** the Semi's cab over the front axle (the tractor is 7 m long and 2.55 m wide): a rounded nose
 *  with a light bar, a huge wrap-round windscreen raked back like a bullet train's, a tall
 *  rounded roof, and a day cab whose back wall carries on in extenders */
const SEMI: Shape = {
  zF: 3.45, zR: -0.4,
  top: [[3.45, 0.66], [3.44, 1.0], [3.39, 1.32], [3.28, 1.58], [3.14, 1.74], [3.05, 1.8], [2.6, 1.95], [2.0, 2.06], [1.0, 2.12], [-0.4, 2.15]],
  belt: [[3.45, 0.66], [3.43, 0.98], [3.37, 1.28], [3.25, 1.55], [3.1, 1.72], [2.8, 1.86], [2.3, 1.98], [1.6, 2.06], [0, 2.12], [-0.4, 2.13]],
  bottom: [[3.45, 0.6], [3.43, 0.5], [3.36, 0.43], [3.2, 0.4], [2.2, 0.42], [1.0, 0.46], [-0.4, 0.5]],
  plan: [[3.45, 0.62], [3.44, 0.86], [3.4, 1.0], [3.32, 1.1], [3.18, 1.18], [2.95, 1.24], [2.5, 1.27], [-0.4, 1.275]],
  tumble: 0.05, rs: 0.16,
  glass: { g: [3.05, -0.4], roof: [[3.05, 1.8], [2.7, 2.28], [2.3, 2.78], [1.9, 3.18], [1.45, 3.5], [0.9, 3.72], [0.2, 3.82], [-0.4, 3.83]],
    roofW: 1.0, inset: 0.03, rf: 1.7, rr: -0.38, uS: 0.52, roofPaint: true, aPillar: 'paint', cPillar: 'paint', bPillars: [], frame: 'trim', sideEnd: 0.68, capRear: true },
  head: { bar: true, y: 1.46, h: 0.028, x0: 0, x1: 0.9 }, tail: null,
  lowLamps: { bar: false, y: 1.27, h: 0.08, x0: 0.6, x1: 0.93 },
  doors: [1.62, 0.62], cladding: 0.14, mirrors: true, mirrorScale: 1.9,
  livery: { front: 3.45, rear: -1.6, stripe: [0.12, 0.34], side: [1.5, 1.5, 0.06], split: [1.9, 2.05], flames: [0.7, 2.1, 1.2], door: [1.1, 1.5, 0.75], hood: null },
};

/** a side outline (z, y pairs, nose first, any winding) extruded across the car's width */
function extrudeSide(outline: [number, number][], halfW: number, bevel: number, segments = 2) {
  const s = new THREE.Shape();
  // shape x = -z, so the extrusion turned a quarter round puts the nose at +z
  outline.forEach(([z, y], k) => (k ? s.lineTo(-z, y) : s.moveTo(-z, y)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 2 * (halfW - bevel), bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: segments, curveSegments: 6 });
  g.rotateY(Math.PI / 2);
  g.translate(-(halfW - bevel), 0, 0);
  return g.index ? g : g;
}

/** a tyre (rounded shoulders) with the face towards +x */
function tyreGeometry(r: number, w: number) {
  const pts: THREE.Vector2[] = [];
  const rim = r * 0.73;
  pts.push(new THREE.Vector2(rim, -w / 2));
  for (let k = 0; k <= 12; k++) {
    const a = -Math.PI / 2 + (k / 12) * Math.PI;
    pts.push(new THREE.Vector2(r - 0.04 + Math.cos(a) * 0.04, Math.sin(a) * (w / 2 - 0.01)));
  }
  pts.push(new THREE.Vector2(rim, w / 2));
  return new THREE.LatheGeometry(pts, 40).rotateZ(-Math.PI / 2);
}

/** an aero wheel face: spokes in the rim colour over a dark centre, with a cap; or (0 spokes) a
 *  smooth cover over the whole wheel, as on the Cybercab */
function wheelTexture(spokes: number) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const c = cv.getContext('2d')!;
  if (!spokes) {
    const g = c.createRadialGradient(128, 128, 10, 128, 128, 128);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.75, '#d0d3d6'); g.addColorStop(0.97, '#9ea3a8'); g.addColorStop(1, '#2a2c2f');
    c.fillStyle = g; c.beginPath(); c.arc(128, 128, 127, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 3; c.beginPath(); c.arc(128, 128, 96, 0, Math.PI * 2); c.stroke();
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  }
  c.fillStyle = '#16171a'; c.beginPath(); c.arc(128, 128, 126, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#ffffff';
  for (let k = 0; k < spokes; k++) {
    c.save(); c.translate(128, 128); c.rotate((k / spokes) * Math.PI * 2);
    c.beginPath(); c.moveTo(-9, 20); c.lineTo(-20, 118); c.lineTo(20, 118); c.lineTo(9, 20); c.fill();
    c.restore();
  }
  c.lineWidth = 12; c.strokeStyle = '#ffffff'; c.beginPath(); c.arc(128, 128, 118, 0, Math.PI * 2); c.stroke();
  c.fillStyle = '#d9dbde'; c.beginPath(); c.arc(128, 128, 26, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#16171a'; c.beginPath(); c.arc(128, 128, 9, 0, Math.PI * 2); c.fill();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/** lights, the intake, door seams and handles, and mirrors on a rounded body */
export function shapeDetails(shell: THREE.Group, S: Shape, body: THREE.Mesh, m: { paint: THREE.Material; glass: THREE.Material; trim: THREE.Material; head: THREE.Material; brake: THREE.Material }) {
  const trim = m.trim;
  const pr = new Projector(body), f = profilesOf(S);
  const put = (geos: THREE.BufferGeometry[], mat: THREE.Material) => geos.forEach(g => shell.add(new THREE.Mesh(g, mat)));
  const W = Math.max(...S.plan.map(k => k[1])), F = S.zF + 1, B = S.zR - 1;
  const back = new THREE.Vector3(0, 0, -1), fwd = new THREE.Vector3(0, 0, 1), side = new THREE.Vector3(-1, 0, 0);
  /** how far along the car the body reaches out to x (from the nose or the tail) */
  const reach = (x: number, front: boolean) => {
    for (let k = 0; k <= 300; k++) { const z = front ? S.zF - (S.zF * k) / 300 : S.zR - (S.zR * k) / 300; if (f.plan(z) >= x + 0.01) return z; }
    return 0;
  };
  const lamp = (spec: Lamp, front: boolean, light: THREE.Material) => {
    const z = front ? F : B, dir = front ? back : fwd;
    if (spec.bar) {
      put(pr.strip(line([-W * spec.x1, spec.y + spec.h, z], [W * spec.x1, spec.y + spec.h, z], 48), line([-W * spec.x1, spec.y, z], [W * spec.x1, spec.y, z], 48), dir, 0.005, false), light);
      return;
    }
    // aimed in from the corner so the lamp wraps round onto the wing
    const d = new THREE.Vector3(-0.75, 0, front ? -1 : 1).normalize();
    const at = (x: number, y: number) => new THREE.Vector3(x - d.x * 1.5, y, reach(x, front) - d.z * 1.5);
    const up: THREE.Vector3[] = [], lo: THREE.Vector3[] = [], mid: THREE.Vector3[] = [];
    for (let k = 0; k <= 18; k++) {
      const t = k / 18, x = W * (spec.x0 + (spec.x1 - spec.x0) * t);
      // swept: slim at the inner end, taller and higher towards the corner
      const yc = spec.y + spec.h * 0.5 * t;
      up.push(at(x, yc + spec.h * (0.35 + 0.4 * t)));
      lo.push(at(x, yc - spec.h * (0.35 + 0.2 * t)));
      mid.push(at(x, yc + spec.h * (0.05 + 0.15 * t)));
    }
    // a dark glass housing with the light along its upper part
    put(pr.strip(up, lo, d, 0.004), m.glass);
    put(pr.strip(up, mid, d, 0.007), light);
  };
  lamp(S.head, true, m.head);
  if (S.tail) lamp(S.tail, false, m.brake);
  if (S.lowLamps) lamp(S.lowLamps, true, m.head);
  // no grille: a slim black intake low in the bumper
  const yb = f.bottom(S.zF - 0.08);
  put(pr.strip(line([-W * 0.36, yb + 0.12, F], [W * 0.36, yb + 0.12, F], 24), line([-W * 0.34, yb + 0.075, F], [W * 0.34, yb + 0.075, F], 24), back, 0.004, false), trim);
  // a black diffuser across the bottom of the rear bumper
  const yr = f.bottom(S.zR + 0.08);
  put(pr.strip(line([-W * 0.7, yr + 0.1, B], [W * 0.7, yr + 0.1, B], 24), line([-W * 0.7, yr, B], [W * 0.7, yr, B], 24), fwd, 0.004, false), trim);
  // door seams (shut lines) and flush handles
  for (const z of S.doors) {
    const yt = f.belt(z) - 0.03, yl = f.bottom(z) + 0.05;
    put(pr.strip(line([W + 1, yt, z + 0.004], [W + 1, yl, z + 0.03], 16), line([W + 1, yt, z - 0.004], [W + 1, yl, z + 0.022], 16), side, 0.003), trim);
  }
  for (let k = 0; k < S.doors.length - 1; k++) {
    const z = S.doors[k] - 0.22, y = f.belt(z) - 0.13;
    put(pr.strip(line([W + 1, y + 0.022, z], [W + 1, y + 0.022, z - 0.17], 6), line([W + 1, y, z], [W + 1, y, z - 0.17], 6), side, 0.004), trim);
  }
  // mirrors on stalks from the front of the doors, below the A-pillars
  if (S.mirrors) {
    const mz = S.glass.g[0] - 0.3, sh = shoulderIn(S, f, mz), my = sh.y + 0.075, mx = f.plan(mz) - S.tumble;
    const k = S.mirrorScale ?? 1;
    const housing = new THREE.SphereGeometry(0.1 * k, 20, 14).scale(1.05, 0.62, 0.72);
    const stalk = new THREE.BoxGeometry(0.12 * k, 0.03 * k, 0.06 * k);
    for (const sx of [-1, 1]) {
      const h = new THREE.Mesh(housing, m.paint);
      h.position.set(sx * (mx + 0.1 * k), my, mz - 0.03 * k); h.rotation.y = sx * 0.12;
      // the dark mirror glass faces backwards
      const glassFace = new THREE.Mesh(new THREE.CircleGeometry(0.075 * k, 20).scale(1.2, 0.68, 1), m.glass);
      glassFace.position.set(sx * (mx + 0.1 * k), my, mz - 0.098 * k); glassFace.rotation.y = Math.PI;
      const st = new THREE.Mesh(stalk, trim);
      st.position.set(sx * (mx + 0.01 * k), my - 0.03 * k, mz);
      shell.add(h, glassFace, st);
    }
  }
}

export class TeslaModel {
  readonly root = new THREE.Group();
  private shell = new THREE.Group();
  private wheels: { pivot: THREE.Group; spin: THREE.Group; extra: THREE.Group | null; left: boolean }[] = [];
  readonly paint: THREE.MeshPhysicalMaterial;
  private glass: THREE.MeshPhysicalMaterial;
  private brakeLight: THREE.MeshStandardMaterial;
  private headLight: THREE.MeshStandardMaterial;
  private rimMat: THREE.MeshStandardMaterial;
  private reflective: THREE.MeshStandardMaterial[] = [];
  private paintIndex = 0;
  private roll = 0; private pitch = 0;
  private livery: Livery | null = null;
  private liveryShape: LiveryShape;
  private glowMat: THREE.MeshBasicMaterial; private glow: THREE.Mesh;
  /** no active wing: no spoiler call-outs */
  onSpoiler?: (up: boolean) => void;

  constructor(readonly kind: TeslaKind, private spec: CarSpec) {
    const p = PAINTS[0];
    this.paint = new THREE.MeshPhysicalMaterial({ color: p.color, metalness: p.metalness, roughness: p.roughness, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 1.15 });
    this.glass = new THREE.MeshPhysicalMaterial({ color: 0x14181d, metalness: 0.35, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 1.6, side: THREE.DoubleSide });
    const trim = new THREE.MeshPhysicalMaterial({ color: 0x0b0b0c, roughness: 0.45, metalness: 0.2, clearcoat: 0.4 });
    const under = new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.9 });
    this.headLight = new THREE.MeshStandardMaterial({ color: 0xeaf4ff, emissive: 0xeaf6ff, emissiveIntensity: 0.6, roughness: 0.2 });
    this.brakeLight = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1020, emissiveIntensity: 1.2, roughness: 0.3 });
    this.rimMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, map: wheelTexture(kind === 'semi' ? 10 : kind === 'cybertruck' ? 6 : kind === 'cybercab' ? 0 : 5), roughness: 0.35, metalness: 0.6 });
    this.reflective.push(this.paint, this.glass, trim);

    this.shell.position.y = -spec.comHeight;
    this.root.add(this.shell);
    const R = spec.wheelRadius, wz = spec.wheelbase / 2;
    const add = (g: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], shadow = true) => {
      const mesh = new THREE.Mesh(g, m); mesh.castShadow = shadow; mesh.receiveShadow = true; this.shell.add(mesh); return mesh;
    };

    let body: THREE.Mesh;
    if (kind === 'cybertruck') {
      // flat glass catches the whole sky: toned down so the windows read dark against the steel
      this.glass.envMapIntensity = 0.8;
      body = this.buildTruck(add, trim); this.liveryShape = TRUCK_LIVERY;
    }
    else {
      const S = kind === 'semi' ? SEMI : SHAPES[kind];
      this.liveryShape = S.livery;
      // the Semi's cab sits over the front axle only
      body = add(buildBody(S, kind === 'semi' ? [wz] : [wz, -wz], R), [this.paint, trim]);
      const chrome = new THREE.MeshPhysicalMaterial({ color: 0xd8dde2, metalness: 1, roughness: 0.18, envMapIntensity: 1.4 });
      this.reflective.push(chrome);
      add(buildGlass(S), [this.glass, this.paint, trim, chrome]);
      shapeDetails(this.shell, S, body, { paint: this.paint, glass: this.glass, trim, head: this.headLight, brake: this.brakeLight });
      if (kind === 'semi') this.semiChassis(trim, under);
    }

    // wheels: rounded tyres and an aero face in the rim colour
    const tyreM = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.9 });
    const tw = kind === 'semi' ? 0.36 : kind === 'cybertruck' ? 0.32 : 0.27;
    const tyre = tyreGeometry(R, tw), face = new THREE.CircleGeometry(R * 0.73, 40).rotateY(Math.PI / 2).translate(tw / 2 - 0.02, 0, 0);
    const makeWheel = (left: boolean) => {
      const spin = new THREE.Group();
      const t = new THREE.Mesh(tyre, tyreM); t.castShadow = true;
      const f = new THREE.Mesh(face, this.rimMat);
      if (!left) f.scale.x = -1;
      spin.add(t, f);
      return spin;
    };
    for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const left = x > 0, pivot = new THREE.Group(), spin = makeWheel(left);
      pivot.add(spin);
      pivot.position.set(x * spec.track / 2, R - spec.comHeight, z * wz);
      this.root.add(pivot);
      // the Semi's tandem: a second rear axle follows the first one
      let extra: THREE.Group | null = null;
      if (kind === 'semi' && z < 0) { extra = makeWheel(left); extra.position.z = -1.3; pivot.add(extra); }
      this.wheels.push({ pivot, spin, extra, left });
    }

    const len = kind === 'semi' ? 7.4 : kind === 'cybertruck' ? 6.2 : 5.4, wid = kind === 'semi' ? 3.2 : 2.5;
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(wid, len), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.85 }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = -spec.comHeight + 0.045; shadow.renderOrder = 1;
    this.root.add(shadow);
    this.glowMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0x2fe6ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 });
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(wid + 1, len + 1), this.glowMat);
    this.glow.rotation.x = -Math.PI / 2; this.glow.position.y = -spec.comHeight + 0.05; this.glow.renderOrder = 1;
    this.glow.visible = false;
    this.root.add(this.glow);
  }

  /** the Cybertruck: flat stainless panels with a straight roofline up to the apex and down to
   *  the tail, square-cut arches with dark flares, and light bars right across the nose and tail */
  private buildTruck(add: (g: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], shadow?: boolean) => THREE.Mesh, trim: THREE.Material) {
    const S = this.spec, R = S.wheelRadius, wz = S.wheelbase / 2;
    const body = add(buildCyber([wz, -wz], R), [this.paint, this.glass, trim]);
    const pr = new Projector(body);
    const put = (geos: THREE.BufferGeometry[], m: THREE.Material) => geos.forEach(g => this.shell.add(new THREE.Mesh(g, m)));
    const side = new THREE.Vector3(-1, 0, 0), back = new THREE.Vector3(0, 0, -1), fwd = new THREE.Vector3(0, 0, 1);
    // the light bars: along the nose's top edge, and across the top of the tailgate
    put(pr.strip(line([-0.93, 0.988, 4], [0.93, 0.988, 4], 40), line([-0.93, 0.955, 4], [0.93, 0.955, 4], 40), back, 0.004, false), this.headLight);
    put(pr.strip(line([-0.95, 1.2, -4], [0.95, 1.2, -4], 40), line([-0.95, 1.16, -4], [0.95, 1.16, -4], 40), fwd, 0.004, false), this.brakeLight);
    // dark plastic flares round the arches
    const flare = new THREE.MeshStandardMaterial({ color: 0x26282b, roughness: 0.75, metalness: 0.1 });
    for (const c of [wz, -wz]) {
      const up: THREE.Vector3[] = [], lo: THREE.Vector3[] = [], half = cyberArchHalf(R);
      for (let j = 0; j <= 48; j++) {
        const z = c - half + (2 * half * j) / 48, y = Math.max(CT.bottom(z) + 0.01, cyberArch(z, [c], R));
        const dz = Math.abs(z - c), flat = R * 0.62;
        // pushed out square to the arch: straight up over the top, along the slope's normal on the sides
        const n = dz < flat ? [0, 1] : [Math.sign(z - c) * 0.86, 0.5];
        up.push(new THREE.Vector3(2, y + n[1] * 0.11, z + n[0] * 0.11)); lo.push(new THREE.Vector3(2, y + 0.006, z));
      }
      put(pr.strip(up, lo, side, 0.007), flare);
    }
    // door seams up the sides and over the upper panels
    for (const z of [1.22, 0.12, -0.95]) put(pr.strip(line([2, 2.2, z + 0.004], [2, 0.5, z + 0.004], 24), line([2, 2.2, z - 0.004], [2, 0.5, z - 0.004], 24), side, 0.003), trim);
    // square mirrors on the front doors
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.13, 0.2), this.paint);
      m.position.set(sx * 1.07, CT.crease(1.12) + 0.13, 1.1); m.castShadow = true;
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.05), trim);
      st.position.set(sx * 1.01, CT.crease(1.12) + 0.08, 1.12);
      this.shell.add(m, st);
    }
    return body;
  }

  /** behind and under the Semi's cab: the aero skirts over the batteries from the front wheels
   *  to the drive axles, with steps up to the door, cab extenders, the chassis rails, the fifth
   *  wheel, fenders and mud flaps over the tandem, and the tail lights */
  private semiChassis(trim: THREE.Material, under: THREE.Material) {
    const S = this.spec, R = S.wheelRadius, wz = S.wheelbase / 2;
    const add = (g: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], shadow = true) => {
      const mesh = new THREE.Mesh(g, m); mesh.castShadow = shadow; mesh.receiveShadow = true; this.shell.add(mesh); return mesh;
    };
    const z0 = wz - R - 0.1, z1 = -wz + R + 0.1;
    add(semiExtenders(SEMI, 0.45), this.paint);
    add(extrudeSide([[z0, 1.12], [z0 + 0.04, 0.5], [z0 - 0.08, 0.38], [z1 + 0.1, 0.38], [z1, 0.5], [z1, 1.12]], 1.25, 0.04), [this.paint, under]);
    // a black band along the bottom of the skirts, and two steps up to the door
    for (const sx of [-1, 1]) {
      add(new THREE.BoxGeometry(0.02, 0.1, z0 - z1 - 0.1).translate(sx * 1.256, 0.47, (z0 + z1) / 2), trim, false);
      for (const y of [0.62, 0.92]) add(new THREE.BoxGeometry(0.04, 0.05, 0.42).translate(sx * 1.25, y, z0 - 0.3), trim, false);
      // fenders over the tandem and mud flaps behind it
      add(new THREE.BoxGeometry(0.44, 0.05, 2.25).translate(sx * (S.track / 2), 2 * R + 0.12, -wz - 0.65), trim, false);
      add(new THREE.BoxGeometry(0.5, 0.65, 0.02).translate(sx * (S.track / 2), 0.55, -wz - 1.3 - R - 0.12), trim, false);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.03), this.brakeLight);
      tl.position.set(sx * 0.82, 1.1, -wz - 1.3 - R - 0.2); this.shell.add(tl);
    }
    // the chassis rails, the deck plate and the fifth wheel over the tandem
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.12, 0.26, 3.6).translate(sx * 0.45, 1.05, -2.15), under, false);
    add(new THREE.BoxGeometry(1.1, 0.04, 1.2).translate(0, 1.2, -1.2), trim, false);
    add(new THREE.CylinderGeometry(0.62, 0.62, 0.1, 28).translate(0, 1.27, -wz - 0.65), trim, false);
    add(new THREE.BoxGeometry(1.9, 0.14, 0.12).translate(0, 0.9, -wz - 1.3 - R - 0.22), trim, false);
  }

  /** the livery on the paint (a copy of the model makes its own) */
  setLivery(cfg: LiveryConfig) {
    if (!this.livery || this.livery.material !== this.paint) this.livery = new Livery(this.paint, this.liveryShape);
    this.livery.set(cfg);
  }

  setSoot(v: number) { if (this.livery) this.livery.soot = v; }

  /** garage parts: the rim style and colour, the glass tint and the underglow (no wing) */
  setParts(p: { rims: RimStyle; rimColor: number; wing: WingStyle; glass: number; glow: number }) {
    this.rimMat.color.setHex(p.rims === 'aero' ? 0xe2e4e6 : p.rimColor);
    this.rimMat.metalness = p.rims === 'painted' ? 0.3 : 0.6;
    // the glass keeps its dark tint, leaning towards the colour picked
    this.glass.color.setHex(p.glass).lerp(new THREE.Color(0x101318), 0.6);
    this.glow.visible = p.glow !== 0;
    if (p.glow) this.glowMat.color.setHex(p.glow);
  }

  get bodyShell() { return this.shell; }

  get paintName() { return PAINTS[this.paintIndex].name; }

  nextPaint() {
    this.paintIndex = (this.paintIndex + 1) % PAINTS.length;
    const p = PAINTS[this.paintIndex];
    this.paint.color.setHex(p.color); this.paint.metalness = p.metalness; this.paint.roughness = p.roughness;
  }

  setNight(night: boolean) { this.headLight.emissiveIntensity = night ? 4 : 0.6; this.glowMat.opacity = night ? 1 : 0.65; }

  setReflections(tex: THREE.Texture | null) {
    for (const m of this.reflective) { m.envMap = tex; m.needsUpdate = true; }
  }

  /** showroom: nothing moves on its own */
  showSpoiler(_up: boolean) { /* no wing */ }
  animate(_dt: number) { /* no wing */ }

  /** sync the wheels and the brake lights with the physics car, and roll and pitch the body */
  update(car: Car, braking: boolean, dt: number) {
    const S = this.spec, hardY = hardpointY(S);
    car.wheels.forEach((w, i) => {
      const vw = this.wheels[i];
      vw.pivot.position.y = hardY - Math.min(w.suspension, S.restLength + 0.02);
      vw.pivot.rotation.y = w.steer;
      vw.spin.rotation.x = w.spin;
      if (vw.extra) vw.extra.rotation.x = w.spin;
    });
    this.brakeLight.emissiveIntensity = braking ? 5 : 1.2;
    const k = Math.min(1, dt * 6), tall = this.kind === 'semi' ? 0.5 : this.kind === 'modelx' || this.kind === 'modely' || this.kind === 'cybertruck' ? 1.25 : 1;
    this.roll += (THREE.MathUtils.clamp(-car.latAccel * 0.004 * tall, -0.06, 0.06) - this.roll) * k;
    this.pitch += (THREE.MathUtils.clamp(-car.longAccel * 0.0026 * tall, -0.04, 0.04) - this.pitch) * k;
    this.shell.rotation.set(this.pitch, 0, this.roll);
  }
}

/** all the parts above in one geometry (unused helper kept small: merge for instancing later) */
export const mergeParts = (g: THREE.BufferGeometry[]) => mergeGeometries(g);
export { mirrorX };
