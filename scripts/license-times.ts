// Times the reference driver (the bots' line and braking at full pace, no mistakes): over every
// license test from a standing start at gate A, for the targets in src/sim/licenses.ts, and over
// a flying lap in each class, for the bots' qualifying times in src/sim/weekend.ts.
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
import { CLASSES, CLASS_ORDER, aeroOf, type ClassId } from '../src/sim/classes';
import { LICENSES, TestProgress, type License, type LicenseTest } from '../src/sim/licenses';

await initPhysics();
const track = new Track(), terrain = new Terrain(track);
const line = racingLine(track);

/** the reference driver over one test: seconds from GO to gate B, or null if it didn't get there */
export function referenceTime(lic: License, test: LicenseTest, pace = 1) {
  return drive(lic.cls, test, pace).time;
}

/** the reference driver's flying lap in a class: a run-up from 300 m before the line, then a lap */
export function referenceLap(id: ClassId) {
  const runup = 300, a = track.total - runup;
  const { times } = drive(id, { name: 'lap', tip: '', a, b: a, ref: 0 }, 1, [runup, runup + track.total]);
  return times.length === 2 ? times[1] - times[0] : null;
}

function drive(id: ClassId, test: LicenseTest, pace: number, marks: number[] = []) {
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
  const times: number[] = [];
  const end = marks.length ? marks[marks.length - 1] : prog.length;
  while (prog.dist < end && t < 200) {
    const pos = car.body.translation();
    const near = track.nearest(pos.x, pos.z, hint);
    hint = near.i;
    updateSurface(car, track, hint);
    const { inp } = driver.drive({ car, s: near.s, lateral: near.lateral, speed: car.speed }, [], jets, canisters, PHYSICS_DT, t < 0.5);
    car.step(applyDrivingHelp('medium', inp, car)); world.step();
    t += PHYSICS_DT;
    prog.update(near.s);
    if (times.length < marks.length && prog.dist >= marks[times.length]) times.push(t);
  }
  world.free();
  return { time: prog.done ? t : null, times };
}

if (process.argv[1]?.endsWith('license-times.ts')) {
  console.log('Flying laps');
  for (const id of CLASS_ORDER) console.log(`  ${id.padEnd(20)} ${referenceLap(id)?.toFixed(2) ?? 'did not finish'}`);
  for (const lic of LICENSES) {
    console.log(`${lic.name} (${lic.cls})`);
    for (const test of lic.tests) {
      const t = referenceTime(lic, test);
      const paces = process.argv.includes('--paces') ? [0.95, 0.89].map(p => referenceTime(lic, test, p)) : [];
      console.log(`  ${test.name.padEnd(20)} ${t?.toFixed(2) ?? 'did not finish'}${paces.map(x => x && t ? `  ×${(x / t).toFixed(3)}` : '  dnf').join('')}`);
    }
  }
}
