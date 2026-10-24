// The race classes: the Rental road car everyone starts with, and three open-wheel single-seaters,
// 0x1.5, 0x2.5 and 0x3.5, each faster and with more downforce than the last. Licenses use the
// single-seaters; championships earn them.
import { CAR, type CarSpec } from './car';

export type ClassId = 'rental' | '0x1.5' | '0x2.5' | '0x3.5';
export const CLASS_ORDER: ClassId[] = ['rental', '0x1.5', '0x2.5', '0x3.5'];

export interface CarClass {
  id: ClassId;
  name: string;
  /** what the class is, for the setup screen */
  about: string;
  /** how you get it */
  unlock: string;
  /** a road car (the roadster body) or an open-wheel single-seater */
  body: 'road' | 'open';
  spec: CarSpec;
  /** the bots' braking (m/s²) when they work out corner speeds */
  brake: number;
}

/** an open-wheel single-seater: light, low, stiff, lots of downforce and a sequential gearbox */
function single(o: Partial<CarSpec>): CarSpec {
  const mass = o.mass ?? 720;
  return {
    ...CAR,
    mass, wheelbase: 3.3, track: 1.62, wheelRadius: 0.34, comHeight: 0.26, restLength: 0.2, maxTravel: 0.12,
    // stiff springs (per unit of mass) so the downforce doesn't bottom the car out
    stiffness: 110, damping: { compression: 4.6, relaxation: 5.8 },
    frontDriveShare: 0, frontBrakeShare: 0.58, maxReverse: 6, regenDecel: 0.9, rollResist: 0.015,
    antiRoll: { front: 42000 * mass / CAR.mass * 1.6, rear: 26000 * mass / CAR.mass * 1.6 },
    steerLock: 0.5,
    tub: [0.55, 0.22, 2.45], cabin: null,
    inertia: { x: 3300 * mass / CAR.mass * 0.9, y: 3600 * mass / CAR.mass * 0.9, z: 760 * mass / CAR.mass * 0.7 },
    idleRpm: 4000,
    ...o,
  };
}

export const CLASSES: Record<ClassId, CarClass> = {
  rental: {
    id: 'rental', name: 'Rental', body: 'road', brake: 9,
    about: 'Where everyone starts: a rental road car. Gentle power, soft grip and very forgiving. 210 kW, 200 km/h.',
    unlock: 'Yours from the start.',
    spec: { ...CAR, power: 210000, maxDriveForce: 12500, topSpeed: 56, grip: 1.38, brakeDecel: 11, dragArea: 0.6, liftArea: 0.5 },
  },
  '0x1.5': {
    id: '0x1.5', name: '0x1.5', body: 'open', brake: 15,
    about: 'The first single-seater: light and nimble, with a 6-speed gearbox. 300 kW, 260 km/h. The National B license car.',
    unlock: 'Yours from the start.',
    spec: single({ power: 300000, maxDriveForce: 11500, topSpeed: 72, grip: 1.75, liftArea: 2.2, dragArea: 0.72, brakeDecel: 17, gears: 6, redline: 11000 }),
  },
  '0x2.5': {
    id: '0x2.5', name: '0x2.5', body: 'open', brake: 17,
    about: 'Faster and stickier, with a bigger wing and 7 gears. 430 kW, 300 km/h. The National A license car.',
    unlock: 'Earn it in the 0x1.5 Championship (3 races).',
    spec: single({ mass: 700, power: 430000, maxDriveForce: 13000, topSpeed: 83, grip: 1.9, liftArea: 3, dragArea: 0.82, brakeDecel: 20, gears: 7, redline: 12000 }),
  },
  '0x3.5': {
    id: '0x3.5', name: '0x3.5', body: 'open', brake: 19,
    about: 'The fastest car in the game: huge downforce and 8 gears. 600 kW, 340 km/h. The International A license car.',
    unlock: 'Earn it in the 0x2.5 Championship (4 races).',
    spec: single({ mass: 680, power: 600000, maxDriveForce: 15000, topSpeed: 94, grip: 2.05, liftArea: 3.8, dragArea: 0.92, brakeDecel: 23, gears: 8, redline: 13000 }),
  },
};

/** the road car the game started with (party races and the showroom drive it) */
export const ROADSTER = CAR;

/** cornering grip from downforce (m/s² per (m/s)²): what the bots' corner speeds allow for */
export const aeroOf = (s: CarSpec) => 0.6 * s.liftArea / s.mass;
