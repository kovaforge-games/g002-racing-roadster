// The circuit: a closed Catmull-Rom centreline resampled every 2 m, with synthesised elevation.
// Everything here is plain math so the headless handling test can use it without a renderer.
import * as THREE from 'three';

export const ROAD_HALF_WIDTH = 6.5;
/** lateral distance from the centreline to the face of the barriers */
export const WALL_OFFSET = 15;
const SPACING = 2;

/** control points (x, z) in metres, driven in this order */
const LAYOUT: [number, number][] = [
  [-260, -170], [-60, -178], [140, -176], [270, -168], [338, -130], [352, -62],
  [318, -8], [232, 14], [170, 52], [168, 118], [216, 168], [300, 196], [372, 246],
  [372, 318], [300, 352], [196, 334], [96, 282], [10, 296], [-70, 268], [-112, 196],
  [-170, 150], [-252, 176], [-330, 160], [-382, 96], [-392, 6], [-368, -100],
];

export class Track {
  readonly n: number;
  readonly total: number;
  readonly px: Float64Array; readonly py: Float64Array; readonly pz: Float64Array;
  /** horizontal unit tangent */
  readonly tx: Float64Array; readonly tz: Float64Array;
  /** signed curvature (1/m), positive = turning left */
  readonly curv: Float64Array;
  /** arc length at each sample */
  readonly s: Float64Array;
  /** kerbs on both edges through the corners */
  readonly kerb: boolean[];
  readonly halfWidth = ROAD_HALF_WIDTH;
  readonly wallOffset = WALL_OFFSET;
  readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number;

  constructor() {
    const curve = new THREE.CatmullRomCurve3(LAYOUT.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
    const length = curve.getLength();
    const n = (this.n = Math.round(length / SPACING));
    this.total = length;
    this.px = new Float64Array(n); this.py = new Float64Array(n); this.pz = new Float64Array(n);
    this.tx = new Float64Array(n); this.tz = new Float64Array(n);
    this.curv = new Float64Array(n); this.s = new Float64Array(n);
    const pts = curve.getSpacedPoints(n);
    for (let i = 0; i < n; i++) {
      this.px[i] = pts[i].x; this.pz[i] = pts[i].z;
      this.s[i] = (i / n) * length;
      this.py[i] = this.elevation(this.s[i]);
    }
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      const dx = this.px[b] - this.px[a], dz = this.pz[b] - this.pz[a];
      const l = Math.hypot(dx, dz);
      this.tx[i] = dx / l; this.tz[i] = dz / l;
    }
    for (let i = 0; i < n; i++) {
      const a = (i - 2 + n) % n, b = (i + 2) % n;
      let dh = Math.atan2(this.tx[b], this.tz[b]) - Math.atan2(this.tx[a], this.tz[a]);
      while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
      // heading = atan2(x, z) grows when turning left (the car's right is -x when it faces +z)
      this.curv[i] = dh / (4 * SPACING);
    }
    const tight = Array.from(this.curv, c => Math.abs(c) > 1 / 130);
    this.kerb = tight.map((_, i) => { for (let k = -6; k <= 6; k++) if (tight[this.wrap(i + k)]) return true; return false; });
    this.minX = Math.min(...this.px); this.maxX = Math.max(...this.px);
    this.minZ = Math.min(...this.pz); this.maxZ = Math.max(...this.pz);
  }

  /** gentle, periodic hills: about ±6 m with grades under 4% */
  elevation(s: number) {
    const u = (s / this.total) * Math.PI * 2;
    return 3.6 * Math.sin(2 * u + 0.4) + 2.2 * Math.sin(3 * u + 2.1) + 1.1 * Math.sin(5 * u + 0.7);
  }

  /** right-hand normal (x, z) for a heading along (tx, tz) in a y-up world */
  rightX(i: number) { return -this.tz[i]; }
  rightZ(i: number) { return this.tx[i]; }

  wrap(i: number) { return ((i % this.n) + this.n) % this.n; }
  indexAt(s: number) { return this.wrap(Math.floor(s / (this.total / this.n))); }

  /** world point at arc length s and lateral offset d (positive = right of the driving direction) */
  pointAt(s: number, d = 0, out = new THREE.Vector3()) {
    const step = this.total / this.n;
    const ss = ((s % this.total) + this.total) % this.total;
    const i = Math.floor(ss / step), j = (i + 1) % this.n, f = ss / step - i;
    const x = this.px[i] + (this.px[j] - this.px[i]) * f;
    const z = this.pz[i] + (this.pz[j] - this.pz[i]) * f;
    const rx = this.rightX(i) * (1 - f) + this.rightX(j) * f, rz = this.rightZ(i) * (1 - f) + this.rightZ(j) * f;
    const rl = Math.hypot(rx, rz);
    return out.set(x + (rx / rl) * d, this.elevation(ss), z + (rz / rl) * d);
  }

  headingAt(s: number) {
    const i = this.indexAt(s);
    return Math.atan2(this.tx[i], this.tz[i]);
  }

  /** nearest centreline sample; searches around `hint` when given (cheap per-frame tracking) */
  nearest(x: number, z: number, hint = -1, window = 60) {
    let best = 0, bd = Infinity;
    const scan = (i: number) => {
      const d = (this.px[i] - x) ** 2 + (this.pz[i] - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    };
    if (hint >= 0) for (let k = -window; k <= window; k++) scan(this.wrap(hint + k));
    else for (let i = 0; i < this.n; i++) scan(i);
    const along = (x - this.px[best]) * this.tx[best] + (z - this.pz[best]) * this.tz[best];
    const lateral = (x - this.px[best]) * this.rightX(best) + (z - this.pz[best]) * this.rightZ(best);
    const s = (((this.s[best] + along) % this.total) + this.total) % this.total;
    return { i: best, s, lateral, dist: Math.sqrt(bd) };
  }
}
