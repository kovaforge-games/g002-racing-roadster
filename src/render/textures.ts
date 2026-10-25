// Procedural canvas textures, so the game ships with no image files.
import * as THREE from 'three';

function rng(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

function canvasTexture(size: number, paint: (c: CanvasRenderingContext2D, rnd: () => number) => void, seed = 1, srgb = true) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d')!;
  paint(c, rng(seed));
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** fine aggregate asphalt: mid grey with light and dark stones */
export function asphaltTexture() {
  return canvasTexture(512, (c, r) => {
    c.fillStyle = '#4a4c50'; c.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 26000; i++) {
      const v = 40 + r() * 70 | 0;
      c.fillStyle = `rgba(${v},${v},${v + 3},${0.35 + r() * 0.5})`;
      const s = r() < 0.9 ? 1 : 2;
      c.fillRect(r() * 512, r() * 512, s, s);
    }
    for (let i = 0; i < 2600; i++) {
      const v = 120 + r() * 70 | 0;
      c.fillStyle = `rgba(${v},${v},${v},${0.25 + r() * 0.4})`;
      c.fillRect(r() * 512, r() * 512, 1, 1);
    }
  }, 3);
}

/** short grass with clumps; tinted by vertex colour */
export function grassTexture() {
  return canvasTexture(256, (c, r) => {
    c.fillStyle = '#b8b8b8'; c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 9000; i++) {
      const v = 150 + r() * 105 | 0;
      c.strokeStyle = `rgba(${v},${v},${v},0.5)`;
      const x = r() * 256, y = r() * 256, a = (r() - 0.5) * 0.8, l = 2 + r() * 4;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.sin(a) * l, y - Math.cos(a) * l); c.stroke();
    }
  }, 5);
}

/** chain-link fence: diagonal wires on transparent, used with alphaTest */
export function fenceTexture() {
  const t = canvasTexture(128, c => {
    c.clearRect(0, 0, 128, 128);
    c.strokeStyle = 'rgba(200,205,210,1)'; c.lineWidth = 2.2;
    for (let k = -128; k <= 256; k += 16) {
      c.beginPath(); c.moveTo(k, 0); c.lineTo(k + 128, 128); c.stroke();
      c.beginPath(); c.moveTo(k, 128); c.lineTo(k + 128, 0); c.stroke();
    }
  }, 1);
  return t;
}

/** text on a dark panel, for the start gantry and signs */
export function signTexture(text: string, sub: string, w = 1024, h = 128) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const c = cv.getContext('2d')!;
  const g = c.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, '#0d1117'); g.addColorStop(1, '#1b2330');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.fillStyle = '#38e8ff'; c.fillRect(0, h - 8, w, 8);
  c.font = `700 ${h * 0.5}px system-ui, sans-serif`; c.textBaseline = 'middle'; c.fillStyle = '#ffffff';
  c.fillText(text, h * 0.35, h * 0.46);
  c.font = `500 ${h * 0.26}px system-ui, sans-serif`; c.fillStyle = '#9fb3c8'; c.textAlign = 'right';
  c.fillText(sub, w - h * 0.3, h * 0.48);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/** the advertising boards along the barriers: bold panels, side by side, that repeat round the lap */
export const BANNER_LENGTH = 72;
export function bannerTexture() {
  const panels: [string, string, string][] = [
    ['ROADSTER CIRCUIT', '#e31937', '#ffffff'], ['CHARGE HUB', '#111418', '#ff3b4e'], ['PLAID', '#f4f4f2', '#111418'],
    ['CYBERTRUCK', '#9aa3ab', '#111418'], ['LUDICROUS', '#111418', '#38e8ff'], ['ZERO EMISSIONS', '#1f8f4e', '#ffffff'],
    ['FULL SEND', '#ffcc1a', '#111418'], ['MODEL S', '#14365e', '#ffffff'],
  ];
  const pw = 512, h = 64;
  const cv = document.createElement('canvas'); cv.width = pw * panels.length; cv.height = h;
  const c = cv.getContext('2d')!;
  panels.forEach(([text, bg, fg], k) => {
    const x = k * pw;
    c.fillStyle = bg; c.fillRect(x, 0, pw, h);
    // a thin dark seam between boards, and a lighter top edge
    c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(x, 0, 3, h);
    c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(x, 0, pw, 3);
    c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `italic 900 ${Math.round(h * 0.62)}px system-ui, sans-serif`;
    const tw = c.measureText(text).width;
    c.save(); c.translate(x + pw / 2, h * 0.53); c.scale(Math.min(1, (pw - 40) / tw), 1); c.fillText(text, 0, 0); c.restore();
  });
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}
