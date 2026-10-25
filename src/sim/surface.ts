// What each tyre is on: tarmac (the road and the pit lane), kerb or grass. Grass has less grip and much more drag.
import { wheelLayout, type Car } from './car';
import type { Track } from './track';
import { onPitLane } from './pits';

export const GRASS_GRIP = 0.65;
const KERB_WIDTH = 1.25;

/** sets car.surface for each wheel; returns how many wheels are on a kerb (0..1) */
export function updateSurface(car: Car, track: Track, hint: number) {
  const t = car.body.translation();
  const { fwd, right } = car.axes();
  let kerb = 0;
  wheelLayout(car.spec).forEach(({ x, z }, i) => {
    // local +x is the car's left, i.e. -right
    const wx = t.x - right.x * x + fwd.x * z, wz = t.z - right.z * x + fwd.z * z;
    const near = track.nearest(wx, wz, hint, 12);
    const d = Math.abs(near.lateral);
    const onKerb = track.kerb[near.i] && d > track.halfWidth - 0.1 && d < track.halfWidth + KERB_WIDTH;
    if (onKerb) kerb += 0.25;
    car.surface[i] = d < track.halfWidth + (track.kerb[near.i] ? KERB_WIDTH : 0.4) || onPitLane(near.s, near.lateral) ? 1 : GRASS_GRIP;
  });
  return kerb;
}
