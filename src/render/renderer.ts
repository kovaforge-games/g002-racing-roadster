// WebGL renderer + post-processing chain, configured from the quality preset (ported from g001).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { recommendedQuality, renderPixelRatio, type GraphicsSettings } from './graphics';
export type { GraphicsSettings } from './graphics';

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private renderPass: RenderPass | null = null;
  private ao: GTAOPass | null = null;
  private settings!: GraphicsSettings;

  constructor(container: HTMLElement) {
    this.gl = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    if (import.meta.env.DEV) this.gl.info.autoReset = false;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.domElement.className = 'gl';
    container.appendChild(this.gl.domElement);
    addEventListener('resize', () => this.resize());
  }

  configure(requested: GraphicsSettings) {
    const s = { ...requested };
    if (s.graphicsMode === 'auto') {
      const ctx = this.gl.getContext();
      const debug = ctx.getExtension('WEBGL_debug_renderer_info');
      const gpu = String(ctx.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : ctx.RENDERER));
      const phone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 500;
      s.quality = recommendedQuality(gpu, (navigator as Navigator & { deviceMemory?: number }).deviceMemory, matchMedia('(pointer: coarse)').matches, phone);
      const touch = matchMedia('(pointer: coarse)').matches;
      s.resolutionScale = touch ? 0.85 : 1;  // iPad: ~1.3x pixel ratio, sharp enough and far lighter on memory
      s.shadows = s.quality !== 'low';
      s.postfx = s.quality !== 'low' && !touch;
    }
    this.settings = s;
    this.gl.setPixelRatio(renderPixelRatio(innerWidth, innerHeight, devicePixelRatio, s.quality, s.resolutionScale));
    this.gl.shadowMap.enabled = s.shadows && s.quality !== 'low';
    if (this.composer) {
      for (const pass of this.composer.passes) pass.dispose();
      this.composer.dispose();
    }
    this.composer = null;
    this.bloom = null;
    this.renderPass = null;
    this.ao = null;
    // post-processing renders to half-float targets; skip it where the GPU cannot (older Safari/iOS)
    const ctx = this.gl.getContext();
    const floatTargets = !!(ctx.getExtension('EXT_color_buffer_float') || ctx.getExtension('EXT_color_buffer_half_float'));
    if (s.postfx && s.quality !== 'low' && floatTargets) {
      const size = this.gl.getSize(new THREE.Vector2());
      const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: s.quality === 'medium' ? 2 : 4 });
      this.composer = new EffectComposer(this.gl, rt);
      this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
      this.composer.addPass(this.renderPass);
      if (s.quality === 'ultra') {
        // ambient occlusion: contact shadows under cars, in the stands, at barrier bases (Ultra only)
        this.ao = new GTAOPass(new THREE.Scene(), new THREE.PerspectiveCamera(), size.x, size.y);
        this.ao.blendIntensity = 0.85;
        this.ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1, samples: 12 });
        this.composer.addPass(this.ao);
      }
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.3, 0.4, 1.0);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.resize();
  }

  get shadowsOn() { return this.gl.shadowMap.enabled; }
  get quality() { return this.settings.quality; }

  /** daytime skies are HDR-bright, so bloom only catches real highlights there */
  setBloom(strength: number, threshold = 1) { if (this.bloom) { this.bloom.strength = strength; this.bloom.threshold = threshold; } }

  resize() {
    const w = innerWidth, h = innerHeight;
    if (!this.settings) return;
    const ratio = renderPixelRatio(w, h, devicePixelRatio, this.settings.quality, this.settings.resolutionScale);
    if (this.gl.getPixelRatio() !== ratio) this.gl.setPixelRatio(ratio);
    this.gl.setSize(w, h);
    this.composer?.setPixelRatio(ratio);
    this.composer?.setSize(w, h);
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    if (import.meta.env.DEV) this.gl.info.reset();
    if (camera.aspect !== innerWidth / innerHeight) { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
    if (this.composer && this.renderPass) {
      this.renderPass.scene = scene; this.renderPass.camera = camera;
      if (this.ao) { this.ao.scene = scene; this.ao.camera = camera; }
      this.composer.render();
    } else this.gl.render(scene, camera);
    if (import.meta.env.DEV) {
      this.gl.domElement.dataset.renderStats = JSON.stringify({ quality: this.quality, ...this.gl.info.render, ...this.gl.info.memory });
    }
  }
}
