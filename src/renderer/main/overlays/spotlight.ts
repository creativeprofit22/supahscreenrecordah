// Spotlight effect — dims everything on the screen except the area around the cursor.
// Drawn AFTER screen video + blur regions but BEFORE camera/text overlays in the
// recording canvas compositing loop. Also provides a DOM overlay for the preview.

import { activeSpotlight, currentZoom } from '../state';
import { previewContainer } from '../dom';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Base spotlight radius in canvas pixels (at zoom 1.0) */
const BASE_RADIUS = 180;

/** Minimum radius when zoomed in — prevents spotlight from becoming too tiny */
const MIN_RADIUS = 80;

/** Dim overlay opacity for the darkened area outside the spotlight */
const DIM_OPACITY = 0.6;

// ---------------------------------------------------------------------------
// Recording canvas — radial gradient spotlight
// ---------------------------------------------------------------------------

/**
 * Draw a radial-gradient dim overlay on the recording canvas, leaving a
 * bright circle around the mouse cursor position.
 *
 * @param ctx       - Recording canvas 2D context
 * @param mouseX    - Cursor X in canvas coordinates
 * @param mouseY    - Cursor Y in canvas coordinates
 * @param screenX   - Screen area left edge in canvas coords
 * @param screenY   - Screen area top edge in canvas coords
 * @param screenW   - Screen area width in canvas coords
 * @param screenH   - Screen area height in canvas coords
 * @param radius    - Spotlight radius in canvas pixels
 */
export function drawSpotlight(
  ctx: CanvasRenderingContext2D,
  mouseX: number,
  mouseY: number,
  screenX: number,
  screenY: number,
  screenW: number,
  screenH: number,
  radius: number,
): void {
  ctx.save();

  // Clip to screen area so dim doesn't bleed into background/letterbox
  ctx.beginPath();
  ctx.rect(screenX, screenY, screenW, screenH);
  ctx.clip();

  // Radial gradient: transparent center → dim edges
  const gradient = ctx.createRadialGradient(
    mouseX, mouseY, 0,
    mouseX, mouseY, radius,
  );
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(0.7, 'rgba(0,0,0,0)');
  gradient.addColorStop(1.0, `rgba(0,0,0,${DIM_OPACITY})`);

  ctx.fillStyle = gradient;
  ctx.fillRect(screenX, screenY, screenW, screenH);

  ctx.restore();
}

/**
 * Compute the spotlight radius, scaling inversely with zoom level so the
 * spotlight shrinks when zoomed in (less content visible = smaller highlight).
 */
export function getSpotlightRadius(zoom: number): number {
  const scaled = BASE_RADIUS / Math.max(zoom, 1.0);
  return Math.max(MIN_RADIUS, scaled);
}

// ---------------------------------------------------------------------------
// Preview DOM overlay — CSS radial gradient that follows cursor
// ---------------------------------------------------------------------------

let spotlightOverlay: HTMLDivElement | null = null;

/** Create/show the DOM spotlight overlay for the preview window. */
export function showPreviewSpotlight(): void {
  if (spotlightOverlay) return;

  spotlightOverlay = document.createElement('div');
  spotlightOverlay.className = 'spotlight-overlay';
  spotlightOverlay.style.cssText = `
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 5;
    opacity: 0;
    transition: opacity 0.3s ease;
  `;
  previewContainer.appendChild(spotlightOverlay);

  // Fade in
  requestAnimationFrame(() => {
    if (spotlightOverlay) spotlightOverlay.style.opacity = '1';
  });
}

/** Hide and remove the DOM spotlight overlay. */
export function hidePreviewSpotlight(): void {
  if (!spotlightOverlay) return;
  const el = spotlightOverlay;
  el.style.opacity = '0';
  setTimeout(() => {
    el.remove();
    if (spotlightOverlay === el) spotlightOverlay = null;
  }, 300);
}

/**
 * Update the preview spotlight position to follow the mouse.
 * Called from the zoom render loop each frame.
 *
 * @param relX - Mouse X relative to preview container (0–1)
 * @param relY - Mouse Y relative to preview container (0–1)
 */
export function updatePreviewSpotlight(relX: number, relY: number): void {
  if (!spotlightOverlay || !activeSpotlight) return;

  const radiusPct = (getSpotlightRadius(currentZoom) / 180) * 25; // ~25% of container at base
  const x = relX * 100;
  const y = relY * 100;

  spotlightOverlay.style.background =
    `radial-gradient(circle ${radiusPct}vw at ${x}% ${y}%, ` +
    `transparent 0%, transparent 70%, rgba(0,0,0,${DIM_OPACITY}) 100%)`;
}
