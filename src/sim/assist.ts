// "Driving help" for the player, ported from g001: catches slides so the car is hard to spin,
// without ever steering towards the racing line or braking on the player's behalf.
// Applied to the player's inputs before physics; Car.stability adds yaw damping and slide
// recovery inside the physics.
//   easy:   steering limited to what the tyres can hold + automatic counter-steer in a slide
//   medium: automatic counter-steer in a slide
//   off:    raw inputs (realistic)
import { steerLockAt, type Car, type CarInputs } from './car';

export type DrivingHelp = 'easy' | 'medium' | 'off';

/** physics-side stability strength per help level */
export const HELP_STABILITY: Record<DrivingHelp, number> = { easy: 1, medium: 0.6, off: 0 };

const G = 9.81;

export function applyDrivingHelp(help: DrivingHelp, inp: CarInputs, car: Car): CarInputs {
  if (help === 'off' || car.airborne) return inp;
  const out = { ...inp };
  const speed = car.speed;
  if (speed < 8 || inp.handbrake) return out;
  const S = car.spec;
  const lock = steerLockAt(speed, S.steerLock) || 1e-3;

  // never ask for more steering than the tyres can hold at this speed (easy only)
  if (help === 'easy') {
    // (with some room over the limit, so the car turns in sharply and uses all of its grip)
    const aMax = S.grip * 0.97 * (G + (0.6 * S.liftArea * speed * speed) / S.mass);
    const dMax = Math.atan((S.wheelbase * aMax) / Math.max(speed * speed, 1)) * 1.5;
    const maxSteer = Math.min(1, dMax / lock);
    out.steer = Math.max(-maxSteer, Math.min(maxSteer, out.steer));
  }

  // slide: the car points away from where it is going, so add counter-steer like a driver
  // catching it (wheels pointed down the direction of travel)
  const slip = Math.atan2(car.vLat, Math.max(Math.abs(speed), 1));
  const excess = Math.abs(slip) - 0.06;
  if (excess > 0) {
    // sliding right (vLat > 0) needs steering to the right (positive input)
    const want = Math.max(-1, Math.min(1, (slip * 1.2) / lock));
    const k = Math.min(1, excess * (help === 'easy' ? 6 : 4));
    out.steer = out.steer * (1 - k) + want * k;
  }
  return out;
}
