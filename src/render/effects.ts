// Particle effects for the realism pass and Fun Mode: sparks (hot, additive, falling under
// gravity) for scraping landings, wall hits and embers out of the rings of fire, and smoke puffs
// with their own colour (tyre smoke when a tyre slides, dust kicked up off the grass).
import * as THREE from 'three';

const VERT = /* glsl */`
attribute float size;
attribute vec4 tint;
varying vec4 vTint;
uniform float uScale;
void main() {
  vTint = tint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const SPARK_FRAG = /* glsl */`
varying vec4 vTint;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  if (r > 1.0) discard;
  float a = pow(1.0 - r, 2.0) * vTint.a;
  gl_FragColor = vec4(vTint.rgb * a, a);
}`;
const SMOKE_FRAG = /* glsl */`
varying vec4 vTint;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  if (r > 1.0) discard;
  float shade = 0.85 + 0.15 * (0.5 - c.y);
  gl_FragColor = vec4(vTint.rgb * shade, (1.0 - r * r) * vTint.a);
}`;

/** a pool of points, each with a velocity, size, colour and life */
class Pool {
  readonly points: THREE.Points;
  protected pos: Float32Array; protected vel: Float32Array; protected size: Float32Array; protected tint: Float32Array;
  protected life: Float32Array; protected age: Float32Array; protected base: Float32Array; protected grow: Float32Array;
  private next = 0;
  private mat: THREE.ShaderMaterial;

  constructor(private max: number, frag: string, additive: boolean, private gravity: number, private drag: number) {
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.size = new Float32Array(max);
    this.tint = new Float32Array(max * 4); this.life = new Float32Array(max); this.age = new Float32Array(max);
    this.base = new Float32Array(max * 4); this.grow = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('tint', new THREE.BufferAttribute(this.tint, 4).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: frag, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, uniforms: { uScale: { value: 400 } },
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, r: number, g: number, b: number, a: number, grow = 0) {
    const k = this.next++ % this.max;
    this.pos.set([x, y, z], k * 3); this.vel.set([vx, vy, vz], k * 3);
    this.size[k] = size; this.grow[k] = grow; this.life[k] = life; this.age[k] = 0;
    this.base.set([r, g, b, a], k * 4); this.tint.set([r, g, b, a], k * 4);
  }

  update(dt: number, cam: THREE.PerspectiveCamera, viewportHeight: number) {
    this.mat.uniforms.uScale.value = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    const drag = Math.exp(-dt * this.drag);
    let live = 0;
    for (let k = 0; k < this.max; k++) {
      if (this.life[k] <= 0) continue;
      this.age[k] += dt;
      const t = this.age[k] / this.life[k];
      if (t >= 1) { this.life[k] = 0; this.size[k] = 0; continue; }
      live++;
      const i = k * 3;
      this.vel[i] *= drag; this.vel[i + 1] = this.vel[i + 1] * drag - this.gravity * dt; this.vel[i + 2] *= drag;
      this.pos[i] += this.vel[i] * dt; this.pos[i + 1] += this.vel[i + 1] * dt; this.pos[i + 2] += this.vel[i + 2] * dt;
      this.size[k] += this.grow[k] * dt;
      this.fade(k, t);
    }
    const g = this.points.geometry;
    if (live || this.dirty) { g.attributes.position.needsUpdate = true; g.attributes.size.needsUpdate = true; g.attributes.tint.needsUpdate = true; }
    this.dirty = live > 0;
  }
  private dirty = false;

  protected fade(k: number, t: number) { this.tint[k * 4 + 3] = this.base[k * 4 + 3] * (1 - t) * (1 - t); }

  clear() { this.life.fill(0); this.size.fill(0); }
}

/** sparks: white-hot when they fly off, cooling to orange and red as they fall */
export class Sparks extends Pool {
  constructor() { super(900, SPARK_FRAG, true, 9.81, 1.2); }

  protected fade(k: number, t: number) {
    const b = this.base, i = k * 4;
    const cool = Math.min(1, t * 1.6);
    this.tint[i] = b[i]; this.tint[i + 1] = b[i + 1] * (1 - cool * 0.7); this.tint[i + 2] = b[i + 2] * (1 - cool);
    this.tint[i + 3] = b[i + 3] * (1 - t);
  }

  /** a spray of n sparks from a point, thrown along (dx, dy, dz) with some spread */
  burst(x: number, y: number, z: number, dx: number, dy: number, dz: number, n: number, speed: number, spread = 0.6, hot = 3) {
    for (let k = 0; k < n; k++) {
      const s = speed * (0.4 + Math.random() * 0.8);
      const j = () => (Math.random() - 0.5) * 2 * spread * speed;
      this.emit(x, y, z, dx * s + j(), dy * s + j() + Math.random() * speed * 0.2, dz * s + j(), 0.05 + Math.random() * 0.06, 0.25 + Math.random() * 0.5,
        hot, hot * 0.75, hot * 0.4, 1);
    }
  }
}

/** smoke and dust: soft puffs that billow, grow and fade */
export class Smoke extends Pool {
  constructor() { super(1600, SMOKE_FRAG, false, -0.25, 2.2); }

  puff(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, color: THREE.Color, alpha: number) {
    this.emit(x, y, z, vx, vy, vz, size, life, color.r, color.g, color.b, alpha, size * 1.8);
  }
}
