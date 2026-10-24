// Headless handling test: straight-line numbers on a flat pad, then laps of the circuit with
// a line-following driver and with a twitchy "keyboard" driver. Prints a report and exits
// non-zero if the car spins, flips or keeps hitting walls.
//   npm run sim-test
import RAPIER from '@dimforge/rapier3d-compat';
import { CAR, Car, type CarInputs } from '../src/sim/car';
import { applyDrivingHelp, HELP_STABILITY, type DrivingHelp } from '../src/sim/assist';
import { Track } from '../src/sim/track';
import { Autopilot } from '../src/sim/autopilot';
import { updateSurface } from '../src/sim/surface';
import { Terrain } from '../src/sim/terrain';
import { buildWorld, initPhysics, PHYSICS_DT } from '../src/sim/world';
import { Jets, JETS, type JetInputs } from '../src/sim/jets';
import { Canisters } from '../src/sim/canisters';
import { Race, RACE_LAPS, MAX_OPPONENTS, type RaceOptions } from '../src/sim/race';
import { CLASSES, CLASS_ORDER, type ClassId } from '../src/sim/classes';

await initPhysics();
// the bots roll dice (mistakes, passing, boosting): seed them so every run of this test is the same
let seed = 20261024;
Math.random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
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

// ---- thrusters on a flat pad: boost, hop, air control
{
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = dt;
  world.createCollider(RAPIER.ColliderDesc.cuboid(3000, 0.5, 3000).setTranslation(0, -0.5, 0));
  const car = new Car(world, 0, 0, -2500, 0);
  const jets = new Jets();
  const none = { boost: false, hop: false, airRoll: false };
  const run = (inp: CarInputs, j: JetInputs, until: (t: number) => boolean) => {
    let t = 0;
    while (!until(t) && t < 60) { car.step(inp); jets.step(car, inp, j); world.step(); t += dt; }
    return t;
  };
  const idle = { steer: 0, throttle: 0, brake: 0, handbrake: false };
  run(idle, none, t => t > 1);
  const t100 = run({ ...idle, throttle: 1 }, { ...none, boost: true }, () => car.speed >= 100 / 3.6);
  console.log(`boosted 0-100 km/h ${t100.toFixed(2)} s, tank ${(jets.tank * 100).toFixed(0)}%`);
  check(t100 < 2.1, 'boost: 0-100 km/h under 2.1 s');
  run({ ...idle, throttle: 1 }, { ...none, boost: true }, () => jets.tank <= 0);
  const vMax = car.speed;
  console.log(`boost until empty: ${kmh(vMax)} km/h`);
  check(jets.tank === 0 && vMax < CAR.topSpeed + JETS.boostMaxSpeed + 1, 'boost drains the tank and stays under its speed cap');

  // hop from rest with a full tank: height and air time
  car.place(0, 0, 0, 0); jets.tank = 1; jets.reset();
  run(idle, none, t => t > 1);
  const y0 = car.body.translation().y;
  let top = y0, air = 0;
  car.step(idle); jets.step(car, idle, { ...none, hop: true }); world.step();
  check(jets.hopped, 'hop fires when grounded');
  run(idle, none, t => { top = Math.max(top, car.body.translation().y); if (car.airborne) air += dt; return t > 3; });
  console.log(`hop: ${(top - y0).toFixed(2)} m high, ${air.toFixed(2)} s in the air, tank ${(jets.tank * 100).toFixed(0)}%`);
  check(top - y0 > 1.4 && top - y0 < 3.2, 'hop height between 1.4 and 3.2 m');
  check(air > 0.8, 'hop gives at least 0.8 s of air time');

  // hop at speed holding pitch for most of the jump: a front flip, landed by the driving help
  car.place(0, 0, 0, 0); jets.tank = 1; jets.reset();
  run({ ...idle, throttle: 1 }, none, () => car.speed > 25);
  car.step(idle); jets.step(car, idle, { ...none, hop: true }); world.step();
  const events: string[] = [];
  let t = 0, flipped = false;
  while (t < 4) {
    const inp = { ...idle, throttle: car.airborne && t < 0.95 ? 1 : 0 };
    car.step(inp); jets.step(car, inp, none); world.step(); t += dt;
    events.push(...jets.events);
    if (car.axes().up.y < -0.3) flipped = true;
    if (t > 0.3 && !car.airborne && events.length) break;
  }
  run(idle, none, t => t > 2);
  console.log(`air control: ${flipped ? 'went over' : 'did not rotate'}, events ${events.join(', ') || '-'}, upright ${car.axes().up.y.toFixed(2)}`);
  check(flipped, 'holding pitch in the air rotates the car past upside down');

  // throttle and steering already held at take-off don't pitch or yaw the car
  car.place(0, 0, 0, 0); jets.tank = 1; jets.reset();
  run({ ...idle, throttle: 1 }, none, () => car.speed > 40);
  const held = { ...idle, throttle: 1, steer: 0.5 };
  car.step(held); jets.step(car, held, { ...none, hop: true }); world.step();
  let minUp = 1, yaw = 0;
  run(held, none, t => { minUp = Math.min(minUp, car.axes().up.y); if (car.airborne) yaw += Math.abs(car.yawRate) * dt; return t > 0.2 && !car.airborne || t > 3; });
  console.log(`hop holding throttle and steering: lowest up ${minUp.toFixed(2)}, yaw in the air ${(yaw * 57.3).toFixed(0)}°`);
  check(minUp > 0.9 && yaw < 0.3, 'inputs held through a hop keep the car level');
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
// ---- races against the AI rivals, with the line-following driver in the player's car
function runRace(opts: RaceOptions) {
  const world = buildWorld(track, terrain);
  const canisters = new Canisters(track);
  const car = new Car(world, 0, 0, 0, 0), jets = new Jets();
  const race = new Race(track, world, canisters, car, jets, opts);
  const pilot = new Autopilot(track);
  pilot.keyboard = true; pilot.aggression = 1.06;
  const hold = { steer: 0, throttle: 0, brake: 0, handbrake: true };
  for (let k = 0; k < 240; k++) { car.step(hold); race.stepRivals(); world.step(); race.afterStep(); }
  race.go();
  const boost = new Map<string, number>(), air = new Map<string, number>();
  let t = 0;
  while (t < 150 * race.laps && !race.allFinished) {
    const p = race.player;
    updateSurface(car, track, p.hint);
    const inp = applyDrivingHelp('easy', pilot.drive(car, p.hint, p.s, dt), car);
    car.step(inp); jets.step(car, inp, { boost: false, hop: false, airRoll: false });
    race.stepRivals(); world.step(); canisters.step(dt); race.afterStep(); t += dt;
    for (const e of race.rivals) {
      if (e.jets.boosting) boost.set(e.name, (boost.get(e.name) ?? 0) + dt);
      if (e.gotAir) air.set(e.name, (air.get(e.name) ?? 0) + e.gotAir);
    }
  }
  console.log(`${race.rivals.length} rivals, ${race.difficulty}, ${race.laps} laps:`);
  for (const e of race.standings) {
    console.log(`  P${e.pos} ${e.name.padEnd(25)} ${e.finishTime?.toFixed(1) ?? 'dnf'} s, best lap ${e.bestLap?.toFixed(1) ?? '-'} s` +
      (e.driver ? `, boost ${(boost.get(e.name) ?? 0).toFixed(1)} s, air picked up ${((air.get(e.name) ?? 0) * 100).toFixed(0)}%, resets ${e.resets}` : ''));
  }
  world.free();
  return { race, boost, air };
}
{
  const { race, boost, air } = runRace({ opponents: 5, laps: RACE_LAPS, difficulty: 'expert' });
  const rivals = race.rivals;
  const times = race.entrants.map(e => e.finishTime ?? Infinity);
  check(race.allFinished, `race: everyone finishes ${RACE_LAPS} laps`);
  check(Math.max(...times) - Math.min(...times) < 30, 'race: the field finishes within 30 s');
  check(rivals.reduce((a, e) => a + e.resets, 0) <= 2, 'race: rivals need at most 2 resets');
  check(rivals.every(e => e.bestLap !== null && e.bestLap > 55 && e.bestLap < 66), 'race: rival lap times between 55 and 66 s');
  check([...boost.values()].reduce((a, b) => a + b, 0) > 15, 'race: rivals use their boost');
  check([...air.values()].reduce((a, b) => a + b, 0) > 0.5, 'race: rivals pick up air canisters');
  const temps = race.player.car.tyreTemp;
  console.log(`tyres after the race: ${temps.map(t => t.toFixed(0)).join(' / ')} °C`);
  check(temps.every(t => t > 60 && t < 125), 'race: tyres warm up into 60-125 °C');
}
// the full field of 11 bots, at the easiest and the hardest difficulty
{
  const avgBest = (r: Race) => r.rivals.reduce((a, e) => a + (e.bestLap ?? 99), 0) / r.rivals.length;
  const newbie = runRace({ opponents: MAX_OPPONENTS, laps: 2, difficulty: 'newbie' }).race;
  const pro = runRace({ opponents: MAX_OPPONENTS, laps: 2, difficulty: 'pro' }).race;
  console.log(`average rival best lap: newbie ${avgBest(newbie).toFixed(1)} s, pro ${avgBest(pro).toFixed(1)} s`);
  check(newbie.entrants.length === 12 && pro.allFinished && newbie.allFinished, 'full field: 12 cars, everyone finishes');
  check(pro.rivals.reduce((a, e) => a + e.resets, 0) <= 4, 'full field: at most 4 rival resets');
  check(avgBest(newbie) > avgBest(pro) + 6, 'newbie bots lap at least 6 s slower than pro bots');
}

// ---- the classes: straight-line numbers, then two laps of the bots racing in each
{
  const want: Record<ClassId, { t100: [number, number]; top: [number, number] }> = {
    rental: { t100: [4, 6], top: [195, 215] }, '0x1.5': { t100: [2.3, 3], top: [250, 270] },
    '0x2.5': { t100: [2, 2.7], top: [290, 310] }, '0x3.5': { t100: [1.8, 2.4], top: [330, 350] },
  };
  const laps: number[] = [];
  for (const id of CLASS_ORDER) {
    const spec = CLASSES[id].spec;
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = dt;
    world.createCollider(RAPIER.ColliderDesc.cuboid(3000, 0.5, 3000).setTranslation(0, -0.5, 0));
    const car = new Car(world, 0, 0, -2500, 0, spec);
    const run = (inp: CarInputs, until: (t: number) => boolean) => { let t = 0; while (!until(t) && t < 120) { car.step(inp); world.step(); t += dt; } return t; };
    const full = { steer: 0, throttle: 1, brake: 0, handbrake: false };
    run({ ...full, throttle: 0 }, t => t > 1);
    const t100 = run(full, () => car.speed >= 100 / 3.6);
    let topGear = 0;
    run(full, t => { topGear = Math.max(topGear, car.gear); return t > 25; });
    const top = car.speed * 3.6;
    world.free();
    const { race } = runRace({ opponents: 5, laps: 2, difficulty: 'expert', cls: id });
    const best = Math.min(...race.rivals.map(e => e.bestLap ?? 99));
    laps.push(best);
    console.log(`${id}: 0-100 ${t100.toFixed(2)} s, top ${top.toFixed(0)} km/h${spec.gears ? `, gears up to ${topGear} of ${spec.gears}` : ''}, best bot lap ${best.toFixed(1)} s`);
    check(t100 > want[id].t100[0] && t100 < want[id].t100[1] && top > want[id].top[0] && top < want[id].top[1], `${id}: 0-100 and top speed in range`);
    check(spec.gears === 0 || topGear === spec.gears, `${id}: the gearbox shifts all the way up`);
    check(race.allFinished && race.rivals.reduce((a, e) => a + e.resets, 0) <= 2, `${id}: everyone finishes, at most 2 bot resets`);
  }
  check(laps.every((t, k) => k === 0 || t < laps[k - 1] - 2), 'each class laps at least 2 s quicker than the one before');
}

process.exit(failed ? 1 : 0);
