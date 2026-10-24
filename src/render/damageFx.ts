// What flies off in a crash: shards of bodywork in the car's paint (with bits of black trim and
// lens) that tumble, bounce and settle on the road, a shower of sparks from the hit, and smoke
// from a badly damaged car. One shared pool of each for every car.
import * as THREE from 'three';
import { Vapour } from './vapour';

const SHARDS = 160, SPARKS = 600;

const SPARK_VERT = /* glsl */`
attribute float size;
attribute float heat;
varying float vHeat;
uniform float uScale;
void main() {
  vHeat = heat;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const SPARK_FRAG = /* glsl */`
varying float vHeat;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  if (r > 1.0) discard;
  // white-hot core cooling to orange, then dull red
  vec3 col = mix(vec3(1.0, 0.25, 0.05), vec3(1.0, 0.9, 0.6), vHeat);
  gl_FragColor = vec4(col * (1.0 - r) * (0.4 + 1.6 * vHeat), 1.0);
}`;

interface Shard { p: THREE.Vector3; v: THREE.Vector3; axis: THREE.Vector3; spin: number; angle: number; life: number; age: number; size: number; ground: number }

export class DamageFx {
  readonly group = new THREE.Group();
  private shards: THREE.InstancedMesh;
  private shard: Shard[] = [];
  private nextShard = 0;
  private sparks: THREE.Points;
  private sp = { pos: new Float32Array(SPARKS * 3), vel: new Float32Array(SPARKS * 3), size: new Float32Array(SPARKS), heat: new Float32Array(SPARKS), life: new Float32Array(SPARKS), age: new Float32Array(SPARKS) };
  private nextSpark = 0;
  private sparkMat: THREE.ShaderMaterial;
  /** dark smoke from damaged cars */
  readonly smoke = new Vapour();
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private s = new THREE.Vector3(); private c = new THREE.Color();

  constructor() {
    // a jagged little flake of panel: a flattened, uneven tetrahedron
    const g = new THREE.TetrahedronGeometry(1, 0);
    g.scale(1, 0.18, 0.7);
    this.shards = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.4 }), SHARDS);
    this.shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shards.castShadow = true;
    this.shards.frustumCulled = false;
    for (let k = 0; k < SHARDS; k++) {
      this.shard.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), axis: new THREE.Vector3(0, 1, 0), spin: 0, angle: 0, life: 0, age: 0, size: 0, ground: 0 });
      this.shards.setMatrixAt(k, this.m.makeScale(0, 0, 0));
      this.shards.setColorAt(k, this.c.set(0xffffff));
    }

    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.sp.pos, 3).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('size', new THREE.BufferAttribute(this.sp.size, 1).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('heat', new THREE.BufferAttribute(this.sp.heat, 1).setUsage(THREE.DynamicDrawUsage));
    this.sparkMat = new THREE.ShaderMaterial({ vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uScale: { value: 400 } } });
    this.sparks = new THREE.Points(sg, this.sparkMat);
    this.sparks.frustumCulled = false;
    this.sparks.renderOrder = 3;
    this.smoke.setColor(0x2b2c2e);
    this.group.add(this.shards, this.sparks, this.smoke.points);
  }

  /** a crash at `at` (world): `out` points away from the car, `vel` is the car's velocity,
   *  `amount` the damage done (0..1), `ground` the road height there */
  crash(at: THREE.Vector3, out: THREE.Vector3, vel: { x: number; y: number; z: number }, amount: number, paint: THREE.Color, ground: number) {
    const n = Math.round(3 + Math.min(1, amount) * 26);
    for (let k = 0; k < n; k++) {
      const i = this.nextShard;
      this.nextShard = (i + 1) % SHARDS;
      const s = this.shard[i];
      const sp = 2 + Math.random() * 6;
      s.p.copy(at).add(this.s.set((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.6));
      s.v.set(vel.x * 0.55 + out.x * sp + (Math.random() - 0.5) * 3, 1.5 + Math.random() * 4.5, vel.z * 0.55 + out.z * sp + (Math.random() - 0.5) * 3);
      s.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      s.spin = 6 + Math.random() * 14; s.angle = Math.random() * 6;
      s.size = 0.04 + Math.random() * (0.06 + amount * 0.1);
      s.life = 6 + Math.random() * 4; s.age = 0; s.ground = ground;
      // mostly paint, then black trim, the odd bit of lens or carbon
      const r = Math.random();
      this.c.copy(paint);
      if (r > 0.88) this.c.set(0xff2a1a); else if (r > 0.8) this.c.set(0xdfe8f0); else if (r > 0.6) this.c.set(0x0d0e10);
      this.shards.setColorAt(i, this.c);
    }
    if (this.shards.instanceColor) this.shards.instanceColor.needsUpdate = true;
    this.spark(at, out, vel, 20 + Math.round(Math.min(1, amount) * 90));
  }

  /** a shower of sparks */
  spark(at: THREE.Vector3, out: THREE.Vector3, vel: { x: number; y: number; z: number }, n: number) {
    const P = this.sp;
    for (let k = 0; k < n; k++) {
      const i = this.nextSpark; this.nextSpark = (this.nextSpark + 1) % SPARKS;
      const sp = 3 + Math.random() * 9;
      P.pos.set([at.x, at.y, at.z], i * 3);
      P.vel.set([vel.x * 0.7 + out.x * sp + (Math.random() - 0.5) * 6, 1 + Math.random() * 5, vel.z * 0.7 + out.z * sp + (Math.random() - 0.5) * 6], i * 3);
      P.size[i] = 0.05 + Math.random() * 0.06; P.heat[i] = 1;
      P.life[i] = 0.25 + Math.random() * 0.45; P.age[i] = 0;
    }
  }

  /** smoke from a damaged car (root: the car's model, `worst`: its worst damage 0..1) */
  smokeFrom(root: THREE.Object3D, worst: number, vel: { x: number; y: number; z: number }, dt: number) {
    if (worst < 0.45) return;
    const rate = (worst - 0.4) * 50;
    if (Math.random() > rate * dt) return;
    this.s.set((Math.random() - 0.5) * 0.8, 0.45, 1.0 + Math.random() * 0.6).applyMatrix4(root.matrixWorld);
    this.smoke.emit(this.s.x, this.s.y, this.s.z, vel.x * 0.35, 1.2 + Math.random(), vel.z * 0.35, 0.4 + worst * 0.5, 1.4 + worst * 1.2, 0.5);
  }

  update(dt: number, cam: THREE.PerspectiveCamera, viewportHeight: number) {
    // shards: tumble, fall, bounce off the road and come to rest, then shrink away
    let live = false;
    for (let k = 0; k < SHARDS; k++) {
      const s = this.shard[k];
      if (s.life <= 0) continue;
      live = true;
      s.age += dt;
      if (s.age >= s.life) { s.life = 0; this.shards.setMatrixAt(k, this.m.makeScale(0, 0, 0)); continue; }
      const resting = s.p.y <= s.ground + 0.02 && Math.abs(s.v.y) < 0.4;
      if (!resting) {
        s.v.y -= 9.81 * dt;
        s.p.addScaledVector(s.v, dt);
        s.angle += s.spin * dt;
        if (s.p.y < s.ground + 0.02) {
          s.p.y = s.ground + 0.02; s.v.y = -s.v.y * 0.3; s.v.x *= 0.55; s.v.z *= 0.55; s.spin *= 0.5;
        }
      }
      const fade = Math.min(1, (s.life - s.age) / 0.8);
      this.q.setFromAxisAngle(s.axis, s.angle);
      this.m.compose(s.p, this.q, this.s.setScalar(s.size * fade));
      this.shards.setMatrixAt(k, this.m);
    }
    if (live) this.shards.instanceMatrix.needsUpdate = true;

    const P = this.sp;
    this.sparkMat.uniforms.uScale.value = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    for (let i = 0; i < SPARKS; i++) {
      if (P.life[i] <= 0) continue;
      P.age[i] += dt;
      const t = P.age[i] / P.life[i];
      if (t >= 1) { P.life[i] = 0; P.size[i] = 0; continue; }
      P.vel[i * 3 + 1] -= 9.81 * dt;
      for (let a = 0; a < 3; a++) P.pos[i * 3 + a] += P.vel[i * 3 + a] * dt;
      P.heat[i] = 1 - t;
    }
    const g = this.sparks.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.size.needsUpdate = true; g.attributes.heat.needsUpdate = true;
    this.smoke.update(dt, cam, viewportHeight);
  }

  clear() {
    for (let k = 0; k < SHARDS; k++) { this.shard[k].life = 0; this.shards.setMatrixAt(k, this.m.makeScale(0, 0, 0)); }
    this.shards.instanceMatrix.needsUpdate = true;
    this.sp.life.fill(0); this.sp.size.fill(0);
    this.smoke.clear();
  }
}
