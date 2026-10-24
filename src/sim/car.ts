// The electric car: a Rapier ray-cast vehicle with an EV powertrain (instant torque up to a power
// limit, regenerative braking, no gears), aero drag and downforce, anti-roll bars, traction
// control, ABS, tyre temperatures and the physics side of "driving help" (yaw damping and slide
// recovery).
import RAPIER from '@dimforge/rapier3d-compat';
import { PHYSICS_DT } from './world';

export interface CarInputs {
  /** -1 (left) .. 1 (right) */
  steer: number;
  throttle: number;
  brake: number;
  handbrake: boolean;
}

export const CAR = {
  mass: 1850,
  wheelbase: 2.9,
  track: 1.64,
  wheelRadius: 0.355,
  /** centre of mass above the ground at rest. Lower than a real car's ~0.5 m so the ray-cast
   *  vehicle (which applies tyre forces at the contact patch) can't trip over itself */
  comHeight: 0.32,
  restLength: 0.3,
  maxTravel: 0.2,
  /** per unit of chassis mass, as in Bullet: about 1.7 Hz ride frequency */
  stiffness: 30,
  damping: { compression: 2.4, relaxation: 3.0 },
  grip: 1.55,
  /** total drive force cap (N) and motor power (W): instant torque up to the power limit */
  maxDriveForce: 21000,
  power: 560000,
  frontDriveShare: 0.42,
  maxReverse: 9,
  topSpeed: 72,
  brakeDecel: 13.5,
  frontBrakeShare: 0.62,
  /** coasting regen, as a deceleration (m/s²) */
  regenDecel: 1.6,
  dragArea: 0.55,
  liftArea: 1.1,
  rollResist: 0.012,
  antiRoll: { front: 42000, rear: 26000 },
  steerLock: 0.62,
  /** collision boxes (half extents, m): the lower tub, and the cabin (or none) */
  tub: [0.94, 0.28, 2.32] as [number, number, number],
  cabin: [0.7, 0.28, 1.05] as [number, number, number] | null,
  inertia: { x: 3300, y: 3600, z: 760 },
  /** a sequential gearbox (auto-shifting) with this many gears, or 0 for a one-speed EV */
  gears: 0,
  /** gearbox cars: engine speed range (rpm) */
  idleRpm: 0,
  redline: 0,
};

/** a car's physical spec: the road car above, or a class car from sim/classes.ts */
export type CarSpec = typeof CAR;

const RHO = 1.2, G = 9.81;
/** tyre heating (°C/s per unit) and cooling (per second) */
const TYRE_HEAT = { roll: 0.05, slide: 1.4, force: 2.2, skid: 12, cool: 0.02, coolSpeed: 0.0012 };
/** wheel positions relative to the centre of mass: front left, front right, rear left, rear right */
export const wheelLayout = (c: CarSpec) => [
  { x: c.track / 2, z: c.wheelbase / 2, front: true },
  { x: -c.track / 2, z: c.wheelbase / 2, front: true },
  { x: c.track / 2, z: -c.wheelbase / 2, front: false },
  { x: -c.track / 2, z: -c.wheelbase / 2, front: false },
];
/** tyre temperatures (°C): below `cold` a tyre shows blue, above `hot` red (yellow between).
 *  Tyre blankets keep them at `blanket` on the grid, so they start out cold but not frozen */
export const TYRE = { cold: 55, hot: 100, blanket: 45 };

/** grip multiplier at a tyre temperature: a gentle effect. Tyres colder than the blankets (after a
 *  long cool-down) grip a little less, down to 0.98; overheated ones go off, down to 0.97 */
export function tyreGrip(t: number) {
  if (t < TYRE.blanket - 5) return 0.98 + 0.02 * Math.max(0, (t - 15) / (TYRE.blanket - 20));
  if (t > TYRE.hot + 5) return Math.max(0.97, 1 - (t - TYRE.hot - 5) * 0.0015);
  return 1;
}

/** suspension hard points sit this far above the centre of mass */
export const hardpointY = (c: CarSpec) => c.wheelRadius + c.restLength - 0.06 - c.comHeight;

/** maximum road-wheel angle at a given speed: full lock at parking speed, much less at speed */
export function steerLockAt(speed: number, lock = CAR.steerLock) {
  return lock / (1 + (Math.abs(speed) / 21) ** 1.4);
}

export interface WheelState {
  steer: number; spin: number; suspension: number; contact: boolean;
  /** 0..1 how hard the tyre is sliding, for skid marks, smoke and squeal */
  slip: number;
  contactPoint: { x: number; y: number; z: number };
}

export class Car {
  readonly body: RAPIER.RigidBody;
  readonly vehicle: RAPIER.DynamicRayCastVehicleController;
  readonly wheels: WheelState[];
  private layout: ReturnType<typeof wheelLayout>;
  /** driving help strength in physics (0 = off, 1 = full) */
  stability = 1;
  tractionControl = true;
  /** per-wheel surface: 1 on tarmac and kerbs, lower on grass (set by the game each step) */
  readonly surface = [1, 1, 1, 1];
  /** air temperature (°C): tyres cool towards it */
  ambient = 22;
  /** tyre temperatures (°C), front left, front right, rear left, rear right: they warm up with
   *  load, sliding, braking and driving, and cool towards the air temperature */
  readonly tyreTemp = [TYRE.blanket, TYRE.blanket, TYRE.blanket, TYRE.blanket];
  private tyreForce = [0, 0, 0, 0];
  abs = true;

  // telemetry
  speed = 0;          // forward speed, m/s (negative in reverse)
  vLat = 0;           // sideways speed, m/s (positive = sliding right)
  yawRate = 0;
  powerKw = 0;        // motor power, negative while regenerating
  motorRpm = 0;
  /** gearbox cars: the gear engaged (1..gears); 0 on a one-speed EV */
  gear = 0;
  private shiftT = 0;
  airborne = false;
  latAccel = 0; longAccel = 0;
  impact = 0;         // largest sudden velocity change this frame (m/s), for camera shake and sound

  private prevVel = { x: 0, y: 0, z: 0 };
  private steerAngle = 0;

  constructor(private world: RAPIER.World, x: number, y: number, z: number, heading: number, readonly spec: CarSpec = CAR) {
    const S = spec;
    this.layout = wheelLayout(S);
    this.wheels = this.layout.map(() => ({ steer: 0, spin: 0, suspension: S.restLength, contact: false, slip: 0, contactPoint: { x: 0, y: 0, z: 0 } }));
    const q = { x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) };
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y + S.comHeight + 0.05, z).setRotation(q)
      .setCanSleep(false).setCcdEnabled(true).setAngularDamping(0.4).setLinearDamping(0));
    // body shell: lower tub and cabin, both relative to the centre of mass
    const tub = RAPIER.ColliderDesc.cuboid(...S.tub).setTranslation(0, 0.19 + S.tub[1] - S.comHeight, 0)
      .setMassProperties(S.mass, { x: 0, y: 0, z: 0 }, S.inertia, { x: 0, y: 0, z: 0, w: 1 })
      .setFriction(0.3).setRestitution(0.05);
    world.createCollider(tub, this.body);
    if (S.cabin) world.createCollider(RAPIER.ColliderDesc.cuboid(...S.cabin).setTranslation(0, 0.77 + S.cabin[1] - S.comHeight, -0.25)
      .setDensity(0).setFriction(0.3), this.body);

    const v = (this.vehicle = world.createVehicleController(this.body));
    v.indexUpAxis = 1;
    v.setIndexForwardAxis = 2;
    this.layout.forEach((w, i) => {
      // an axle along -x makes +z the forward direction for positive engine force
      v.addWheel({ x: w.x, y: hardpointY(S), z: w.z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, S.restLength, S.wheelRadius);
      v.setWheelSuspensionStiffness(i, S.stiffness);
      v.setWheelSuspensionCompression(i, S.damping.compression);
      v.setWheelSuspensionRelaxation(i, S.damping.relaxation);
      v.setWheelMaxSuspensionTravel(i, S.maxTravel);
      v.setWheelMaxSuspensionForce(i, 120000);
      v.setWheelFrictionSlip(i, S.grip);
      v.setWheelSideFrictionStiffness(i, 1);
    });
  }

  /** put the car back on the road, stationary, facing `heading` */
  place(x: number, y: number, z: number, heading: number) {
    const S = this.spec;
    this.body.setTranslation({ x, y: y + S.comHeight + 0.08, z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.prevVel = { x: 0, y: 0, z: 0 };
    this.steerAngle = 0;
    this.gear = this.spec.gears ? 1 : 0;
  }

  /** local axes of the chassis in world space */
  axes() {
    const r = this.body.rotation();
    const { x, y, z, w } = r;
    return {
      fwd: { x: 2 * (x * z + w * y), y: 2 * (y * z - w * x), z: 1 - 2 * (x * x + y * y) },
      up: { x: 2 * (x * y - w * z), y: 1 - 2 * (x * x + z * z), z: 2 * (y * z + w * x) },
      right: { x: -(1 - 2 * (y * y + z * z)), y: -2 * (x * y + w * z), z: -2 * (x * z - w * y) },
    };
  }

  /** one physics step; call before world.step() */
  step(inp: CarInputs, dt = PHYSICS_DT) {
    const S = this.spec;
    const b = this.body, v = this.vehicle;
    b.resetForces(true); b.resetTorques(true);
    const { fwd, up, right } = this.axes();
    const lv = b.linvel(), av = b.angvel();
    const vF = lv.x * fwd.x + lv.y * fwd.y + lv.z * fwd.z;
    const vR = lv.x * right.x + lv.y * right.y + lv.z * right.z;
    const yawRate = av.x * up.x + av.y * up.y + av.z * up.z;
    const speed2 = lv.x * lv.x + lv.y * lv.y + lv.z * lv.z;
    const speed = Math.sqrt(speed2);
    const grounded = [0, 1, 2, 3].filter(i => v.wheelIsInContact(i)).length;
    this.airborne = grounded === 0;

    // steering: speed-sensitive lock, eased so the car can't snap its wheels across
    const target = -inp.steer * steerLockAt(vF, S.steerLock);   // positive road-wheel angle steers left
    this.steerAngle += Math.max(-3 * dt, Math.min(3 * dt, target - this.steerAngle));
    // a touch of Ackermann: the inside wheel turns a little more
    const ack = 1 + Math.min(0.15, Math.abs(this.steerAngle) * 0.5);
    const left = this.steerAngle > 0;
    v.setWheelSteering(0, this.steerAngle * (left ? 1 : ack));
    v.setWheelSteering(1, this.steerAngle * (left ? ack : 1));

    // tyre loads from last step's suspension forces, for traction control and ABS
    const load = [0, 1, 2, 3].map(i => Math.max(0, v.wheelSuspensionForce(i) ?? 0));
    const reversing = vF < 0.5 && inp.brake > 0.1 && inp.throttle < 0.05;
    let drive = 0;
    if (reversing) drive = vF > -S.maxReverse ? -0.35 * S.maxDriveForce * inp.brake : 0;
    else if (inp.throttle > 0) {
      const powerLimited = S.power / Math.max(1, vF);
      drive = Math.min(S.maxDriveForce, powerLimited) * inp.throttle;
      if (vF > S.topSpeed) drive *= Math.max(0, 1 - (vF - S.topSpeed) / 2);
    }
    if (S.gears) drive *= this.gearbox(vF, dt);
    const braking = !reversing && inp.brake > 0.02;
    let regen = 0;
    for (let i = 0; i < 4; i++) {
      const front = this.layout[i].front;
      const share = (front ? S.frontDriveShare : 1 - S.frontDriveShare) / 2;
      let f = drive * share;
      const grip = S.grip * this.surface[i] * tyreGrip(this.tyreTemp[i]);
      if (this.tractionControl && f !== 0) f = Math.sign(f) * Math.min(Math.abs(f), grip * load[i] * 0.95);
      // Rapier ignores the brake on a wheel that has engine force, so only one is ever set
      let brake = 0;
      if (braking && !reversing) {
        const bShare = (front ? S.frontBrakeShare : 1 - S.frontBrakeShare) / 2;
        let force = S.brakeDecel * S.mass * inp.brake * bShare;
        if (this.abs) force = Math.min(force, grip * load[i] * (front ? 0.97 : 0.9));
        brake = force * dt;
        f = 0;
      } else if (inp.throttle < 0.05 && !reversing && vF > 1) {
        // lift-off regen: the motor slows the car gently, mostly on the rear axle
        const force = S.regenDecel * S.mass * (front ? 0.35 : 0.65) / 2;
        brake = force * dt;
        regen += force * vF;
      }
      if (inp.handbrake && !front) { brake = Math.max(brake, S.mass * 9 * dt); f = 0; }
      v.setWheelEngineForce(i, f);
      v.setWheelBrake(i, brake);
      v.setWheelSideFrictionStiffness(i, inp.handbrake && !front ? 0.45 : 1);
      v.setWheelFrictionSlip(i, grip);
      this.tyreForce[i] = Math.abs(f) + brake / dt;
    }
    this.powerKw = (drive * Math.max(0, vF) - regen - (braking ? Math.min(S.mass * 3, S.brakeDecel * S.mass * inp.brake) * Math.max(0, vF) * 0.4 : 0)) / 1000;

    // aero: drag against the motion, downforce along the car's down axis
    const drag = 0.5 * RHO * S.dragArea * speed;
    // rolling resistance, much higher on grass
    const grass = this.surface.reduce((a, g, i) => a + (v.wheelIsInContact(i) ? 1 - g : 0), 0) / 4;
    const roll = speed > 0.3 && grounded ? (S.rollResist + grass * 0.35) * S.mass * G / speed : 0;
    b.addForce({ x: -(drag + roll) * lv.x, y: -(drag + roll) * lv.y, z: -(drag + roll) * lv.z }, true);
    if (grounded) {
      const lift = 0.5 * RHO * S.liftArea * vF * vF;
      b.addForce({ x: -up.x * lift, y: -up.y * lift, z: -up.z * lift }, true);
    }

    // anti-roll bars: resist the difference in compression across each axle
    const comp = [0, 1, 2, 3].map(i => v.wheelIsInContact(i) ? S.restLength - (v.wheelSuspensionLength(i) ?? S.restLength) : 0);
    const t = b.translation();
    for (const [l, r, k] of [[1, 0, S.antiRoll.front], [3, 2, S.antiRoll.rear]] as const) {
      const f = (comp[l] - comp[r]) * k;
      for (const [i, sign] of [[l, 1], [r, -1]] as const) {
        const w = this.layout[i];
        const p = { x: t.x - right.x * w.x + fwd.x * w.z, y: t.y - right.y * w.x + fwd.y * w.z, z: t.z - right.z * w.x + fwd.z * w.z };
        // lift the more compressed side, pull the other one down
        const fs = sign * f;
        b.addForceAtPoint({ x: up.x * fs, y: up.y * fs, z: up.z * fs }, p, true);
      }
    }

    // driving help (physics side): damp yaw beyond what the steering asks for, and bleed off slides
    if (this.stability > 0 && grounded >= 2 && vF > 6) {
      const aMax = S.grip * (G + 0.5 * RHO * S.liftArea * vF * vF / S.mass);
      const wanted = Math.max(-aMax / vF, Math.min(aMax / vF, vF * Math.tan(this.steerAngle) / S.wheelbase));
      const excess = yawRate - wanted;
      if (Math.sign(excess) === Math.sign(yawRate) && Math.abs(yawRate) > Math.abs(wanted)) {
        const tq = -excess * 3600 * 4.5 * this.stability;
        b.addTorque({ x: up.x * tq, y: up.y * tq, z: up.z * tq }, true);
      }
      const slip = Math.atan2(vR, Math.abs(vF));
      if (Math.abs(slip) > 0.05 && !inp.handbrake) {
        const k = Math.min(1, (Math.abs(slip) - 0.05) * 5) * 0.9 * this.stability;
        const fl = -vR * S.mass * k;
        b.addForce({ x: right.x * fl, y: right.y * fl, z: right.z * fl }, true);
      }
    }

    // wheel rays only see the ground and walls, never another car
    v.updateVehicle(dt, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);

    // telemetry
    const accX = (lv.x - this.prevVel.x) / dt, accY = (lv.y - this.prevVel.y) / dt, accZ = (lv.z - this.prevVel.z) / dt;
    const jump = Math.hypot(lv.x - this.prevVel.x, lv.y - this.prevVel.y, lv.z - this.prevVel.z);
    if (jump > 1.2 * G * dt * 3) this.impact = Math.max(this.impact, jump);
    const smooth = Math.min(1, dt * 8);
    this.latAccel += ((accX * right.x + accY * right.y + accZ * right.z) - this.latAccel) * smooth;
    this.longAccel += ((accX * fwd.x + accY * fwd.y + accZ * fwd.z) - this.longAccel) * smooth;
    this.prevVel = { x: lv.x, y: lv.y, z: lv.z };
    this.speed = vF; this.vLat = vR; this.yawRate = yawRate;
    if (!S.gears) this.motorRpm = Math.abs(vF) / S.wheelRadius * 9 * 60 / (2 * Math.PI);
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      w.steer = v.wheelSteering(i) ?? 0;
      w.spin = v.wheelRotation(i) ?? 0;
      w.suspension = v.wheelSuspensionLength(i) ?? S.restLength;
      w.contact = v.wheelIsInContact(i);
      const cp = v.wheelContactPoint(i);
      if (cp) w.contactPoint = { x: cp.x, y: cp.y, z: cp.z };
      // sideways speed of the tyre over the road, plus locking and wheelspin
      const ws = w.steer;
      const ax = { x: right.x * Math.cos(ws) + fwd.x * Math.sin(ws), z: right.z * Math.cos(ws) + fwd.z * Math.sin(ws) };
      const px = this.layout[i].z * fwd.x - this.layout[i].x * right.x, pz = this.layout[i].z * fwd.z - this.layout[i].x * right.z;
      // velocity of the contact point: v + ω × r (yaw only is plenty here)
      const vx = lv.x + av.y * pz, vz = lv.z - av.y * px;
      const lat = Math.abs(vx * ax.x + vz * ax.z);
      let s = Math.max(0, (lat - 1.6) / 4);
      if (inp.handbrake && !this.layout[i].front && Math.abs(vF) > 3) s = Math.max(s, 0.8);
      if (!this.abs && braking && inp.brake > 0.85 && Math.abs(vF) > 4) s = Math.max(s, 0.7);
      w.slip = w.contact ? Math.min(1, s) : 0;

      // tyre temperature: rolling under load, sliding sideways, braking and driving heat it;
      // the air cools it, faster at speed
      const loadN = w.contact ? load[i] / (S.mass * G / 4) : 0;
      // (the more a tyre is loaded the harder it works, so the outside tyres in a corner heat up
      // most; past the car's own weight, downforce adds less)
      const work = Math.min(loadN, 1) ** 2 * Math.max(1, loadN) ** 0.5;
      const heat = work * (TYRE_HEAT.roll * Math.abs(vF) + TYRE_HEAT.slide * Math.min(lat, 4)) + TYRE_HEAT.force * this.tyreForce[i] / (S.mass * G / 4) * Math.min(1, Math.abs(vF) / 10)
        + (w.slip > 0.5 ? TYRE_HEAT.skid * w.slip : 0);
      // (a very hot tyre sheds heat much faster, so even a scrubbing, sliding tyre levels off)
      const hot = 1 + Math.max(0, this.tyreTemp[i] - 90) / 12;
      const cool = (this.tyreTemp[i] - this.ambient) * (TYRE_HEAT.cool + TYRE_HEAT.coolSpeed * Math.abs(vF)) * hot;
      this.tyreTemp[i] += (heat - cool) * dt;
    }
  }

  /** gearbox cars: pick the gear for this speed (shifting up near the redline and down when the
   *  revs drop), set the engine speed, and return how much drive gets through: a brief cut while
   *  a shift happens, and a torque curve that peaks high in the rev range */
  private gearbox(vF: number, dt: number) {
    const S = this.spec, n = S.gears;
    // each gear runs out at this speed (m/s): close ratios at the top
    const top = (g: number) => S.topSpeed * 1.04 * (g / n) ** 0.72;
    const rpmIn = (g: number) => S.redline * Math.abs(vF) / top(g);
    if (this.gear < 1) this.gear = 1;
    let g = this.gear;
    if (g < n && rpmIn(g) > S.redline * 0.97) g++;
    else if (g > 1 && rpmIn(g - 1) < S.redline * 0.82) g--;
    if (g !== this.gear) { this.gear = g; this.shiftT = 0.06; }
    this.shiftT = Math.max(0, this.shiftT - dt);
    this.motorRpm = Math.max(S.idleRpm, Math.min(S.redline, rpmIn(this.gear)));
    const x = this.motorRpm / S.redline;
    const torque = 0.82 + 0.18 * Math.sin(Math.min(1, x / 0.85) * Math.PI / 2);
    return this.shiftT > 0 ? 0.35 : torque;
  }

  /** fresh tyres off the blankets (a new session) */
  resetTyres() { this.tyreTemp.fill(Math.max(this.ambient, TYRE.blanket)); }

  /** consume the impact recorded since the last call */
  takeImpact() { const i = this.impact; this.impact = 0; return i; }

  dispose() {
    this.world.removeVehicleController(this.vehicle);
    this.world.removeRigidBody(this.body);
  }
}
