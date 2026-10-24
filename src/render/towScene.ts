// The flying tow car and its show: a copy of the Roadster in recovery orange with its wheels
// folded flat into hover pods, blue jets firing down from each pod, an amber beacon bar on the
// roof, a winch cable with a hook, and the three rings of fire it flies through on the way out.
// It also has the camera for the rescue: off to the side, keeping the wreck and the tow car in view.
import * as THREE from 'three';
import { cloneModel } from './cloneModel';
import { PAINTS, type CarModel } from './carModel';
import { FireRing } from './fireRing';
import type { Quality } from './graphics';
import type { Vapour } from './vapour';
import { BELLY, TOW, type Tow } from '../sim/tow';

const TOW_PAINT = 'Racing Orange';
const up = new THREE.Vector3(0, 1, 0);

/** the beacon bar: two amber lamps and a white strobe on a black bar, with TOW on each side */
function beaconBar() {
  const g = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.07, 0.18), new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.5 }));
  g.add(bar);
  const amber = [0, 1].map(() => new THREE.MeshStandardMaterial({ color: 0x3a2000, emissive: 0xffa21a, emissiveIntensity: 0, roughness: 0.3 }));
  amber.forEach((m, k) => {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 0.15), m);
    lamp.position.set(k ? -0.27 : 0.27, 0.06, 0);
    g.add(lamp);
  });
  const strobe = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.3 });
  const s = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.13), strobe);
  s.position.y = 0.055; g.add(s);
  // TOW on both sides of the bar
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#0c0c0d'; c.fillRect(0, 0, 256, 64);
  c.fillStyle = '#ffb21a'; c.font = 'bold 50px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('TOW', 128, 34);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  for (const side of [-1, 1]) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.1), new THREE.MeshBasicMaterial({ map: tex }));
    sign.position.set(0, -0.005, side * 0.0905);
    if (side < 0) sign.rotation.y = Math.PI;
    g.add(sign);
  }
  return { group: g, amber, strobe };
}

/** a downward jet from a hover pod: a bright core fading to nothing (additive) */
function jetGeometry() {
  const g = new THREE.CylinderGeometry(0.22, 0.08, 1.6, 16, 4, true).translate(0, -0.8, 0);
  const pos = g.getAttribute('position'), col = new Float32Array(pos.count * 3);
  for (let k = 0; k < pos.count; k++) { const f = Math.max(0, 1 + pos.getY(k) / 1.6) ** 1.8; col.set([f, f, f], k * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export class TowScene {
  readonly group = new THREE.Group();
  private model: CarModel;
  private beacons: ReturnType<typeof beaconBar>;
  private jets: THREE.Mesh[] = [];
  private jetMat: THREE.MeshBasicMaterial;
  private glow: THREE.Mesh;
  private cable: THREE.Mesh;
  private hook: THREE.Group;
  private rings: FireRing[] = [];
  /** 0..1 each ring has lit up; they light when the car is dropped and burn out after the tow leaves */
  private ringLit = [0, 0, 0];
  private ringsOn = false;
  private ringsOffT = 0;
  private light: THREE.PointLight | null = null;
  private fireLight: THREE.PointLight | null = null;
  private time = 0;
  private puffT = 0;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camSet = false;
  private tow: Tow | null = null;
  private v = new THREE.Vector3();

  constructor(source: CarModel, private vapour: Vapour, quality: Quality) {
    this.model = cloneModel(source);
    this.model.onSpoiler = undefined;
    for (let k = 0; k < PAINTS.length && this.model.paintName !== TOW_PAINT; k++) this.model.nextPaint();
    this.model.hoverWheels(1);
    this.group.add(this.model.root);

    this.beacons = beaconBar();
    this.beacons.group.position.set(0, 0.835, -0.3);
    this.model.root.add(this.beacons.group);

    // jets under the four hover pods, and a soft blue glow on whatever is below
    this.jetMat = new THREE.MeshBasicMaterial({ color: 0x8fd0ff, vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const jg = jetGeometry();
    for (const pivot of this.model.wheelPivots) {
      const j = new THREE.Mesh(jg, this.jetMat);
      j.position.copy(pivot.position).add(new THREE.Vector3(0, -0.05, 0));
      j.renderOrder = 3;
      this.jets.push(j);
      this.model.root.add(j);
    }
    const glowTex = (() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 64;
      const c = cv.getContext('2d')!, g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(140,210,255,0.9)'); g.addColorStop(1, 'rgba(140,210,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(cv);
    })();
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.renderOrder = 2;
    this.group.add(this.glow);

    // winch cable (a unit-long rod hanging down, stretched to length) and the hook on its end
    const steel = new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.8, roughness: 0.35 });
    this.cable = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1, 8).translate(0, -0.5, 0), steel);
    this.group.add(this.cable);
    this.hook = new THREE.Group();
    const hookM = new THREE.MeshStandardMaterial({ color: 0xffb21a, metalness: 0.5, roughness: 0.4 });
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.08), hookM);
    const curl = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.022, 8, 16, Math.PI * 1.5), steel);
    curl.position.y = -0.14; curl.rotation.z = Math.PI * 0.75;
    this.hook.add(block, curl);
    this.group.add(this.hook);

    for (let k = 0; k < TOW.rings.length; k++) {
      const r = new FireRing(TOW.ringRadius, quality);
      r.group.visible = false;
      this.rings.push(r);
      this.group.add(r.group);
    }
    // a fixed pair of lights (made once: adding lights later recompiles every material)
    if (quality !== 'low') {
      this.light = new THREE.PointLight(0x8fd0ff, 0, 14, 2);
      this.fireLight = new THREE.PointLight(0xff7a22, 0, 40, 2);
      this.group.add(this.light, this.fireLight);
    }
    this.group.visible = false;
  }

  setNight(night: boolean) { this.model.setNight(night); }

  setReflections(tex: THREE.Texture | null) { this.model.setReflections(tex); }

  start(tow: Tow) {
    this.tow = tow;
    this.group.visible = true;
    this.model.root.visible = true;
    this.camSet = false;
    this.ringsOn = false;
    this.ringLit.fill(0);
    for (const r of this.rings) r.group.visible = false;
  }

  /** the tow is over (or called off): fly off and let the rings burn out */
  stop() {
    this.tow = null;
    if (!this.ringsOn) this.group.visible = false;
    else this.ringsOffT = Math.max(this.ringsOffT, 0.01);
  }

  get active() { return this.group.visible; }

  /** `ground`: the road height under the tow car */
  update(dt: number, cam: THREE.PerspectiveCamera, viewportHeight: number, ground: number) {
    if (!this.group.visible) return;
    this.time += dt;
    const tow = this.tow;
    if (tow) {
      const root = this.model.root;
      root.position.copy(tow.pos);
      root.quaternion.copy(tow.quat);
      root.visible = !tow.done;
      this.model.hoverWheels(tow.fold);
      // beacons: the two amber lamps take turns, with a double strobe in between
      const ph = (this.time * 2.6) % 1;
      this.beacons.amber[0].emissiveIntensity = ph < 0.5 ? 6 : 0.2;
      this.beacons.amber[1].emissiveIntensity = ph >= 0.5 ? 6 : 0.2;
      const st = (this.time * 1.3) % 1;
      this.beacons.strobe.emissiveIntensity = (st > 0.7 && st < 0.74) || (st > 0.8 && st < 0.84) ? 12 : 0;
      // hover jets: longer the harder they push, flickering
      const flick = 0.85 + Math.random() * 0.3;
      for (const j of this.jets) j.scale.set(1, (0.6 + 0.9 * tow.thrust) * flick, 1);
      this.jetMat.opacity = 0.75 * tow.fold;
      for (const j of this.jets) j.visible = tow.fold > 0.3;
      // the glow pool on the road under it, fading with height
      const h = tow.pos.y - ground;
      const near = THREE.MathUtils.clamp(1 - (h - 2) / 16, 0, 1);
      this.glow.visible = near > 0.02;
      this.glow.position.set(tow.pos.x, ground + 0.06, tow.pos.z);
      this.glow.scale.setScalar(3 + h * 0.35);
      (this.glow.material as THREE.MeshBasicMaterial).opacity = near * 0.8;
      if (this.light) { this.light.position.copy(tow.pos).addScaledVector(up, -1.2); this.light.intensity = 25 * tow.thrust * flick; }
      // downwash: vapour blasted out over the road when it's low
      this.puffT += dt * 70 * near;
      while (this.puffT >= 1) {
        this.puffT--;
        const a = Math.random() * Math.PI * 2;
        this.vapour.emit(tow.pos.x + Math.sin(a) * 0.8, ground + 0.25, tow.pos.z + Math.cos(a) * 0.8, Math.sin(a) * 9, 0.4, Math.cos(a) * 9, 0.5, 0.9, 0.45);
      }
      // the cable from the belly to the hook
      const top = this.v.copy(tow.pos).addScaledVector(up, -BELLY);
      this.cable.visible = this.hook.visible = tow.cable > 0.05;
      this.cable.position.copy(top);
      this.cable.scale.set(1, Math.max(0.01, tow.cable), 1);
      this.hook.position.copy(tow.hookPoint);
      // rings light up when the car is dropped
      if (!this.ringsOn && tow.rings.length) {
        this.ringsOn = true;
        tow.rings.forEach((r, k) => {
          const g = this.rings[k].group;
          g.position.copy(r.pos);
          g.rotation.set(r.pitch, r.yaw, 0, 'YXZ');
          g.visible = true;
        });
      }
      tow.rings.forEach((r, k) => { if (r.passed && this.ringLit[k] < 2) { this.rings[k].flare(); this.ringLit[k] = 2; } });
      if (tow.done && !this.ringsOffT) this.ringsOffT = 0.01;
    }
    // rings: grow in when lit, burn on for a while after the tow is gone, then shrink away
    if (this.ringsOn) {
      if (this.ringsOffT > 0) this.ringsOffT += dt;
      const out = this.ringsOffT > 0 ? THREE.MathUtils.clamp(1 - (this.ringsOffT - 2.5) / 0.8, 0, 1) : 1;
      let nearest: THREE.Vector3 | null = null, best = Infinity;
      this.rings.forEach((r, k) => {
        if (this.ringLit[k] < 1) this.ringLit[k] = Math.min(1, this.ringLit[k] + dt * (2.5 - k * 0.5));
        const s = Math.min(1, this.ringLit[k]) * out;
        r.group.scale.setScalar(Math.max(0.001, s));
        r.group.visible = s > 0.002;
        r.update(dt, cam, viewportHeight);
        const d = r.group.position.distanceTo(cam.position);
        if (s > 0.1 && d < best) { best = d; nearest = r.group.position; }
      });
      if (this.fireLight) {
        this.fireLight.intensity = nearest ? 60 * out * (0.85 + Math.random() * 0.3) : 0;
        if (nearest) this.fireLight.position.copy(nearest);
      }
      if (out <= 0) { this.ringsOn = false; this.ringsOffT = 0; for (const r of this.rings) r.group.visible = false; if (!this.tow) this.group.visible = false; }
    }
    if (!this.tow && !this.ringsOn) this.group.visible = false;
    if (this.light && !this.tow) this.light.intensity = 0;
  }

  /** the rescue camera: off to one side of the drop point, keeping the car and the tow in shot */
  camera(cam: THREE.PerspectiveCamera, dt: number) {
    const tow = this.tow;
    if (!tow) return;
    const yaw = new THREE.Euler().setFromQuaternion(tow.quat, 'YXZ').y;
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), side = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const want = tow.carPos.clone().addScaledVector(fwd, -12).addScaledVector(side, 9).addScaledVector(up, 4.5);
    const look = tow.carPos.clone().lerp(tow.pos, 0.5);
    if (!this.camSet) { this.camPos.copy(want); this.camLook.copy(look); this.camSet = true; }
    const k = 1 - Math.exp(-dt * 2.2);
    this.camPos.lerp(want, k); this.camLook.lerp(look, 1 - Math.exp(-dt * 5));
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
  }
}
