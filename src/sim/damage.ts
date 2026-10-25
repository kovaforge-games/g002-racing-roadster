// Crash damage: four zones of bodywork (front, rear, left, right) that take damage from hard
// hits. Each hit is a sudden change of velocity (from Car.impact); the bodywork on the side the
// car was hit from takes the damage. A damaged car loses some power, and a bent front corner
// pulls the steering towards it. A zone that reaches 1 wrecks the car: the tow is called.
import type { Car } from './car';

export type Zone = 'front' | 'rear' | 'left' | 'right';
export const ZONES: Zone[] = ['front', 'rear', 'left', 'right'];

export const DAMAGE = {
  /** a hit softer than this (m/s of velocity change) leaves no mark: kerbs, nudges, scrapes */
  threshold: 4,
  /** m/s above the threshold that take a zone from new to wrecked in one hit: a head-on hit on
   *  the barrier at about 90 km/h wrecks the car, 50 km/h dents it badly */
  wreck: 22,
  /** most power lost with every zone wrecked */
  powerLoss: 0.4,
  /** steering pull (as steering input) with one front corner wrecked */
  pull: 0.08,
};

/** a hit, in the car's frame: where on the car it landed and how much damage it did */
export interface Hit {
  /** direction from the car's centre to the hit, in the car's frame (+x left, +z forward) */
  dir: { x: number; z: number };
  /** damage added (0..1 of a zone) */
  amount: number;
  /** velocity change (m/s) */
  speed: number;
}

export class Damage {
  readonly zones: Record<Zone, number> = { front: 0, rear: 0, left: 0, right: 0 };
  /** hits since the last takeHits(), for the dents, debris and sparks */
  private hits: Hit[] = [];

  /** a sudden velocity change `dv` (world m/s) on the car: dent the side it came from. The car
   *  is pushed away from what it hit, so the hit is on the side opposite the push. Vertical
   *  bumps (landings, kerbs) don't count. Returns the hit, or null for a soft one */
  hit(car: Car, dv: { x: number; y: number; z: number }): Hit | null {
    const { fwd, right } = car.axes();
    // push in the car's frame (x is the car's left)
    const px = -(dv.x * right.x + dv.y * right.y + dv.z * right.z);
    const pz = dv.x * fwd.x + dv.y * fwd.y + dv.z * fwd.z;
    const speed = Math.hypot(px, pz);
    if (speed < DAMAGE.threshold) return null;
    const amount = ((speed - DAMAGE.threshold) / DAMAGE.wreck) ** 1.15;
    const dir = { x: -px / speed, z: -pz / speed };
    // shared between the zones the hit points at (a corner hit dents two)
    const w = { front: Math.max(0, dir.z) ** 2, rear: Math.max(0, -dir.z) ** 2, left: Math.max(0, dir.x) ** 2, right: Math.max(0, -dir.x) ** 2 };
    const sum = w.front + w.rear + w.left + w.right;
    for (const z of ZONES) this.zones[z] = Math.min(1, this.zones[z] + amount * w[z] / sum * 1.25);
    const h = { dir, amount, speed };
    this.hits.push(h);
    return h;
  }

  /** burnt by a ring of fire: the paint and panels all round take `amount` (no dent) */
  burn(amount: number) { for (const z of ZONES) this.zones[z] = Math.min(1, this.zones[z] + amount); }

  /** the worst zone, 0..1 */
  get worst() { return Math.max(...ZONES.map(z => this.zones[z])); }
  /** the car can't go on: a zone is wrecked */
  get wrecked() { return this.worst >= 1; }
  /** motor power left */
  get powerMul() { return 1 - DAMAGE.powerLoss * ZONES.reduce((a, z) => a + this.zones[z], 0) / 4; }
  /** steering pull towards the damaged front corner (as steering input, positive = right) */
  get steerPull() { return DAMAGE.pull * this.zones.front * (this.zones.right - this.zones.left); }

  /** apply the damage to the physics car */
  applyTo(car: Car) { car.powerMul = this.powerMul; car.steerPull = this.steerPull; }

  takeHits() { const h = this.hits; this.hits = []; return h; }

  repair() { for (const z of ZONES) this.zones[z] = 0; this.hits = []; }
}
