// Cinema filter & camera enhancement — renderer-specific canvas/CSS helpers

import { cameraVideo } from '../dom';
import { activeCinemaFilter, activeCameraEnhancement } from '../state';
import {
  buildEnhancementFilter,
  CINEMA_FILTERS,
  getCinemaCSS,
  getCinemaCanvas,
} from '../../../shared/filters';

// Re-export shared utilities for convenience
export { buildEnhancementFilter, CINEMA_FILTERS, getCinemaCSS, getCinemaCanvas };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------

/**
 * Draw a colored shadow tint — pushes a color into the darker regions of the image.
 * Uses 'multiply' so it only tints dark areas; bright areas stay mostly clean.
 */
export function drawShadowTint(
  ctx: CanvasRenderingContext2D,
  bounds: Bounds,
  color: string,
  alpha: number,
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  ctx.restore();
}

/**
 * Draw a colored highlight wash — lifts bright areas toward a hue.
 * Uses 'screen' so it only affects bright areas; dark areas stay clean.
 */
export function drawHighlightWash(
  ctx: CanvasRenderingContext2D,
  bounds: Bounds,
  color: string,
  alpha: number,
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Live preview
// ---------------------------------------------------------------------------

/** Apply combined CSS filter (enhancement + cinema) to live preview — camera only */
export function applyCameraFiltersToPreview(): void {
  const enhFilter = buildEnhancementFilter(activeCameraEnhancement);
  const cinemaFilter = getCinemaCSS(activeCinemaFilter);
  const combined = [enhFilter, cinemaFilter].filter(Boolean).join(' ');
  cameraVideo.style.filter = combined || '';
}

// ---------------------------------------------------------------------------
// Recording canvas
// ---------------------------------------------------------------------------

/** Apply cinematic post-processing to the recording canvas — camera area only */
export function applyRecordingCinemaFilter(
  ctx: CanvasRenderingContext2D,
  bounds: Bounds,
  filter: string,
): void {
  if (filter === 'none') {
    return;
  }
  const def = CINEMA_FILTERS[filter];

  // Clip all effects to camera bounds
  ctx.save();
  ctx.beginPath();
  ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
  ctx.clip();

  // Shadow tint — pushes a color into dark areas via multiply blend
  if (def.shadowTint && def.shadowAlpha > 0) {
    drawShadowTint(ctx, bounds, def.shadowTint, def.shadowAlpha);
  }
  // Highlight wash — lifts bright areas toward a hue via screen blend
  if (def.highlightTint && def.highlightAlpha > 0) {
    drawHighlightWash(ctx, bounds, def.highlightTint, def.highlightAlpha);
  }

  ctx.restore();
}
