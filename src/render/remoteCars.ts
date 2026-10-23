// The other drivers in a party race: their cars drawn from the states they send (about 20 a
// second), shown 100 ms in the past so there are always two states to blend between, with a name
// tag over each car. They have no physics here: each driver's own game simulates their car.
import * as THREE from 'three';
import { PAINTS, type CarModel } from './carModel';
import { cloneModel } from './cloneModel';
import { NameTag } from './nameTag';
import { CAR, type Car } from '../sim/car';
import type { LobbyPlayer, Snapshot } from '../net/party';

const DELAY = 0.1;
const MAX_EXTRAPOLATE = 0.25;

export const paintIndex = (n: number) => Math.abs(Math.floor(n)) % PAINTS.length;
export const paintCss = (n: number) => `#${PAINTS[paintIndex(n)].color.toString(16).padStart(6, '0')}`;

/** the few fields CarModel.update reads from a simulated car */
interface CarPose { wheels: { steer: number; spin: number; suspension: number }[]; speed: number; latAccel: number; longAccel: number }

class RemoteCar {
  readonly model: CarModel;
  readonly pose: CarPose;
  tag: NameTag | null = null;
  private tagKey = '';
  /** latest blended state, for the minimap and standings */
  x = 0; z = 0; dist = -Infinity; paint = 0;

  constructor(src: CarModel, restSuspension: number) {
    // a copy of the player's model shares its geometry: building one from scratch takes seconds
    this.model = cloneModel(src);
    this.model.onSpoiler = undefined;
    this.pose = { wheels: [0, 1, 2, 3].map(() => ({ steer: 0, spin: 0, suspension: restSuspension })), speed: 0, latAccel: 0, longAccel: 0 };
  }

  setPaint(n: number) {
    this.paint = paintIndex(n);
    for (let k = 0; k < PAINTS.length && this.model.paintName !== PAINTS[this.paint].name; k++) this.model.nextPaint();
  }

  /** the tag shows the name in the car's colour; rebuilt when either changes */
  label(name: string, group: THREE.Group) {
    const key = `${name}|${this.paint}`;
    if (key === this.tagKey) return;
    this.tagKey = key;
    if (this.tag) group.remove(this.tag.sprite);
    this.tag = new NameTag(name, paintCss(this.paint));
    group.add(this.tag.sprite);
  }

  /** blend the buffered states at the render time */
  apply(buf: Snapshot[], now: number, dt: number) {
    const t = now - DELAY;
    let a = buf[0], b = buf[0];
    for (let k = 0; k < buf.length; k++) { if (buf[k].t <= t) a = buf[k]; b = buf[k]; if (buf[k].t >= t) break; }
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
    this.pose.longAccel = dt > 0 ? THREE.MathUtils.clamp((speed - this.pose.speed) / dt, -15, 15) : 0;
    this.pose.speed = speed;
    this.setPaint(s[11] ?? 0);
    this.model.update(this.pose as unknown as Car, ((s[10] ?? 0) & 1) === 1, dt);
    this.x = root.position.x; this.z = root.position.z;
    this.dist = s[7] ?? this.dist;
  }
}

export class RemoteCars {
  readonly group = new THREE.Group();
  private cars = new Map<string, RemoteCar>();
  private night = false;

  constructor(private src: CarModel, private restSuspension: number) {}

  setNight(night: boolean) { this.night = night; for (const c of this.cars.values()) c.model.setNight(night); }

  private remove(id: string, c: RemoteCar) {
    this.group.remove(c.model.root);
    if (c.tag) this.group.remove(c.tag.sprite);
    this.cars.delete(id);
  }

  clear() { for (const [id, c] of this.cars) this.remove(id, c); }

  /** the other cars as they should look now; returns them for the map and standings */
  update(snapshots: Map<string, Snapshot[]>, players: LobbyPlayer[], cam: THREE.Camera, dt: number, positions: Map<string, number>) {
    const now = performance.now() / 1000;
    for (const [id, c] of this.cars) if (!snapshots.has(id)) this.remove(id, c);
    for (const [id, buf] of snapshots) {
      if (!buf.length) continue;
      let c = this.cars.get(id);
      if (!c) {
        c = new RemoteCar(this.src, this.restSuspension);
        c.model.setNight(this.night);
        this.cars.set(id, c); this.group.add(c.model.root);
      }
      c.apply(buf, now, dt);
      c.label(players.find(p => p.id === id)?.name ?? 'Driver', this.group);
      const p = c.model.root.position;
      c.tag!.update(positions.get(id) ?? 0, p.x, p.y, p.z, p.distanceTo(cam.position));
    }
    return [...this.cars.entries()].map(([id, c]) => ({ id, x: c.x, z: c.z, dist: c.dist, paint: c.paint }));
  }
}
