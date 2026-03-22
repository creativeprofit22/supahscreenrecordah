// Watermark/branding overlay — renders a user's logo in a corner of the recording
// ---------------------------------------------------------------------------
// Loads a local image file and draws it at a configurable position, size, and
// opacity on every composited frame. The image is cached as an HTMLImageElement
// so it doesn't need to be re-decoded each frame.
// ---------------------------------------------------------------------------

import type { WatermarkConfig } from '../../../shared/feature-types';

let watermarkImage: HTMLImageElement | null = null;
let watermarkLoadedPath = '';

/**
 * Load a watermark image from a local file path. Caches the image so
 * subsequent calls with the same path are no-ops.
 */
export function loadWatermark(imagePath: string): Promise<void> {
  if (!imagePath) {
    watermarkImage = null;
    watermarkLoadedPath = '';
    return Promise.resolve();
  }

  // Already loaded this path — skip
  if (imagePath === watermarkLoadedPath && watermarkImage) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      watermarkImage = img;
      watermarkLoadedPath = imagePath;
      resolve();
    };
    img.onerror = () => {
      console.error('[watermark] Failed to load image:', imagePath);
      watermarkImage = null;
      watermarkLoadedPath = '';
      reject(new Error(`Failed to load watermark image: ${imagePath}`));
    };
    // Electron file:// protocol for local paths
    img.src = imagePath.startsWith('file://') ? imagePath : `file://${imagePath}`;
  });
}

/**
 * Draw the cached watermark image onto the canvas.
 * Should be called late in the compositing pipeline (after all overlays).
 */
export function drawWatermark(
  ctx: CanvasRenderingContext2D,
  config: WatermarkConfig,
  canvasWidth: number,
  canvasHeight: number,
): void {
  if (!watermarkImage || !config.enabled) return;

  // Calculate size: config.size% of canvas width, maintaining aspect ratio
  const w = canvasWidth * (config.size / 100);
  const h = w * (watermarkImage.naturalHeight / watermarkImage.naturalWidth);

  // Calculate position based on config.position
  const margin = 20;
  let x: number;
  let y: number;
  switch (config.position) {
    case 'top-left':
      x = margin;
      y = margin;
      break;
    case 'top-right':
      x = canvasWidth - w - margin;
      y = margin;
      break;
    case 'bottom-left':
      x = margin;
      y = canvasHeight - h - margin;
      break;
    case 'bottom-right':
      x = canvasWidth - w - margin;
      y = canvasHeight - h - margin;
      break;
  }

  // Draw with opacity
  ctx.globalAlpha = config.opacity;
  ctx.drawImage(watermarkImage, x, y, w, h);
  ctx.globalAlpha = 1.0;
}

/**
 * Clear the cached watermark image (e.g. when the user disables the watermark).
 */
export function clearWatermark(): void {
  watermarkImage = null;
  watermarkLoadedPath = '';
}
