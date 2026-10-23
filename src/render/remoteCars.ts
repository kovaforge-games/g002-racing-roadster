// The other drivers in a party race: their cars drawn from the states they send (about 20 a
// second), shown 100 ms in the past so there are always two states to blend between, with a name
// tag over each car. They have no physics here: each driver's own game simulates their car.
import * as THREE from 'three';
import { CarModel, PAINTS } from './carModel';
import { CAR, type Car } from '../sim/car';
import type { LobbyPlayer, Snapshot } from '../net/party';

const DELAY = 0.1;
const MAX_EXTRAPOLATE = 0.25;

/** the few fields CarModel.update reads from a simulated car */
interface CarPose { wheels: { steer: number; spin: number; suspension: number }[]; latAccel: number; longAccel: number }

class RemoteCar {
  readonly model = new CarModel();
  readonly label: HTMLElement;
  readonly pose: CarPose;
  private paint = 0;
  private lastSpeed = 0;
  /** latest interpolated state, for the minimap and standings */
  x = 0; z = 0; heading = 0; dist = -Infinity; visible = false;

  constructor(parent: HTMLElement, restSuspension: number) {
    this.pose = { wheels: [0, 1, 2, 3].map(() => ({ steer: 0, spin: 0, suspension: restSuspension })), latAccel: 0, longAccel: 0 };
    this.label = document.createElement('div');
    this.label.className = 'nametag';
    parent.appendChild(this.label);
  }

  setPaint(n: number) {
    const target = Math.abs(Math.floor(n)) % PAINTS.length;
    while (this.paint !== target) { this.model.nextPaint(); this.paint = (this.paint + 1) % PAINTS.length; }
  }

  dispose() {
    this.label.remove();
    this.model.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }

  /** blend the buffered states at the render time */
  apply(buf: Snapshot[], now: number, dt: number) {
    const t = now - DELAY;
    let a = buf[0], b = buf[0];
    for (let k = 0; k < buf.length; k++) { if (buf[k].t <= t) a = buf[k]; if (buf[k].t >= t) { b = buf[k]; break; } b = buf[k]; }
    const root = this.model.root;
    const pa = new THREE.Vector3(a.s[0], a.s[1], a.s[2]), qa = new THREE.Quaternion(a.s[3], a.s[4], a.s[5], a.s[6]);
    if (a !== b) {
      const f = THREE.MathUtils.clamp((t - a.t) / Math.max(1e-3, b.t - a.t), 0, 1);
      root.position.lerpVectors(pa, new THREE.Vector3(b.s[0], b.s[1], b.s[2]), f);
      root.quaternion.slerpQuaternions(qa, new THREE.Quaternion(b.s[3], b.s[4], b.s[5], b.s[6]), f);
    } else if (buf.length > 1 && t > a.t) {
      // late: carry on along the last motion for a moment
      const p = buf[buf.length - 2], span = Math.max(1e-3, a.t - p.t), ahead = Math.min(MAX_EXTRAPOLATE, t - a.t);
      root.position.set(a.s[0] + (a.s[0] - p.s[0]) / span * ahead, a.s[1] + (a.s[1] - p.s[1]) / span * ahead, a.s[2] + (a.s[2] - p.s[2]) / span * ahead);
      root.quaternion.copy(qa);
    } else { root.position.copy(pa); root.quaternion.copy(qa); }

    const s = b.s, speed = s[8] ?? 0;
    for (const w of this.pose.wheels) { w.spin += speed / CAR.wheelRadius * dt; w.steer = 0; }
    this.pose.wheels[0].steer = this.pose.wheels[1].steer = s[9] ?? 0;
    this.pose.longAccel = dt > 0 ? THREE.MathUtils.clamp((speed - this.lastSpeed) / dt, -15, 15) : 0;
    this.lastSpeed = speed;
    this.setPaint(s[11] ?? 0);
    this.model.update(this.pose as unknown as Car, ((s[10] ?? 0) & 1) === 1, dt);
    this.x = root.position.x; this.z = root.position.z;
    this.heading = new THREE.Euler().setFromQuaternion(root.quaternion, 'YXZ').y;
    this.dist = s[7] ?? this.dist;
  }
}

export class RemoteCars {
  readonly group = new THREE.Group();
  private cars = new Map<string, RemoteCar>();
  private tags = document.createElement('div');
  private night = false;
  private v = new THREE.Vector3();

  constructor(private restSuspension: number) {
    this.tags.className = 'nametags';
    document.body.appendChild(this.tags);
  }

  setNight(night: boolean) { this.night = night; for (const c of this.cars.values()) c.model.setNight(night); }

  clear() { for (const c of this.cars.values()) { this.group.remove(c.model.root); c.dispose(); } this.cars.clear(); }

  /** the other cars as they should look now; returns them for the map and standings */
  update(snapshots: Map<string, Snapshot[]>, players: LobbyPlayer[], cam: THREE.Camera, dt: number) {
    const now = performance.now() / 1000;
    for (const [id, c] of this.cars) if (!snapshots.has(id)) { this.group.remove(c.model.root); c.dispose(); this.cars.delete(id); }
    const w = innerWidth, h = innerHeight;
    for (const [id, buf] of snapshots) {
      if (!buf.length) continue;
      let c = this.cars.get(id);
      if (!c) {
        c = new RemoteCar(this.tags, this.restSuspension);
        c.model.setNight(this.night);
        this.cars.set(id, c); this.group.add(c.model.root);
      }
      c.apply(buf, now, dt);
      const pl = players.find(p => p.id === id);
      c.label.textContent = pl?.name ?? '';
      // name tag above the roof, hidden behind the camera or far away
      this.v.copy(c.model.root.position); this.v.y += 1.25;
      const dist = this.v.distanceTo(cam.position);
      this.v.project(cam);
      const show = this.v.z < 1 && dist < 160 && Math.abs(this.v.x) < 1.1 && Math.abs(this.v.y) < 1.1;
      c.label.style.display = show ? '' : 'none';
      if (show) {
        c.label.style.transform = `translate(${((this.v.x + 1) / 2 * w).toFixed(1)}px, ${((1 - this.v.y) / 2 * h).toFixed(1)}px) translate(-50%, -100%)`;
        c.label.style.opacity = String(THREE.MathUtils.clamp(1.4 - dist / 120, 0.35, 1));
      }
    }
    return [...this.cars.entries()].map(([id, c]) => ({ id, x: c.x, z: c.z, heading: c.heading, dist: c.dist }));
  }

  setVisible(v: boolean) { this.group.visible = v; this.tags.style.display = v ? '' : 'none'; }
}
