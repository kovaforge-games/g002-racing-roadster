// Procedural electric roadster: the faceted body shell from carBody.ts, details projected onto
// it (light bar, hidden headlights, vents, full-width tail light, a carbon diffuser with fans),
// an active rear wing and 20"/21" wheels with thin black spokes over white aero inserts. Built in
// a ground frame (y = 0 is the road, +z forward) and then shifted so the group's origin is the
// physics body's centre of mass.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAR, type Car } from '../sim/car';
import { ARCH_REACH, R, WHEEL_R, WHEEL_X, WHEEL_Z, Projector, archY, beltAt, bodyGeometry, line, rockerAt, widthAt } from './carBody';

export const PAINTS = [
  { name: 'Anodised White', color: 0xe6e8e6, metalness: 0.2, roughness: 0.34 },
  { name: 'Lava Red', color: 0x9e0a12, metalness: 0.5, roughness: 0.28 },
  { name: 'Midnight Blue', color: 0x15306a, metalness: 0.6, roughness: 0.3 },
  { name: 'Liquid Silver', color: 0xb4b8bd, metalness: 0.85, roughness: 0.22 },
  { name: 'Graphite', color: 0x3a3e44, metalness: 0.55, roughness: 0.3 },
  { name: 'Gloss Black', color: 0x0b0b0d, metalness: 0.3, roughness: 0.2 },
];

/** dark ceilings inside the wheel arches, following the arch outline */
function archLiners() {
  const parts: THREE.BufferGeometry[] = [];
  const N = 36;
  for (const wz of [WHEEL_Z, -WHEEL_Z]) for (const side of [-1, 1]) {
    const pos: number[] = [], idx: number[] = [];
    for (let k = 0; k <= N; k++) {
      const z = wz - ARCH_REACH + (2 * ARCH_REACH * k) / N;
      const y = Math.max(archY(z), 0.15) - 0.004, W = widthAt(z);
      // inner wall, ceiling inner edge, ceiling outer edge
      pos.push(side * (W - 0.33), 0.14, z, side * (W - 0.33), y, z, side * (W - 0.012), y, z);
      if (k) for (let r = 0; r < 2; r++) { const a = (k - 1) * 3 + r, b = k * 3 + r; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    parts.push(g);
  }
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
}

/** a tyre, its black barrel, spokes and lip, and the white insert, with the face towards +x */
function wheelGeometries(rv: number, tw: number) {
  const rimR = rv - 0.3 * tw;
  const tp: THREE.Vector2[] = [];
  for (let k = 0; k <= 16; k++) {
    const a = -Math.PI / 2 + (k / 16) * Math.PI;
    tp.push(new THREE.Vector2(rv - 0.035 + Math.cos(a) * 0.035, Math.sin(a) * (tw / 2 - 0.012)));
  }
  // sidewalls: from the rim out to the shoulder
  const tyre = new THREE.LatheGeometry(
    [new THREE.Vector2(rimR - 0.005, -tw / 2 + 0.03), new THREE.Vector2(rv - 0.05, -tw / 2), ...tp, new THREE.Vector2(rv - 0.05, tw / 2), new THREE.Vector2(rimR - 0.005, tw / 2 - 0.03)], 44);
  tyre.rotateZ(Math.PI / 2); // lathe axis y -> wheel axle x

  const face = tw / 2;
  const black: THREE.BufferGeometry[] = [];
  black.push(new THREE.CylinderGeometry(rimR, rimR, tw - 0.05, 40, 1, true).rotateZ(Math.PI / 2));
  black.push(new THREE.RingGeometry(rimR - 0.016, rimR + 0.006, 48).rotateY(Math.PI / 2).translate(face - 0.012, 0, 0));
  // six thin spokes from the hub to the lip, standing just proud of the insert
  for (let k = 0; k < 6; k++) {
    const len = rimR - 0.07;
    const spoke = new THREE.BoxGeometry(0.018, len, 0.019);
    spoke.translate(face - 0.024, 0.05 + len / 2, 0).rotateX((k / 6) * Math.PI * 2);
    black.push(spoke);
  }
  black.push(new THREE.CylinderGeometry(0.058, 0.066, 0.03, 24).rotateZ(Math.PI / 2).translate(face - 0.026, 0, 0));
  const rim = mergeGeometries(black.map(g => g.index ? g.toNonIndexed() : g))!;
  rim.computeVertexNormals();
  const insert = new THREE.CircleGeometry(rimR - 0.013, 48).rotateY(Math.PI / 2).translate(face - 0.034, 0, 0);
  const cap = new THREE.CircleGeometry(0.03, 20).rotateY(Math.PI / 2).translate(face - 0.01, 0, 0);
  return { tyre, rim, insert, cap };
}

/** a carbon weave for the diffuser and the wing */
function carbonTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const c = cv.getContext('2d')!;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    c.fillStyle = (x + y) % 2 ? '#1b1c1f' : '#0d0e10'; c.fillRect(x * 8, y * 8, 8, 8);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(14, 3); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** one of the diffuser's suction fans, seen through its grille */
function fanTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#050506'; c.beginPath(); c.arc(64, 64, 64, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#3a3d42'; c.lineWidth = 6; c.beginPath(); c.arc(64, 64, 58, 0, Math.PI * 2); c.stroke();
  c.fillStyle = '#26282c';
  for (let k = 0; k < 9; k++) {
    c.save(); c.translate(64, 64); c.rotate((k / 9) * Math.PI * 2);
    c.beginPath(); c.moveTo(10, -4); c.quadraticCurveTo(38, -18, 54, -4); c.lineTo(54, 4); c.quadraticCurveTo(36, -6, 10, 4); c.fill();
    c.restore();
  }
  c.fillStyle = '#5a5e64'; c.beginPath(); c.arc(64, 64, 11, 0, Math.PI * 2); c.fill();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function shadowTexture() {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 256;
  const c = cv.getContext('2d')!;
  const g = c.createRadialGradient(64, 128, 10, 64, 128, 128);
  g.addColorStop(0, 'rgba(0,0,0,0.75)'); g.addColorStop(0.55, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g; c.fillRect(0, 0, 128, 256);
  return new THREE.CanvasTexture(cv);
}

/** a thin wing section, extruded across the car (leading edge at z = 0, chord running back) */
function wingGeometry(span: number, chord: number) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.02 * chord, 0.09 * chord, 0.35 * chord, 0.12 * chord, chord, 0.03 * chord);
  s.lineTo(chord, 0.0);
  s.bezierCurveTo(0.6 * chord, -0.01 * chord, 0.15 * chord, -0.04 * chord, 0, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: span, bevelEnabled: false, curveSegments: 12 });
  // shape x (chord) -> -z, extrusion -> x
  g.rotateY(Math.PI / 2).translate(-span / 2, 0, 0);
  return g;
}

export class CarModel {
  readonly root = new THREE.Group();
  /** body shell: rolls and pitches with the load transfer, wheels stay put */
  private shell = new THREE.Group();
  private wheels: { pivot: THREE.Group; spin: THREE.Group; left: boolean; front: boolean; lift: number }[] = [];
  readonly paint: THREE.MeshPhysicalMaterial;
  private brakeLight!: THREE.MeshStandardMaterial;
  private headLight!: THREE.MeshStandardMaterial;
  private wing = new THREE.Group();
  private wingAngle = 0.12;
  private paintIndex = 0;
  private roll = 0; private pitch = 0;

  constructor() {
    const p = PAINTS[0];
    this.paint = new THREE.MeshPhysicalMaterial({ color: p.color, metalness: p.metalness, roughness: p.roughness, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.15 });
    // gold-tinted glass, like a visor
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x5a4418, metalness: 0.7, roughness: 0.04, envMapIntensity: 1.3, clearcoat: 1, clearcoatRoughness: 0.02 });
    const lower = new THREE.MeshPhysicalMaterial({ color: 0x0b0b0c, roughness: 0.32, metalness: 0.2, clearcoat: 0.6, clearcoatRoughness: 0.2 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.7 });

    // everything is built on the ground; the root's origin is the centre of mass
    this.shell.position.y = -CAR.comHeight;
    this.root.add(this.shell);
    const body = new THREE.Mesh(bodyGeometry(), [this.paint, glass, lower]);
    const under = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.05, 3.7), trim);
    under.position.set(0, 0.16, 0); this.shell.add(under);
    body.castShadow = true; body.receiveShadow = true;
    this.shell.add(body);
    const liners = new THREE.Mesh(archLiners(), new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.9, side: THREE.DoubleSide }));
    this.shell.add(liners);

    this.headLight = new THREE.MeshStandardMaterial({ color: 0xeaf4ff, emissive: 0xeaf6ff, emissiveIntensity: 0.6, roughness: 0.2 });
    this.brakeLight = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1020, emissiveIntensity: 1.2, roughness: 0.3 });
    this.addDetails(body, trim);

    // wheels: 20" at the front and 21" at the rear, on wider rear tyres
    const tyreM = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.9 });
    const spokeM = new THREE.MeshPhysicalMaterial({ color: 0x0e0f11, metalness: 0.5, roughness: 0.3, clearcoat: 0.8 });
    const insertM = new THREE.MeshPhysicalMaterial({ color: 0xe9eae7, metalness: 0.1, roughness: 0.35, clearcoat: 0.6 });
    const axles = { front: wheelGeometries(WHEEL_R.front, 0.295), rear: wheelGeometries(WHEEL_R.rear, 0.335) };
    for (const [x, z] of [[WHEEL_X, WHEEL_Z], [-WHEEL_X, WHEEL_Z], [WHEEL_X, -WHEEL_Z], [-WHEEL_X, -WHEEL_Z]]) {
      const front = z > 0, wg = front ? axles.front : axles.rear;
      const pivot = new THREE.Group();
      const spin = new THREE.Group();
      const left = x > 0;
      const tyre = new THREE.Mesh(wg.tyre, tyreM); tyre.castShadow = true;
      const rim = new THREE.Group();
      rim.add(new THREE.Mesh(wg.rim, spokeM), new THREE.Mesh(wg.insert, insertM), new THREE.Mesh(wg.cap, insertM));
      // the wheel face points outwards on both sides
      if (!left) rim.scale.x = -1;
      spin.add(tyre, rim);
      pivot.add(spin);
      const lift = (front ? WHEEL_R.front : WHEEL_R.rear) - R;
      pivot.position.set(x, R + lift - CAR.comHeight, z);
      this.root.add(pivot);
      this.wheels.push({ pivot, spin, left, front, lift });
    }

    // soft contact shadow so the car sits on the road even without shadow maps
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 5.0), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.85 }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = -CAR.comHeight + 0.045; shadow.renderOrder = 1;
    this.root.add(shadow);
  }

  /** everything that sits on the paint, projected onto the body so it follows its facets */
  private addDetails(body: THREE.Mesh, trim: THREE.Material) {
    const pr = new Projector(body);
    const add = (geos: THREE.BufferGeometry[], m: THREE.Material, shadow = false) => geos.forEach(g => {
      const mesh = new THREE.Mesh(g, m); mesh.castShadow = shadow; this.shell.add(mesh);
    });
    const front = new THREE.Vector3(0, 0, -1), rear = new THREE.Vector3(0, 0, 1), side = new THREE.Vector3(-1, 0, 0), down = new THREE.Vector3(0, -1, 0);
    const F = 3.2, B = -3.2, S = 2.2, U = 2.0;
    const gloss = new THREE.MeshPhysicalMaterial({ color: 0x050506, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 });
    const lens = new THREE.MeshPhysicalMaterial({ color: 0x0b0d10, roughness: 0.05, metalness: 0.4, clearcoat: 1 });
    const drl = new THREE.MeshStandardMaterial({ color: 0xf4f8ff, emissive: 0xf0f6ff, emissiveIntensity: 2.2, roughness: 0.2 });
    const carbon = new THREE.MeshPhysicalMaterial({ map: carbonTexture(), roughness: 0.35, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 });

    // a thin light bar across the full width of the black nose band
    add(pr.strip(line([-0.74, 0.39, F], [0.74, 0.39, F], 60), line([-0.74, 0.378, F], [0.74, 0.378, F], 60), front, 0.004, false), drl);
    // hidden headlights: slim slots at the front corners that light up when they drop down
    add(pr.strip(line([0.5, U, 2.1], [0.8, U, 2.08], 18), line([0.5, U, 2.07], [0.8, U, 2.05], 18), down, 0.003), lens);
    add(pr.strip(line([0.52, U, 2.092], [0.78, U, 2.073], 16), line([0.52, U, 2.082], [0.78, U, 2.063], 16), down, 0.005), this.headLight);
    // active hood vent ahead of the windshield
    add(pr.strip(line([-0.24, U, 1.2], [0.24, U, 1.2], 24), line([-0.2, U, 1.1], [0.2, U, 1.1], 24), down, 0.003, false), gloss);

    // side: the barge-board panel behind each front wheel and the door shut lines
    add(pr.strip(line([S, 0.6, 1.0], [S, 0.6, 0.94], 6), line([S, 0.39, 1.0], [S, 0.39, 0.94], 6), side, 0.004), gloss);
    for (const z of [0.86, -0.78]) {
      const top = beltAt(z) - 0.012, bottom = rockerAt(z) + 0.01;
      add(pr.strip(line([S, top, z + 0.003], [S, bottom, z + 0.003], 20), line([S, top, z - 0.003], [S, bottom, z - 0.003], 20), side, 0.002), trim);
    }

    // rear: a full-width tail light near the top of the tail, and a carbon diffuser with fans
    add(pr.strip(line([-0.9, 0.862, B], [0.9, 0.862, B], 60), line([-0.9, 0.838, B], [0.9, 0.838, B], 60), rear, 0.004, false), this.brakeLight);
    add(pr.strip(line([-0.92, 0.56, B], [0.92, 0.56, B], 60), line([-0.92, 0.335, B], [0.92, 0.335, B], 60), rear, 0.004, false), carbon);
    const fanM = new THREE.MeshStandardMaterial({ map: fanTexture(), roughness: 0.5, metalness: 0.4 });
    for (const x of [-0.56, -0.19, 0.19, 0.56]) {
      const fan = new THREE.Mesh(new THREE.CircleGeometry(0.078, 28), fanM);
      fan.rotation.y = Math.PI; fan.position.set(x, 0.448, -2.2 - 0.009);
      this.shell.add(fan);
    }

    // active rear wing on two short stalks over the tail
    const wingM = carbon.clone(); wingM.map = carbon.map!.clone(); wingM.map.repeat.set(10, 1);
    const blade = new THREE.Mesh(wingGeometry(1.72, 0.3), wingM); blade.castShadow = true;
    this.wing.add(blade);
    for (const x of [-0.86, 0.86]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.09, 0.32), wingM);
      plate.position.set(x, 0.01, -0.15); this.wing.add(plate);
    }
    this.wing.position.set(0, 1.0, -1.86);
    this.shell.add(this.wing);
    for (const x of [-0.5, 0.5]) {
      const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.12), trim);
      stalk.position.set(x, 0.96, -1.96); this.shell.add(stalk);
    }
  }

  get paintName() { return PAINTS[this.paintIndex].name; }

  nextPaint() {
    this.paintIndex = (this.paintIndex + 1) % PAINTS.length;
    const p = PAINTS[this.paintIndex];
    this.paint.color.setHex(p.color); this.paint.metalness = p.metalness; this.paint.roughness = p.roughness;
  }

  setNight(night: boolean) { this.headLight.emissiveIntensity = night ? 4 : 0.6; }

  /** sync wheels, lights, the wing and the body's roll/pitch with the physics car */
  update(car: Car, braking: boolean, dt: number) {
    const hardY = CAR.wheelRadius + CAR.restLength - 0.06 - CAR.comHeight;
    car.wheels.forEach((w, i) => {
      const vw = this.wheels[i];
      vw.pivot.position.y = hardY - Math.min(w.suspension, CAR.restLength + 0.02) + vw.lift;
      vw.pivot.rotation.y = w.steer;
      vw.spin.rotation.x = w.spin;
    });
    this.brakeLight.emissiveIntensity = braking ? 5 : 1.2;
    // the wing stands up as an airbrake under hard braking, and flattens for low drag at speed
    const target = braking && car.speed > 25 ? 1.05 : car.speed > 50 ? 0.03 : 0.12;
    this.wingAngle += (target - this.wingAngle) * Math.min(1, dt * 5);
    this.wing.rotation.x = this.wingAngle;
    // visual load transfer: the physics centre of mass is low, so add the roll a real car shows
    const k = Math.min(1, dt * 6);
    this.roll += (THREE.MathUtils.clamp(-car.latAccel * 0.0042, -0.06, 0.06) - this.roll) * k;
    this.pitch += (THREE.MathUtils.clamp(-car.longAccel * 0.0028, -0.04, 0.04) - this.pitch) * k;
    this.shell.rotation.set(this.pitch, 0, this.roll);
  }
}
