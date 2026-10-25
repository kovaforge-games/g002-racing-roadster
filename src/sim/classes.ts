// The race classes: a Tesla in each. The Roadster everyone starts with, then the career cars
// (the Model 3, the Model X and the Model S, each quicker than the last, earned through the
// licenses and championships), and four free to drive from the start: the Model Y, the
// Cybertruck, the Cybercab and the Semi. Every car races against a field of the same car.
import { CAR, type CarSpec } from './car';
import type { TeslaKind } from '../render/teslaModel';

export type ClassId = 'roadster' | 'model3' | 'modelx' | 'models' | 'modely' | 'cybertruck' | 'cybercab' | 'semi';
export const CLASS_ORDER: ClassId[] = ['roadster', 'model3', 'modelx', 'models', 'modely', 'cybertruck', 'cybercab', 'semi'];
/** the career ladder, slowest first: licenses and championships move you up it */
export const CAREER: ClassId[] = ['roadster', 'model3', 'modelx', 'models'];
/** in the garage from the start */
export const STARTER_CARS: ClassId[] = ['roadster', 'modely', 'cybertruck', 'cybercab', 'semi'];

export interface CarClass {
  id: ClassId;
  name: string;
  /** what the class is, for the setup screen */
  about: string;
  /** how you get it */
  unlock: string;
  /** the 3D body: the Roadster (with its active wing) or one of the other Teslas */
  body: 'roadster' | TeslaKind;
  spec: CarSpec;
  /** the bots' braking (m/s²) when they work out corner speeds */
  brake: number;
}

/** a Tesla on its own dimensions: springs, anti-roll and inertia scale with its mass and size.
 *  len and wid are the body's length and width (m), for the inertia */
function tesla(len: number, wid: number, o: Partial<CarSpec>): CarSpec {
  const mass = o.mass ?? CAR.mass, m = mass / CAR.mass, l = (len / 4.64) ** 2, w = (wid / 1.88) ** 2;
  return {
    ...CAR,
    // no active wing, so no airbrake
    airbrake: 0,
    antiRoll: { front: CAR.antiRoll.front * m, rear: CAR.antiRoll.rear * m },
    inertia: { x: CAR.inertia.x * m * l, y: CAR.inertia.y * m * (l + w) / 2, z: CAR.inertia.z * m * w },
    ...o,
  };
}

export const CLASSES: Record<ClassId, CarClass> = {
  roadster: {
    id: 'roadster', name: 'Roadster', body: 'roadster', brake: 10.5,
    about: 'Where everyone starts: the Roadster in its starter tune. Forgiving, with an active wing that brakes for you. 290 kW, 215 km/h.',
    unlock: 'Yours from the start.',
    spec: { ...CAR, power: 290000, maxDriveForce: 14000, topSpeed: 60, grip: 1.46, brakeDecel: 14, dragArea: 0.58, liftArea: 0.6 },
  },
  model3: {
    id: 'model3', name: 'Model 3', body: 'model3', brake: 12.5,
    about: 'The Model 3 Performance: light, low and sharp on turn-in. 390 kW, 262 km/h. The National B license car.',
    unlock: 'Earn the National B license.',
    spec: tesla(4.72, 1.85, { mass: 1850, wheelbase: 2.88, track: 1.58, wheelRadius: 0.34, comHeight: 0.31, power: 390000, maxDriveForce: 15500, topSpeed: 73, grip: 1.64, brakeDecel: 16, dragArea: 0.5, liftArea: 0.8,
      tub: [0.9, 0.27, 2.3], cabin: [0.64, 0.24, 1.15], cabinAt: [0.84, -0.35] }),
  },
  modelx: {
    id: 'modelx', name: 'Model X', body: 'modelx', brake: 14.5,
    about: 'The Model X Plaid: a heavy SUV with three motors that pulls like nothing else off the line. 750 kW, 262 km/h. The National A license car.',
    unlock: 'Earn it in the Model 3 Championship (3 races).',
    spec: tesla(5.06, 2.0, { mass: 2450, wheelbase: 2.97, track: 1.68, wheelRadius: 0.37, comHeight: 0.36, power: 750000, maxDriveForce: 25000, topSpeed: 74, grip: 1.86, brakeDecel: 17.5, dragArea: 0.7, liftArea: 1.2,
      tub: [0.98, 0.32, 2.45], cabin: [0.7, 0.3, 1.45], cabinAt: [1.02, -0.45] }),
  },
  models: {
    id: 'models', name: 'Model S', body: 'models', brake: 15,
    about: 'The Model S Plaid: the fastest Tesla saloon there is, with the grip to use it. 760 kW, 322 km/h. The International A license car.',
    unlock: 'Earn it in the Model X Championship (4 races).',
    spec: tesla(5.02, 1.96, { mass: 2100, wheelbase: 2.96, track: 1.66, wheelRadius: 0.36, comHeight: 0.3, power: 760000, maxDriveForce: 22500, topSpeed: 89, grip: 2.0, brakeDecel: 18.5, dragArea: 0.52, liftArea: 1.7,
      tub: [0.96, 0.27, 2.45], cabin: [0.66, 0.24, 1.2], cabinAt: [0.84, -0.4] }),
  },
  modely: {
    id: 'modely', name: 'Model Y', body: 'modely', brake: 11.5,
    about: 'The Model Y Performance: the family crossover, taller and softer than the 3 but still quick. 340 kW, 250 km/h.',
    unlock: 'Free to drive from the start.',
    spec: tesla(4.8, 1.92, { mass: 2000, wheelbase: 2.89, track: 1.64, wheelRadius: 0.36, comHeight: 0.35, power: 340000, maxDriveForce: 15500, topSpeed: 69, grip: 1.58, brakeDecel: 15, dragArea: 0.62, liftArea: 0.6,
      tub: [0.94, 0.31, 2.35], cabin: [0.68, 0.28, 1.3], cabinAt: [0.98, -0.4] }),
  },
  cybertruck: {
    id: 'cybertruck', name: 'Cybertruck', body: 'cybertruck', brake: 10,
    about: 'The Cybertruck Cyberbeast: three tonnes of stainless steel with three motors. Brake early and lean on it in the corners. 630 kW, 209 km/h.',
    unlock: 'Free to drive from the start.',
    spec: tesla(5.68, 2.0, { mass: 3100, wheelbase: 3.65, track: 1.76, wheelRadius: 0.43, comHeight: 0.42, restLength: 0.34, maxTravel: 0.26, stiffness: 32,
      power: 630000, maxDriveForce: 28000, topSpeed: 58, grip: 1.45, brakeDecel: 13, dragArea: 0.95, liftArea: 0.3, steerLock: 0.56,
      tub: [1.0, 0.36, 2.84], tubAt: [0.42, 0], cabin: [0.86, 0.26, 1.25], cabinAt: [1.12, 0.1] }),
  },
  cybercab: {
    id: 'cybercab', name: 'Cybercab', body: 'cybercab', brake: 11,
    about: 'The two-seat robotaxi, with a steering wheel put back in for you. Small, light and nimble, but not fast. 200 kW, 190 km/h.',
    unlock: 'Free to drive from the start.',
    spec: tesla(4.24, 1.9, { mass: 1600, wheelbase: 2.75, track: 1.6, wheelRadius: 0.35, comHeight: 0.3, power: 200000, maxDriveForce: 11500, topSpeed: 53, grip: 1.52, brakeDecel: 14.5, dragArea: 0.45, liftArea: 0.5,
      tub: [0.92, 0.27, 2.08], cabin: [0.66, 0.24, 0.95], cabinAt: [0.84, -0.15] }),
  },
  semi: {
    id: 'semi', name: 'Semi', body: 'semi', brake: 8,
    about: 'The Semi tractor, no trailer: eight tonnes, a centre driving seat and 800 kW. Slow to stop and slow to turn, and nothing pushes it about. 150 km/h.',
    unlock: 'Free to drive from the start.',
    spec: tesla(7.0, 2.55, { mass: 8000, wheelbase: 4.4, track: 2.05, wheelRadius: 0.52, comHeight: 0.55, restLength: 0.34, maxTravel: 0.22, stiffness: 34,
      damping: { compression: 2.8, relaxation: 3.4 }, frontDriveShare: 0, frontBrakeShare: 0.5,
      power: 800000, maxDriveForce: 50000, topSpeed: 42, grip: 1.25, brakeDecel: 10, dragArea: 3.2, liftArea: 0, steerLock: 0.5, maxReverse: 6,
      tub: [1.25, 0.5, 3.45], tubAt: [0.5, -0.27], cabin: [1.2, 1.3, 2.0], cabinAt: [1.2, 1.2] }),
  },
};

/** the full-power Roadster (party races and the showroom drive it) */
export const ROADSTER = CAR;

/** cornering grip from downforce (m/s² per (m/s)²): what the bots' corner speeds allow for */
export const aeroOf = (s: CarSpec) => 0.6 * s.liftArea / s.mass;

/** a saved class id from before the Tesla line-up (or anything unknown) as one of today's */
export function migrateClass(id: unknown): ClassId {
  const old: Record<string, ClassId> = { rental: 'roadster', '0x1.5': 'model3', '0x2.5': 'modelx', '0x3.5': 'models' };
  if (typeof id === 'string' && (CLASS_ORDER as string[]).includes(id)) return id as ClassId;
  return (typeof id === 'string' && old[id]) || 'roadster';
}
