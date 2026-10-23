// A simple line-following driver: steers at a look-ahead point on the centreline and keeps to
// a speed profile from the track's curvature. Used by the headless test and the ?autodrive demo.
import type { Car, CarInputs } from './car';
import type { Track } from './track';

export class Autopilot {
  keyboard = false;
  /** >1 brakes later than the speed profile allows */
  aggression = 1;
  private keySteer = 0;

  constructor(private track: Track) {}

  private vMax(i: number) {
    return Math.sqrt(1.25 * 9.81 / Math.max(Math.abs(this.track.curv[this.track.wrap(i)]), 1e-4));
  }

  drive(car: Car, nearI: number, nearS: number, dt: number): CarInputs {
    const tr = this.track;
    const pos = car.body.translation();
    const look = 8 + Math.max(0, car.speed) * 0.55;
    const target = tr.pointAt(nearS + look, 0);
    const { fwd, right } = car.axes();
    const dx = target.x - pos.x, dz = target.z - pos.z;
    const ang = Math.atan2(dx * right.x + dz * right.z, dx * fwd.x + dz * fwd.z);
    let vT = 80;
    for (let k = 0; k < 120; k += 3) vT = Math.min(vT, Math.sqrt(this.vMax(nearI + k) ** 2 + 2 * 9 * k * 2));
    vT *= this.aggression;
    let steer = Math.max(-1, Math.min(1, ang * 3));
    if (this.keyboard) {
      // digital keys ramped like the real input: full lock or nothing
      const key = Math.abs(ang) > 0.03 ? Math.sign(ang) : 0;
      const rate = key === 0 ? 8 : Math.sign(key) !== Math.sign(this.keySteer) ? 10 : 6;
      this.keySteer += Math.max(-rate * dt, Math.min(rate * dt, key - this.keySteer));
      steer = this.keySteer;
    }
    return { steer, throttle: car.speed < vT - 1 ? 1 : 0, brake: car.speed > vT + 2 ? 1 : 0, handbrake: false };
  }
}
