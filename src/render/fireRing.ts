// A ring of fire: a glowing burner hoop with flames licking up all the way round it. The hoop
// lies in the group's local XY plane facing +z, and the flames rise along local +y. Flames are
// camera-facing quads drawn with an animated noise shader (additive, so they glow under bloom).
// No lights of its own: adding lights at run time recompiles every material in the scene.
import * as THREE from 'three';
import type { Quality } from './graphics';

const VERT = /* glsl */`
attribute vec2 corner;
attribute float seed;
uniform float uHeight;
uniform float uWidth;
uniform float uBoost;
varying vec2 vUv;
varying float vSeed;
void main() {
  vUv = corner;
  vSeed = seed;
  vec4 c = modelViewMatrix * vec4(position, 1.0);
  // a cylindrical billboard: tall along the ring's up axis, wide across the view
  vec3 upV = normalize((modelViewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  vec3 rightV = normalize(cross(upV, vec3(0.0, 0.0, 1.0)));
  float h = uHeight * (0.7 + 0.6 * fract(seed * 7.13)) * uBoost;
  c.xyz += rightV * corner.x * uWidth + upV * (corner.y * h - 0.15);
  gl_Position = projectionMatrix * c;
}`;

const FRAG = /* glsl */`
uniform float uTime;
uniform float uBoost;
varying vec2 vUv;
varying float vSeed;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float y = vUv.y, x = vUv.x;
  vec2 q = vec2(x * 2.2 + vSeed * 13.0, y * 2.6 - uTime * 3.4 + vSeed * 5.0);
  float n = noise(q) * 0.6 + noise(q * 2.3 + 4.0) * 0.4;
  // a tongue of flame: wide at the base, narrowing and breaking up towards the tip
  float width = (1.0 - y) * (0.75 + 0.5 * n);
  float a = smoothstep(width, width * 0.35, abs(x)) * smoothstep(1.0, 0.25 + 0.4 * n, y) * smoothstep(0.0, 0.08, y);
  vec3 hot = vec3(1.0, 0.92, 0.6), mid = vec3(1.0, 0.45, 0.06), tip = vec3(0.7, 0.08, 0.02);
  vec3 col = mix(hot, mid, smoothstep(0.05, 0.45, y + n * 0.2));
  col = mix(col, tip, smoothstep(0.45, 0.95, y + n * 0.15));
  gl_FragColor = vec4(col * a * (1.1 + 0.6 * uBoost), 1.0);
}`;

export class FireRing {
  readonly group = new THREE.Group();
  private mat: THREE.ShaderMaterial;
  private hoopMat: THREE.MeshStandardMaterial;
  private time = Math.random() * 10;
  /** a burst of extra flame (1 = normal): flare() sets it, it settles back */
  private boost = 1;

  constructor(readonly radius: number, quality: Quality = 'high') {
    this.hoopMat = new THREE.MeshStandardMaterial({ color: 0x2a2624, metalness: 0.7, roughness: 0.45, emissive: 0xff5a10, emissiveIntensity: 0.9 });
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.16, 12, 72), this.hoopMat);
    this.group.add(hoop);
    // burner nozzles round the outside of the hoop
    const nozzle = new THREE.CylinderGeometry(0.06, 0.08, 0.22, 8);
    const nm = new THREE.MeshStandardMaterial({ color: 0x55504a, metalness: 0.8, roughness: 0.35 });
    const N = quality === 'low' ? 36 : 64;
    const nozzles = new THREE.InstancedMesh(nozzle, nm, N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), a - Math.PI / 2);
      m.compose(new THREE.Vector3(Math.cos(a) * (radius + 0.2), Math.sin(a) * (radius + 0.2), 0), q, new THREE.Vector3(1, 1, 1));
      nozzles.setMatrixAt(k, m);
    }
    this.group.add(nozzles);

    // flames: two quads per burner, staggered, so the ring reads as a solid wall of fire
    const F = N * 2;
    const pos = new Float32Array(F * 4 * 3), corner = new Float32Array(F * 4 * 2), seed = new Float32Array(F * 4);
    const idx: number[] = [];
    for (let k = 0; k < F; k++) {
      const a = (k / F) * Math.PI * 2, r = radius + 0.12 + (k % 2) * 0.1;
      const s = Math.random();
      for (let v = 0; v < 4; v++) {
        const j = k * 4 + v;
        pos.set([Math.cos(a) * r, Math.sin(a) * r, (k % 2 ? 0.08 : -0.08)], j * 3);
        corner.set([v % 2 ? 1 : -1, v < 2 ? 0 : 1], j * 2);
        seed[j] = s;
      }
      const b = k * 4;
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('corner', new THREE.BufferAttribute(corner, 2));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius + 3);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uHeight: { value: 1.25 }, uWidth: { value: 0.42 }, uBoost: { value: 1 } },
    });
    const flames = new THREE.Mesh(g, this.mat);
    flames.renderOrder = 4;
    this.group.add(flames);
  }

  /** a whoosh of flame, as something flies through */
  flare() { this.boost = 2.2; }

  update(dt: number, _camera?: THREE.Camera, _viewportHeight?: number) {
    this.time += dt;
    this.boost += (1 - this.boost) * Math.min(1, dt * 2.5);
    this.mat.uniforms.uTime.value = this.time;
    this.mat.uniforms.uBoost.value = this.boost;
    this.hoopMat.emissiveIntensity = 0.75 + 0.25 * Math.sin(this.time * 17) * Math.sin(this.time * 5.3) + (this.boost - 1) * 0.8;
  }

  dispose() {
    this.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.geometry.dispose(); (Array.isArray(m.material) ? m.material : [m.material]).forEach(x => x.dispose()); }
    });
  }
}
