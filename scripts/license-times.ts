// Times the reference driver over every license test, for the targets in src/sim/licenses.ts:
// the bots' line and braking at full pace, no mistakes, from a standing start at gate A.
//   npx tsx scripts/license-times.ts            prints the reference times
//   npx tsx scripts/license-times.ts --paces    also how much slower club and beginner pace bots are
import { Car } from '../src/sim/car';
import { applyDrivingHelp } from '../src/sim/assist';
import { Track } from '../src/sim/track';
import { Terrain } from '../src/sim/terrain';
import { updateSurface } from '../src/sim/surface';
import { buildWorld, initPhysics, PHYSICS_DT } from '../src/sim/world';
import { Jets } from '../src/sim/jets';
import { Canisters } from '../src/sim/canisters';
import { RivalDriver, RIVALS } from '../src/sim/rival';
import { racingLine, speedProfile } from '../src/sim/racingLine';
import { CLASSES, aeroOf, type ClassId } from '../src/sim/classes';
import { LICENSES, TestProgress, type License, type LicenseTest } from '../src/sim/licenses';

await initPhysics();
const track = new Track(), terrain = new Terrain(track);
const line = racingLine(track);

/** the reference driver over one test: seconds from GO to gate B, or null if it didn't get there */
export function referenceTime(lic: License, test: LicenseTest, pace = 1) {
  return drive(lic.cls, test, pace).time;
}

function drive(id: ClassId, test: LicenseTest, pace: number) {
  const cls = CLASSES[id], spec = cls.spec;
  const profile = speedProfile(track, spec.grip, cls.brake, spec.topSpeed + 8, aeroOf(spec));
  const world = buildWorld(track, terrain);
  const p = track.pointAt(test.a, 0);
  const car = new Car(world, p.x, p.y, p.z, track.headingAt(test.a), spec);
  const jets = new Jets(); jets.tank = 1; // a full tank: the driver never goes looking for air
  const canisters = new Canisters(track);
  const driver = new RivalDriver({ ...RIVALS[0], pace, consistency: 1.4, aggression: 0 }, track, line, profile);
  const prog = new TestProgress(track, test);
  const hold = { steer: 0, throttle: 0, brake: 0, handbrake: true };
  for (let k = 0; k < 240; k++) { car.step(hold); world.step(); }
  let t = 0, hint = -1;
  while (!prog.done && t < 200) {
    const pos = car.body.translation();
    const near = track.nearest(pos.x, pos.z, hint);
    hint = near.i;
    updateSurface(car, track, hint);
    const { inp } = driver.drive({ car, s: near.s, lateral: near.lateral, speed: car.speed }, [], jets, canisters, PHYSICS_DT, t < 0.5);
    car.step(applyDrivingHelp('medium', inp, car)); world.step();
    t += PHYSICS_DT;
    prog.update(near.s);
  }
  world.free();
  return { time: prog.done ? t : null };
}

if (process.argv[1]?.endsWith('license-times.ts')) {
  for (const lic of LICENSES) {
    console.log(`${lic.name} (${lic.cls})`);
    for (const test of lic.tests) {
      const t = referenceTime(lic, test);
      const paces = process.argv.includes('--paces') ? [0.95, 0.89].map(p => referenceTime(lic, test, p)) : [];
      console.log(`  ${test.name.padEnd(20)} ${t?.toFixed(2) ?? 'did not finish'}${paces.map(x => x && t ? `  ×${(x / t).toFixed(3)}` : '  dnf').join('')}`);
    }
  }
}
