// Prints the circuit's length, tightest corners and closest approach between separate parts.
import { Track } from '../src/sim/track';

const t = new Track();
console.log('length', t.total.toFixed(0), 'm, samples', t.n, 'bounds', t.minX.toFixed(0), t.maxX.toFixed(0), t.minZ.toFixed(0), t.maxZ.toFixed(0));
const corners: { s: number; r: number }[] = [];
for (let i = 0; i < t.n; i++) {
  const c = Math.abs(t.curv[i]);
  const prev = Math.abs(t.curv[t.wrap(i - 1)]), next = Math.abs(t.curv[t.wrap(i + 1)]);
  if (c > 1 / 400 && c >= prev && c >= next) corners.push({ s: t.s[i], r: (1 / t.curv[i]) });
}
console.log('corner apexes (s, radius; + = left):', corners.map(c => `${c.s.toFixed(0)}:${c.r.toFixed(0)}`).join(' '));
let worst = Infinity, at = '';
for (let i = 0; i < t.n; i += 2) for (let j = 0; j < t.n; j += 2) {
  let ds = Math.abs(t.s[i] - t.s[j]); ds = Math.min(ds, t.total - ds);
  if (ds < 150) continue;
  const d = Math.hypot(t.px[i] - t.px[j], t.pz[i] - t.pz[j]);
  if (d < worst) { worst = d; at = `${t.s[i].toFixed(0)}/${t.s[j].toFixed(0)}`; }
}
console.log('closest separate sections', worst.toFixed(1), 'm at', at);
let maxGrade = 0;
for (let i = 0; i < t.n; i++) maxGrade = Math.max(maxGrade, Math.abs(t.py[t.wrap(i + 1)] - t.py[i]) / 2);
console.log('max grade', (maxGrade * 100).toFixed(1), '%');
