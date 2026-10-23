// Procedural electric sports car: a lofted body with a dark glass greenhouse, cut wheel arches,
// LED light bars and 20" two-tone wheels. Built in a ground frame (y = 0 is the road, +z forward)
// and then shifted so the group's origin is the physics body's centre of mass.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAR, type Car } from '../sim/car';

export const PAINTS = [
  { name: 'Ultra Red', color: 0x9e0a12, metalness: 0.5, roughness: 0.28 },
  { name: 'Pearl White', color: 0xeeeeea, metalness: 0.15, roughness: 0.25 },
  { name: 'Deep Blue', color: 0x15306a, metalness: 0.6, roughness: 0.3 },
  { name: 'Quicksilver', color: 0xb4b8bd, metalness: 0.85, roughness: 0.22 },
  { name: 'Stealth Grey', color: 0x3a3e44, metalness: 0.55, roughness: 0.3 },
  { name: 'Solid Black', color: 0x0b0b0d, metalness: 0.3, roughness: 0.2 },
];

/** smooth curve through (z, value) keys, z descending from nose to tail */
function profile(keys: [number, number][], linear = false) {
  return (z: number) => {
    if (z >= keys[0][0]) return keys[0][1];
    for (let k = 0; k < keys.length - 1; k++) {
      const [z0, v0] = keys[k], [z1, v1] = keys[k + 1];
      if (z <= z0 && z >= z1 && linear) return v0 + (v1 - v0) * (z0 - z) / (z0 - z1);
      if (z <= z0 && z >= z1) {
        // Catmull-Rom between keys k and k+1 for smooth slopes
        const vm = keys[Math.max(0, k - 1)][1], vp = keys[Math.min(keys.length - 1, k + 2)][1];
        const zm = keys[Math.max(0, k - 1)][0], zp = keys[Math.min(keys.length - 1, k + 2)][0];
        const t = (z0 - z) / (z0 - z1);
        const m0 = k === 0 ? (v1 - v0) : (v1 - vm) / ((zm - z1) / (z0 - z1));
        const m1 = k + 2 >= keys.length ? (v1 - v0) : (vp - v0) / ((z0 - zp) / (z0 - z1));
        const t2 = t * t, t3 = t2 * t;
        return (2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * m1;
      }
    }
    return keys[keys.length - 1][1];
  };
}

const HALF_L = 2.36;
const top = profile([[2.36, 0.48], [2.28, 0.59], [2.05, 0.7], [1.6, 0.82], [1.12, 0.89], [0.65, 1.12], [0.15, 1.33], [-0.45, 1.37], [-1.0, 1.27], [-1.55, 1.08], [-2.02, 0.99], [-2.26, 0.97], [-2.36, 0.78]]);
const bottom = profile([[2.36, 0.4], [2.24, 0.26], [1.95, 0.19], [0, 0.17], [-1.95, 0.19], [-2.22, 0.28], [-2.36, 0.46]]);
const halfW = profile([[2.36, 0.5], [2.27, 0.8], [2.0, 0.92], [1.45, 0.975], [0.3, 0.96], [-0.9, 0.975], [-1.5, 0.99], [-2.05, 0.93], [-2.28, 0.8], [-2.36, 0.56]]);
/** window line: the dark glass greenhouse starts here */
const belt = profile([[2.36, 9], [1.13, 9], [1.12, 0.9], [0.6, 0.93], [-1.0, 0.95], [-1.7, 0.98], [-1.86, 0.99], [-1.87, 9]], true);

const WHEEL_Z = CAR.wheelbase / 2, WHEEL_X = CAR.track / 2, R = CAR.wheelRadius;
const ARCH_R = R + 0.07;

function archY(z: number) {
  let y = -1;
  for (const wz of [WHEEL_Z, -WHEEL_Z]) {
    const dz = z - wz;
    if (Math.abs(dz) < ARCH_R) y = Math.max(y, R + 0.02 + Math.sqrt(ARCH_R * ARCH_R - dz * dz));
  }
  return y;
}

/** the body shell in two groups, paint and glass, split exactly on the window line */
function bodyGeometry() {
  // each section: an upper arc (glass, NU segments) and a lower arc (paint, NL segments) that
  // meet at the window line, with the meeting points duplicated so the edge stays crisp
  const NZ = 220, NU = 36, NL = 84, NA = NU + NL + 2;
  const pos: number[] = [];
  for (let i = 0; i <= NZ; i++) {
    // denser sections at the ends, where the curvature is
    const u = i / NZ;
    const z = HALF_L * (0.55 * Math.cos(u * Math.PI) + 0.45 * (1 - 2 * u));
    // the first and last sections collapse to a point, closing the nose and tail
    const cap = i === 0 || i === NZ ? 0.02 : 1;
    const yT0 = top(z), yB0 = bottom(z), w = halfW(z) * cap, yBelt = belt(z);
    const ym = (yT0 + yB0) / 2, yT = ym + (yT0 - ym) * cap, yB = ym - (ym - yB0) * cap, hh = (yT - yB) / 2;
    const arch = archY(z);
    // angle where the section crosses the window line (the top centre when there's no glass)
    const aBelt = yBelt >= yT - 0.01 ? Math.PI / 2 : Math.asin(Math.min(1, Math.max(0, (yBelt - ym) / hh)) ** (1 / 0.42));
    const point = (a: number, lower: boolean) => {
      const c = Math.cos(a), sn = Math.sin(a);
      const e = sn > 0 ? 0.32 : 0.22; // flatter underneath, rounder on top
      let x = w * Math.sign(c) * Math.abs(c) ** e;
      let y = ym + hh * Math.sign(sn) * Math.abs(sn) ** (sn > 0 ? 0.42 : 0.2);
      // tumblehome: the greenhouse leans in above the window line
      if (!lower && y > yBelt) x *= 1 - 0.3 * ((y - yBelt) / Math.max(0.05, yT - yBelt)) ** 1.3;
      // the shoulder: slightly fuller just below the window line
      else x *= 1 + 0.015 * Math.max(0, 1 - Math.abs(y - (yBelt - 0.12)) / 0.2);
      // wheel arches: lift the outer part of the section clear of the tyre
      if (lower && arch > 0 && Math.abs(x) > WHEEL_X - 0.2 && y < arch) y = arch;
      pos.push(x, y, z);
    };
    for (let j = 0; j <= NU; j++) point(aBelt + (Math.PI - 2 * aBelt) * (j / NU), false);
    for (let j = 0; j <= NL; j++) point(Math.PI - aBelt + (Math.PI + 2 * aBelt) * (j / NL), true);
  }
  const glass: number[] = [], paint: number[] = [];
  for (let i = 0; i < NZ; i++) for (let j = 0; j < NA - 1; j++) {
    if (j === NU) continue; // the seam between glass and paint
    const a = i * NA + j, b = a + 1, c = a + NA, d = c + 1;
    (j < NU ? glass : paint).push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex([...paint, ...glass]);
  geo.addGroup(0, paint.length, 0);
  geo.addGroup(paint.length, glass.length, 1);
  geo.computeVertexNormals();
  return geo;
}

/** dark wheel tubs inside the arches */
function archLiners() {
  const parts: THREE.BufferGeometry[] = [];
  for (const z of [WHEEL_Z, -WHEEL_Z]) for (const side of [-1, 1]) {
    const g = new THREE.CylinderGeometry(ARCH_R + 0.01, ARCH_R + 0.01, 0.42, 28, 1, true, -Math.PI / 2, Math.PI);
    g.rotateZ(Math.PI / 2).rotateX(-Math.PI / 2);
    g.translate(side * (WHEEL_X - 0.02), R + 0.02, z);
    parts.push(g.toNonIndexed());
  }
  return mergeGeometries(parts)!;
}

/** outer surface x at a given height and z (for placing lights and mirrors on the body) */
function surfaceX(z: number, y: number) {
  const yT = top(z), yB = bottom(z), w = halfW(z);
  const s = Math.max(-1, Math.min(1, ((y - (yT + yB) / 2) / ((yT - yB) / 2))));
  const sn = Math.sign(s) * Math.abs(s) ** (1 / (s > 0 ? 0.42 : 0.2));
  const c = Math.sqrt(Math.max(0, 1 - sn * sn));
  return w * c ** (s > 0 ? 0.32 : 0.22);
}

function wheelGeometries() {
  // tyre: lathe of a rounded section; the rim: barrel + a five twin-spoke face
  const tw = 0.255, rimR = 0.255;
  const tp: THREE.Vector2[] = [];
  for (let k = 0; k <= 16; k++) {
    const a = -Math.PI / 2 + (k / 16) * Math.PI;
    tp.push(new THREE.Vector2(R - 0.035 + Math.cos(a) * 0.035, Math.sin(a) * (tw / 2 - 0.01)));
  }
  tp.unshift(new THREE.Vector2(rimR, -tw / 2 + 0.02));
  tp.push(new THREE.Vector2(rimR, tw / 2 - 0.02));
  // sidewalls: from the rim out to the shoulder
  const tyre = new THREE.LatheGeometry(
    [new THREE.Vector2(rimR - 0.005, -tw / 2 + 0.03), new THREE.Vector2(R - 0.05, -tw / 2), ...tp.slice(1, -1), new THREE.Vector2(R - 0.05, tw / 2), new THREE.Vector2(rimR - 0.005, tw / 2 - 0.03)], 40);
  tyre.rotateZ(Math.PI / 2); // lathe axis y -> wheel axle x

  const barrel = new THREE.CylinderGeometry(rimR, rimR, tw - 0.05, 36, 1, true).rotateZ(Math.PI / 2);
  const face = new THREE.Shape();
  face.absarc(0, 0, rimR - 0.004, 0, Math.PI * 2, false);
  for (let k = 0; k < 5; k++) {
    // a window between each pair of twin spokes, and a slot inside each pair
    const a0 = (k / 5) * Math.PI * 2;
    const win = new THREE.Path();
    const r0 = 0.085, r1 = rimR - 0.03, half = 0.36;
    win.absarc(0, 0, r1, a0 + half, a0 + (Math.PI * 2) / 5 - half, false);
    win.absarc(0, 0, r0, a0 + (Math.PI * 2) / 5 - half - 0.12, a0 + half + 0.12, true);
    face.holes.push(win);
    const slot = new THREE.Path();
    slot.absarc(0, 0, r1 - 0.01, a0 - 0.06, a0 + 0.06, false);
    slot.absarc(0, 0, r0 + 0.03, a0 + 0.04, a0 - 0.04, true);
    face.holes.push(slot);
  }
  const hubCap = new THREE.CylinderGeometry(0.05, 0.06, 0.03, 20).rotateZ(Math.PI / 2).translate(tw / 2 - 0.02, 0, 0);
  const faceGeo = new THREE.ExtrudeGeometry(face, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.006, bevelSegments: 2, curveSegments: 40 });
  faceGeo.rotateY(Math.PI / 2).translate(tw / 2 - 0.07, 0, 0);
  const rim = mergeGeometries([barrel.toNonIndexed(), faceGeo.toNonIndexed(), hubCap.toNonIndexed()])!;
  const disc = new THREE.CylinderGeometry(0.19, 0.19, 0.028, 32).rotateZ(Math.PI / 2).translate(0.02, 0, 0);
  const caliper = new THREE.BoxGeometry(0.06, 0.14, 0.2).translate(0.05, 0.11, -0.1);
  return { tyre, rim, disc, caliper };
}

function shadowTexture() {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 256;
  const c = cv.getContext('2d')!;
  const g = c.createRadialGradient(64, 128, 10, 64, 128, 128);
  g.addColorStop(0, 'rgba(0,0,0,0.75)'); g.addColorStop(0.55, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g; c.fillRect(0, 0, 128, 256);
  return new THREE.CanvasTexture(cv);
}

export class CarModel {
  readonly root = new THREE.Group();
  /** body shell: rolls and pitches with the load transfer, wheels stay put */
  private shell = new THREE.Group();
  private wheels: { pivot: THREE.Group; spin: THREE.Group; left: boolean; front: boolean }[] = [];
  readonly paint: THREE.MeshPhysicalMaterial;
  private brakeLight: THREE.MeshStandardMaterial;
  private headLight: THREE.MeshStandardMaterial;
  private paintIndex = 0;
  private roll = 0; private pitch = 0;

  constructor() {
    const p = PAINTS[0];
    this.paint = new THREE.MeshPhysicalMaterial({ color: p.color, metalness: p.metalness, roughness: p.roughness, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.2 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x020304, metalness: 0, roughness: 0.08, envMapIntensity: 0.45 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.7 });
    const satin = new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.45, metalness: 0.3 });

    // everything is built on the ground; the root's origin is the centre of mass
    this.shell.position.y = -CAR.comHeight;
    this.root.add(this.shell);
    const body = new THREE.Mesh(bodyGeometry(), [this.paint, glass]);
    body.castShadow = true; body.receiveShadow = true;
    this.shell.add(body);
    const liners = new THREE.Mesh(archLiners(), new THREE.MeshStandardMaterial({ color: 0x0a0a0b, roughness: 0.9, side: THREE.DoubleSide }));
    this.shell.add(liners);

    // underbody, front intake, rear diffuser
    const under = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 4.1), trim);
    under.position.set(0, 0.22, 0); this.shell.add(under);
    const intake = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.1, 0.12), satin);
    intake.position.set(0, 0.32, 2.27); intake.rotation.x = -0.25; this.shell.add(intake);
    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 0.25), satin);
    diffuser.position.set(0, 0.3, -2.25); diffuser.rotation.x = 0.35; this.shell.add(diffuser);

    // lights: slim LED headlight blades and a full-width rear light bar
    this.headLight = new THREE.MeshStandardMaterial({ color: 0xeaf4ff, emissive: 0xeaf6ff, emissiveIntensity: 1.6, roughness: 0.2 });
    this.brakeLight = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1020, emissiveIntensity: 1.2, roughness: 0.3 });
    for (const side of [-1, 1]) {
      // slim LED blade tucked into each front corner, following the curve of the body
      const z = 2.1, y = 0.64;
      const blade = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 8).scale(0.2, 0.022, 0.05), this.headLight);
      blade.position.set(side * (surfaceX(z, y) - 0.14), y, z + 0.05);
      blade.rotation.set(0, side * 0.55, side * 0.06);
      this.shell.add(blade);
      // mirrors on short stalks
      const mz = 0.98, my = 0.98;
      const mx = surfaceX(mz, 0.9) + 0.06;
      const mirror = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 10).scale(0.7, 0.55, 1.25), this.paint);
      mirror.position.set(side * (mx + 0.06), my, mz - 0.05); mirror.castShadow = true;
      this.shell.add(mirror);
      const glassM = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.08), glass);
      glassM.position.set(side * (mx + 0.06), my, mz - 0.17); glassM.rotation.y = Math.PI;
      this.shell.add(glassM);
      const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.06), trim);
      stalk.position.set(side * mx, my - 0.03, mz); this.shell.add(stalk);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.04, 0.04), this.brakeLight);
    bar.position.set(0, 0.9, -2.31); this.shell.add(bar);
    for (const side of [-1, 1]) {
      const wrap = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.04), this.brakeLight);
      wrap.position.set(side * 0.82, 0.9, -2.22); wrap.rotation.y = side * 0.75; this.shell.add(wrap);
    }

    // wheels
    const wg = wheelGeometries();
    const tyreM = new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.88 });
    const rimM = new THREE.MeshStandardMaterial({ color: 0x8d9198, metalness: 0.9, roughness: 0.28, envMapIntensity: 1.3 });
    const discM = new THREE.MeshStandardMaterial({ color: 0x5c5f63, metalness: 0.8, roughness: 0.45 });
    const caliperM = new THREE.MeshStandardMaterial({ color: 0xb8141c, roughness: 0.4, metalness: 0.2 });
    for (const [x, z] of [[WHEEL_X, WHEEL_Z], [-WHEEL_X, WHEEL_Z], [WHEEL_X, -WHEEL_Z], [-WHEEL_X, -WHEEL_Z]]) {
      const pivot = new THREE.Group();
      const spin = new THREE.Group();
      const left = x > 0;
      const tyre = new THREE.Mesh(wg.tyre, tyreM); tyre.castShadow = true;
      const rim = new THREE.Mesh(wg.rim, rimM); rim.castShadow = true;
      const disc = new THREE.Mesh(wg.disc, discM);
      // the rim's face points outwards on both sides
      if (!left) { rim.scale.x = -1; disc.scale.x = -1; }
      spin.add(tyre, rim, disc);
      const cal = new THREE.Mesh(wg.caliper, caliperM);
      if (!left) cal.scale.x = -1;
      pivot.add(spin, cal);
      pivot.position.set(x, R - CAR.comHeight, z);
      this.root.add(pivot);
      this.wheels.push({ pivot, spin, left, front: z > 0 });
    }

    // soft contact shadow so the car sits on the road even without shadow maps
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 5.2), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.85 }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = -CAR.comHeight + 0.045; shadow.renderOrder = 1;
    this.root.add(shadow);
  }

  get paintName() { return PAINTS[this.paintIndex].name; }

  nextPaint() {
    this.paintIndex = (this.paintIndex + 1) % PAINTS.length;
    const p = PAINTS[this.paintIndex];
    this.paint.color.setHex(p.color); this.paint.metalness = p.metalness; this.paint.roughness = p.roughness;
  }

  setNight(night: boolean) { this.headLight.emissiveIntensity = night ? 4 : 1.6; }

  /** sync wheels, lights and the body's roll/pitch with the physics car */
  update(car: Car, braking: boolean, dt: number) {
    const hardY = CAR.wheelRadius + CAR.restLength - 0.06 - CAR.comHeight;
    car.wheels.forEach((w, i) => {
      const vw = this.wheels[i];
      vw.pivot.position.y = hardY - Math.min(w.suspension, CAR.restLength + 0.02);
      vw.pivot.rotation.y = w.steer;
      vw.spin.rotation.x = w.spin;
    });
    this.brakeLight.emissiveIntensity = braking ? 5 : 1.2;
    // visual load transfer: the physics centre of mass is low, so add the roll a real car shows
    const k = Math.min(1, dt * 6);
    this.roll += (THREE.MathUtils.clamp(-car.latAccel * 0.0042, -0.06, 0.06) - this.roll) * k;
    this.pitch += (THREE.MathUtils.clamp(-car.longAccel * 0.0028, -0.04, 0.04) - this.pitch) * k;
    this.shell.rotation.set(this.pitch, 0, this.roll);
  }
}
