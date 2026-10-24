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
import { newRun, scoreRound, standings, isOver } from '../src/sim/championship';
import { LICENSES, medalFor, medalTime } from '../src/sim/licenses';
import { referenceTime, referenceLap } from './license-times';
import { LAP_REF, qualifyingOrder } from '../src/sim/weekend';
import { Damage, DAMAGE } from '../src/sim/damage';
import { Tow, TOW } from '../src/sim/tow';
import * as THREE from 'three';
import { Fun, FUN_DEFAULTS } from '../src/sim/fun';
import { racingLine } from '../src/sim/racingLine';

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

  // throttle held at take-off doesn't pitch the car; steering in the air turns it and its travel
  const heading = () => { const v = car.body.linvel(); return Math.atan2(v.x, v.z); };
  const airSteer = (tank: number, hover = false) => {
    car.place(0, 0, 0, 0); jets.tank = 1; jets.reset();
    run({ ...idle, throttle: 1 }, none, () => car.speed > 25);
    const held = { ...idle, throttle: 1, steer: 0.6 };
    car.step(held); jets.step(car, held, { ...none, hop: true, hover }); world.step();
    jets.tank = tank;
    let minUp = 1, h0 = NaN, h1 = 0, lead = 0;
    run(held, { ...none, hover }, t => {
      minUp = Math.min(minUp, car.axes().up.y);
      if (car.airborne) {
        if (isNaN(h0)) h0 = heading();
        h1 = heading();
        const f = car.axes().fwd, d = Math.atan2(f.x, f.z) - h1;
        lead = Math.max(lead, Math.abs(Math.atan2(Math.sin(d), Math.cos(d))));
      }
      return t > 0.2 && !car.airborne || t > 8;
    });
    let turned = h1 - h0; turned = Math.abs(Math.atan2(Math.sin(turned), Math.cos(turned)));
    return { minUp, turned, lead };
  };
  const full = airSteer(1), empty = airSteer(0), hov = airSteer(1, true);
  console.log(`hop holding throttle and steering: lowest up ${full.minUp.toFixed(2)}, travel turned ${(full.turned * 57.3).toFixed(0)}° in the air (${(empty.turned * 57.3).toFixed(0)}° with an empty tank)`);
  console.log(`hover holding steering: travel turned ${(hov.turned * 57.3).toFixed(0)}°, nose at most ${(hov.lead * 57.3).toFixed(0)}° off the travel, landed at ${(car.speed * 3.6).toFixed(0)} km/h`);
  check(full.minUp > 0.9, 'inputs held through a hop keep the car level');
  check(full.turned > 0.35 && full.turned < 1.6, 'steering in the air turns the car\'s travel (20° to 90° in one jump)');
  check(empty.turned > 0.35, 'steering in the air works with an empty tank');
  check(hov.turned > 1 && hov.lead < 0.6 && car.speed > 10, 'steering through a hover takes a corner without spinning the car round');

  // Road Thruster controls: holding jump hovers, side thrusters dodge on the road and flip in the air
  car.place(0, 0, 0, 0); jets.tank = 1; jets.reset();
  run(idle, none, t => t > 1);
  car.step(idle); jets.step(car, idle, { ...none, hop: true, hover: true }); world.step();
  let hoverAir = 0, hoverTime = 0;
  run(idle, { ...none, hover: true }, t => { if (car.airborne) hoverAir += dt; if (jets.hovering) hoverTime += dt; return t > 0.3 && !car.airborne || t > 8; });
  console.log(`jump held: ${hoverAir.toFixed(2)} s in the air (${hoverTime.toFixed(2)} s hovering), tank ${(jets.tank * 100).toFixed(0)}%`);
  check(hoverAir > air + 1, 'holding jump hovers: at least a second longer in the air than a plain jump');

  car.place(0, 0, 0, 0); jets.tank = 1; jets.reset();
  run({ ...idle, throttle: 1 }, none, t => t > 0.5 && car.speed > 20);
  car.step(idle); jets.step(car, idle, { ...none, sidePress: 1 }); world.step();
  const { right } = car.axes(), lv = car.body.linvel();
  const sideways = lv.x * right.x + lv.z * right.z;
  console.log(`side thruster on the road: ${sideways.toFixed(1)} m/s sideways`);
  check(jets.events.includes('dodge') && sideways > 3, 'a side thruster dodges sideways on the road');

  // (car.speed only updates on a step, so drive a moment before reading it after place())
  car.place(0, 0, 0, 0); jets.tank = 1; jets.reset();
  run({ ...idle, throttle: 1 }, none, t => t > 0.5 && car.speed > 20);
  car.step(idle); jets.step(car, idle, { ...none, hop: true }); world.step();
  let rolled = false; const rollEvents: string[] = [];
  run(idle, { ...none, side: -1 }, t => { if (car.axes().up.y < -0.3) rolled = true; rollEvents.push(...jets.events); return t > 0.3 && !car.airborne || t > 4; });
  run(idle, none, t => t > 2);
  console.log(`side thruster in the air: ${rolled ? 'rolled over' : 'did not roll'}, events ${rollEvents.join(', ') || '-'}, upright ${car.axes().up.y.toFixed(2)}`);
  check(rolled, 'a side thruster held in the air flips the car');
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
  let t = 0, stuckT = 0, playerResets = 0;
  while (t < 150 * race.laps && !race.allFinished) {
    const p = race.player;
    updateSurface(car, track, p.hint);
    const inp = applyDrivingHelp('easy', pilot.drive(car, p.hint, p.s, dt), car);
    car.step(inp); jets.step(car, inp, { boost: false, hop: false, airRoll: false });
    race.stepRivals(); world.step(); canisters.step(dt); race.afterStep(); t += dt;
    // wedged against a wall: the line driver can't back out, so press R like a player would
    stuckT = Math.abs(car.speed) < 1 && !race.player.finished ? stuckT + dt : 0;
    if (stuckT > 3) {
      stuckT = 0; playerResets++;
      const s = race.player.s - 5, q = track.pointAt(s, 0);
      car.place(q.x, q.y, q.z, track.headingAt(s)); jets.reset();
    }
    for (const e of race.rivals) {
      if (e.jets.boosting) boost.set(e.name, (boost.get(e.name) ?? 0) + dt);
      if (e.gotAir) air.set(e.name, (air.get(e.name) ?? 0) + e.gotAir);
    }
  }
  console.log(`${race.rivals.length} rivals, ${race.difficulty}, ${race.laps} laps${playerResets ? ` (the player's car was reset ${playerResets}×)` : ''}:`);
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

// ---- championship scoring
{
  console.log('championship scoring:');
  const run = newRun('0x1.5', 'club');
  const names = ['A', 'B', 'You', 'C'];
  scoreRound(run, names.map(name => ({ name })));
  scoreRound(run, ['B', 'A', 'C', 'You'].map(name => ({ name })));
  const table = standings(run);
  check(run.points.A === 43 && run.points.B === 43 && run.points.You === 27 && run.points.C === 27, 'points 25-18-15-12 add up over two rounds');
  check(table.length === 4 && table[0].points === 43, 'the standings list everyone, most points first');
  const tie = { ...newRun('0x1.5', 'club'), points: { X: 26, Y: 26, Z: 26 }, finishes: { X: [3, 1], Y: [2, 2], Z: [1, 10] } };
  check(standings(tie).map(r => r.name).join('') === 'XZY', 'a tie on points goes to more wins, then more seconds');
  scoreRound(run, names.map(name => ({ name })));
  check(isOver(run) && run.round === 3, 'the 0x1.5 Championship is over after 3 rounds');
}

// ---- license targets: the reference driver still makes each target, so the medals stay fair
{
  console.log('license tests (reference driver vs the stored time):');
  for (const lic of LICENSES) for (const test of lic.tests) {
    const t = referenceTime(lic, test);
    const off = t === null ? Infinity : t / test.ref - 1;
    console.log(`  ${lic.name.padEnd(16)} ${test.name.padEnd(20)} ${t?.toFixed(2) ?? 'dnf'} s (stored ${test.ref.toFixed(2)}, gold ${medalTime(test, 'gold').toFixed(1)}, silver ${medalTime(test, 'silver').toFixed(1)})`);
    check(Math.abs(off) < 0.03, `${lic.name} / ${test.name}: reference time within 3% of the stored one (rerun scripts/license-times.ts after a handling change)`);
    check(t !== null && medalFor(test, t) === 'gold', `${lic.name} / ${test.name}: the reference driver gets gold`);
  }
}

// ---- race weekend: the bots' qualifying times, and the race grid from qualifying
{
  console.log('race weekend:');
  for (const id of CLASS_ORDER) {
    const t = referenceLap(id);
    console.log(`  ${id.padEnd(8)} reference flying lap ${t?.toFixed(2) ?? 'dnf'} s (stored ${LAP_REF[id].toFixed(2)})`);
    check(t !== null && Math.abs(t / LAP_REF[id] - 1) < 0.03, `${id}: flying lap within 3% of the stored one (rerun scripts/license-times.ts after a handling change)`);
  }
  const q = qualifyingOrder(null, 5, '0x1.5', 'club');
  check(q.length === 6 && q[5].name === 'You' && q.slice(0, 5).every((r, k) => k === 0 || r.time! >= q[k - 1].time!), 'qualifying: quickest first, no time at the back');
  const pole = qualifyingOrder(1, 5, '0x1.5', 'pro');
  check(pole[0].name === 'You', 'qualifying: a quicker lap than every bot takes pole');
  const world = buildWorld(track, terrain);
  const car = new Car(world, 0, 0, 0, 0);
  const race = new Race(track, world, new Canisters(track), car, new Jets(), { opponents: 5, grid: q.map(r => r.name) });
  check(race.entrants.map(e => e.name).join() === q.map(r => r.name).join(), 'the race grid follows the qualifying order');
  world.free();
}

// ---- crash damage: hits into the barrier, and the flying tow putting the car back on the road
{
  console.log('crash damage:');
  const track = new Track(), world = buildWorld(track, new Terrain(track));
  const s = 420;
  /** drive into the right-hand barrier at `v` m/s, `angle` (rad) off the track direction */
  const crash = (v: number, angle: number, from = 9, steps = 240) => {
    const head = track.headingAt(s), a = track.pointAt(s, from);
    const right = track.pointAt(s, 10);
    const toWall = Math.atan2(right.x - a.x, right.z - a.z);
    let d = toWall - head; d = Math.atan2(Math.sin(d), Math.cos(d));
    const h = head + d * (angle / (Math.PI / 2));
    const car = new Car(world, a.x, a.y, a.z, h);
    for (let k = 0; k < 60; k++) { car.step({ steer: 0, throttle: 0, brake: 0, handbrake: true }); world.step(); }
    car.body.setLinvel({ x: Math.sin(h) * v, y: 0, z: Math.cos(h) * v }, true);
    (car as unknown as { prevVel: object }).prevVel = { x: Math.sin(h) * v, y: 0, z: Math.cos(h) * v };
    const dmg = new Damage();
    for (let k = 0; k < steps; k++) {
      car.step({ steer: 0, throttle: 0, brake: 0, handbrake: false }); world.step();
      if (car.impact > DAMAGE.threshold) dmg.hit(car, car.impactVec);
      car.takeImpact();
    }
    car.dispose();
    return dmg;
  };
  const big = crash(26, Math.PI / 2), mid = crash(14, Math.PI / 2), scrape = crash(25, 0.12, 13, 150);
  console.log(`  head-on 94 km/h: front ${big.zones.front.toFixed(2)}; 50 km/h: front ${mid.zones.front.toFixed(2)}, power ${(mid.powerMul * 100).toFixed(0)}%; glancing scrape: worst ${scrape.worst.toFixed(2)}`);
  check(big.wrecked, 'a head-on hit at 94 km/h wrecks the car');
  check(!mid.wrecked && mid.zones.front > 0.2 && mid.powerMul < 1, 'a head-on hit at 50 km/h dents the front and costs power');
  check(mid.zones.rear === 0, 'a front hit leaves the rear alone');
  check(scrape.worst < 0.15, 'a glancing scrape along the barrier barely marks the car');

  // the tow: from a car on its roof off the road to the road, facing the right way
  const carAt = { p: new THREE.Vector3(...(['x', 'y', 'z'] as const).map(k => track.pointAt(600, 12)[k])), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 1, Math.PI)) };
  carAt.p.y += 0.5;
  const tow = new Tow(track, carAt, 595, 3, CAR.comHeight);
  const seen = new Set<string>();
  let t = 0, held = 0, lowest = Infinity, released: THREE.Vector3 | null = null;
  while (!tow.done && t < 40) {
    tow.step(dt); t += dt;
    for (const e of tow.takeEvents()) { seen.add(e); if (e === 'release') released = tow.carPos.clone(); }
    if (tow.holding) { held += dt; lowest = Math.min(lowest, tow.pos.y - tow.carPos.y); }
  }
  const road = track.pointAt(595, 3);
  console.log(`  tow: holds the car ${held.toFixed(1)} s, gone after ${t.toFixed(1)} s, events ${[...seen].join(' ')}`);
  check(tow.done && t < 25, 'the tow finishes and flies away');
  check(['hooked', 'release', 'ring', 'gone'].every(e => seen.has(e)), 'the tow hooks, drops the car, flies through the rings and leaves');
  check(tow.rings.length === TOW.rings.length && tow.rings.every(r => r.passed), 'it flies through every ring of fire');
  check(!!released && Math.hypot(released.x - road.x, released.z - road.z) < 0.5 && Math.abs(released.y - road.y - CAR.comHeight) < 0.3, 'the car is set down on the road');
  check(lowest > TOW.cable, 'the tow car stays above the car it carries');
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(tow.carQuat);
  check(Math.abs(Math.atan2(fwd.x, fwd.z) - track.headingAt(595)) < 0.05 || Math.abs(Math.abs(Math.atan2(fwd.x, fwd.z) - track.headingAt(595)) - 2 * Math.PI) < 0.05, 'the car faces along the track when it lands');
}

// ---- Fun Mode: every ramp's jump lands on the road (the big one through its ring of fire), the
// rings score and singe, items work, the slipstream tows, and the bots get round a fun race
{
  console.log('fun mode:');
  const line = racingLine(track);
  const RAMP_SPEED = [0.84, 0.96, 0.78];
  for (const id of CLASS_ORDER) {
    const spec = CLASSES[id].spec;
    const world = buildWorld(track, terrain);
    const fun = new Fun(track, world, spec, FUN_DEFAULTS, line);
    const jumps = fun.layout.ramps.map((r, k) => {
      // straight down the middle of the ramp at its design speed, the driving help on
      const d = (r.d0 + r.d1) / 2, v = spec.topSpeed * RAMP_SPEED[k], s0 = r.s0 - 60;
      const p = track.pointAt(s0, d), h = track.headingAt(s0);
      const car = new Car(world, p.x, p.y, p.z, h, spec), jets = new Jets();
      const fc = fun.add('test', car, jets, { car, s: s0, lateral: d, speed: v }, true, false);
      car.body.setLinvel({ x: Math.sin(h) * v, y: 0, z: Math.cos(h) * v }, true);
      let hint = track.nearest(p.x, p.z).i, t = 0, air = 0, best = 0, land = 0, flipped = false;
      while (t < 4) {
        const pos = car.body.translation();
        const near = track.nearest(pos.x, pos.z, hint); hint = near.i;
        fc.view.s = near.s; fc.view.lateral = near.lateral;
        const ahead = track.pointAt(near.s + 25, d), ax = car.axes();
        const tx = ahead.x - pos.x, tz = ahead.z - pos.z;
        const steer = Math.max(-1, Math.min(1, 2 * Math.atan2(ax.fwd.x * tz - ax.fwd.z * tx, ax.fwd.x * tx + ax.fwd.z * tz)));
        const inp = { steer, throttle: car.speed < v ? 1 : 0.2, brake: 0, handbrake: false };
        car.step(inp); jets.step(car, { ...inp, throttle: 0, steer: 0 }, { boost: false, hop: false, airRoll: false });
        fun.preStep(fc); world.step(); fun.afterStep(dt, true); t += dt;
        if (car.airborne) air += dt; else { if (air > best) { best = air; land = near.lateral; } air = 0; }
        if (ax.up.y < 0.3) flipped = true;
        if (best > 0.3 && t > 2.5) break;
      }
      const rings = fc.rings;
      fun.clearCars(); world.removeRigidBody(car.body);
      return { best, land, flipped, rings };
    });
    console.log(`  ${id.padEnd(8)} ramp jumps ${jumps.map(j => `${j.best.toFixed(2)} s`).join(', ')}, landing ${jumps.map(j => j.land.toFixed(1)).join(', ')} m across`);
    check(jumps.every((j, k) => j.best > [1.3, 0.45, 0.45][k] && !j.flipped && Math.abs(j.land) < track.halfWidth + 1), `${id}: every ramp jump lands on the road the right way up`);
    check(jumps[0].rings === 1, `${id}: the big jump goes through its ring of fire`);
    world.free();
  }
  // rings: through a road ring scores, under a raised one singes; items
  {
    const spec = CLASSES['0x1.5'].spec, world = buildWorld(track, terrain);
    const fun = new Fun(track, world, spec, FUN_DEFAULTS, line);
    const drive = (d: number, secs: number, fc: ReturnType<typeof fun.add>) => {
      const car = fc.car;
      let hint = track.nearest(car.body.translation().x, car.body.translation().z).i;
      for (let t = 0; t < secs; t += dt) {
        const pos = car.body.translation(), near = track.nearest(pos.x, pos.z, hint); hint = near.i;
        fc.view.s = near.s; fc.view.lateral = near.lateral;
        const ahead = track.pointAt(near.s + 20, d), ax = car.axes(), tx = ahead.x - pos.x, tz = ahead.z - pos.z;
        const inp = { steer: Math.max(-1, Math.min(1, 2 * Math.atan2(ax.fwd.x * tz - ax.fwd.z * tx, ax.fwd.x * tx + ax.fwd.z * tz))), throttle: car.speed < 25 ? 1 : 0, brake: 0, handbrake: false };
        car.step(inp); fun.preStep(fc); world.step(); fun.afterStep(dt, true);
      }
    };
    const place = (s: number, d: number) => {
      const p = track.pointAt(s, d), h = track.headingAt(s);
      const car = new Car(world, p.x, p.y, p.z, h, spec);
      car.body.setLinvel({ x: Math.sin(h) * 25, y: 0, z: Math.cos(h) * 25 }, true);
      return fun.add('test', car, new Jets(), { car, s, lateral: d, speed: 25 }, true, false);
    };
    const road = fun.layout.rings.find(r => r.kind === 'road')!, hop = fun.layout.rings.find(r => r.kind === 'hop')!;
    const a = place(road.s - 30, road.d);
    drive(road.d, 2, a);
    check(a.rings === 1 && a.stunt >= 100, 'driving through a ring of fire scores');
    fun.clearCars(); world.removeRigidBody(a.car.body);
    const b = place(hop.s - 30, hop.d);
    drive(hop.d, 2, b);
    check(b.rings === 0 && b.soot > 0, 'driving under a raised ring of fire singes the car');
    b.item = 'turbo'; b.charges = 1;
    const v0 = b.car.speed;
    check(fun.useItem(b) && b.boostT > 0 && b.item === null, 'a turbo fires and is used up');
    drive(hop.d, 1, b);
    check(b.car.speed > v0 + 3, 'the turbo speeds the car up');
    b.item = 'mega'; b.charges = 1;
    fun.useItem(b);
    check(b.car.body.linvel().y > 8, 'Mega Jump throws the car up');
    world.free();
  }
  // the slipstream: right behind another car the drag drops
  {
    const world = buildWorld(track, terrain);
    const car = new Car(world, 0, 0, 0, 0), jets = new Jets();
    const race = new Race(track, world, new Canisters(track), car, jets, { opponents: 1 });
    race.go();
    const lead = race.rivals[0];
    const s = 200, p = track.pointAt(s, 0), q = track.pointAt(s - 10, 0), h = track.headingAt(s);
    lead.car.place(p.x, p.y, p.z, h); car.place(q.x, q.y, q.z, h);
    for (const c of [lead.car, car]) c.body.setLinvel({ x: Math.sin(h) * 50, y: 0, z: Math.cos(h) * 50 }, true);
    lead.car.speed = car.speed = 50;
    lead.hint = track.nearest(p.x, p.z).i; race.player.hint = track.nearest(q.x, q.z).i;
    for (let k = 0; k < 480; k++) race.afterStep();
    check(car.draft > 0.5 && lead.car.draft === 0, `slipstream: the car behind gets a tow (draft ${car.draft.toFixed(2)})`);
    world.free();
  }
  // a fun race: the bots go for rings, boxes and items and all get round
  {
    const spec = CLASSES['0x1.5'].spec, world = buildWorld(track, terrain);
    const car = new Car(world, 0, -100, 0, 0, spec), jets = new Jets();
    const race = new Race(track, world, new Canisters(track), car, jets, { opponents: 5, laps: 2, difficulty: 'pro' });
    const fun = new Fun(track, world, spec, FUN_DEFAULTS, line);
    const cars = new Map(race.entrants.map(e => [e, fun.add(e.name, e.car, e.jets, e, e === race.player, !!e.driver)] as const));
    for (const e of race.rivals) { const fc = cars.get(e)!, dr = e.driver!; dr.aim = (s, v) => fun.aim(fc, s, v, dr.def.aggression); }
    race.onRivalStep = (e, step) => fun.preStep(cars.get(e)!, step);
    const hold = { steer: 0, throttle: 0, brake: 0, handbrake: true };
    for (let k = 0; k < 240; k++) { car.step(hold); race.stepRivals(); world.step(); race.afterStep(); fun.afterStep(dt, false); }
    race.go();
    let t = 0;
    const kinds = new Set<string>();
    while (t < 400 && !race.rivals.every(e => e.finished)) {
      car.step(hold); race.stepRivals(); world.step(); race.afterStep(); fun.afterStep(dt, true); t += dt;
      for (const fc of fun.cars) { for (const ev of fc.events) kinds.add(ev.kind); fc.events.length = 0; }
    }
    const bots = race.rivals.map(e => cars.get(e)!);
    const resets = race.rivals.reduce((a, e) => a + e.resets, 0);
    console.log(`  fun race: ${race.rivals.map(e => `${e.name.split(' ')[0]} ${e.finishTime?.toFixed(0) ?? 'dnf'} s, ${cars.get(e)!.stunt} pts, ${cars.get(e)!.rings} rings`).join('; ')}; ${resets} resets; events ${[...kinds].join(' ')}`);
    check(race.rivals.every(e => e.finished), 'fun race: every bot finishes');
    check(resets <= 8, 'fun race: the bots need at most 8 resets between them');
    check(bots.every(b => b.rings > 0 && b.stunt > 0), 'fun race: every bot scores stunt points and flies through rings');
    check(['ring', 'box', 'item', 'pad', 'air'].every(k => kinds.has(k)), 'fun race: rings, boxes, items, boost pads and big air all happen');
    world.free();
  }
}

process.exit(failed ? 1 : 0);
