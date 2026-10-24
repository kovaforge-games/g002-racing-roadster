// Procedural electric roadster: the faceted body shell from carBody.ts, details projected onto
// it (light bar, hidden headlights, vents, full-width tail light, a carbon diffuser with fans),
// an active rear wing and 20"/21" wheels with thin black spokes over white aero inserts. Built in
// a ground frame (y = 0 is the road, +z forward) and then shifted so the group's origin is the
// physics body's centre of mass.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAR, type Car } from '../sim/car';
import { ARCH_DEPTH, ARCH_REACH, R, WHEEL_R, WHEEL_X, WHEEL_Z, Projector, archY, beltAt, bodyGeometry, line, rockerAt, widthAt } from './carBody';
import { Livery, ROADSTER_SHAPE, type LiveryConfig } from './livery';
import type { RimStyle, WingStyle } from '../core/garage';

export const PAINTS = [
  { name: 'Anodised White', color: 0xe6e8e6, metalness: 0.2, roughness: 0.34 },
  { name: 'Lava Red', color: 0x9e0a12, metalness: 0.5, roughness: 0.28 },
  { name: 'Midnight Blue', color: 0x15306a, metalness: 0.6, roughness: 0.3 },
  { name: 'Liquid Silver', color: 0xb4b8bd, metalness: 0.85, roughness: 0.22 },
  { name: 'Graphite', color: 0x3a3e44, metalness: 0.55, roughness: 0.3 },
  { name: 'Gloss Black', color: 0x0b0b0d, metalness: 0.3, roughness: 0.2 },
  { name: 'Racing Orange', color: 0xd9540f, metalness: 0.45, roughness: 0.28 },
  { name: 'Volt Yellow', color: 0xd9c414, metalness: 0.35, roughness: 0.3 },
  { name: 'Sky Blue', color: 0x3d8fd6, metalness: 0.5, roughness: 0.28 },
  { name: 'Lime Green', color: 0x5fb41c, metalness: 0.4, roughness: 0.3 },
  { name: 'Ultra Violet', color: 0x5a2a9c, metalness: 0.55, roughness: 0.28 },
  { name: 'Coral Pink', color: 0xe0607a, metalness: 0.4, roughness: 0.3 },
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
      pos.push(side * (W - ARCH_DEPTH), 0.14, z, side * (W - ARCH_DEPTH), y, z, side * (W - 0.012), y, z);
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

/** a soft neon pool of light for the underglow */
function glowTexture() {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 256;
  const c = cv.getContext('2d')!;
  const g = c.createRadialGradient(64, 128, 8, 64, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.45, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 128, 256);
  return new THREE.CanvasTexture(cv);
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

/** the tail deck under the stowed wing, and how far the wing rises */
const WING_DECK = 0.93, WING_RISE = 0.17;

/** what you see through the glass: white seats with grey bolsters, a dash, a yoke and a console */
function cabin() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.85 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe8e5de, roughness: 0.6 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x5d6066, roughness: 0.9 });
  const screen = new THREE.MeshStandardMaterial({ color: 0x0a0f18, emissive: 0x1d3a66, emissiveIntensity: 0.5, roughness: 0.2 });
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, rx = 0) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z); b.rotation.x = rx; g.add(b); return b;
  };
  box(1.56, 0.04, 2.0, dark, 0, 0.22, -0.2);                 // floor
  box(1.5, 0.5, 0.06, dark, 0, 0.5, -1.12);                  // bulkhead behind the seats
  for (const s of [-1, 1]) box(0.06, 0.42, 1.8, dark, s * 0.84, 0.44, -0.15); // door cards
  box(1.56, 0.16, 0.4, dark, 0, 0.62, 0.66, -0.25);          // dash
  box(0.36, 0.02, 0.2, screen, -0.02, 0.715, 0.5, -0.9);     // centre screen
  box(0.2, 0.16, 1.1, dark, 0, 0.32, -0.2);                  // console
  for (const x of [-0.37, 0.37]) {
    box(0.44, 0.1, 0.5, white, x, 0.3, -0.42);               // cushion
    box(0.44, 0.62, 0.1, white, x, 0.6, -0.74, -0.28);       // backrest
    for (const s of [-1, 1]) box(0.06, 0.6, 0.12, grey, x + s * 0.22, 0.6, -0.72, -0.28); // bolsters
  }
  // a yoke in front of the driver (on the car's left, +x)
  const yoke = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.017, 8, 28, Math.PI).rotateZ(Math.PI), dark);
  yoke.scale.set(1, 0.7, 1); yoke.position.set(0.37, 0.66, 0.28); yoke.rotation.x = -0.35; g.add(yoke);
  box(0.3, 0.03, 0.03, dark, 0.37, 0.66, 0.28, -0.35);
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
  private stalks = new THREE.Group();
  private wingAngle = 0;
  /** 0 stowed flush on the tail, 1 fully raised */
  private wingLift = 0;
  /** the spoiler pops up above about 80 km/h and stows again below about 60 */
  spoilerUp = false;
  onSpoiler?: (up: boolean) => void;
  /** materials that take the live reflection probe when there is one */
  private reflective: THREE.MeshStandardMaterial[] = [];
  private paintIndex = 0;
  private roll = 0; private pitch = 0;
  // garage parts: the glass, the rims, the underglow and how the wing behaves
  private glass: THREE.MeshPhysicalMaterial;
  private rimSpoke!: THREE.MeshPhysicalMaterial; private rimInsert!: THREE.MeshPhysicalMaterial;
  private glowMat: THREE.MeshBasicMaterial; private glow: THREE.Mesh;
  private glowOn = false;
  private wingStyle: WingStyle = 'active';
  private livery: Livery | null = null;

  constructor() {
    const p = PAINTS[0];
    this.paint = new THREE.MeshPhysicalMaterial({ color: p.color, metalness: p.metalness, roughness: p.roughness, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.15 });
    // gold-tinted glass, like a visor: mostly reflection, with the cabin showing through
    const glass = this.glass = new THREE.MeshPhysicalMaterial({ color: 0x7a5c22, metalness: 0.45, roughness: 0.03, envMapIntensity: 1.5, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.62 });
    const lower = new THREE.MeshPhysicalMaterial({ color: 0x0b0b0c, roughness: 0.32, metalness: 0.2, clearcoat: 0.6, clearcoatRoughness: 0.2 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.7 });

    // everything is built on the ground; the root's origin is the centre of mass
    this.shell.position.y = -CAR.comHeight;
    this.root.add(this.shell);
    const body = new THREE.Mesh(bodyGeometry(), [this.paint, glass, lower]);
    this.reflective.push(this.paint, glass, lower);
    this.shell.add(cabin());
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
    const spokeM = this.rimSpoke = new THREE.MeshPhysicalMaterial({ color: 0x0e0f11, metalness: 0.5, roughness: 0.3, clearcoat: 0.8 });
    const insertM = this.rimInsert = new THREE.MeshPhysicalMaterial({ color: 0xe9eae7, metalness: 0.1, roughness: 0.35, clearcoat: 0.6 });
    this.reflective.push(spokeM, insertM);
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

    // underglow: neon light on the road under the car (off until fitted in the garage)
    this.glowMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0x2fe6ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 });
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 6.2), this.glowMat);
    this.glow.rotation.x = -Math.PI / 2; this.glow.position.y = -CAR.comHeight + 0.05; this.glow.renderOrder = 1;
    this.glow.visible = false;
    this.root.add(this.glow);
  }

  /** the livery on the paint: a pattern, its second colour and the race number (a copy of the
   *  model makes its own, since it has its own paint) */
  setLivery(cfg: LiveryConfig) {
    if (!this.livery || this.livery.material !== this.paint) this.livery = new Livery(this.paint, ROADSTER_SHAPE);
    this.livery.set(cfg);
  }

  /** soot on the paint after brushing a ring of fire, 0..1 */
  setSoot(v: number) { if (this.livery) this.livery.soot = v; }

  /** garage parts: rim style and colour, the wing, the glass tint and the underglow (0 = off) */
  setParts(p: { rims: RimStyle; rimColor: number; wing: WingStyle; glass: number; glow: number }) {
    const dark = 0x15161a;
    this.rimSpoke.color.setHex(p.rims === 'painted' ? dark : p.rimColor);
    this.rimInsert.color.setHex(p.rims === 'aero' ? 0xe9eae7 : p.rims === 'open' ? dark : p.rimColor);
    this.rimSpoke.metalness = this.rimInsert.metalness = p.rimColor === 0xc9ced4 || p.rimColor === 0xd4a72c ? 0.9 : 0.4;
    this.wingStyle = p.wing;
    this.glass.color.setHex(p.glass);
    this.glowOn = p.glow !== 0;
    this.glow.visible = this.glowOn;
    if (this.glowOn) this.glowMat.color.setHex(p.glow);
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
    this.reflective.push(gloss, lens, carbon);

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

    // active rear wing: it lies flush on the tail as a ducktail, and rises on two stalks at speed
    const wingM = carbon.clone(); wingM.map = carbon.map!.clone(); wingM.map.repeat.set(10, 1);
    this.reflective.push(wingM);
    const blade = new THREE.Mesh(wingGeometry(1.72, 0.3), wingM); blade.castShadow = true;
    this.wing.add(blade);
    for (const x of [-0.86, 0.86]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.06, 0.3), wingM);
      plate.position.set(x, 0.005, -0.15); this.wing.add(plate);
    }
    this.shell.add(this.wing);
    // stalks are unit-high boxes standing on the deck, stretched up to the blade
    for (const x of [-0.5, 0.5]) {
      const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1, 0.1).translate(0, 0.5, 0), trim);
      stalk.position.set(x, 0, 0); this.stalks.add(stalk);
    }
    this.stalks.position.set(0, WING_DECK - 0.02, -1.98);
    this.shell.add(this.stalks);
    this.poseWing();
  }

  private poseWing() {
    const y = WING_DECK + this.wingLift * WING_RISE;
    this.wing.position.set(0, y, -1.85);
    this.wing.rotation.x = this.wingAngle;
    this.stalks.scale.y = Math.max(0.001, y - WING_DECK + 0.03);
    this.stalks.visible = this.wingLift > 0.02;
  }

  /** showroom: raise or stow the spoiler without a physics car; `animate` eases it there */
  private shownSpoiler = false;
  showSpoiler(up: boolean) { this.shownSpoiler = up; this.spoilerUp = up; }

  /** showroom: move the spoiler towards its shown position */
  animate(dt: number) {
    this.wingLift += ((this.shownSpoiler ? 1 : 0) - this.wingLift) * Math.min(1, dt * 4);
    this.wingAngle += ((this.shownSpoiler ? 0.14 : 0) * Math.min(1, this.wingLift * 1.5) - this.wingAngle) * Math.min(1, dt * 5);
    this.poseWing();
  }

  /** reflect a live capture of the surroundings (or null for the sky gradient) */
  setReflections(tex: THREE.Texture | null) {
    for (const m of this.reflective) { m.envMap = tex; m.needsUpdate = true; }
  }

  get paintName() { return PAINTS[this.paintIndex].name; }

  nextPaint() {
    this.paintIndex = (this.paintIndex + 1) % PAINTS.length;
    const p = PAINTS[this.paintIndex];
    this.paint.color.setHex(p.color); this.paint.metalness = p.metalness; this.paint.roughness = p.roughness;
  }

  setNight(night: boolean) { this.headLight.emissiveIntensity = night ? 4 : 0.6; this.glowMat.opacity = night ? 1 : 0.65; }

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
    // the spoiler pops up above about 80 km/h and stows below about 60; once up it stands up as
    // an airbrake under hard braking and trims flat for low drag at very high speed
    const up = this.wingStyle === 'fixed' || (this.wingStyle === 'active' && (car.speed > 22 || (this.spoilerUp && car.speed > 16)));
    if (up !== this.spoilerUp) { this.spoilerUp = up; if (this.wingStyle === 'active') this.onSpoiler?.(up); }
    this.wingLift += ((up ? 1 : 0) - this.wingLift) * Math.min(1, dt * 4);
    const angle = !up ? 0 : this.wingStyle === 'fixed' ? 0.22 : braking && car.speed > 25 ? 1.05 : car.speed > 55 ? 0.03 : 0.14;
    this.wingAngle += (angle * Math.min(1, this.wingLift * 1.5) - this.wingAngle) * Math.min(1, dt * 5);
    this.poseWing();
    // visual load transfer: the physics centre of mass is low, so add the roll a real car shows
    const k = Math.min(1, dt * 6);
    this.roll += (THREE.MathUtils.clamp(-car.latAccel * 0.0042, -0.06, 0.06) - this.roll) * k;
    this.pitch += (THREE.MathUtils.clamp(-car.longAccel * 0.0028, -0.04, 0.04) - this.pitch) * k;
    this.shell.rotation.set(this.pitch, 0, this.roll);
  }
}
