// Fun Mode on screen: the red kicker ramps (chevrons on the deck, neon pink sides and a
// glowing lip), boost pads with running arrows, spinning rainbow item boxes, oil slicks, and the
// rings of fire: a steel burner hoop wrapped in thousands of flame particles animated on the GPU,
// with smoke rising off the top, a hot glow on the road and real light thrown on the cars by the
// two rings nearest the camera. Raised rings hang from a gantry over the road.
import * as THREE from 'three';
import type { Track } from '../sim/track';
import { rampMesh, RING_FLAME, type Fun, type Oil, type Ring } from '../sim/fun';
import type { Quality } from './graphics';

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

const FIRE_VERT = /* glsl */`
attribute vec4 seed;   // phase, rate, size, rise
attribute float floorY;
uniform float uTime, uScale;
varying float vAge;
varying float vClip;
void main() {
  float age = fract(uTime * seed.y + seed.x);
  vec3 p = position;
  // flames lick upwards, flickering side to side as they go
  p.y += age * age * seed.w + age * 0.25;
  p.x += sin(uTime * 9.0 + seed.x * 53.0) * 0.12 * age;
  p.z += cos(uTime * 8.0 + seed.x * 37.0) * 0.12 * age;
  vAge = age;
  vClip = p.y - floorY;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float size = seed.z * (1.15 - age * 0.75) * smoothstep(0.0, 0.08, age);
  gl_PointSize = size * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FIRE_FRAG = /* glsl */`
uniform float uBright;
varying float vAge;
varying float vClip;
void main() {
  if (vClip < 0.0) discard;
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  if (r > 1.0) discard;
  // a teardrop: narrower towards the top of the sprite
  float soft = pow(max(0.0, 1.0 - r), 1.4) * (0.8 + 0.4 * (0.5 + c.y));
  vec3 white = vec3(1.0, 0.95, 0.75), yellow = vec3(1.0, 0.72, 0.18), orange = vec3(1.0, 0.33, 0.04), red = vec3(0.45, 0.04, 0.0);
  vec3 col = vAge < 0.12 ? mix(white, yellow, vAge / 0.12) : vAge < 0.4 ? mix(yellow, orange, (vAge - 0.12) / 0.28) : mix(orange, red, (vAge - 0.4) / 0.6);
  float a = soft * (1.0 - vAge) * (1.0 - vAge) * smoothstep(0.0, 0.25, vClip);
  gl_FragColor = vec4(col * uBright * a, a);
}`;
const SMOKE_VERT = /* glsl */`
attribute vec4 seed;
uniform float uTime, uScale;
varying float vAge;
void main() {
  float age = fract(uTime * seed.y + seed.x);
  vec3 p = position;
  p.y += age * seed.w;
  p.x += sin(seed.x * 40.0 + uTime * 0.7) * age * 1.2;
  p.z += cos(seed.x * 23.0 + uTime * 0.6) * age * 1.2;
  vAge = age;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = seed.z * (0.6 + age * 2.2) * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const SMOKE_FRAG = /* glsl */`
uniform vec3 uColor;
varying float vAge;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  if (r > 1.0) discard;
  float a = (1.0 - r * r) * smoothstep(0.0, 0.15, vAge) * (1.0 - vAge) * 0.32;
  gl_FragColor = vec4(uColor, a);
}`;

/** the flames: premultiplied "over" blending, so they glow like additive light but still show
 *  up against a bright sky (pure additive flames vanish into a sunset) */
function fireMaterial() {
  return new THREE.ShaderMaterial({ vertexShader: FIRE_VERT, fragmentShader: FIRE_FRAG, transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: { uTime: { value: 0 }, uScale: { value: 400 }, uBright: { value: 2.6 } } });
}

/** a point on a ring's hoop at angle a (0 = right of the road, π/2 = the top) */
function hoopPoint(r: Ring, a: number, rad = r.r) {
  const c = Math.cos(a) * rad, s = Math.sin(a) * rad;
  return new THREE.Vector3(r.x + r.rx * c, r.y + s, r.z + r.rz * c);
}

/** flame and smoke particles for a set of rings: points spread round each hoop and through its
 *  band of fire, with smoke rising off the top */
function ringParticles(rings: Ring[], density: number) {
  const fireP: number[] = [], fireS: number[] = [], fireF: number[] = [];
  const smokeP: number[] = [], smokeS: number[] = [];
  for (const r of rings) {
    const n = Math.round(2 * Math.PI * r.r * 46 * density);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const p = hoopPoint(r, a, r.r + (Math.random() - 0.5) * RING_FLAME * 1.2);
      const off = (Math.random() - 0.5) * 0.35;
      fireP.push(p.x + r.nx * off, p.y, p.z + r.nz * off);
      // flames on the bottom of a hoop are shorter (they lick up into it), the top ones taller
      const rise = 0.9 + Math.random() * 0.9 + Math.max(0, Math.sin(a)) * 0.6;
      fireS.push(Math.random(), 0.9 + Math.random() * 1.3, 0.38 + Math.random() * 0.42, rise);
      fireF.push(r.floor + 0.02);
    }
    for (let k = 0; k < 70 * density; k++) {
      const a = Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      const p = hoopPoint(r, a);
      smokeP.push(p.x, p.y + 0.6, p.z);
      smokeS.push(Math.random(), 0.22 + Math.random() * 0.2, 0.9 + Math.random() * 0.8, 5 + Math.random() * 4);
    }
  }
  const fire = new THREE.BufferGeometry();
  fire.setAttribute('position', new THREE.Float32BufferAttribute(fireP, 3));
  fire.setAttribute('seed', new THREE.Float32BufferAttribute(fireS, 4));
  fire.setAttribute('floorY', new THREE.Float32BufferAttribute(fireF, 1));
  const smoke = new THREE.BufferGeometry();
  smoke.setAttribute('position', new THREE.Float32BufferAttribute(smokeP, 3));
  smoke.setAttribute('seed', new THREE.Float32BufferAttribute(smokeS, 4));
  return { fire, smoke };
}

export class FunScene {
  readonly group = new THREE.Group();
  private disposables: { dispose(): void }[] = [];
  private fire: THREE.ShaderMaterial; private smoke: THREE.ShaderMaterial;
  private glowMat: THREE.MeshBasicMaterial; private floorMat: THREE.MeshBasicMaterial;
  private padMat: THREE.MeshBasicMaterial; private lipMat: THREE.MeshStandardMaterial;
  private boxMat: THREE.MeshStandardMaterial; private boxGeo = new THREE.BoxGeometry(1.4, 1.4, 1.4);
  private boxes: THREE.Mesh[] = [];
  private oilMat = new THREE.MeshPhysicalMaterial({ color: 0x030303, roughness: 0.04, metalness: 0.2, clearcoat: 1, transparent: true, opacity: 0.94, polygonOffset: true, polygonOffsetFactor: -6 });
  private oilGeo = new THREE.CircleGeometry(1.9, 28).rotateX(-Math.PI / 2);
  private oils = new Map<Oil, THREE.Mesh>();
  private lights: THREE.PointLight[] = [];
  private neon: THREE.ShaderMaterial;
  private t = 0;

  constructor(private track: Track, private fun: Fun, quality: Quality) {
    const fine = quality === 'high' || quality === 'ultra';
    this.fire = fireMaterial();
    this.smoke = new THREE.ShaderMaterial({ vertexShader: SMOKE_VERT, fragmentShader: SMOKE_FRAG, transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uScale: { value: 400 }, uColor: { value: new THREE.Color(0x2b2724) } } });
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const glowTex = canvasTex(128, 128, c => {
      const g = c.createRadialGradient(64, 64, 4, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,170,60,0.9)'); g.addColorStop(0.45, 'rgba(255,90,10,0.45)'); g.addColorStop(1, 'rgba(255,40,0,0)');
      c.fillStyle = g; c.fillRect(0, 0, 128, 128);
    });
    this.floorMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4 });
    this.disposables.push(this.fire, this.smoke, this.glowMat, glowTex, this.floorMat, this.boxGeo, this.oilMat, this.oilGeo);

    this.lipMat = new THREE.MeshStandardMaterial({ color: 0x003333, emissive: 0x00fff0, emissiveIntensity: 3 });
    this.disposables.push(this.lipMat);
    this.buildRamps();
    const padTex = canvasTex(64, 128, c => {
      c.fillStyle = '#04223c'; c.fillRect(0, 0, 64, 128);
      c.fillStyle = '#2fe6ff';
      for (let k = 0; k < 3; k++) { c.beginPath(); c.moveTo(8, 118 - k * 40); c.lineTo(32, 86 - k * 40); c.lineTo(56, 118 - k * 40); c.lineTo(56, 102 - k * 40); c.lineTo(32, 70 - k * 40); c.lineTo(8, 102 - k * 40); c.fill(); }
    });
    padTex.wrapT = THREE.RepeatWrapping; padTex.repeat.set(1, 3);
    this.padMat = new THREE.MeshBasicMaterial({ map: padTex, transparent: true, opacity: 0.95, polygonOffset: true, polygonOffsetFactor: -5, side: THREE.DoubleSide });
    this.disposables.push(padTex, this.padMat);
    this.buildPads();
    const boxTex = canvasTex(128, 128, c => {
      const g = c.createLinearGradient(0, 0, 128, 128);
      ['#ff3b3b', '#ffb000', '#ffe600', '#2bd96b', '#2f9bff', '#a74bff'].forEach((col, i) => g.addColorStop(i / 5, col));
      c.fillStyle = g; c.fillRect(0, 0, 128, 128);
      c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 8; c.strokeRect(4, 4, 120, 120);
      c.fillStyle = 'rgba(255,255,255,0.92)'; c.font = '900 90px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('?', 64, 70);
    });
    this.boxMat = new THREE.MeshStandardMaterial({ map: boxTex, emissive: 0xffffff, emissiveMap: boxTex, emissiveIntensity: 0.55, transparent: true, opacity: 0.88, roughness: 0.25 });
    this.disposables.push(boxTex, this.boxMat);
    for (const b of fun.boxes) {
      const m = new THREE.Mesh(this.boxGeo, this.boxMat);
      m.position.set(b.x, b.y + 1.2, b.z); m.castShadow = true;
      this.group.add(m); this.boxes.push(m);
    }
    this.buildRings(fine ? 1 : 0.5);
    this.neon = this.buildNeon();
    for (let k = 0; k < (fine ? 2 : 1); k++) {
      const l = new THREE.PointLight(0xff7a2a, 0, 34, 1.6);
      this.lights.push(l); this.group.add(l);
    }
  }

  private buildRamps() {
    // g001's red ramps: a red deck with darker red chevrons, and neon sides
    const deck = canvasTex(256, 256, c => {
      c.fillStyle = '#e00a0a'; c.fillRect(0, 0, 256, 256);
      c.fillStyle = '#8a0000';
      for (let k = -1; k < 3; k++) {
        c.beginPath(); c.moveTo(0, 128 + k * 128); c.lineTo(128, k * 128); c.lineTo(256, 128 + k * 128); c.lineTo(256, 156 + k * 128); c.lineTo(128, 28 + k * 128); c.lineTo(0, 156 + k * 128); c.fill();
      }
    });
    deck.wrapS = deck.wrapT = THREE.RepeatWrapping; deck.repeat.set(1 / 6.5, 1 / 4.5);
    const top = new THREE.MeshStandardMaterial({ map: deck, roughness: 0.55, metalness: 0.1, emissive: 0x400000 });
    const side = new THREE.MeshStandardMaterial({ color: 0xff2d95, emissive: 0xff2d95, emissiveIntensity: 1.4, roughness: 0.4 });
    this.disposables.push(deck, top, side);
    for (const r of this.fun.layout.ramps) {
      const m = rampMesh(this.track, r);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
      g.setIndex(new THREE.BufferAttribute(m.idx, 1));
      g.addGroup(0, m.topCount, 0); g.addGroup(m.topCount, m.idx.length - m.topCount, 1);
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, [top, side]);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.group.add(mesh);
      // a glowing strip along the lip
      const a = this.track.pointAt(r.s0 + r.len, r.d0), b = this.track.pointAt(r.s0 + r.len, r.d1);
      const len = a.distanceTo(b);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, 0.12), this.lipMat);
      lip.position.set((a.x + b.x) / 2, (a.y + b.y) / 2 + r.h + 0.06, (a.z + b.z) / 2);
      lip.rotation.y = Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2;
      this.group.add(lip);
      this.disposables.push(g, lip.geometry);
    }
  }

  private buildPads() {
    const t = this.track;
    for (const p of this.fun.layout.pads) {
      const pos: number[] = [], uv: number[] = [], idx: number[] = [];
      const STEPS = 5;
      for (let k = 0; k <= STEPS; k++) {
        const u = k / STEPS;
        for (const [d, ux] of [[p.d0, 0], [p.d1, 1]] as const) {
          const q = t.pointAt(p.s0 + u * p.len, d);
          pos.push(q.x, q.y + 0.05, q.z); uv.push(ux, u);
        }
        if (k > 0) { const a = (k - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      this.group.add(new THREE.Mesh(g, this.padMat));
      this.disposables.push(g);
    }
  }

  private buildRings(density: number) {
    const steel = new THREE.MeshStandardMaterial({ color: 0x44484e, roughness: 0.35, metalness: 0.9 });
    const sooty = new THREE.MeshStandardMaterial({ color: 0x1a1a1b, roughness: 0.8, metalness: 0.4 });
    this.disposables.push(steel, sooty);
    for (const r of this.fun.layout.rings) {
      const axis = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(r.nx, 0, r.nz));
      // the burner pipe, and a hot glowing core inside the flames
      const pipe = new THREE.Mesh(new THREE.TorusGeometry(r.r, 0.09, 10, 96), sooty);
      pipe.position.set(r.x, r.y, r.z); pipe.quaternion.copy(axis); pipe.castShadow = true;
      const core = new THREE.Mesh(new THREE.TorusGeometry(r.r, 0.2, 8, 96), this.glowMat);
      core.position.copy(pipe.position); core.quaternion.copy(axis);
      this.group.add(pipe, core);
      this.disposables.push(pipe.geometry, core.geometry);
      // the road glows under rings that reach down to it
      if (r.kind !== 'ramp') {
        const glow = new THREE.Mesh(new THREE.PlaneGeometry(r.r * 3.2, 7).rotateX(-Math.PI / 2), this.floorMat);
        glow.position.set(r.x, r.floor + 0.06, r.z);
        glow.rotation.y = Math.atan2(r.nx, r.nz);
        glow.renderOrder = 1;
        this.group.add(glow);
        this.disposables.push(glow.geometry);
      }
      if (r.kind !== 'road') this.gantry(r, steel);
    }
    const { fire, smoke } = ringParticles(this.fun.layout.rings, density);
    const fp = new THREE.Points(fire, this.fire), sp = new THREE.Points(smoke, this.smoke);
    fp.frustumCulled = sp.frustumCulled = false;
    fp.renderOrder = 4; sp.renderOrder = 3;
    this.group.add(sp, fp);
    this.disposables.push(fire, smoke);
  }

  /** neon borders: glowing strips along both edges of the road and along the barriers, in
   *  a rainbow that flows round the lap */
  private buildNeon() {
    const tr = this.track;
    const mat = new THREE.ShaderMaterial({
      vertexShader: `attribute float hue; varying float vHue; void main() { vHue = hue; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uTime, uBright; varying float vHue;
        vec3 hsv(float h) { vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); return k; }
        void main() { gl_FragColor = vec4(hsv(fract(vHue - uTime * 0.08)) * uBright, 1.0); }`,
      uniforms: { uTime: { value: 0 }, uBright: { value: 2 } },
      polygonOffset: true, polygonOffsetFactor: -3,
    });
    this.disposables.push(mat);
    const pos: number[] = [], hue: number[] = [], idx: number[] = [];
    const band = (d0: number, d1: number, y: number, laps: number) => {
      const base = pos.length / 3;
      for (let i = 0; i <= tr.n; i++) {
        const s = (i / tr.n) * tr.total;
        for (const d of [d0, d1]) { const p = tr.pointAt(s, d); pos.push(p.x, p.y + y, p.z); hue.push((i / tr.n) * laps); }
        if (i) { const a = base + (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2, a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
    };
    const hw = tr.halfWidth;
    for (const side of [-1, 1]) {
      band(side * (hw + 0.12), side * (hw + 0.42), 0.07, 12);
      band(side * (tr.wallOffset - 0.03), side * (tr.wallOffset - 0.03), 0.76, 12);
    }
    // the strips on the barriers' painted band stand up: raise their second edge
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('hue', new THREE.Float32BufferAttribute(hue, 1));
    g.setIndex(idx);
    const per = (tr.n + 1) * 2;
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (const band of [1, 3]) for (let i = 0; i <= tr.n; i++) { const k = band * per + i * 2 + 1; p.setY(k, p.getY(k) + 0.26); }
    const m = new THREE.Mesh(g, mat);
    m.frustumCulled = false;
    this.group.add(m);
    this.disposables.push(g);
    return mat;
  }

  /** two poles beside the road, a beam across, and cables down to the top of the hoop */
  private gantry(r: Ring, steel: THREE.Material) {
    const topY = r.y + r.r + 1.4;
    const pole = new THREE.CylinderGeometry(0.16, 0.2, 1, 12).translate(0, 0.5, 0);
    const ends: THREE.Vector3[] = [];
    for (const side of [-1, 1]) {
      const p = this.track.pointAt(r.s, side * r.poles);
      const m = new THREE.Mesh(pole, steel);
      m.position.copy(p); m.scale.y = topY - p.y; m.castShadow = true;
      this.group.add(m);
      ends.push(new THREE.Vector3(p.x, topY, p.z));
    }
    const span = ends[0].distanceTo(ends[1]);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span + 0.4, 0.34, 0.34), steel);
    beam.position.copy(ends[0]).add(ends[1]).multiplyScalar(0.5);
    beam.rotation.y = Math.atan2(ends[1].x - ends[0].x, ends[1].z - ends[0].z) + Math.PI / 2;
    beam.castShadow = true;
    this.group.add(beam);
    for (const a of [Math.PI / 2 - 0.5, Math.PI / 2 + 0.5]) {
      const p = hoopPoint(r, a);
      const len = topY - p.y;
      const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, len, 6), steel);
      cable.position.set(p.x, p.y + len / 2, p.z);
      this.group.add(cable);
      this.disposables.push(cable.geometry);
    }
    this.disposables.push(pole, beam.geometry);
  }

  /** a car went through: a burst of embers from the hoop */
  embers(r: Ring, burst: (x: number, y: number, z: number, dx: number, dy: number, dz: number, n: number, speed: number) => void) {
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const p = hoopPoint(r, a);
      if (p.y < r.floor + 0.2) continue;
      burst(p.x, p.y, p.z, r.nx * 0.5 - Math.cos(a) * r.rx * 0.4, 0.4 - Math.sin(a) * 0.4, r.nz * 0.5 - Math.cos(a) * r.rz * 0.4, 9, 8);
    }
  }

  update(dt: number, cam: THREE.PerspectiveCamera, viewportHeight: number, night: boolean) {
    this.t += dt;
    const scale = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    this.fire.uniforms.uTime.value = this.t; this.fire.uniforms.uScale.value = scale;
    this.fire.uniforms.uBright.value = night ? 1.6 : 2.6;
    this.smoke.uniforms.uTime.value = this.t; this.smoke.uniforms.uScale.value = scale;
    this.smoke.uniforms.uColor.value.set(night ? 0x141210 : 0x3a3532);
    const flick = 0.82 + 0.18 * Math.sin(this.t * 23) * Math.sin(this.t * 7.3 + 1);
    this.glowMat.opacity = 0.75 * flick;
    this.floorMat.opacity = (night ? 1 : 0.7) * flick;
    // light from the rings nearest the camera
    const near = [...this.fun.layout.rings].sort((a, b) => (a.x - cam.position.x) ** 2 + (a.z - cam.position.z) ** 2 - ((b.x - cam.position.x) ** 2 + (b.z - cam.position.z) ** 2));
    this.lights.forEach((l, k) => {
      const r = near[k];
      if (!r) { l.intensity = 0; return; }
      l.position.set(r.x, r.y + 0.4, r.z);
      l.intensity = (night ? 260 : 120) * flick * (0.9 + 0.1 * Math.sin(this.t * 31 + k));
    });
    this.neon.uniforms.uTime.value = this.t;
    this.neon.uniforms.uBright.value = night ? 1.6 : 2.2;
    const map = this.padMat.map;
    if (map) map.offset.y = (map.offset.y - dt * 1.6) % 1;
    this.fun.boxes.forEach((b, k) => {
      const m = this.boxes[k];
      m.visible = b.respawn <= 0;
      m.rotation.set(this.t * 0.7 + k, this.t * 1.3, 0);
      m.position.y = b.y + 1.2 + Math.sin(this.t * 2 + k) * 0.2;
    });
    // oil slicks: new ones appear, old ones go
    for (const o of this.fun.dropped) {
      const m = new THREE.Mesh(this.oilGeo, this.oilMat);
      m.position.set(o.x, o.y + 0.04, o.z); m.receiveShadow = true;
      this.group.add(m); this.oils.set(o, m);
    }
    this.fun.dropped.length = 0;
    for (const [o, m] of this.oils) if (!this.fun.oils.includes(o)) { this.group.remove(m); this.oils.delete(o); }
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.group.clear();
  }
}

/** one ring of fire on its own, for anything outside Fun Mode's track layout (such as a ring in
 *  the sky): the hoop lies in the group's local XY plane facing +z and its flames rise along
 *  local +y. Position and turn `group` as you like; call update every frame */
export class FireRing {
  readonly group = new THREE.Group();
  private fire: THREE.ShaderMaterial; private smoke: THREE.ShaderMaterial; private glow: THREE.MeshBasicMaterial;
  private parts: { dispose(): void }[] = [];
  private t = 0;

  constructor(readonly radius = 3.5, quality: Quality = 'high') {
    const density = quality === 'high' || quality === 'ultra' ? 1 : 0.5;
    this.fire = fireMaterial();
    this.smoke = new THREE.ShaderMaterial({ vertexShader: SMOKE_VERT, fragmentShader: SMOKE_FRAG, transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uScale: { value: 400 }, uColor: { value: new THREE.Color(0x3a3532) } } });
    this.glow = new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const ring: Ring = { kind: 'ramp', s: 0, d: 0, r: radius, x: 0, y: 0, z: 0, floor: -1e6, nx: 0, nz: 1, rx: 1, rz: 0, poles: 0 };
    const pipe = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.09, 10, 96), new THREE.MeshStandardMaterial({ color: 0x1a1a1b, roughness: 0.8, metalness: 0.4 }));
    const core = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.2, 8, 96), this.glow);
    const { fire, smoke } = ringParticles([ring], density);
    const fp = new THREE.Points(fire, this.fire), sp = new THREE.Points(smoke, this.smoke);
    fp.frustumCulled = sp.frustumCulled = false; fp.renderOrder = 4; sp.renderOrder = 3;
    this.group.add(pipe, core, sp, fp);
    this.parts.push(pipe.geometry, pipe.material as THREE.Material, core.geometry, fire, smoke, this.fire, this.smoke, this.glow);
  }

  update(dt: number, cam: THREE.PerspectiveCamera, viewportHeight: number, night = false) {
    this.t += dt;
    const scale = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    for (const m of [this.fire, this.smoke]) { m.uniforms.uTime.value = this.t; m.uniforms.uScale.value = scale; }
    this.fire.uniforms.uBright.value = night ? 1.6 : 2.6;
    this.glow.opacity = 0.75 * (0.82 + 0.18 * Math.sin(this.t * 23) * Math.sin(this.t * 7.3 + 1));
  }

  dispose() { for (const p of this.parts) p.dispose(); this.group.clear(); }
}
