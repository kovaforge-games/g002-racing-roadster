// Thruster effects. The jets vent cold compressed air, so there are no flames: white vapour
// puffs that billow and fade, a faint shimmering cone behind each rear nozzle while boosting,
// and a ring of vapour blasted out under the car on a hop.
import * as THREE from 'three';
import { CAR } from '../sim/car';
import type { Jets } from '../sim/jets';

const MAX = 1400;

const VERT = /* glsl */`
attribute float size;
attribute float alpha;
varying float vAlpha;
uniform float uScale;
void main() {
  vAlpha = alpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */`
varying float vAlpha;
uniform vec3 uColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  if (r > 1.0) discard;
  float a = (1.0 - r * r) * vAlpha;
  // a little shading so puffs read as volume rather than discs
  float shade = 0.82 + 0.18 * (0.5 - c.y);
  gl_FragColor = vec4(uColor * shade, a);
}`;

/** one shared pool of vapour puffs for every car */
export class Vapour {
  readonly points: THREE.Points;
  private pos = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private size = new Float32Array(MAX);
  private grow = new Float32Array(MAX);
  private alpha = new Float32Array(MAX);
  private life = new Float32Array(MAX);
  private age = new Float32Array(MAX);
  private next = 0;
  private mat: THREE.ShaderMaterial;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      uniforms: { uScale: { value: 400 }, uColor: { value: new THREE.Color(0xeef3f8) } },
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  /** puffs are lit roughly like the scene: dimmer at night */
  setNight(night: boolean) { this.mat.uniforms.uColor.value.set(night ? 0x56606e : 0xeef3f8); }

  /** a different colour of puff: dark smoke from a damaged car uses its own pool */
  setColor(hex: number) { this.mat.uniforms.uColor.value.set(hex); }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, alpha = 0.55) {
    const k = this.next++ % MAX;
    this.pos.set([x, y, z], k * 3);
    this.vel.set([vx, vy, vz], k * 3);
    this.size[k] = size; this.grow[k] = size * 2.2;
    this.alpha[k] = alpha; this.life[k] = life; this.age[k] = 0;
  }

  update(dt: number, cam: THREE.PerspectiveCamera, viewportHeight: number) {
    this.mat.uniforms.uScale.value = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    const drag = Math.exp(-dt * 3.2);
    for (let k = 0; k < MAX; k++) {
      if (this.life[k] <= 0) continue;
      this.age[k] += dt;
      const t = this.age[k] / this.life[k];
      if (t >= 1) { this.life[k] = 0; this.size[k] = 0; continue; }
      const i = k * 3;
      this.vel[i] *= drag; this.vel[i + 1] = this.vel[i + 1] * drag + dt * 0.6; this.vel[i + 2] *= drag;
      this.pos[i] += this.vel[i] * dt; this.pos[i + 1] += this.vel[i + 1] * dt; this.pos[i + 2] += this.vel[i + 2] * dt;
      this.size[k] += this.grow[k] * dt;
      this.alpha[k] = 0.55 * (1 - t) * (1 - t);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.size.needsUpdate = true; g.attributes.alpha.needsUpdate = true;
  }

  clear() { this.life.fill(0); this.size.fill(0); }
}

/** rear nozzles in the car's frame (origin at the centre of mass, +z forward, +x left) */
const REAR = [[0.24, 0.26, -2.26], [-0.24, 0.26, -2.26], [0.56, 0.22, -2.2], [-0.56, 0.22, -2.2]];
/** attitude nozzles at the corners, pointing outwards */
const SIDE = [[0.95, 0.15, 1.7, 1, 0, 0], [-0.95, 0.15, 1.7, -1, 0, 0], [0.98, 0.15, -1.7, 1, 0, 0], [-0.98, 0.15, -1.7, -1, 0, 0],
  [0, 0.75, 1.9, 0, 1, 0.3], [0, 0.6, -2.1, 0, 1, -0.3]];

/** per-car thruster effects: shimmering cones on the car, puffs into the shared pool */
export class JetFx {
  private group = new THREE.Group();
  private cones: THREE.Mesh[] = [];
  private mat: THREE.MeshBasicMaterial;
  private emitAcc = 0;
  private v = new THREE.Vector3(); private d = new THREE.Vector3();

  constructor(root: THREE.Object3D, private vapour: Vapour) {
    this.mat = new THREE.MeshBasicMaterial({ color: 0xbfe4ff, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    // a slim cone from the nozzle backwards, bright at the nozzle and fading to nothing (additive
    // blending, so black is invisible); scaled along z by the thrust
    const g = new THREE.CylinderGeometry(0.07, 0.13, 1.5, 16, 4, true).translate(0, -0.75, 0).rotateX(Math.PI / 2);
    const pos = g.getAttribute('position'), col = new Float32Array(pos.count * 3);
    for (let k = 0; k < pos.count; k++) { const f = Math.max(0, 1 + pos.getZ(k) / 1.5) ** 1.6; col.set([f, f, f], k * 3); }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    for (const [x, y, z] of REAR) {
      const m = new THREE.Mesh(g, this.mat);
      m.position.set(x, y, z);
      m.renderOrder = 3;
      this.cones.push(m);
      this.group.add(m);
    }
    this.group.visible = false;
    root.add(this.group);
  }

  /** root must already hold this frame's pose; vel is the car's world velocity; hopped: a hop
   *  fired since the last frame */
  update(jets: Jets, hopped: boolean, root: THREE.Object3D, vel: { x: number; y: number; z: number }, dt: number) {
    const boost = jets.boosting;
    this.group.visible = boost;
    if (boost) {
      const flick = 0.85 + Math.random() * 0.3;
      this.mat.opacity = 0.55 * flick;
      for (const c of this.cones) c.scale.set(1, 1, 1.3 * flick);
    }
    root.updateMatrixWorld();
    const m = root.matrixWorld;
    const puff = (lx: number, ly: number, lz: number, dx: number, dy: number, dz: number, speed: number, size: number, life: number, alpha?: number) => {
      this.v.set(lx, ly, lz).applyMatrix4(m);
      this.d.set(dx, dy, dz).transformDirection(m);
      const j = () => (Math.random() - 0.5) * speed * 0.25;
      this.vapour.emit(this.v.x, this.v.y, this.v.z,
        vel.x * 0.6 + this.d.x * speed + j(), vel.y * 0.6 + this.d.y * speed + j(), vel.z * 0.6 + this.d.z * speed + j(), size, life, alpha);
    };
    // a steady stream while boosting (rate-limited so frame rate doesn't change the density)
    if (boost) {
      this.emitAcc += dt * 90;
      while (this.emitAcc >= 1) {
        this.emitAcc--;
        const n = REAR[(Math.random() * 4) | 0];
        puff(n[0], n[1], n[2] - 0.6, 0, 0, -1, 9, 0.35, 0.55);
      }
    } else this.emitAcc = 0;
    if (hopped) {
      // a ring of vapour blasted out sideways from under the car
      for (let k = 0; k < 46; k++) {
        const a = (k / 46) * Math.PI * 2;
        const lx = Math.sin(a) * 0.9, lz = Math.cos(a) * 1.9;
        puff(lx, -CAR.comHeight + 0.15, lz, Math.sin(a), -0.2, Math.cos(a) * 0.6, 11 + Math.random() * 4, 0.7, 0.9, 0.6);
      }
    }
    if (jets.attitude > 0.05 && Math.random() < jets.attitude * dt * 40) {
      const n = SIDE[(Math.random() * SIDE.length) | 0];
      puff(n[0], n[1], n[2], n[3], n[4], n[5], 6, 0.25, 0.4, 0.45);
    }
  }
}
