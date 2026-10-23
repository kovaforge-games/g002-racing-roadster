// Procedural electric roadster: the body shell from carBody.ts, details projected onto it, and
// 20" two-tone wheels. Built in a ground frame (y = 0 is the road, +z forward) and then shifted
// so the group's origin is the physics body's centre of mass.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAR, type Car } from '../sim/car';
import { ARCH_R, R, WHEEL_X, WHEEL_Z, Projector, bodyGeometry, fenderAt, line } from './carBody';

export const PAINTS = [
  { name: 'Ultra Red', color: 0x9e0a12, metalness: 0.5, roughness: 0.28 },
  { name: 'Pearl White', color: 0xeeeeea, metalness: 0.15, roughness: 0.25 },
  { name: 'Deep Blue', color: 0x15306a, metalness: 0.6, roughness: 0.3 },
  { name: 'Quicksilver', color: 0xb4b8bd, metalness: 0.85, roughness: 0.22 },
  { name: 'Stealth Grey', color: 0x3a3e44, metalness: 0.55, roughness: 0.3 },
  { name: 'Solid Black', color: 0x0b0b0d, metalness: 0.3, roughness: 0.2 },
];

/** dark wheel tubs inside the arches */
function archLiners() {
  const parts: THREE.BufferGeometry[] = [];
  for (const z of [WHEEL_Z, -WHEEL_Z]) for (const side of [-1, 1]) {
    const g = new THREE.CylinderGeometry(ARCH_R - 0.02, ARCH_R - 0.02, 0.26, 28, 1, true, -Math.PI / 2, Math.PI);
    g.rotateZ(Math.PI / 2).rotateX(-Math.PI / 2);
    g.translate(side * (WHEEL_X - 0.02), R + 0.01, z);
    parts.push(g.toNonIndexed());
  }
  return mergeGeometries(parts)!;
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

/** number plate: no country, no brand, just the game's tag */
function plateMaterial() {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#f2f2ee'; c.fillRect(0, 0, 256, 64);
  c.strokeStyle = '#222'; c.lineWidth = 4; c.strokeRect(3, 3, 250, 58);
  c.fillStyle = '#16181c'; c.font = '700 40px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('EV · 002', 128, 34);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 });
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
  private brakeLight!: THREE.MeshStandardMaterial;
  private headLight!: THREE.MeshStandardMaterial;
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
    const under = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 3.9), trim);
    under.position.set(0, 0.17, 0); this.shell.add(under);
    body.castShadow = true; body.receiveShadow = true;
    this.shell.add(body);
    const liners = new THREE.Mesh(archLiners(), new THREE.MeshStandardMaterial({ color: 0x0a0a0b, roughness: 0.9, side: THREE.DoubleSide }));
    this.shell.add(liners);

    this.headLight = new THREE.MeshStandardMaterial({ color: 0xeaf4ff, emissive: 0xeaf6ff, emissiveIntensity: 1.6, roughness: 0.2 });
    this.brakeLight = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1020, emissiveIntensity: 1.2, roughness: 0.3 });
    this.addDetails(body, glass, trim, satin);

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

  /** everything that sits on the paint, projected onto the body so it follows its curves */
  private addDetails(body: THREE.Mesh, glass: THREE.Material, trim: THREE.Material, satin: THREE.Material) {
    const pr = new Projector(body);
    const add = (geos: THREE.BufferGeometry[], m: THREE.Material, shadow = false) => geos.forEach(g => {
      const mesh = new THREE.Mesh(g, m); mesh.castShadow = shadow; this.shell.add(mesh);
    });
    const front = new THREE.Vector3(0, -0.1, -1), rear = new THREE.Vector3(0, 0, 1), side = new THREE.Vector3(-1, 0, 0);
    const F = 3.2, B = -3.2, S = 2.2;
    const gloss = new THREE.MeshPhysicalMaterial({ color: 0x050506, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 });
    const lens = new THREE.MeshPhysicalMaterial({ color: 0x0b0d10, roughness: 0.05, metalness: 0.4, clearcoat: 1 });

    // slim swept headlights at the top of each front corner, with an LED line along the top
    add(pr.strip(line([0.4, 0.575, F], [0.86, 0.655, F], 28, [0, 0.008, 0]), line([0.44, 0.54, F], [0.875, 0.615, F], 28), front, 0.004), lens);
    add(pr.strip(line([0.41, 0.571, F], [0.86, 0.65, F], 28, [0, 0.008, 0]), line([0.42, 0.562, F], [0.862, 0.64, F], 28, [0, 0.008, 0]), front, 0.008), this.headLight);
    // lower intake, corner vents and a thin splitter
    // (the projection slopes down 0.1 m per metre, so these land about 0.1 m below their origins)
    add(pr.strip(line([-0.5, 0.45, F], [0.5, 0.45, F], 40, [0, -0.02, 0]), line([-0.44, 0.355, F], [0.44, 0.355, F], 40), front, 0.004, false), gloss);
    add(pr.strip(line([0.62, 0.47, F], [0.84, 0.5, F], 16), line([0.64, 0.38, F], [0.84, 0.4, F], 16), front, 0.004), gloss);
    add(pr.strip(line([-0.86, 0.31, F], [0.86, 0.31, F], 50), line([-0.86, 0.285, F], [0.86, 0.285, F], 50), front, 0.012, false), trim);

    // full-width tail light, number plate and diffuser
    add(pr.strip(line([-0.99, 0.875, B], [0.99, 0.875, B], 60), line([-0.99, 0.855, B], [0.99, 0.855, B], 60), rear, 0.004, false), this.brakeLight);
    add(pr.strip(line([0.25, 0.68, B], [-0.25, 0.68, B], 6), line([0.25, 0.57, B], [-0.25, 0.57, B], 6), rear, 0.004, false), plateMaterial());
    add(pr.strip(line([-0.82, 0.5, B], [0.82, 0.5, B], 40), line([-0.82, 0.3, B], [0.82, 0.3, B], 40), rear, 0.005, false), gloss);

    // side: door shut lines, a gloss black sill and a fine trim line along the window base
    for (const z of [0.8, -0.95]) {
      const top = fenderAt(z) - 0.015;
      add(pr.strip(line([S, top, z + 0.003], [S, 0.27, z + 0.003], 20), line([S, top, z - 0.003], [S, 0.27, z - 0.003], 20), side, 0.002), trim);
    }
    add(pr.strip(line([S, 0.245, 1.0], [S, 0.245, -1.02], 40), line([S, 0.15, 1.0], [S, 0.15, -1.02], 40), side, 0.004), gloss);
    const beltLine = (dy: number) => { const pts = line([S, 0, 0.7], [S, 0, -1.62], 50); pts.forEach(p => { p.y = fenderAt(p.z) + dy; }); return pts; };
    add(pr.strip(beltLine(0.052), beltLine(0.04), side, 0.003), satin);

    // mirrors: body-coloured teardrops on short black arms at the front of the door
    for (const sgn of [-1, 1]) {
      const z = 0.6, y = fenderAt(z) + 0.1;
      const mirror = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 12).scale(0.65, 0.5, 1.3), this.paint);
      mirror.position.set(sgn * 1.0, y, z - 0.04); mirror.rotation.y = sgn * -0.12; mirror.castShadow = true;
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.06, 16).scale(1, 0.75, 1), glass);
      face.position.set(sgn * 1.0, y, z - 0.165); face.rotation.y = Math.PI;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.025, 0.05), trim);
      arm.position.set(sgn * 0.9, y - 0.04, z);
      this.shell.add(mirror, face, arm);
    }
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
