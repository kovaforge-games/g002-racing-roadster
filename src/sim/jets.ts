// Cold-gas thrusters fed by one air tank: rear jets for a boost, underbody jets to jump and then
// hover, side thrusters to dodge sideways on the road or flip the car in the air, and small
// attitude jets for pitch and steering in the air. Every move draws from the tank, which
// only refills from air canisters on the track. Forces go on after Car.step() (which clears
// them) and before world.step().
import type { Car, CarInputs } from './car';
import { PHYSICS_DT } from './world';

export const JETS = {
  /** rear thrust: about 0.9 g on top of the motor */
  boostAccel: 8.9,
  /** boost fades out between these speeds (m/s) over the car's top speed, so it can't run away */
  boostFadeFrom: 10, boostMaxSpeed: 23,
  /** tank fractions */
  boostDrain: 0.24,      // per second
  hopCost: 0.2,
  airDrain: 0.05,        // per second of attitude jets
  /** upward speed a hop adds (m/s): about 2.2 m high and 1.3 s in the air */
  hopSpeed: 6.6,
  hopCooldown: 0.9,
  /** hover: hold jump in the air and the underbody jets carry most of the car's weight */
  hoverLift: 0.93, hoverDrain: 0.3,
  /** side thrusters on the road: a sideways dodge (m/s), its cost and cooldown */
  sideSpeed: 4.5, sideCost: 0.08, sideCooldown: 0.6,
  /** largest air-control rates (rad/s) and how hard the jets chase them */
  pitchRate: 5.5, rollRate: 6, response: 7,
  /** steering in the air: the yaw rate (rad/s) at full lock, how quickly (1/s) the car's travel
   * swings round to follow its nose, and how far (rad) the nose may lead it. Free, so it still
   * works with an empty tank */
  airSteerRate: 1.1, airGrip: 4, airLead: 0.25,
  /** a free burst of boost (s) for nailing the start */
  launchWindow: 0.3, launchBoost: 1.2,
};

export interface JetInputs {
  boost: boolean;
  /** true on the step the hop button was pressed */
  hop: boolean;
  /** hold to turn steering into roll in the air (the handbrake button) */
  airRoll: boolean;
  /** stick pitch, -1 (nose up) .. 1 (nose down); without it, throttle and brake pitch the car */
  pitch?: number;
  /** jump held: hover once in the air */
  hover?: boolean;
  /** side thrusters held, -1 (left) .. 1 (right): a flip in the air */
  side?: number;
  /** a side thruster pressed on this step, -1 or 1: a dodge on the road */
  sidePress?: number;
}

export type JetEvent = 'launch' | 'hop' | 'dodge' | 'landing' | 'clean-landing' | 'flip' | 'roll' | 'spin' | 'empty';

export class Jets {
  /** 0..1 */
  tank = 1;
  boosting = false;
  /** 0..1 attitude-jet output, for the vapour puffs and hiss */
  attitude = 0;
  hopCooldown = 0;
  sideCooldown = 0;
  /** the underbody jets are holding the car up */
  hovering = false;
  /** remaining seconds of free launch boost */
  freeBoost = 0;
  airTime = 0;
  /** events from the last step, consumed by the game for messages, effects and sound */
  readonly events: JetEvent[] = [];
  /** set on the step of a hop, for the burst under the car */
  hopped = false;
  // rotation accumulated in the air, for flip and roll messages
  private airPitch = 0; private airRoll = 0; private airYaw = 0;
  private wasAirborne = false;
  // inputs already held at take-off are ignored until released, so holding the throttle or
  // steering through a hop doesn't send the car into a flip
  private latch = { pitch: false, steer: false };

  /** call at the moment the lights go out; boost pressed inside the window gets a free surge */
  private launchClock = -1;
  armLaunch() { this.launchClock = 0; }

  refill(amount: number) { this.tank = Math.min(1, this.tank + amount); }

  step(car: Car, drive: CarInputs, inp: JetInputs, dt = PHYSICS_DT, assist = true) {
    const b = car.body;
    const { fwd, up, right } = car.axes();
    this.events.length = 0;
    this.hopped = false;
    this.hopCooldown = Math.max(0, this.hopCooldown - dt);
    this.sideCooldown = Math.max(0, this.sideCooldown - dt);
    if (this.launchClock >= 0) {
      this.launchClock += dt;
      if (inp.boost && this.launchClock < JETS.launchWindow) { this.freeBoost = JETS.launchBoost; this.launchClock = -1; this.events.push('launch'); }
      else if (this.launchClock >= JETS.launchWindow) this.launchClock = -1;
    }

    // boost: thrust along the car, at the centre of mass so it doesn't pitch the nose up
    const free = this.freeBoost > 0;
    this.boosting = free || (inp.boost && this.tank > 0);
    if (this.boosting) {
      const v = car.speed;
      const fade = Math.max(0, Math.min(1, (car.spec.topSpeed + JETS.boostMaxSpeed - v) / (JETS.boostMaxSpeed - JETS.boostFadeFrom)));
      const f = JETS.boostAccel * car.spec.mass * fade;
      b.addForce({ x: fwd.x * f, y: fwd.y * f, z: fwd.z * f }, true);
      if (free) this.freeBoost -= dt;
      else this.drain(JETS.boostDrain * dt);
    }

    // hop: one big burst from under the car, mostly straight up
    const grounded = car.wheels.filter(w => w.contact).length >= 2;
    if (inp.hop && grounded && this.hopCooldown <= 0 && this.tank >= JETS.hopCost * 0.5) {
      const dv = JETS.hopSpeed * Math.min(1, this.tank / JETS.hopCost);
      const lv = b.linvel();
      const ux = up.x * 0.35, uy = 0.65 + up.y * 0.35, uz = up.z * 0.35;
      // don't stack on an upward speed the car already has
      const add = Math.max(0, dv - Math.max(0, lv.y));
      const m = car.spec.mass;
      b.applyImpulse({ x: ux * add * m, y: uy * add * m, z: uz * add * m }, true);
      this.drain(JETS.hopCost);
      this.hopCooldown = JETS.hopCooldown;
      this.hopped = true;
      this.events.push('hop');
    }

    // side thrusters on the road: a quick sideways dodge
    if (inp.sidePress && grounded && this.sideCooldown <= 0 && this.tank >= JETS.sideCost * 0.5) {
      const m = car.spec.mass, dv = JETS.sideSpeed * inp.sidePress;
      b.applyImpulse({ x: right.x * dv * m, y: 0.4 * m, z: right.z * dv * m }, true);
      this.drain(JETS.sideCost);
      this.sideCooldown = JETS.sideCooldown;
      this.events.push('dodge');
    }

    // hover: jump held in the air, once the jump is near its top, the underbody jets carry most of
    // the weight and soak up a fall
    this.hovering = false;
    const lvNow = b.linvel();
    if (inp.hover && car.airborne && this.airTime > 0.15 && lvNow.y < 1.5 && this.tank > 0) {
      const m = car.spec.mass;
      const f = m * 9.81 * JETS.hoverLift + m * Math.max(0, -lvNow.y) * 2.5;
      b.addForce({ x: 0, y: f, z: 0 }, true);
      this.drain(JETS.hoverDrain * dt);
      this.hovering = true;
    }

    // attitude jets in the air: chase a target rate on each local axis
    this.attitude = this.hovering ? 0.6 : 0;
    const stick = inp.pitch ?? 0;
    const rawPitch = Math.abs(stick) > 0.15 ? stick : drive.throttle - drive.brake;
    if (car.airborne) {
      this.airTime += dt;
      const av = b.angvel();
      // local angular velocity: +x (the car's left) is nose-down pitch, +y is a left yaw,
      // +z (forward) rolls to the right
      const left = { x: -right.x, y: -right.y, z: -right.z };
      const wx = av.x * left.x + av.y * left.y + av.z * left.z;
      const wy = av.x * up.x + av.y * up.y + av.z * up.z;
      const wz = av.x * fwd.x + av.y * fwd.y + av.z * fwd.z;
      this.airPitch += wx * dt; this.airYaw += wy * dt; this.airRoll += wz * dt;
      if (Math.abs(rawPitch) < 0.1) this.latch.pitch = false;
      if (Math.abs(drive.steer) < 0.1) this.latch.steer = false;
      const pitchIn = this.latch.pitch ? 0 : rawPitch;
      // the side thrusters roll the car (a flip); holding the roll button turns steering into roll
      // too, and then steering held from take-off waits to be re-centred so it doesn't tip the car
      const side = inp.side ?? 0;
      const steerIn = inp.airRoll ? (this.latch.steer ? 0 : drive.steer) : 0;
      const rollIn = Math.abs(side) > 0.05 ? side : steerIn;
      const active = this.airTime > 0.08 && this.tank > 0 && (Math.abs(pitchIn) > 0.05 || Math.abs(rollIn) > 0.05);
      const I = car.spec.inertia;
      const k = JETS.response;
      let tx = 0, ty = 0, tz = 0;
      if (active) {
        // no input on an axis: hold its current rate (players flip, the jets don't fight them)
        if (Math.abs(pitchIn) > 0.05) tx = I.x * k * (pitchIn * JETS.pitchRate - wx);
        if (Math.abs(rollIn) > 0.05) tz = I.z * k * (rollIn * JETS.rollRate - wz);
        this.attitude = Math.min(1, Math.max(this.attitude, Math.abs(pitchIn) + Math.abs(rollIn)));
        this.drain(JETS.airDrain * this.attitude * dt);
      } else if (assist && this.airTime > 0.25) {
        // driving help: with the sticks centred, ease the car back to wheels-down for the landing,
        // turning about up × world-up
        const m = car.spec.inertia.x / 3300, s = 7000 * m, d = 2500 * m;
        b.addTorque({ x: -up.z * s - av.x * d, y: 0, z: up.x * s - av.z * d }, true);
      }
      // steering in the air: turn the nose like the car turns on the road, and while the car is
      // roughly upright its travel follows the nose, so a jump or a hover can take a corner (not
      // on a short skip over a kerb or a bump)
      if (!inp.airRoll && this.airTime > 0.15) {
        const steer = Math.abs(drive.steer) > 0.05 ? drive.steer : 0;
        let yawWant = -steer * JETS.airSteerRate;
        if (steer) this.attitude = Math.max(this.attitude, Math.abs(steer) * 0.5);
        const lv = b.linvel();
        // flying backwards, the travel follows the tail instead
        const dir = lv.x * fwd.x + lv.z * fwd.z < 0 ? -1 : 1;
        const sp = Math.hypot(lv.x, lv.z), hl = Math.hypot(fwd.x, fwd.z);
        if (sp > 2 && hl > 0.3) {
          // how far the nose points from the travel, + to the left
          let d = Math.atan2(fwd.x * dir, fwd.z * dir) - Math.atan2(lv.x, lv.z);
          d = Math.atan2(Math.sin(d), Math.cos(d));
          // the nose leads the travel by a little, never so far that the car spins round
          if (yawWant * d > 0) yawWant *= Math.max(0, Math.min(1, 2 - Math.abs(d) / JETS.airLead));
          if (up.y < 0.5) d = 0;
          const turn = d * Math.min(1, JETS.airGrip * dt);
          const c = Math.cos(turn), sn = Math.sin(turn);
          const nx = lv.x * c + lv.z * sn, nz = -lv.x * sn + lv.z * c;
          const m = car.spec.mass;
          b.applyImpulse({ x: (nx - lv.x) * m, y: 0, z: (nz - lv.z) * m }, true);
        }
        // no steering: leave the yaw alone, like the other axes
        if (steer) ty = I.y * k * (yawWant - wy);
      }
      if (tx || ty || tz) {
        b.addTorque({
          x: left.x * tx + up.x * ty + fwd.x * tz,
          y: left.y * tx + up.y * ty + fwd.y * tz,
          z: left.z * tx + up.z * ty + fwd.z * tz,
        }, true);
      }
    } else {
      if (this.wasAirborne && this.airTime > 0.5) {
        const turns = (a: number) => Math.round(Math.abs(a) / (Math.PI * 2) - 0.15);
        if (turns(this.airPitch) >= 1) this.events.push('flip');
        else if (turns(this.airRoll) >= 1) this.events.push('roll');
        else if (turns(this.airYaw) >= 1) this.events.push('spin');
        if (up.y > 0.9) {
          // wheels-down landing: the tyres bite and the car keeps its speed with a small kick
          const lv = b.linvel();
          const kick = 2.2 * car.spec.mass;
          b.applyImpulse({ x: fwd.x * kick, y: 0, z: fwd.z * kick }, true);
          if (Math.hypot(lv.x, lv.z) > 8) this.events.push('clean-landing');
        } else this.events.push('landing');
      }
      this.airTime = 0; this.airPitch = 0; this.airRoll = 0; this.airYaw = 0;
      this.latch = { pitch: Math.abs(rawPitch) > 0.3, steer: Math.abs(drive.steer) > 0.3 };
    }
    this.wasAirborne = car.airborne;
  }

  private drain(amount: number) {
    const before = this.tank;
    this.tank = Math.max(0, this.tank - amount);
    if (before > 0 && this.tank === 0) this.events.push('empty');
  }

  reset() {
    this.boosting = false; this.attitude = 0; this.freeBoost = 0; this.airTime = 0; this.hovering = false; this.sideCooldown = 0;
    this.airPitch = this.airRoll = this.airYaw = 0; this.wasAirborne = false; this.launchClock = -1;
  }
}
