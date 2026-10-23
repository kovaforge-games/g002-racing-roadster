// Graphics presets (ported from g001): Auto picks Low on integrated GPUs and bounds the render size.
export type Quality = 'low' | 'medium' | 'high' | 'ultra';

export interface GraphicsSettings {
  graphicsMode: 'auto' | 'custom'; quality: Quality; resolutionScale: number; shadows: boolean; postfx: boolean;
}

/** Use the existing WebGL context; never allocate a second GPU context for detection. */
export function recommendedQuality(gpu: string, memory: number | undefined, touch: boolean, phone = false): Quality {
  if (/Intel.*(?:UHD|HD Graphics|Iris)|SwiftShader|llvmpipe|softpipe|Mali-[GT]?[0-7]\d\b|Adreno \(TM\) [1-5]\d\d|PowerVR/i.test(gpu) || (memory !== undefined && memory <= 4)) return 'low';
  // phones have far less memory than iPads/laptops (iOS kills tabs that use too much)
  if (phone) return 'low';
  return touch ? 'medium' : 'high';
}

/** Bound both dimensions on Low, even on a high-DPI or external 4K display. */
export function renderPixelRatio(width: number, height: number, dpr: number, quality: Quality, scale: number) {
  const cap = quality === 'low' ? Math.min(1, 1280 / width, 720 / height) : quality === 'medium' ? 1.5 : 2;
  return Math.min(dpr, cap) * scale;
}
