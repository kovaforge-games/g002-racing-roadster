// Time-of-day lighting (ported from g001): sun/moon, hemisphere fill, sky, fog, exposure and bloom.
import * as THREE from 'three';
import { disposeResources } from './resources';
import { Sky } from 'three/addons/objects/Sky.js';
import type { Quality } from './graphics';

export type TimeOfDay = 'morning' | 'noon' | 'sunset' | 'night';

export interface TodPreset {
  elev: number; azim: number; sun: number; sunI: number;
  hemiSky: number; hemiGround: number; hemiI: number;
  fog: number; fogDensity: number; exposure: number; bloom: number;
  trackTemp: number; envI: number; turbidity: number; rayleigh: number; night: boolean;
}

export const TOD: Record<TimeOfDay, TodPreset> = {
  morning: { elev: 13, azim: 110, sun: 0xffe3c4, sunI: 2.6, hemiSky: 0xbfd6ff, hemiGround: 0x5a5040, hemiI: 0.7, fog: 0xd8dde6, fogDensity: 0.0011, exposure: 0.95, bloom: 0, trackTemp: 24, envI: 0.9, turbidity: 6, rayleigh: 1.6, night: false },
  noon: { elev: 68, azim: 160, sun: 0xfffaf0, sunI: 3.0, hemiSky: 0xcfe6ff, hemiGround: 0x6b6050, hemiI: 0.7, fog: 0xc7d7ea, fogDensity: 0.00045, exposure: 0.9, bloom: 0, trackTemp: 42, envI: 1.0, turbidity: 3, rayleigh: 0.8, night: false },
  sunset: { elev: 3.5, azim: 255, sun: 0xff8a3c, sunI: 2.8, hemiSky: 0xffb38a, hemiGround: 0x3a2a30, hemiI: 0.75, fog: 0xe0a27a, fogDensity: 0.0008, exposure: 1.0, bloom: 0, trackTemp: 30, envI: 0.8, turbidity: 10, rayleigh: 3, night: false },
  night: { elev: 62, azim: 200, sun: 0xe6edff, sunI: 2.1, hemiSky: 0x8ea6d8, hemiGround: 0x222226, hemiI: 0.7, fog: 0x0a0d16, fogDensity: 0.0009, exposure: 1.05, bloom: 0.8, trackTemp: 22, envI: 0.6, turbidity: 1, rayleigh: 0.2, night: true },
};

export const SHADOW_SIZE: Record<Quality, number> = { low: 0, medium: 1024, high: 2048, ultra: 4096 };

/** soft cumulus puffs on a transparent tile (grey and dense for rain) */
function cloudTexture(wet: boolean) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 512;
  const c = cv.getContext('2d')!;
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < (wet ? 70 : 26); k++) {
    const cx = rnd() * 512, cy = rnd() * 512, r = 30 + rnd() * 50;
    for (let p = 0; p < 7; p++) {
      const px = cx + (rnd() - 0.5) * r * 1.8, py = cy + (rnd() - 0.5) * r * 0.8, pr = r * (0.5 + rnd() * 0.6);
      for (const [ox, oy] of [[0, 0], [512, 0], [-512, 0], [0, 512], [0, -512]]) { // tile seamlessly
        const g = c.createRadialGradient(px + ox, py + oy, 0, px + ox, py + oy, pr);
        const col = wet ? '150,155,162' : '255,255,255';
        g.addColorStop(0, `rgba(${col},0.55)`); g.addColorStop(1, `rgba(${col},0)`);
        c.fillStyle = g; c.fillRect(px + ox - pr, py + oy - pr, pr * 2, pr * 2);
      }
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 4);
  return t;
}

export class Environment {
  readonly preset: TodPreset;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sunDir = new THREE.Vector3();
  private envTarget: THREE.WebGLRenderTarget;
  private sky?: Sky;
  private stars?: THREE.Points;
  private clouds?: THREE.Mesh;

  constructor(public scene: THREE.Scene, renderer: THREE.WebGLRenderer, tod: TimeOfDay, quality: Quality, wet = false) {
    const base = TOD[tod];
    // rain: overcast, flat light, mist and a cooler track
    const p = (this.preset = !wet ? base : base.night
      ? { ...base, fogDensity: base.fogDensity * 2.2, sunI: base.sunI * 0.7, trackTemp: base.trackTemp - 6 }
      : { ...base, sun: 0xdfe4ea, sunI: base.sunI * 0.28, hemiSky: 0xa9b1bb, hemiGround: 0x4a4c50, hemiI: 1.15, fog: 0x8d949c,
          fogDensity: Math.max(0.0028, base.fogDensity * 3), exposure: 1.0, envI: 0.7, trackTemp: base.trackTemp - 12 });
    const phi = THREE.MathUtils.degToRad(90 - p.elev), theta = THREE.MathUtils.degToRad(p.azim);
    this.sunDir.setFromSphericalCoords(1, phi, theta);

    this.sun = new THREE.DirectionalLight(p.sun, p.sunI);
    const size = SHADOW_SIZE[quality];
    if (size) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(size, size);
      const cam = this.sun.shadow.camera;
      cam.left = -45; cam.right = 45; cam.top = 45; cam.bottom = -45; cam.near = 1; cam.far = 600;
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.04;
    }
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(p.hemiSky, p.hemiGround, p.hemiI);
    scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(p.fog, quality === 'low' ? Math.max(0.0016, p.fogDensity) : p.fogDensity);
    // Khronos PBR Neutral keeps liveries, kerbs and grass saturated (ACES washes them out)
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = p.exposure;

    if (!p.night) {
      if (quality === 'low' || wet) {
        // cheap screen-space gradient sky instead of a flat colour (also the overcast rain sky)
        const cv = document.createElement('canvas'); cv.width = 2; cv.height = 256;
        const c = cv.getContext('2d')!, gr = c.createLinearGradient(0, 0, 0, 256);
        const top = wet ? new THREE.Color(0x6c737c) : new THREE.Color(p.hemiSky).lerp(new THREE.Color(0x3d7fe0), 0.55);
        gr.addColorStop(0, '#' + top.getHexString()); gr.addColorStop(0.62, '#' + new THREE.Color(p.fog).getHexString()); gr.addColorStop(1, '#' + new THREE.Color(p.fog).getHexString());
        c.fillStyle = gr; c.fillRect(0, 0, 2, 256);
        const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
        scene.background = t;
        // a cheap cloud layer high above (the physical sky shader draws its own clouds)
        const ct = cloudTexture(wet);
        this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(Math.PI / 2),
          new THREE.MeshBasicMaterial({ map: ct, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, opacity: wet ? 0.95 : 0.85 }));
        this.clouds.renderOrder = -2;
        scene.add(this.clouds);
      }
      else {
        const sky = (this.sky = new Sky());
        sky.scale.setScalar(9000);
        const u = sky.material.uniforms;
        u.turbidity.value = p.turbidity; u.rayleigh.value = p.rayleigh;
        u.mieCoefficient.value = 0.005; u.mieDirectionalG.value = 0.8;
        if (u.cloudCoverage) { u.cloudCoverage.value = 0.55; u.cloudDensity.value = 0.55; }
        u.sunPosition.value.copy(this.sunDir);
        (sky.material as THREE.ShaderMaterial).fog = false;
        scene.add(sky);
      }
      // reflections from a soft gradient sky (the physical sky shader is far too bright for IBL)
      const pm = new THREE.PMREMGenerator(renderer);
      const envScene = new THREE.Scene();
      const top = new THREE.Color(p.hemiSky), horizon = new THREE.Color(p.fog), ground = new THREE.Color(p.hemiGround);
      const g = new THREE.SphereGeometry(100, 32, 16);
      const col: number[] = [];
      const pos = g.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i) / 100;
        const c = y > 0 ? horizon.clone().lerp(top, Math.min(1, y * 2.2)) : horizon.clone().lerp(ground, Math.min(1, -y * 4));
        col.push(c.r, c.g, c.b);
      }
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      envScene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
      const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(6, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(p.sun).multiplyScalar(6) }));
      sunDisc.position.copy(this.sunDir).multiplyScalar(90);
      envScene.add(sunDisc);
      this.envTarget = pm.fromScene(envScene, 0.03);
      scene.environment = this.envTarget.texture;
      disposeResources(envScene);
      scene.environmentIntensity = p.envI;
      pm.dispose();
    } else {
      scene.background = new THREE.Color(0x05070d);
      const n = 2500, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const v = new THREE.Vector3().randomDirection();
        v.y = Math.abs(v.y) * 0.9 + 0.05;
        v.normalize().multiplyScalar(6000);
        pos.set([v.x, v.y, v.z], i * 3);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false }));
      scene.add(this.stars);
      const pm = new THREE.PMREMGenerator(renderer);
      const envScene = new THREE.Scene();
      envScene.background = new THREE.Color(0x0c1020);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(40, 8, 8), new THREE.MeshBasicMaterial({ color: 0xfff2d6 }));
      lamp.position.set(0, 300, 0); envScene.add(lamp);
      this.envTarget = pm.fromScene(envScene, 0.04);
      scene.environment = this.envTarget.texture;
      disposeResources(envScene);
      scene.environmentIntensity = p.envI;
      pm.dispose();
    }
  }

  dispose() {
    this.envTarget.dispose();
    this.scene.environment = null;
    this.sun.dispose();
    if (this.sky) disposeResources(this.sky);
    if (this.stars) disposeResources(this.stars);
    if (this.clouds) disposeResources(this.clouds);
  }

  /** keep the shadow frustum centred on the focus point */
  follow(x: number, y: number, z: number) {
    this.sun.target.position.set(x, y, z);
    this.sun.position.set(x + this.sunDir.x * 250, y + Math.max(this.sunDir.y, 0.25) * 250, z + this.sunDir.z * 250);
    this.sun.target.updateMatrixWorld();
    if (this.sky) this.sky.position.set(x, 0, z);
    if (this.stars) this.stars.position.set(x, 0, z);
    if (this.clouds) {
      // the layer follows the car but its texture stays put in the world, so the clouds drift past
      this.clouds.position.set(x, y + 650, z);
      (this.clouds.material as THREE.MeshBasicMaterial).map!.offset.set(x / 2250, -z / 2250);
    }
  }
}
