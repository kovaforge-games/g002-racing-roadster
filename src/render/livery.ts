// Liveries for the garage: patterns (racing stripes, a side stripe, a two-tone roof and hot-rod
// flames), a second colour, the race number in a roundel on the doors and the bonnet, and soot
// after brushing a ring of fire. Everything is drawn in the paint's shader from the body's own
// (object-space) position and normal, so it needs no UVs and follows any body shape. Each car
// model patches its own paint material; copies of a model call setLivery again to get their own.
import * as THREE from 'three';

export type Pattern = 'solid' | 'stripes' | 'side' | 'twotone' | 'flames';
export const PATTERNS: [Pattern, string][] = [['solid', 'Solid'], ['stripes', 'Racing stripes'], ['side', 'Side stripe'], ['twotone', 'Two-tone'], ['flames', 'Flames']];
const PATTERN_ID: Record<Pattern, number> = { solid: 0, stripes: 1, side: 2, twotone: 3, flames: 4 };

export interface LiveryConfig {
  pattern: Pattern;
  /** the second colour (stripes, the roof, the flames' outline) */
  second: number;
  /** race number in a roundel, or null for none */
  number: number | null;
}

/** where things go on a body, in its build frame (y up from the road, +z forward, +x left) */
export interface LiveryShape {
  front: number; rear: number;
  /** racing stripes: distance of each stripe's inner and outer edge from the centre line */
  stripe: [number, number];
  /** side stripe: its centre height at the nose and the tail, and its half height */
  side: [number, number, number];
  /** two-tone split height at the nose and the tail */
  split: [number, number];
  /** flames: bottom and top of the band they fill on the sides, and the half width on top */
  flames: [number, number, number];
  /** door roundel (z, y, size) and bonnet roundel (z, size); null for none */
  door: [number, number, number] | null;
  hood: [number, number] | null;
}

export const ROADSTER_SHAPE: LiveryShape = {
  front: 2.2, rear: -2.2, stripe: [0.09, 0.27], side: [0.47, 0.6, 0.035], split: [0.71, 0.9], flames: [0.32, 0.86, 0.95],
  door: [0.04, 0.52, 0.46], hood: [1.42, 0.5],
};
export const OPEN_WHEEL_SHAPE: LiveryShape = {
  front: 2.62, rear: -2.05, stripe: [0.03, 0.09], side: [0.36, 0.42, 0.03], split: [0.42, 0.52], flames: [0.2, 0.62, 0.4],
  door: null, hood: null,
};

/** the number in a white roundel with a black ring, for the shader to sample */
function roundel(n: number) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = '#f7f7f4'; x.beginPath(); x.arc(128, 128, 120, 0, Math.PI * 2); x.fill();
  x.strokeStyle = '#111'; x.lineWidth = 10; x.beginPath(); x.arc(128, 128, 112, 0, Math.PI * 2); x.stroke();
  x.fillStyle = '#0d0d0f'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = `900 ${n > 9 ? 138 : 160}px system-ui, -apple-system, Segoe UI, sans-serif`;
  x.fillText(String(n), 128, 138);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

const FRAG = /* glsl */`
{
  vec3 lp = vLivP;
  vec3 ln = normalize(vLivN);
  float ax = abs(lp.x);
  float t = clamp((uLivA.x - lp.z) / (uLivA.x - uLivA.y), 0.0, 1.0);
  vec3 col = diffuseColor.rgb;
  if (uLivPat == 1) {
    // twin racing stripes over the top, nose to tail
    float m = step(uLivA.z, ax) * step(ax, uLivA.w) * step(0.25, ln.y + abs(ln.z));
    col = mix(col, uLivSecond, m);
  } else if (uLivPat == 2) {
    float yc = mix(uLivB.x, uLivB.y, t);
    float m = step(0.35, abs(ln.x)) * (1.0 - smoothstep(uLivB.z - 0.004, uLivB.z + 0.004, abs(lp.y - yc)));
    col = mix(col, uLivSecond, m);
  } else if (uLivPat == 3) {
    float ys = mix(uLivB.w, uLivC.w, t);
    col = mix(col, uLivSecond, smoothstep(ys - 0.006, ys + 0.006, lp.y));
  } else if (uLivPat == 4) {
    // hot-rod flames licking back from the nose: on the flanks across the side band, on top
    // across the bonnet from the centre line out
    float v = abs(ln.x) > 0.45 ? (lp.y - uLivC.x) / (uLivC.y - uLivC.x) : ax / uLivC.z;
    float fill = 0.0, edge = 0.0;
    for (int k = 0; k < 5; k++) {
      float fk = float(k);
      float len = 0.34 + 0.09 * mod(fk * 3.0, 5.0);
      float tt = t / len;
      if (tt >= 1.0) continue;
      float w = 0.115 * pow(1.0 - tt, 0.75);
      float yc = 0.12 + fk * 0.19 + 0.07 * sin(tt * 6.3 + fk * 1.9) * tt;
      float d = abs(v - yc);
      fill = max(fill, 1.0 - smoothstep(w - 0.01, w, d));
      edge = max(edge, 1.0 - smoothstep(w + 0.018, w + 0.026, d));
    }
    if (v < 0.0 || v > 1.05) { fill = 0.0; edge = 0.0; }
    vec3 fire = mix(vec3(1.0, 0.86, 0.12), vec3(0.92, 0.12, 0.02), clamp(t / 0.55, 0.0, 1.0));
    col = mix(col, uLivSecond, edge);
    col = mix(col, fire, fill);
  }
  // race number roundels on the doors (read from either side) and on the bonnet
  if (uLivDoor.w > 0.5 && abs(ln.x) > 0.55) {
    vec2 uv = vec2((lp.z - uLivDoor.x) * (lp.x > 0.0 ? -1.0 : 1.0), lp.y - uLivDoor.y) / uLivDoor.z + 0.5;
    if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) { vec4 n = texture2D(uLivNum, uv); col = mix(col, n.rgb, n.a); }
  }
  if (uLivHood.w > 0.5 && ln.y > 0.6) {
    vec2 uv = vec2(lp.x, uLivHood.x - lp.z) / uLivHood.y + 0.5;
    if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) { vec4 n = texture2D(uLivNum, uv); col = mix(col, n.rgb, n.a); }
  }
  // soot from the flames: dark and blotchy
  if (uLivSoot > 0.001) {
    float blot = fract(sin(dot(floor(lp * 14.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    col *= 1.0 - uLivSoot * (0.55 + 0.35 * blot);
  }
  diffuseColor.rgb = col;
}
`;

export class Livery {
  readonly uniforms = {
    uLivPat: { value: 0 }, uLivSecond: { value: new THREE.Color(0xffffff) },
    uLivA: { value: new THREE.Vector4() }, uLivB: { value: new THREE.Vector4() }, uLivC: { value: new THREE.Vector4() },
    uLivDoor: { value: new THREE.Vector4() }, uLivHood: { value: new THREE.Vector4() },
    uLivNum: { value: null as THREE.Texture | null }, uLivSoot: { value: 0 },
  };
  private shownNumber: number | null = null;

  constructor(readonly material: THREE.MeshPhysicalMaterial, private shape: LiveryShape) {
    const s = shape, u = this.uniforms;
    u.uLivA.value.set(s.front, s.rear, s.stripe[0], s.stripe[1]);
    u.uLivB.value.set(s.side[0], s.side[1], s.side[2], s.split[0]);
    u.uLivC.value.set(s.flames[0], s.flames[1], s.flames[2], s.split[1]);
    if (s.door) u.uLivDoor.value.set(s.door[0], s.door[1], s.door[2], 0);
    if (s.hood) u.uLivHood.value.set(s.hood[0], s.hood[1], 0, 0);
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLivP;\nvarying vec3 vLivN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLivP = position;\nvLivN = normal;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vLivP;
varying vec3 vLivN;
uniform int uLivPat;
uniform vec3 uLivSecond;
uniform vec4 uLivA, uLivB, uLivC, uLivDoor, uLivHood;
uniform sampler2D uLivNum;
uniform float uLivSoot;`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG}`);
    };
    material.customProgramCacheKey = () => 'livery-1';
    material.needsUpdate = true;
  }

  set(cfg: LiveryConfig) {
    const u = this.uniforms;
    u.uLivPat.value = PATTERN_ID[cfg.pattern] ?? 0;
    u.uLivSecond.value.setHex(cfg.second);
    const on = cfg.number !== null && !!(this.shape.door || this.shape.hood);
    if (on && cfg.number !== this.shownNumber) {
      u.uLivNum.value?.dispose();
      u.uLivNum.value = roundel(cfg.number!);
      this.shownNumber = cfg.number;
    }
    u.uLivDoor.value.w = on && this.shape.door ? 1 : 0;
    u.uLivHood.value.w = on && this.shape.hood ? 1 : 0;
  }

  set soot(v: number) { this.uniforms.uLivSoot.value = v; }
}

/** paint finishes: how the clear coat and the flakes in the paint look ('factory' keeps the preset's) */
export type Finish = 'factory' | 'gloss' | 'metallic' | 'matte' | 'pearl' | 'chrome';
export const FINISHES: [Finish, string][] = [['factory', 'Factory'], ['gloss', 'Gloss'], ['metallic', 'Metallic'], ['matte', 'Matte'], ['pearl', 'Pearl'], ['chrome', 'Chrome']];

export function applyFinish(m: THREE.MeshPhysicalMaterial, f: Finish) {
  const set: Record<Finish, Partial<THREE.MeshPhysicalMaterial>> = {
    // the preset paint's own metalness and roughness, under a clear coat
    factory: { clearcoat: 1, clearcoatRoughness: 0.06, iridescence: 0 },
    gloss: { metalness: 0.15, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05, iridescence: 0 },
    metallic: { metalness: 0.72, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.06, iridescence: 0 },
    matte: { metalness: 0.08, roughness: 0.72, clearcoat: 0, clearcoatRoughness: 0.5, iridescence: 0 },
    pearl: { metalness: 0.35, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.04, iridescence: 1, iridescenceIOR: 1.35 },
    chrome: { metalness: 1, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.02, iridescence: 0 },
  };
  Object.assign(m, set[f]);
  m.needsUpdate = true;
}
