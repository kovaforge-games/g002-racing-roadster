// Live reflections for the car: a cube camera that follows the car and captures the track,
// scenery and sky every few frames, so the paint and glass reflect the world around them
// (High and Ultra only; the other presets reflect the soft sky gradient).
import * as THREE from 'three';

export class ReflectionProbe {
  private target: THREE.WebGLCubeRenderTarget;
  private cam: THREE.CubeCamera;
  private frame = 0;

  constructor(size: number, private every: number) {
    this.target = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
    this.cam = new THREE.CubeCamera(0.3, 9500, this.target);
  }

  get texture() { return this.target.texture; }

  /** capture from `at`, with `hide` (the car itself) left out of its own reflection */
  update(gl: THREE.WebGLRenderer, scene: THREE.Scene, at: THREE.Vector3, hide: THREE.Object3D, before?: () => void, after?: () => void) {
    if (this.frame++ % this.every) return;
    before?.();
    hide.visible = false;
    this.cam.position.copy(at);
    this.cam.update(gl, scene);
    hide.visible = true;
    after?.();
    // the material system re-filters the capture for rough and glossy surfaces
    this.target.texture.needsPMREMUpdate = true;
  }

  dispose() { this.target.dispose(); }
}
