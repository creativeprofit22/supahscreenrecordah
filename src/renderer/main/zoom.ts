// Click-to-zoom — spring-based for smooth, interruptible zoom transitions.
// Includes zoom preview animation loop, background canvas sizing, and
// standalone particle loop for when no screen capture is active.

import {
  createSpringState, stepSpring, setSpringTarget,
  DEFAULT_SPRING_CONFIG,
  type SpringConfig, type SpringState,
} from '../../shared/zoom';
import {
  screenStream,
  smoothMouseX, smoothMouseY,
  capturedBounds,
  currentZoom,
  isMouseHeld, setIsMouseHeld,
  zoomOutTimeout, setZoomOutTimeout,
  lastClickDownTime, setLastClickDownTime,
  activeClickZoomMin, activeClickZoomMax,
  setActiveClickZoomMin, setActiveClickZoomMax,
  zoomLingerTime, setZoomLingerTime,
} from './state';
import { screenVideo, bgCanvas, bgCtx, previewContainer } from './dom';
import { updateSmoothMouse } from './overlays/cursor';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MOUSE_ZOOM_DEFAULT = 1.5;
const BASE_ZOOM = 1.0; // Long-form default: show full screen

/** Clicks within this window are coalesced (double/triple-click, etc.) */
const CLICK_DEBOUNCE_MS = 400;

// ---------------------------------------------------------------------------
// Spring state
// ---------------------------------------------------------------------------

/** Spring-based zoom animation — preserves velocity across target changes */
const zoomSpring: SpringState = createSpringState(BASE_ZOOM);

/** Separate spring configs for zoom-in (snappy) vs zoom-out (gentle) */
const ZOOM_IN_SPRING: SpringConfig = {
  stiffness: 200, // Snappy response
  damping: 26,     // Critically damped
  mass: 1,
};

const ZOOM_OUT_SPRING: SpringConfig = {
  stiffness: 120, // Gentler, slower
  damping: 22,     // Slightly underdamped for organic feel
  mass: 1,
};

/** Track which spring config is active (changes based on zoom direction) */
export let activeSpringConfig: SpringConfig = DEFAULT_SPRING_CONFIG;

// ---------------------------------------------------------------------------
// Animation state
// ---------------------------------------------------------------------------

let zoomAnimFrame = 0;
let lastBgParticleTime = performance.now();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive dynamic min/max click-zoom from the user's mouseZoom setting (1.2–2.5).
 */
function clickZoomRange(mouseZoom: number): { min: number; max: number } {
  const clamped = Math.max(1.2, Math.min(2.5, mouseZoom));
  const min = Math.max(1.05, clamped - 0.3);
  const max = Math.min(3.0, clamped + 0.5);
  return { min, max };
}

/**
 * Convert mouse position from screen coordinates to captured content coordinates.
 * For window captures, this maps the mouse to the captured window's coordinate space.
 *
 * @returns Relative position (0-1) within captured content, or null if mouse is outside
 */
export function getMouseRelativeToCaptured(): { relX: number; relY: number } | null {
  // Check if mouse is within the captured bounds
  const inCapturedX =
    smoothMouseX >= capturedBounds.x &&
    smoothMouseX <= capturedBounds.x + capturedBounds.width;
  const inCapturedY =
    smoothMouseY >= capturedBounds.y &&
    smoothMouseY <= capturedBounds.y + capturedBounds.height;

  // For window captures, if mouse is outside the window, clamp to edges
  // For screen captures, mouse should always be within bounds
  let clampedX = smoothMouseX;
  let clampedY = smoothMouseY;
  if (!inCapturedX || !inCapturedY) {
    // Mouse is outside captured region - clamp to bounds
    clampedX = Math.max(
      capturedBounds.x,
      Math.min(capturedBounds.x + capturedBounds.width, smoothMouseX),
    );
    clampedY = Math.max(
      capturedBounds.y,
      Math.min(capturedBounds.y + capturedBounds.height, smoothMouseY),
    );
  }

  const relX = (clampedX - capturedBounds.x) / capturedBounds.width;
  const relY = (clampedY - capturedBounds.y) / capturedBounds.height;
  return { relX, relY };
}

/**
 * Calculate dynamic zoom that keeps the mouse visible and reasonably centered.
 *
 * Key insight: When mouse is at the edge of content, we need HIGHER zoom
 * so the viewport is smaller, which pushes the mouse toward the viewport center
 * (due to clamping at content boundaries).
 *
 * @param relX - Mouse X position relative to captured content (0-1)
 * @param relY - Mouse Y position relative to captured content (0-1)
 * @returns Zoom level that keeps mouse visible with good margin
 */
function calculateDynamicZoom(relX: number, relY: number): number {
  // Distance from mouse to each edge (0 to 1 scale)
  const distLeft = relX;
  const distRight = 1 - relX;
  const distTop = relY;
  const distBottom = 1 - relY;

  // Minimum distance to any edge
  const minDist = Math.min(distLeft, distRight, distTop, distBottom);

  // Calculate zoom needed to keep mouse at least VIEWPORT_MARGIN from viewport edge
  // With zoom Z, viewport shows 1/Z of content
  // To have mouse at position M (0-1) in viewport: we need zoom such that
  // the smaller of M and (1-M) is >= VIEWPORT_MARGIN
  //
  // For edge case: if mouse is at 0% and we want it at 15% in viewport,
  // the viewport must start before the content edge - but that's clamped.
  // With clamping, higher zoom = mouse appears further from viewport edge.
  //
  // Formula: zoom needed = 1 / (2 * minDist + 2 * VIEWPORT_MARGIN)
  // This ensures that after clamping, mouse has adequate margin

  // Scale minDist to account for desired margin
  // At edge (minDist=0): we need max zoom to push mouse toward center
  // At center (minDist=0.5): min zoom is fine, mouse is naturally centered

  // Inverse relationship: closer to edge = higher zoom needed
  const edgeProximity = 1 - Math.min(1, minDist * 2); // 1 at edge, 0 at center

  // Interpolate: edge = max zoom, center = min zoom (user-configurable)
  const dynamicZoom =
    activeClickZoomMin + (activeClickZoomMax - activeClickZoomMin) * edgeProximity;

  // Hard cap — even the highest user setting can't exceed 3.0x
  return Math.min(dynamicZoom, 3.0);
}

// ---------------------------------------------------------------------------
// Click-to-zoom handlers — with debouncing and asymmetric spring configs
// ---------------------------------------------------------------------------

export function onMouseDown(): void {
  const now = performance.now();

  // Cancel any pending zoom-out
  if (zoomOutTimeout) {
    clearTimeout(zoomOutTimeout);
    setZoomOutTimeout(null);
  }

  setIsMouseHeld(true);

  // Debounce rapid clicks: if this click arrives within CLICK_DEBOUNCE_MS of the
  // last one, treat it as a continuation (e.g. double/triple-click to select text).
  // The zoom stays in — we just update the target position smoothly.
  const isRapidClick = now - lastClickDownTime < CLICK_DEBOUNCE_MS;
  setLastClickDownTime(now);

  // Calculate dynamic zoom based on mouse position relative to captured content
  const relPos = getMouseRelativeToCaptured();
  if (!relPos) {
    return;
  }

  const dynamicZoom = calculateDynamicZoom(relPos.relX, relPos.relY);

  // Use snappy spring for zoom-in
  activeSpringConfig = ZOOM_IN_SPRING;

  if (isRapidClick && currentZoom > BASE_ZOOM) {
    // Already zoomed — just smoothly update target (pan effect while zoomed)
    setSpringTarget(zoomSpring, dynamicZoom);
  } else {
    // Fresh zoom-in
    setSpringTarget(zoomSpring, dynamicZoom);
  }
}

export function onMouseUp(): void {
  setIsMouseHeld(false);

  if (zoomOutTimeout) {
    clearTimeout(zoomOutTimeout);
  }

  const timeout = setTimeout(() => {
    // Only zoom out if mouse is not being held (user may have clicked again)
    if (!isMouseHeld) {
      // Use gentle spring for zoom-out (slower, less jarring)
      activeSpringConfig = ZOOM_OUT_SPRING;
      setSpringTarget(zoomSpring, BASE_ZOOM);
    }
    setZoomOutTimeout(null);
  }, zoomLingerTime);

  setZoomOutTimeout(timeout);
}

// ---------------------------------------------------------------------------
// Apply zoom to the screen video preview via CSS transform
// ---------------------------------------------------------------------------

export function applyScreenZoomTransform(): void {
  if (currentZoom <= 1.0 || !screenStream) {
    screenVideo.style.transformOrigin = '';
    screenVideo.style.transform = 'translateY(-50%)';
    screenVideo.style.clipPath = '';
    return;
  }

  // Get mouse position relative to captured content
  const relPos = getMouseRelativeToCaptured();
  if (!relPos) {
    return;
  }
  const { relX, relY } = relPos;

  // Clamp the desired viewport center so the zoomed region stays within bounds.
  // The viewport is (100/zoom)% wide, so center must be in [halfView, 100-halfView].
  const halfView = 50 / currentZoom;
  const centerX = Math.max(halfView, Math.min(100 - halfView, relX * 100));
  const centerY = Math.max(halfView, Math.min(100 - halfView, relY * 100));

  // Derive the CSS transform-origin that produces the desired visible center.
  // With scale(S) around origin ox, the visible center in content space is:
  //   visibleCenter = ox + (50 - ox) / S
  // Solving for ox: ox = (center * S - 50) / (S - 1)
  const originX = (centerX * currentZoom - 50) / (currentZoom - 1);
  const originY = (centerY * currentZoom - 50) / (currentZoom - 1);

  screenVideo.style.transformOrigin = `${originX}% ${originY}%`;
  screenVideo.style.transform = `translateY(-50%) scale(${currentZoom})`;

  // Clip the scaled element back to its original bounds so it doesn't overflow.
  // clip-path is applied in local coords before the transform, so we compute
  // insets that, after being scaled, produce the original element boundary.
  const factor = 1 - 1 / currentZoom;
  const clipTop = originY * factor;
  const clipRight = (100 - originX) * factor;
  const clipBottom = (100 - originY) * factor;
  const clipLeft = originX * factor;
  screenVideo.style.clipPath = `inset(${clipTop}% ${clipRight}% ${clipBottom}% ${clipLeft}%)`;
}

// ---------------------------------------------------------------------------
// Background canvas sizing
// ---------------------------------------------------------------------------

/** Size the background canvas to match the container (DPR-aware) */
export function sizeBgCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = previewContainer.clientWidth;
  const h = previewContainer.clientHeight;
  bgCanvas.width = Math.round(w * dpr);
  bgCanvas.height = Math.round(h * dpr);
}

// ---------------------------------------------------------------------------
// Background drawing — delegates to the background overlay module
// ---------------------------------------------------------------------------

// Lazy import to avoid circular deps; background.ts may import from zoom.ts
let _drawPreviewBackground: (() => void) | null = null;

function getDrawPreviewBackground(): () => void {
  if (!_drawPreviewBackground) {
    // Provide a no-op fallback until background module wires itself in
    _drawPreviewBackground = () => {};
  }
  return _drawPreviewBackground;
}

/** Allow the background module to register its draw callback */
export function setDrawPreviewBackground(fn: () => void): void {
  _drawPreviewBackground = fn;
}

// ---------------------------------------------------------------------------
// Animation loop for zoom preview (runs continuously when screen is active)
// ---------------------------------------------------------------------------

function zoomRenderLoop(): void {
  updateSmoothMouse();
  applyScreenZoomTransform();
  getDrawPreviewBackground()();
  zoomAnimFrame = requestAnimationFrame(zoomRenderLoop);
}

export function startZoomLoop(): void {
  if (zoomAnimFrame) {
    return;
  }
  zoomAnimFrame = requestAnimationFrame(zoomRenderLoop);
}

export function stopZoomLoop(): void {
  if (zoomAnimFrame) {
    cancelAnimationFrame(zoomAnimFrame);
    zoomAnimFrame = 0;
  }
}

// ---------------------------------------------------------------------------
// Standalone background animation loop — runs when zoomRenderLoop is not active.
// Handles both particles-only and mesh+particles combinations.
// ---------------------------------------------------------------------------

let particleLoopFrame = 0;

function particleLoop(): void {
  // If zoomRenderLoop is running, it handles background — skip standalone loop
  if (zoomAnimFrame) {
    particleLoopFrame = 0;
    return;
  }
  getDrawPreviewBackground()();
  particleLoopFrame = requestAnimationFrame(particleLoop);
}

export function startParticleLoop(): void {
  if (particleLoopFrame || zoomAnimFrame) {
    return;
  }
  particleLoopFrame = requestAnimationFrame(particleLoop);
}

export function stopParticleLoop(): void {
  if (particleLoopFrame) {
    cancelAnimationFrame(particleLoopFrame);
    particleLoopFrame = 0;
  }
}

// ---------------------------------------------------------------------------
// Config setter — called from applyOverlay() to update user preferences
// ---------------------------------------------------------------------------

/**
 * Update the click-zoom range and linger duration from user settings.
 *
 * @param mouseZoom - User's desired zoom level (1.2–2.5)
 * @param lingerMs  - How long zoom stays after mouse release (ms)
 */
export function setZoomConfig(mouseZoom: number, lingerMs: number): void {
  const range = clickZoomRange(mouseZoom);
  setActiveClickZoomMin(range.min);
  setActiveClickZoomMax(range.max);
  setZoomLingerTime(lingerMs);
}

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

export function getZoomSpring(): SpringState {
  return zoomSpring;
}

export function isZoomLoopRunning(): boolean {
  return zoomAnimFrame !== 0;
}

export { zoomSpring, MOUSE_ZOOM_DEFAULT, BASE_ZOOM };
