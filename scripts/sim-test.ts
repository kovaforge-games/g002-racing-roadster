// Headless handling test: straight-line numbers on a flat pad, then laps of the circuit with
// a line-following driver and with a twitchy "keyboard" driver. Prints a report and exits
// non-zero if the car spins, flips or keeps hitting walls.
//   npm run sim-test
import RAPIER from '@dimforge/rapier3d-compat';
import { Car, type CarInputs } from '../src/sim/car';
import { applyDrivingHelp, HELP_STABILITY, type DrivingHelp } from '../src/sim/assist';
import { Track } from '../src/sim/track';
import { Autopilot } from '../src/sim/autopilot';
import { updateSurface } from '../src/sim/surface';
import { Terrain } from '../src/sim/terrain';
import { buildWorld, initPhysics, PHYSICS_DT } from '../src/sim/world';

await initPhysics();
const dt = PHYSICS_DT;
const kmh = (v: number) => (v * 3.6).toFixed(0);
let failed = false;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? '  ok ' : 'FAIL '} ${msg}`); if (!ok) failed = true; };

// ---- straight line on a flat pad
{
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = dt;
  world.createCollider(RAPIER.ColliderDesc.cuboid(3000, 0.5, 3000).setTranslation(0, -0.5, 0));
  const car = new Car(world, 0, 0, -2500, 0);
  const run = (inp: CarInputs, until: (t: number) => boolean) => {
    let t = 0;
    while (!until(t) && t < 120) { car.step(inp); world.step(); t += dt; }
    return t;
  };
  run({ steer: 0, throttle: 0, brake: 0, handbrake: false }, t => t > 1);
  const t100 = run({ steer: 0, throttle: 1, brake: 0, handbrake: false }, () => car.speed >= 100 / 3.6);
  const t200 = t100 + run({ steer: 0, throttle: 1, brake: 0, handbrake: false }, () => car.speed >= 200 / 3.6);
  run({ steer: 0, throttle: 1, brake: 0, handbrake: false }, t => t > 25);
  const top = car.speed;
  console.log(`0-100 km/h ${t100.toFixed(2)} s, 0-200 ${t200.toFixed(2)} s, top speed ${kmh(top)} km/h`);
  check(t100 > 2 && t100 < 3.4, '0-100 km/h between 2 and 3.4 s');
  check(top > 230 / 3.6 && top < 275 / 3.6, 'top speed 230-275 km/h');
  // brake from 100
  run({ steer: 0, throttle: 0, brake: 0, handbrake: false }, () => car.speed < 100 / 3.6);
  const p0 = car.body.translation().z;
  run({ steer: 0, throttle: 0, brake: 1, handbrake: false }, () => car.speed < 0.3);
  const dist = car.body.translation().z - p0;
  console.log(`100-0 km/h in ${dist.toFixed(1)} m`);
  check(dist > 25 && dist < 40, '100-0 between 25 and 40 m');

  // skidpad: hold a 60 m radius circle with a simple steering controller, measure lateral g
  car.place(0, 0, 0, 0);
  let maxLat = 0, t = 0;
  while (t < 30) {
    const sp = Math.max(car.speed, 1);
    const want = sp / 60;                  // yaw rate for a 60 m radius
    const steer = Math.max(-1, Math.min(1, -(want - car.yawRate) * 6 - 0.15));
    const inp = applyDrivingHelp('easy', { steer: Math.max(-1, Math.min(1, steer)), throttle: 0.35, brake: 0, handbrake: false }, car);
    car.step(inp); world.step(); t += dt;
    if (t > 10) maxLat = Math.max(maxLat, Math.abs(car.latAccel));
  }
  console.log(`skidpad: ${(maxLat / 9.81).toFixed(2)} g at ${kmh(car.speed)} km/h`);
  check(maxLat / 9.81 > 0.9, 'over 0.9 g on the skidpad');
}

// ---- laps of the circuit
const track = new Track();
const terrain = new Terrain(track);

function lap(driver: 'line' | 'keyboard', help: DrivingHelp, laps = 2) {
  const world = buildWorld(track, terrain);
  const p = track.pointAt(20, 0);
  const car = new Car(world, p.x, p.y, p.z, track.headingAt(20));
  car.stability = HELP_STABILITY[help];
  let hint = track.nearest(p.x, p.z).i, t = 0, lapStart = 0, s0 = 20, done = 0;
  const times: number[] = [];
  let wallHits = 0, spins = 0, flips = 0, maxSlip = 0, lastWall = -10, spinning = false, grassTime = 0;
  const pilot = new Autopilot(track);
  pilot.keyboard = driver === 'keyboard';
  if (driver === 'keyboard') pilot.aggression = 1.06; // brakes a bit late
  while (done < laps && t < 400) {
    const pos = car.body.translation();
    const near = track.nearest(pos.x, pos.z, hint);
    hint = near.i;
    updateSurface(car, track, hint);
    if (car.surface.some(g => g < 1)) grassTime += dt;
    const inp = applyDrivingHelp(help, pilot.drive(car, near.i, near.s, dt), car);
    car.step(inp); world.step(); t += dt;

    const slip = Math.abs(Math.atan2(car.vLat, Math.max(Math.abs(car.speed), 1)));
    if (car.speed > 5) maxSlip = Math.max(maxSlip, slip);
    if (slip > 0.5 && car.speed > 5 && !spinning) { spins++; spinning = true; }
    if (slip < 0.2) spinning = false;
    const imp = car.takeImpact();
    if (Math.abs(near.lateral) > track.wallOffset - 1.6 && imp > 1 && t - lastWall > 1) { wallHits++; lastWall = t; }
    if (car.axes().up.y < 0.3) {
      flips++;
      const rp = track.pointAt(near.s, 0);
      car.place(rp.x, rp.y, rp.z, track.headingAt(near.s));
    }
    // lap: crossed s = 0 going forward after covering most of the lap
    const sNow = near.s;
    if (s0 > track.total - 50 && sNow < 50 && t - lapStart > 20) { times.push(t - lapStart); lapStart = t; done++; }
    s0 = sNow;
  }
  world.free();
  return { times, wallHits, spins, flips, maxSlip, grassTime };
}

for (const [driver, help] of [['line', 'easy'], ['line', 'off'], ['keyboard', 'easy'], ['keyboard', 'medium'], ['keyboard', 'off']] as const) {
  const r = lap(driver, help);
  console.log(`${driver.padEnd(8)} help=${help.padEnd(6)} laps ${r.times.map(x => x.toFixed(1)).join(' / ') || '-'} s, walls ${r.wallHits}, spins ${r.spins}, flips ${r.flips}, max slip ${(r.maxSlip * 57.3).toFixed(0)}°, wheels on grass ${r.grassTime.toFixed(1)} s`);
  if (help !== 'off') {
    check(r.times.length === 2, `${driver}/${help}: completes two laps`);
    check(r.spins === 0 && r.flips === 0, `${driver}/${help}: no spins or flips`);
    check(r.wallHits <= 2, `${driver}/${help}: at most 2 wall hits`);
  }
}
process.exit(failed ? 1 : 0);
