// Driving cameras, ported from g001's rig: a chase camera whose FOV widens with speed, that lags
// vertically over crests and shakes on impacts, plus a far chase, hood and bumper view.
import * as THREE from 'three';

export interface Focus { x: number; y: number; z: number; heading: number; pitch: number; roll: number; speed: number; }

export type CameraMode = 'chase' | 'far' | 'hood' | 'bumper';
export const CAMERA_ORDER: CameraMode[] = ['chase', 'far', 'hood', 'bumper'];

export class CameraRig {
  readonly cam = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 9000);
  mode: CameraMode = 'chase';
  private smoothHeading = 0;
  private pos = new THREE.Vector3();
  private shake = 0;
  private init = false;
  private initY = false;
  /** 0..1 rear-jet thrust: widens the view and adds a buzz */
  boost = 0;
  private boostK = 0;
  /** the car's size against the Roadster's: the cameras move back and up for a bigger one */
  size = { length: 1, height: 1 };

  reset() { this.init = false; this.initY = false; this.pos.set(0, 0, 0); }
  kick(amount: number) { this.shake = Math.min(1, this.shake + amount); }

  next() {
    this.mode = CAMERA_ORDER[(CAMERA_ORDER.indexOf(this.mode) + 1) % CAMERA_ORDER.length];
    this.reset();
  }

  update(f: Focus, dt: number, lookBack = false) {
    if (!this.init) { this.smoothHeading = f.heading; }
    let dh = f.heading - this.smoothHeading;
    while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2;
    const k = this.mode === 'chase' ? 4.5 : this.mode === 'far' ? 3.5 : 30;
    this.smoothHeading += dh * Math.min(1, dt * k);
    const h = this.smoothHeading + (lookBack ? Math.PI : 0);
    const fx = Math.sin(h), fz = Math.cos(h);
    const speedK = Math.min(1, Math.abs(f.speed) / 70);
    const onboard = this.mode === 'hood' || this.mode === 'bumper';
    this.boostK += (this.boost - this.boostK) * Math.min(1, dt * (this.boost > this.boostK ? 6 : 2));
    const fov = (onboard ? 66 : 58) + speedK * 14 + this.boostK * 9;
    if (Math.abs(this.cam.fov - fov) > 0.05) { this.cam.fov += (fov - this.cam.fov) * Math.min(1, dt * 3); this.cam.updateProjectionMatrix(); }
    this.shake *= Math.exp(-dt * 6);
    const sh = this.shake * 0.09 + speedK * speedK * 0.01 + this.boostK * 0.025;
    const jx = (Math.random() - 0.5) * sh, jy = (Math.random() - 0.5) * sh;

    if (!onboard) {
      const { length: L, height: H } = this.size;
      const dist = (this.mode === 'chase' ? 6.0 + speedK * 1.3 : 9.5 + speedK * 1.5) * (0.5 + 0.5 * L) * (0.7 + 0.3 * H);
      const up = (this.mode === 'chase' ? 1.75 : 2.9) * (0.35 + 0.65 * H);
      const target = new THREE.Vector3(f.x - fx * dist, f.y + up, f.z - fz * dist);
      if (!this.init) this.pos.copy(target);
      const y = this.pos.y;
      this.pos.lerp(target, Math.min(1, dt * 12));
      // vertical lag: crests read as movement instead of the world bobbing
      this.pos.y = this.initY ? y + (target.y - y) * Math.min(1, dt * 3.5) : target.y;
      this.initY = true;
      this.cam.position.set(this.pos.x + jx, this.pos.y + jy, this.pos.z);
      this.cam.lookAt(f.x + fx * 4 * L, f.y + (this.mode === 'chase' ? 0.75 : 0.9) * H, f.z + fz * 4 * L);
    } else {
      // onboard cameras are rigidly attached to the car
      const { length: L, height: H } = this.size;
      const off = this.mode === 'hood' ? [0, 0.68 * H, 1.0 * L] : [0, 0.1 * H, 2.45 * L];
      const qCar = new THREE.Quaternion().setFromEuler(new THREE.Euler(f.pitch, f.heading, f.roll, 'YXZ'));
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(f.pitch, f.heading + (lookBack ? Math.PI : 0), f.roll, 'YXZ'));
      const o = new THREE.Vector3(off[0], off[1], off[2]).applyQuaternion(qCar);
      this.cam.position.set(f.x + o.x + jx * 0.3, f.y + o.y + jy * 0.3, f.z + o.z);
      // three.js cameras look down -z; rotate 180° so they look along the car's +z
      this.cam.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
      if (this.mode === 'hood') this.cam.rotateX(-0.05);
    }
    this.init = true;
  }
}
