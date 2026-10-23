// Shader add-ons for the circuit surfaces (ported from g001), injected into MeshStandardMaterial:
//  - large-scale colour variation from world position (breaks up texture tiling)
//  - rubbered racing line on the asphalt (per-vertex lateral position of the line, `rl`)
//  - mowing stripes on grass (only where the vertex colour is green)
import * as THREE from 'three';

const NOISE = `
float sfHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sfNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(sfHash(i), sfHash(i + vec2(1, 0)), f.x), mix(sfHash(i + vec2(0, 1)), sfHash(i + vec2(1, 1)), f.x), f.y);
}
float sfFbm(vec2 p) { return sfNoise(p) * 0.6 + sfNoise(p * 2.7) * 0.3 + sfNoise(p * 7.1) * 0.1; }
`;

export interface SurfaceOpts {
  /** strength of the large-scale variation (0..0.3) */
  vary?: number;
  /** world-space frequency of the variation (1/m) */
  freq?: number;
  /** darken a rubbered racing line using the `rl` attribute (0..1 across the uv.x of the road) */
  rubber?: number;
  /** mowing stripes on green parts (needs vertex colours); value = stripe length in uv.y units */
  mow?: number;
}

export function enhanceSurface(m: THREE.MeshStandardMaterial, o: SurfaceOpts) {
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 sfWP; varying vec2 sfUv;
        ${o.rubber ? 'attribute float rl; varying float sfRl;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        sfWP = (modelMatrix * vec4(transformed, 1.0)).xyz; sfUv = uv;
        ${o.rubber ? 'sfRl = rl;' : ''}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 sfWP; varying vec2 sfUv;
        ${o.rubber ? 'varying float sfRl;' : ''}
        ${NOISE}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          float n = sfFbm(sfWP.xz * ${(o.freq ?? 0.02).toFixed(4)});
          diffuseColor.rgb *= 1.0 + (n - 0.5) * ${(2 * (o.vary ?? 0.12)).toFixed(3)};
          ${o.rubber ? `
          // two dark tyre tracks either side of the line, fading with distance from it
          float dx = sfUv.x - sfRl;
          float rub = exp(-pow(dx / 0.13, 2.0)) * 0.55 + exp(-pow((abs(dx) - 0.07) / 0.03, 2.0)) * 0.45;
          rub *= 0.75 + 0.25 * sfNoise(sfWP.xz * 0.3);
          diffuseColor.rgb *= 1.0 - ${o.rubber.toFixed(3)} * rub;` : ''}
          ${o.mow ? `
          #ifdef USE_COLOR
          if (vColor.g > vColor.r * 1.25 && vColor.g > vColor.b * 1.25) {
            float stripe = step(0.5, fract(sfUv.y / ${o.mow.toFixed(3)}));
            diffuseColor.rgb *= 0.9 + 0.16 * stripe;
          }
          #endif` : ''}
        }`);
  };
  m.customProgramCacheKey = () => `sf:${o.vary}:${o.freq}:${o.rubber}:${o.mow}`;
  return m;
}
