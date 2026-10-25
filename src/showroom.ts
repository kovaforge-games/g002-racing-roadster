// Showroom: the car alone on a turntable in a studio, lit by soft boxes, to look at up close.
// Open with ?showroom or #showroom (?showroom&car=cybertruck for another class). Drag to orbit, scroll to zoom; P changes the paint, S raises the spoiler,
// N toggles the lights, and Enter goes to the track.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Renderer } from './render/renderer';
import { buildModel, type BodyModel } from './render/models';
import { CLASSES, type ClassId } from './sim/classes';
import type { Quality } from './render/graphics';

export class Showroom {
  readonly scene = new THREE.Scene();
  readonly renderer: Renderer;
  readonly camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.1, 200);
  readonly model: BodyModel;
  private controls: OrbitControls;
  private turntable = new THREE.Group();
  private spoiler = false;
  private night = false;
  private last = performance.now();
  /** test hook: stop the turntable and auto-orbit at a fixed angle (radians) */
  angle: number | null = null;

  constructor(container: HTMLElement, quality: Quality = 'ultra', cls: ClassId = 'roadster') {
    this.model = buildModel(cls);
    this.renderer = new Renderer(container);
    this.renderer.configure({ graphicsMode: 'custom', quality, resolutionScale: 1, shadows: true, postfx: true });
    const gl = this.renderer.gl;
    gl.toneMapping = THREE.NeutralToneMapping;
    gl.toneMappingExposure = 0.85;
    gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setBloom(0.12, 2.4);

    // studio: soft boxes for reflections, a dark graded backdrop, a glossy floor
    const pm = new THREE.PMREMGenerator(gl);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.02).texture;
    this.scene.environmentIntensity = 0.55;
    pm.dispose();
    this.scene.background = backdrop();
    this.scene.fog = new THREE.Fog(0x101216, 18, 60);

    const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.55, metalness: 0.0, envMapIntensity: 0.25 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    this.scene.add(floor);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.65, 0.04, 96), new THREE.MeshPhysicalMaterial({ color: 0x15171a, roughness: 0.5, metalness: 0.1, clearcoat: 0.3, clearcoatRoughness: 0.4, envMapIntensity: 0.3 }));
    plate.position.y = 0.02; plate.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.63, 0.012, 8, 160).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xcfe8ff, emissiveIntensity: 1.1 }));
    ring.position.y = 0.04;
    this.turntable.add(plate, ring);
    this.scene.add(this.turntable);

    // key light from above for crisp contact shadows, plus a cool rim and a warm fill
    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(3, 9, 4); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 24 });
    key.shadow.bias = -0.0003; key.shadow.normalBias = 0.02; key.shadow.radius = 6;
    const rim = new THREE.DirectionalLight(0xbcd6ff, 1.2); rim.position.set(-6, 3, -5);
    const fill = new THREE.DirectionalLight(0xffe6cc, 0.5); fill.position.set(-4, 2, 6);
    this.scene.add(key, rim, fill, new THREE.HemisphereLight(0xdfe8ff, 0x1a1b1e, 0.35));

    // the car stands on the turntable; its origin is the centre of mass
    this.model.root.position.y = CLASSES[cls].spec.comHeight + 0.04;
    this.model.root.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    this.turntable.add(this.model.root);

    // a bigger car (the Cybertruck, the Semi) gets a bigger turntable and a camera further back
    const box = new THREE.Box3().setFromObject(this.model.bodyShell), size = Math.max(1, (box.max.z - box.min.z) / 4.7);
    plate.scale.set(size, 1, size); ring.scale.set(size, 1, size);
    this.camera.position.set(5.6 * size, 1.5 * size, 6.4 * size);
    this.controls = new OrbitControls(this.camera, gl.domElement);
    this.controls.target.set(0, Math.max(0.55, (box.max.y - box.min.y) * 0.4), 0);
    this.controls.enableDamping = true;
    this.controls.minDistance = 3; this.controls.maxDistance = 16 * size;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04;
    this.controls.autoRotate = true; this.controls.autoRotateSpeed = 0.6;

    const caption = document.createElement('div');
    caption.className = 'showroom-caption';
    const wing = CLASSES[cls].body === 'roadster' ? ' · <b>S</b> spoiler' : '';
    caption.innerHTML = `<div class="brand small">${CLASSES[cls].name.toUpperCase()}</div><div class="hint">Drag to look around · scroll to zoom · <b>P</b> paint${wing} · <b>N</b> lights · <a href="#drive">Drive ›</a></div><div class="paint"></div>`;
    document.body.appendChild(caption);
    const paintLabel = caption.querySelector('.paint')!;
    paintLabel.textContent = this.model.paintName;
    addEventListener('keydown', e => {
      if (e.code === 'KeyP') { this.model.nextPaint(); paintLabel.textContent = this.model.paintName; }
      if (e.code === 'KeyS') this.setSpoiler(!this.spoiler);
      if (e.code === 'KeyN') { this.night = !this.night; this.model.setNight(this.night); }
      if (e.code === 'Enter') location.hash = 'drive';
    });
  }

  setSpoiler(up: boolean) { this.spoiler = up; this.model.showSpoiler(up); }

  frame(t: number) {
    const dt = Math.min(0.1, (t - this.last) / 1000); this.last = t;
    if (this.angle !== null) {
      this.controls.autoRotate = false;
      const r = Math.hypot(this.camera.position.x, this.camera.position.z);
      this.camera.position.set(Math.sin(this.angle) * r, this.camera.position.y, Math.cos(this.angle) * r);
    }
    this.controls.update(dt);
    this.model.animate(dt);
    this.renderer.render(this.scene, this.camera);
  }

  run() {
    const loop = (t: number) => { this.frame(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
}

/** a dark studio wall that fades to black at the top */
function backdrop() {
  const cv = document.createElement('canvas'); cv.width = 2; cv.height = 256;
  const c = cv.getContext('2d')!, g = c.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#050608'); g.addColorStop(0.55, '#16191e'); g.addColorStop(1, '#101216');
  c.fillStyle = g; c.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
