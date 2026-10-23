// Height grid around the circuit. The road and its run-off are flat across and follow the
// track's elevation; beyond that the ground blends into rolling hills and a ring of mountains.
// The same grid feeds the Rapier heightfield and the rendered landscape.
import type { Track } from './track';

function hash(x: number, y: number) {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
function noise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
export function fbm(x: number, y: number, oct = 4) {
  let v = 0, amp = 0.5, f = 1;
  for (let o = 0; o < oct; o++) { v += amp * noise(x * f, y * f); f *= 2.03; amp *= 0.5; }
  return v / (1 - 0.5 ** oct);
}
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** flat zone (road + run-off + barriers) and the distance over which it blends into hills */
const FLAT = 19, BLEND = 55, REACH = FLAT + BLEND + 6;

export class Terrain {
  readonly cell: number;
  readonly nx: number; readonly nz: number;
  readonly x0: number; readonly z0: number;
  /** row-major: heights[iz * nx + ix] */
  readonly heights: Float32Array;
  /** distance from the nearest centreline, for scenery placement */
  readonly dist: Float32Array;

  constructor(track: Track, cell = 2, margin = 520) {
    this.cell = cell;
    this.x0 = Math.floor((track.minX - margin) / cell) * cell;
    this.z0 = Math.floor((track.minZ - margin) / cell) * cell;
    this.nx = Math.ceil((track.maxX + margin - this.x0) / cell) + 1;
    this.nz = Math.ceil((track.maxZ + margin - this.z0) / cell) + 1;
    const N = this.nx * this.nz;
    const dist = (this.dist = new Float32Array(N).fill(1e9));
    const sNear = new Float32Array(N);

    // rasterise the distance to the centreline around every sample (much cheaper than a global search)
    const r = Math.ceil(REACH / cell);
    for (let i = 0; i < track.n; i++) {
      const cx = track.px[i], cz = track.pz[i], tx = track.tx[i], tz = track.tz[i];
      const gx = Math.round((cx - this.x0) / cell), gz = Math.round((cz - this.z0) / cell);
      for (let dz = -r; dz <= r; dz++) {
        const iz = gz + dz; if (iz < 0 || iz >= this.nz) continue;
        for (let dx = -r; dx <= r; dx++) {
          const ix = gx + dx; if (ix < 0 || ix >= this.nx) continue;
          const wx = this.x0 + ix * cell - cx, wz = this.z0 + iz * cell - cz;
          const along = wx * tx + wz * tz, lat = -wx * tz + wz * tx;
          const d = Math.hypot(lat, Math.max(0, Math.abs(along) - 1));
          const k = iz * this.nx + ix;
          if (d < dist[k]) { dist[k] = d; sNear[k] = track.s[i] + along; }
        }
      }
    }

    const heights = (this.heights = new Float32Array(N));
    const cxm = (track.minX + track.maxX) / 2, czm = (track.minZ + track.maxZ) / 2;
    const rx = (track.maxX - track.minX) / 2 + 140, rz = (track.maxZ - track.minZ) / 2 + 140;
    for (let iz = 0; iz < this.nz; iz++) for (let ix = 0; ix < this.nx; ix++) {
      const k = iz * this.nx + ix;
      const x = this.x0 + ix * cell, z = this.z0 + iz * cell;
      // rolling meadow near the circuit, mountains rising towards the edge of the map
      const edge = Math.hypot((x - cxm) / rx, (z - czm) / rz);
      const hills = (fbm(x / 160, z / 160) - 0.5) * 9 + 1.5;
      const mountains = smooth(1.0, 1.7, edge) * (40 + 120 * fbm(x / 260 + 7, z / 260 - 3, 5));
      const natural = hills + mountains;
      const d = dist[k];
      heights[k] = d >= REACH ? natural : track.elevation(sNear[k]) + (natural - track.elevation(sNear[k])) * smooth(FLAT, FLAT + BLEND, d);
    }
  }

  /** bilinear height (scenery placement; physics uses Rapier's triangulation of the same grid) */
  heightAt(x: number, z: number) {
    const fx = Math.min(this.nx - 1.001, Math.max(0, (x - this.x0) / this.cell));
    const fz = Math.min(this.nz - 1.001, Math.max(0, (z - this.z0) / this.cell));
    const ix = Math.floor(fx), iz = Math.floor(fz), u = fx - ix, v = fz - iz;
    const h = this.heights, n = this.nx, k = iz * n + ix;
    return (h[k] * (1 - u) + h[k + 1] * u) * (1 - v) + (h[k + n] * (1 - u) + h[k + n + 1] * u) * v;
  }

  distAt(x: number, z: number) {
    const ix = Math.round((x - this.x0) / this.cell), iz = Math.round((z - this.z0) / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return 1e9;
    return this.dist[iz * this.nx + ix];
  }

  get width() { return (this.nx - 1) * this.cell; }
  get depth() { return (this.nz - 1) * this.cell; }
}
