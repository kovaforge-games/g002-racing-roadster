// Air canisters on the road: a floating carbon pressure bottle with glowing cyan bands, spinning
// over a soft ring of light, with a faint beam of light above so rows read from far away. Taken
// ones vanish and grow back when they respawn.
import * as THREE from 'three';
import type { Canisters } from '../sim/canisters';

function ringTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const c = cv.getContext('2d')!;
  const g = c.createRadialGradient(64, 64, 20, 64, 64, 64);
  g.addColorStop(0, 'rgba(60,220,255,0)'); g.addColorStop(0.62, 'rgba(60,220,255,0.55)'); g.addColorStop(0.75, 'rgba(160,240,255,0.9)'); g.addColorStop(1, 'rgba(60,220,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cv);
}

export class CanisterScene {
  readonly group = new THREE.Group();
  private items: { obj: THREE.Group; ring: THREE.Mesh; beam: THREE.Mesh; phase: number }[] = [];
  private glow: THREE.MeshStandardMaterial;
  private t = 0;

  constructor(private canisters: Canisters) {
    const shell = new THREE.MeshStandardMaterial({ color: 0x1b1e22, roughness: 0.35, metalness: 0.4 });
    this.glow = new THREE.MeshStandardMaterial({ color: 0x0b3a48, emissive: 0x3fdcff, emissiveIntensity: 2.2, roughness: 0.3 });
    const cap = new THREE.MeshStandardMaterial({ color: 0xc9ced4, roughness: 0.25, metalness: 0.9 });
    const body = new THREE.CapsuleGeometry(0.32, 0.7, 6, 18);
    const band = new THREE.CylinderGeometry(0.335, 0.335, 0.16, 24);
    const valve = new THREE.CylinderGeometry(0.08, 0.1, 0.18, 12).translate(0, 0.76, 0);
    const ringM = new THREE.MeshBasicMaterial({ map: ringTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const ringG = new THREE.PlaneGeometry(3.6, 3.6).rotateX(-Math.PI / 2);
    // beam: brightest at the bottom, fading upwards (additive, so black is invisible)
    const beamG = new THREE.CylinderGeometry(0.42, 0.42, 7, 16, 6, true).translate(0, 3.5, 0);
    const bp = beamG.getAttribute('position'), bc = new Float32Array(bp.count * 3);
    for (let k = 0; k < bp.count; k++) { const f = (1 - bp.getY(k) / 7) ** 2 * 0.5; bc.set([f * 0.5, f * 0.9, f], k * 3); }
    beamG.setAttribute('color', new THREE.BufferAttribute(bc, 3));
    const beamM = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    for (const c of canisters.list) {
      const obj = new THREE.Group();
      const b = new THREE.Mesh(body, shell); b.castShadow = true;
      const b1 = new THREE.Mesh(band, this.glow); b1.position.y = 0.18;
      const b2 = new THREE.Mesh(band, this.glow); b2.position.y = -0.18;
      obj.add(b, b1, b2, new THREE.Mesh(valve, cap));
      obj.position.set(c.x, c.y + 1.3, c.z);
      obj.rotation.z = 0.25;
      obj.scale.setScalar(1.5);
      const ring = new THREE.Mesh(ringG, ringM);
      ring.position.set(c.x, c.y + 0.06, c.z); ring.renderOrder = 1;
      const beam = new THREE.Mesh(beamG, beamM);
      beam.position.set(c.x, c.y, c.z); beam.renderOrder = 2;
      this.group.add(obj, ring, beam);
      this.items.push({ obj, ring, beam, phase: Math.random() * 6 });
    }
  }

  update(dt: number) {
    this.t += dt;
    this.glow.emissiveIntensity = 1.8 + Math.sin(this.t * 5) * 0.6;
    this.canisters.list.forEach((c, k) => {
      const it = this.items[k];
      const shown = c.respawn <= 0;
      // grow back over the last half second before respawning
      const grow = shown ? 1 : Math.max(0, 1 - c.respawn / 0.5);
      it.obj.visible = grow > 0.01;
      it.ring.visible = it.beam.visible = shown;
      it.obj.scale.setScalar(1.5 * (grow < 1 ? grow * grow : 1));
      it.obj.rotation.y = this.t * 1.6 + it.phase;
      it.obj.position.y = c.y + 1.3 + Math.sin(this.t * 2.2 + it.phase) * 0.12;
    });
  }
}
