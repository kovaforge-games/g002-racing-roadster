// The electric car: a Rapier ray-cast vehicle with an EV powertrain (instant torque up to a power
// limit, regenerative braking, no gears), aero drag and downforce, anti-roll bars, traction
// control, ABS and the physics side of "driving help" (yaw damping and slide recovery).
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
};

const RHO = 1.2, G = 9.81;
const WHEELS = [
  { x: CAR.track / 2, z: CAR.wheelbase / 2, front: true },
  { x: -CAR.track / 2, z: CAR.wheelbase / 2, front: true },
  { x: CAR.track / 2, z: -CAR.wheelbase / 2, front: false },
  { x: -CAR.track / 2, z: -CAR.wheelbase / 2, front: false },
];
/** suspension hard points sit this far above the centre of mass */
const HARDPOINT_Y = CAR.wheelRadius + CAR.restLength - 0.06 - CAR.comHeight;

/** maximum road-wheel angle at a given speed: full lock at parking speed, much less at speed */
export function steerLockAt(speed: number) {
  return CAR.steerLock / (1 + (Math.abs(speed) / 21) ** 1.4);
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
  readonly wheels: WheelState[] = WHEELS.map(() => ({ steer: 0, spin: 0, suspension: CAR.restLength, contact: false, slip: 0, contactPoint: { x: 0, y: 0, z: 0 } }));
  /** driving help strength in physics (0 = off, 1 = full) */
  stability = 1;
  tractionControl = true;
  /** per-wheel surface: 1 on tarmac and kerbs, lower on grass (set by the game each step) */
  readonly surface = [1, 1, 1, 1];
  abs = true;

  // telemetry
  speed = 0;          // forward speed, m/s (negative in reverse)
  vLat = 0;           // sideways speed, m/s (positive = sliding right)
  yawRate = 0;
  powerKw = 0;        // motor power, negative while regenerating
  motorRpm = 0;
  airborne = false;
  latAccel = 0; longAccel = 0;
  impact = 0;         // largest sudden velocity change this frame (m/s), for camera shake and sound

  private prevVel = { x: 0, y: 0, z: 0 };
  private steerAngle = 0;

  constructor(private world: RAPIER.World, x: number, y: number, z: number, heading: number) {
    const q = { x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) };
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y + CAR.comHeight + 0.05, z).setRotation(q)
      .setCanSleep(false).setCcdEnabled(true).setAngularDamping(0.4).setLinearDamping(0));
    // body shell: lower tub and cabin, both relative to the centre of mass
    const tub = RAPIER.ColliderDesc.cuboid(0.94, 0.28, 2.32).setTranslation(0, 0.47 - CAR.comHeight, 0)
      .setMassProperties(CAR.mass, { x: 0, y: 0, z: 0 }, { x: 3300, y: 3600, z: 760 }, { x: 0, y: 0, z: 0, w: 1 })
      .setFriction(0.3).setRestitution(0.05);
    const cabin = RAPIER.ColliderDesc.cuboid(0.7, 0.28, 1.05).setTranslation(0, 1.05 - CAR.comHeight, -0.25)
      .setDensity(0).setFriction(0.3);
    world.createCollider(tub, this.body);
    world.createCollider(cabin, this.body);

    const v = (this.vehicle = world.createVehicleController(this.body));
    v.indexUpAxis = 1;
    v.setIndexForwardAxis = 2;
    WHEELS.forEach((w, i) => {
      // an axle along -x makes +z the forward direction for positive engine force
      v.addWheel({ x: w.x, y: HARDPOINT_Y, z: w.z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, CAR.restLength, CAR.wheelRadius);
      v.setWheelSuspensionStiffness(i, CAR.stiffness);
      v.setWheelSuspensionCompression(i, CAR.damping.compression);
      v.setWheelSuspensionRelaxation(i, CAR.damping.relaxation);
      v.setWheelMaxSuspensionTravel(i, CAR.maxTravel);
      v.setWheelMaxSuspensionForce(i, 120000);
      v.setWheelFrictionSlip(i, CAR.grip);
      v.setWheelSideFrictionStiffness(i, 1);
    });
  }

  /** put the car back on the road, stationary, facing `heading` */
  place(x: number, y: number, z: number, heading: number) {
    this.body.setTranslation({ x, y: y + CAR.comHeight + 0.08, z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.prevVel = { x: 0, y: 0, z: 0 };
    this.steerAngle = 0;
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
    const target = -inp.steer * steerLockAt(vF);   // positive road-wheel angle steers left
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
    if (reversing) drive = vF > -CAR.maxReverse ? -0.35 * CAR.maxDriveForce * inp.brake : 0;
    else if (inp.throttle > 0) {
      const powerLimited = CAR.power / Math.max(1, vF);
      drive = Math.min(CAR.maxDriveForce, powerLimited) * inp.throttle;
      if (vF > CAR.topSpeed) drive *= Math.max(0, 1 - (vF - CAR.topSpeed) / 2);
    }
    const braking = !reversing && inp.brake > 0.02;
    let regen = 0;
    for (let i = 0; i < 4; i++) {
      const front = WHEELS[i].front;
      const share = (front ? CAR.frontDriveShare : 1 - CAR.frontDriveShare) / 2;
      let f = drive * share;
      if (this.tractionControl && f !== 0) f = Math.sign(f) * Math.min(Math.abs(f), CAR.grip * this.surface[i] * load[i] * 0.95);
      // Rapier ignores the brake on a wheel that has engine force, so only one is ever set
      let brake = 0;
      if (braking && !reversing) {
        const bShare = (front ? CAR.frontBrakeShare : 1 - CAR.frontBrakeShare) / 2;
        let force = CAR.brakeDecel * CAR.mass * inp.brake * bShare;
        if (this.abs) force = Math.min(force, CAR.grip * this.surface[i] * load[i] * (front ? 0.97 : 0.9));
        brake = force * dt;
        f = 0;
      } else if (inp.throttle < 0.05 && !reversing && vF > 1) {
        // lift-off regen: the motor slows the car gently, mostly on the rear axle
        const force = CAR.regenDecel * CAR.mass * (front ? 0.35 : 0.65) / 2;
        brake = force * dt;
        regen += force * vF;
      }
      if (inp.handbrake && !front) { brake = Math.max(brake, CAR.mass * 9 * dt); f = 0; }
      v.setWheelEngineForce(i, f);
      v.setWheelBrake(i, brake);
      v.setWheelSideFrictionStiffness(i, inp.handbrake && !front ? 0.45 : 1);
      v.setWheelFrictionSlip(i, CAR.grip * this.surface[i]);
    }
    this.powerKw = (drive * Math.max(0, vF) - regen - (braking ? Math.min(CAR.mass * 3, CAR.brakeDecel * CAR.mass * inp.brake) * Math.max(0, vF) * 0.4 : 0)) / 1000;

    // aero: drag against the motion, downforce along the car's down axis
    const drag = 0.5 * RHO * CAR.dragArea * speed;
    // rolling resistance, much higher on grass
    const grass = this.surface.reduce((a, g, i) => a + (v.wheelIsInContact(i) ? 1 - g : 0), 0) / 4;
    const roll = speed > 0.3 && grounded ? (CAR.rollResist + grass * 0.35) * CAR.mass * G / speed : 0;
    b.addForce({ x: -(drag + roll) * lv.x, y: -(drag + roll) * lv.y, z: -(drag + roll) * lv.z }, true);
    if (grounded) {
      const lift = 0.5 * RHO * CAR.liftArea * vF * vF;
      b.addForce({ x: -up.x * lift, y: -up.y * lift, z: -up.z * lift }, true);
    }

    // anti-roll bars: resist the difference in compression across each axle
    const comp = [0, 1, 2, 3].map(i => v.wheelIsInContact(i) ? CAR.restLength - (v.wheelSuspensionLength(i) ?? CAR.restLength) : 0);
    const t = b.translation();
    for (const [l, r, k] of [[1, 0, CAR.antiRoll.front], [3, 2, CAR.antiRoll.rear]] as const) {
      const f = (comp[l] - comp[r]) * k;
      for (const [i, sign] of [[l, 1], [r, -1]] as const) {
        const w = WHEELS[i];
        const p = { x: t.x - right.x * w.x + fwd.x * w.z, y: t.y - right.y * w.x + fwd.y * w.z, z: t.z - right.z * w.x + fwd.z * w.z };
        // lift the more compressed side, pull the other one down
        const fs = sign * f;
        b.addForceAtPoint({ x: up.x * fs, y: up.y * fs, z: up.z * fs }, p, true);
      }
    }

    // driving help (physics side): damp yaw beyond what the steering asks for, and bleed off slides
    if (this.stability > 0 && grounded >= 2 && vF > 6) {
      const aMax = CAR.grip * (G + 0.5 * RHO * CAR.liftArea * vF * vF / CAR.mass);
      const wanted = Math.max(-aMax / vF, Math.min(aMax / vF, vF * Math.tan(this.steerAngle) / CAR.wheelbase));
      const excess = yawRate - wanted;
      if (Math.sign(excess) === Math.sign(yawRate) && Math.abs(yawRate) > Math.abs(wanted)) {
        const tq = -excess * 3600 * 4.5 * this.stability;
        b.addTorque({ x: up.x * tq, y: up.y * tq, z: up.z * tq }, true);
      }
      const slip = Math.atan2(vR, Math.abs(vF));
      if (Math.abs(slip) > 0.05 && !inp.handbrake) {
        const k = Math.min(1, (Math.abs(slip) - 0.05) * 5) * 0.9 * this.stability;
        const fl = -vR * CAR.mass * k;
        b.addForce({ x: right.x * fl, y: right.y * fl, z: right.z * fl }, true);
      }
    }

    v.updateVehicle(dt);

    // telemetry
    const accX = (lv.x - this.prevVel.x) / dt, accY = (lv.y - this.prevVel.y) / dt, accZ = (lv.z - this.prevVel.z) / dt;
    const jump = Math.hypot(lv.x - this.prevVel.x, lv.y - this.prevVel.y, lv.z - this.prevVel.z);
    if (jump > 1.2 * G * dt * 3) this.impact = Math.max(this.impact, jump);
    const smooth = Math.min(1, dt * 8);
    this.latAccel += ((accX * right.x + accY * right.y + accZ * right.z) - this.latAccel) * smooth;
    this.longAccel += ((accX * fwd.x + accY * fwd.y + accZ * fwd.z) - this.longAccel) * smooth;
    this.prevVel = { x: lv.x, y: lv.y, z: lv.z };
    this.speed = vF; this.vLat = vR; this.yawRate = yawRate;
    this.motorRpm = Math.abs(vF) / CAR.wheelRadius * 9 * 60 / (2 * Math.PI);
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      w.steer = v.wheelSteering(i) ?? 0;
      w.spin = v.wheelRotation(i) ?? 0;
      w.suspension = v.wheelSuspensionLength(i) ?? CAR.restLength;
      w.contact = v.wheelIsInContact(i);
      const cp = v.wheelContactPoint(i);
      if (cp) w.contactPoint = { x: cp.x, y: cp.y, z: cp.z };
      // sideways speed of the tyre over the road, plus locking and wheelspin
      const ws = w.steer;
      const ax = { x: right.x * Math.cos(ws) + fwd.x * Math.sin(ws), z: right.z * Math.cos(ws) + fwd.z * Math.sin(ws) };
      const px = WHEELS[i].z * fwd.x - WHEELS[i].x * right.x, pz = WHEELS[i].z * fwd.z - WHEELS[i].x * right.z;
      // velocity of the contact point: v + ω × r (yaw only is plenty here)
      const vx = lv.x + av.y * pz, vz = lv.z - av.y * px;
      const lat = Math.abs(vx * ax.x + vz * ax.z);
      let s = Math.max(0, (lat - 1.6) / 4);
      if (inp.handbrake && !WHEELS[i].front && Math.abs(vF) > 3) s = Math.max(s, 0.8);
      if (!this.abs && braking && inp.brake > 0.85 && Math.abs(vF) > 4) s = Math.max(s, 0.7);
      w.slip = w.contact ? Math.min(1, s) : 0;
    }
  }

  /** consume the impact recorded since the last call */
  takeImpact() { const i = this.impact; this.impact = 0; return i; }

  dispose() {
    this.world.removeVehicleController(this.vehicle);
    this.world.removeRigidBody(this.body);
  }
}
