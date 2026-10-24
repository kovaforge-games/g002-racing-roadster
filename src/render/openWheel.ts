// Procedural open-wheel single-seater for the 0x classes: a lofted monocoque with a raised nose,
// sidepods, an engine cover with an airbox, a halo over the cockpit and a helmeted driver, front
// and rear wings, a floor, suspension arms and bare wheels. The paint and the race number change
// per car, so every rival is a copy of one model. Built in a ground frame (y = 0 is the road,
// +z forward), then shifted so the group's origin is the physics body's centre of mass.
import * as THREE from 'three';
import { hardpointY, type Car, type CarSpec } from '../sim/car';
import { PAINTS } from './carModel';

/** one cross-section of a loft: centre height, half width and half height at z, and how square it is */
interface Section { z: number; y: number; w: number; h: number; sq?: number }

/** a closed tube through rounded (superellipse) cross-sections, capped at both ends */
function loft(sections: Section[], seg = 28, x = 0) {
  const pos: number[] = [], idx: number[] = [];
  for (const s of sections) {
    const e = 2 / (s.sq ?? 3);
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2, c = Math.cos(a), si = Math.sin(a);
      pos.push(x + s.w * Math.sign(c) * Math.abs(c) ** e, s.y + s.h * Math.sign(si) * Math.abs(si) ** e, s.z);
    }
  }
  for (let r = 0; r < sections.length - 1; r++) for (let k = 0; k < seg; k++) {
    const a = r * seg + k, b = r * seg + (k + 1) % seg, c = a + seg, d = b + seg;
    // faces wind so their normals point out of the tube (sections run from the nose backwards)
    idx.push(a, c, b, b, c, d);
  }
  // end caps: fans around each end's centre
  for (const [r, flip] of [[0, false], [sections.length - 1, true]] as const) {
    const s = sections[r], ci = pos.length / 3;
    pos.push(x, s.y, s.z);
    for (let k = 0; k < seg; k++) {
      const a = r * seg + k, b = r * seg + (k + 1) % seg;
      if (flip) idx.push(ci, b, a); else idx.push(ci, a, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** a wing element: a thin cambered blade across the car */
function blade(width: number, chord: number, thick: number) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(chord * 0.25, thick * 1.6, chord * 0.7, thick * 1.2, chord, thick * 0.3);
  s.lineTo(chord, 0);
  s.bezierCurveTo(chord * 0.6, thick * 0.2, chord * 0.3, -thick * 0.3, 0, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false, curveSegments: 10 });
  // shape x is the chord (backwards), extrusion is across the car
  g.rotateY(Math.PI / 2); g.translate(-width / 2, 0, 0);
  return g;
}

/** the race number, white with a dark outline, for the nose and the engine cover */
function numberTexture(n: number) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  const x = c.getContext('2d')!;
  x.font = '900 128px system-ui, -apple-system, Segoe UI, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 16; x.strokeStyle = '#0b0d10'; x.lineJoin = 'round';
  x.strokeText(String(n), 128, 86);
  x.fillStyle = '#ffffff'; x.fillText(String(n), 128, 86);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export class OpenWheelModel {
  readonly root = new THREE.Group();
  private shell = new THREE.Group();
  private wheels: { pivot: THREE.Group; spin: THREE.Group }[] = [];
  readonly paint: THREE.MeshPhysicalMaterial;
  private numberMat: THREE.MeshBasicMaterial;
  private brakeLight: THREE.MeshStandardMaterial;
  private reflective: THREE.MeshStandardMaterial[] = [];
  private paintIndex = 0;
  private roll = 0; private pitch = 0;
  number = 0;
  /** the single-seater has a fixed wing: no spoiler call-outs */
  onSpoiler?: (up: boolean) => void;

  constructor(private spec: CarSpec, number = 1) {
    const p = PAINTS[0];
    this.paint = new THREE.MeshPhysicalMaterial({ color: p.color, metalness: p.metalness, roughness: p.roughness, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.15 });
    const carbon = new THREE.MeshPhysicalMaterial({ color: 0x111215, roughness: 0.4, metalness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.15 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x08090b, roughness: 0.8 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.35, metalness: 0.8 });
    this.brakeLight = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1020, emissiveIntensity: 1.2, roughness: 0.3 });
    this.numberMat = new THREE.MeshBasicMaterial({ map: numberTexture(number), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.number = number;
    this.reflective.push(this.paint, carbon);

    this.shell.position.y = -spec.comHeight;
    this.root.add(this.shell);
    const add = (g: THREE.BufferGeometry, m: THREE.Material, shadow = true) => {
      const mesh = new THREE.Mesh(g, m); mesh.castShadow = shadow; mesh.receiveShadow = true; this.shell.add(mesh); return mesh;
    };

    // monocoque: from the raised nose tip back past the cockpit to the gearbox
    add(loft([
      { z: 2.62, y: 0.2, w: 0.07, h: 0.05, sq: 2.4 },
      { z: 2.3, y: 0.26, w: 0.13, h: 0.09 },
      { z: 1.6, y: 0.36, w: 0.2, h: 0.13 },
      { z: 0.9, y: 0.42, w: 0.27, h: 0.17 },
      { z: 0.35, y: 0.43, w: 0.36, h: 0.2 },
      { z: -0.35, y: 0.44, w: 0.4, h: 0.22 },
      { z: -1.1, y: 0.43, w: 0.32, h: 0.2 },
      { z: -1.7, y: 0.38, w: 0.17, h: 0.13 },
      { z: -2.05, y: 0.34, w: 0.1, h: 0.09 },
    ]), this.paint);
    // engine cover rising to the airbox over the driver's head, and the shark fin behind it
    add(loft([
      { z: -0.22, y: 0.74, w: 0.12, h: 0.1, sq: 2.6 },
      { z: -0.42, y: 0.76, w: 0.14, h: 0.12 },
      { z: -0.9, y: 0.66, w: 0.2, h: 0.13 },
      { z: -1.5, y: 0.5, w: 0.14, h: 0.08 },
      { z: -1.85, y: 0.44, w: 0.06, h: 0.05 },
    ]), this.paint);
    add(new THREE.BoxGeometry(0.012, 0.22, 0.95).translate(0, 0.8, -1.25), this.paint);
    const intake = add(new THREE.CircleGeometry(0.07, 20).translate(0, 0, 0), dark, false);
    intake.position.set(0, 0.78, -0.215);
    // sidepods
    for (const sx of [-1, 1]) {
      add(loft([
        { z: 0.62, y: 0.36, w: 0.13, h: 0.12, sq: 4 },
        { z: 0.45, y: 0.37, w: 0.17, h: 0.15, sq: 4 },
        { z: -0.2, y: 0.36, w: 0.18, h: 0.15, sq: 4 },
        { z: -0.9, y: 0.3, w: 0.13, h: 0.1, sq: 3 },
        { z: -1.4, y: 0.27, w: 0.06, h: 0.06 },
      ], 24, sx * 0.5), this.paint);
      const mouth = add(new THREE.PlaneGeometry(0.24, 0.2), dark, false);
      mouth.position.set(sx * 0.5, 0.37, 0.625);
    }
    // the floor and the bargeboards
    add(new THREE.BoxGeometry(1.4, 0.03, 2.9).translate(0, 0.12, -0.35), carbon);
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.02, 0.18, 0.5).translate(sx * 0.72, 0.21, 0.75), carbon);

    // cockpit: the opening, the driver's helmet and the halo
    add(loft([
      { z: 0.32, y: 0.62, w: 0.2, h: 0.03, sq: 2.2 },
      { z: -0.1, y: 0.63, w: 0.25, h: 0.03, sq: 2.2 },
      { z: -0.28, y: 0.64, w: 0.2, h: 0.03, sq: 2.2 },
    ], 24), dark, false);
    const helmet = add(new THREE.SphereGeometry(0.13, 20, 14), new THREE.MeshPhysicalMaterial({ color: 0xf2f2f2, roughness: 0.25, clearcoat: 1 }));
    helmet.position.set(0, 0.73, -0.06);
    const visor = add(new THREE.SphereGeometry(0.132, 20, 8, -0.9, 1.8, 1.25, 0.45), new THREE.MeshPhysicalMaterial({ color: 0x0b0d14, roughness: 0.05, metalness: 0.6, clearcoat: 1 }), false);
    visor.position.copy(helmet.position); visor.rotation.y = 0;
    const halo = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.27, 0.62, -0.32), new THREE.Vector3(-0.27, 0.86, -0.12), new THREE.Vector3(-0.18, 0.9, 0.16),
      new THREE.Vector3(0, 0.9, 0.24), new THREE.Vector3(0.18, 0.9, 0.16), new THREE.Vector3(0.27, 0.86, -0.12), new THREE.Vector3(0.27, 0.62, -0.32),
    ]);
    add(new THREE.TubeGeometry(halo, 40, 0.024, 8, false), carbon);
    add(new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(0, 0.9, 0.24), new THREE.Vector3(0, 0.58, 0.52)), 4, 0.02, 8, false), carbon);

    // front wing: three elements across the full width, endplates, and pillars up to the nose
    for (const [i, y, z, c] of [[0, 0.07, 2.92, 0.36], [1, 0.12, 2.7, 0.24], [2, 0.17, 2.55, 0.18]] as const) {
      add(blade(1.84 - i * 0.04, c, 0.03), i === 0 ? this.paint : carbon).position.set(0, y, z);
    }
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.02, 0.2, 0.55).translate(sx * 0.93, 0.15, 2.68), carbon);
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.02, 0.14, 0.18).translate(sx * 0.07, 0.17, 2.55), carbon);

    // rear wing: main plane and flap between endplates, on a central pylon, and the rain light
    add(blade(0.98, 0.32, 0.05), this.paint).position.set(0, 0.86, -2.0);
    add(blade(0.98, 0.18, 0.035), carbon).position.set(0, 0.97, -2.25);
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.02, 0.34, 0.5).translate(sx * 0.5, 0.86, -2.16), carbon);
    add(new THREE.BoxGeometry(0.03, 0.5, 0.18).translate(0, 0.6, -2.12), carbon);
    add(new THREE.BoxGeometry(0.62, 0.06, 0.3).translate(0, 0.27, -2.15), carbon);
    const rain = add(new THREE.BoxGeometry(0.1, 0.06, 0.02), this.brakeLight, false);
    rain.position.set(0, 0.32, -2.31);

    // race numbers on the nose and on both sides of the engine cover
    const num = (w: number, h: number, pos: [number, number, number], rot: [number, number, number]) => {
      const m = add(new THREE.PlaneGeometry(w, h), this.numberMat, false);
      m.position.set(...pos); m.rotation.set(...rot); m.renderOrder = 2;
    };
    num(0.28, 0.18, [0, 0.53, 1.45], [-Math.PI / 2 + 0.15, 0, 0]);
    for (const sx of [-1, 1]) num(0.3, 0.17, [sx * 0.215, 0.7, -0.9], [0, sx * Math.PI / 2, 0]);

    // wheels: wide, bare tyres with a metal rim and a hub, and suspension arms to the body
    const tyreM = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.92 });
    const R = spec.wheelRadius;
    for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const front = z > 0;
      const w = front ? 0.3 : 0.38;
      const wx = x * spec.track / 2, wz = z * spec.wheelbase / 2;
      const pivot = new THREE.Group(), spin = new THREE.Group();
      const tyre = new THREE.Mesh(new THREE.CylinderGeometry(R, R, w, 32, 1).rotateZ(Math.PI / 2), tyreM); tyre.castShadow = true;
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.66, R * 0.66, w + 0.01, 24, 1, true).rotateZ(Math.PI / 2), metal);
      const face = new THREE.Mesh(new THREE.CircleGeometry(R * 0.66, 24).rotateY(x * Math.PI / 2).translate(x * (w / 2 + 0.006), 0, 0), dark);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 12).rotateZ(Math.PI / 2).translate(x * (w / 2 + 0.02), 0, 0), metal);
      spin.add(tyre, rim, face, hub);
      pivot.add(spin);
      pivot.position.set(wx, R - spec.comHeight, wz);
      this.root.add(pivot);
      this.wheels.push({ pivot, spin });
      // wishbones from the chassis to the upright (fixed to the body: they don't follow the bumps)
      for (const [dy, dz] of [[0.05, 0.12], [0.05, -0.12], [-0.06, 0.1], [-0.06, -0.1]]) {
        const a = new THREE.Vector3(x * (front ? 0.16 : 0.3), R + dy + 0.05, wz + dz * 2.2);
        const b = new THREE.Vector3(wx - x * w * 0.5, R + dy, wz);
        add(new THREE.TubeGeometry(new THREE.LineCurve3(a, b), 1, 0.012, 6, false), carbon, false);
      }
    }

    // soft contact shadow so the car sits on the road even without shadow maps
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 5.6), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.8 }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = -spec.comHeight + 0.045; shadow.renderOrder = 1;
    this.root.add(shadow);
  }

  /** the body shell, built in the ground frame: crash dents go here (render/damage.ts) */
  get bodyShell() { return this.shell; }

  get paintName() { return PAINTS[this.paintIndex].name; }

  nextPaint() {
    this.paintIndex = (this.paintIndex + 1) % PAINTS.length;
    const p = PAINTS[this.paintIndex];
    this.paint.color.setHex(p.color); this.paint.metalness = p.metalness; this.paint.roughness = p.roughness;
  }

  /** a new race number (each copy of the model has its own number material) */
  setNumber(n: number) {
    if (n === this.number) return;
    this.number = n;
    this.numberMat.map?.dispose();
    this.numberMat.map = numberTexture(n);
    this.numberMat.needsUpdate = true;
  }

  setNight(night: boolean) { this.brakeLight.emissiveIntensity = night ? 2 : 1.2; }

  setReflections(tex: THREE.Texture | null) {
    for (const m of this.reflective) { m.envMap = tex; m.needsUpdate = true; }
  }

  /** showroom: nothing moves on its own */
  showSpoiler(_up: boolean) { /* fixed wing */ }
  animate(_dt: number) { /* fixed wing */ }

  /** sync wheels and the rain light with the physics car, and add a touch of body roll and pitch */
  update(car: Car, braking: boolean, dt: number) {
    const S = this.spec;
    const hardY = hardpointY(S);
    car.wheels.forEach((w, i) => {
      const vw = this.wheels[i];
      vw.pivot.position.y = hardY - Math.min(w.suspension, S.restLength + 0.02);
      vw.pivot.rotation.y = w.steer;
      vw.spin.rotation.x = w.spin;
    });
    this.brakeLight.emissiveIntensity = braking ? 5 : 1.2;
    const k = Math.min(1, dt * 6);
    this.roll += (THREE.MathUtils.clamp(-car.latAccel * 0.0016, -0.025, 0.025) - this.roll) * k;
    this.pitch += (THREE.MathUtils.clamp(-car.longAccel * 0.0012, -0.02, 0.02) - this.pitch) * k;
    this.shell.rotation.set(this.pitch, 0, this.roll);
  }
}

function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 64, 4, 32, 64, 62);
  g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.scale(1, 1); x.fillRect(0, 0, 64, 128);
  return new THREE.CanvasTexture(c);
}
