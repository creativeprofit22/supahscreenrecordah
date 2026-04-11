// Click-to-zoom — spring-based for smooth, interruptible zoom transitions.
// Includes zoom preview animation loop, background canvas sizing, and
// standalone particle loop for when no screen capture is active.
//
// Smart zoom enhancements (opt-in via activeSmartZoom):
// - Click cluster detection: sustained zoom on repeated clicks in a small area
// - Cursor velocity analysis: suppress zoom during fast movement, auto-zoom on stop
// - Adaptive spring configs: stiff springs for fast motion, soft for focus areas
// - Smart edge boundaries: reduced zoom near screen edges to avoid empty space

import {
  createSpringState, stepSpring, setSpringTarget,
  DEFAULT_SPRING_CONFIG,
  type SpringConfig, type SpringState,
} from '../../shared/zoom';
import {
  screenStream,
  smoothMouseX, smoothMouseY,
  currentMouseX, currentMouseY,
  capturedBounds, displayScaleFactor,
  currentZoom,
  isMouseHeld, setIsMouseHeld,
  zoomOutTimeout, setZoomOutTimeout,
  lastClickDownTime, setLastClickDownTime,
  activeClickZoomMin, activeClickZoomMax,
  setActiveClickZoomMin, setActiveClickZoomMax,
  zoomLingerTime, setZoomLingerTime,
  activeSpotlight,
  activeSmartZoom,
  isCapturingWindow,
} from './state';
import { screenVideo, bgCanvas, bgCtx, previewContainer, cursorOverlay } from './dom';
import { updateSmoothMouse } from './overlays/cursor';
import { updatePreviewSpotlight } from './overlays/spotlight';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MOUSE_ZOOM_DEFAULT = 1.5;
const BASE_ZOOM = 1.0; // Long-form default: show full screen

/** Clicks within this window are coalesced (double/triple-click, etc.) */
const CLICK_DEBOUNCE_MS = 400;

// ---------------------------------------------------------------------------
// Smart zoom constants
// ---------------------------------------------------------------------------

/** Sliding window duration for click cluster detection (ms) */
const CLUSTER_WINDOW_MS = 5000;

/** Minimum clicks within window to trigger a cluster zoom */
const CLUSTER_MIN_CLICKS = 3;

/** Maximum spatial spread (px) for clicks to be considered a cluster */
const CLUSTER_RADIUS_PX = 200;

/** Distance cursor must travel from cluster center before cluster zoom releases */
const CLUSTER_RELEASE_DISTANCE_PX = 300;

/** Zoom multiplier applied on top of dynamic zoom for cluster focus */
const CLUSTER_ZOOM_BOOST = 1.25;

/** Cursor velocity threshold (px/frame at 60fps) — below this, cursor is "slow" */
const VELOCITY_SLOW_THRESHOLD = 2.0;

/** How long cursor must be slow before auto-zoom triggers (ms) */
const VELOCITY_SETTLE_MS = 500;

/** Easing zone — ignore cursor stop for this duration to prevent micro-zooms (ms) */
const EASING_ZONE_MS = 200;

/** Screen edge fraction (0-1) — zoom is reduced when cursor is in this margin */
const EDGE_MARGIN_FRACTION = 0.10;

/** How much to reduce zoom at screen edges (multiplier, 0-1) */
const EDGE_ZOOM_REDUCTION = 0.6;

/** Title bar height estimate (px) for window captures — zoom is reduced here */
const TITLE_BAR_HEIGHT_PX = 30;

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

/** Smart zoom: soft spring for gentle focus zoom-in (slow cursor / cluster) */
const SMART_ZOOM_IN_SPRING: SpringConfig = {
  stiffness: 100, // Gentle, gradual
  damping: 20,     // Slightly underdamped for organic feel
  mass: 1.2,
};

/** Smart zoom: stiff spring for quick zoom-out during fast cursor movement */
const SMART_ZOOM_OUT_SPRING: SpringConfig = {
  stiffness: 280, // Very stiff — snap out fast
  damping: 30,     // Overdamped — no bounce
  mass: 0.8,
};

/** Track which spring config is active (changes based on zoom direction) */
export let activeSpringConfig: SpringConfig = DEFAULT_SPRING_CONFIG;

// ---------------------------------------------------------------------------
// Animation state
// ---------------------------------------------------------------------------

let zoomAnimFrame = 0;
let lastBgParticleTime = performance.now();

// ---------------------------------------------------------------------------
// Smart zoom: click cluster tracking
// ---------------------------------------------------------------------------

interface ClickRecord {
  time: number;
  x: number; // screen coordinates
  y: number;
}

/** Sliding window of recent clicks */
let recentClicks: ClickRecord[] = [];

/** Active cluster center (screen coords), null if no cluster is active */
let clusterCenter: { x: number; y: number } | null = null;

/** Whether a cluster zoom is currently being held */
let clusterZoomActive = false;

// ---------------------------------------------------------------------------
// Smart zoom: cursor velocity tracking
// ---------------------------------------------------------------------------

/** Previous cursor position for velocity calculation */
let prevMouseX = 0;
let prevMouseY = 0;
let prevVelocityTime = performance.now();

/** Exponentially smoothed cursor velocity (px/frame at 60fps equivalent) */
let cursorVelocity = 0;

/** Timestamp when cursor velocity first dropped below threshold */
let velocitySlowSince = 0;

/** Whether the auto-zoom from velocity has been triggered for this stop */
let velocityZoomTriggered = false;

/** Whether cursor is currently considered "fast-moving" */
let cursorIsFast = false;

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
  // On Windows with DPI scaling, cursor coordinates from getCursorScreenPoint()
  // may be in physical pixels while Display.bounds are in logical/DIP pixels.
  // Detect and correct this mismatch using the display scale factor.
  const sf = displayScaleFactor;
  let mx = smoothMouseX;
  let my = smoothMouseY;

  // If mouse coordinates exceed the bounds by roughly the scale factor,
  // the cursor is likely in physical pixels — convert to logical.
  if (sf > 1) {
    const rawRelX = (mx - capturedBounds.x) / capturedBounds.width;
    const rawRelY = (my - capturedBounds.y) / capturedBounds.height;
    if (rawRelX > 1.05 || rawRelY > 1.05) {
      // Cursor appears to be in physical pixels; divide by scale factor
      mx = mx / sf;
      my = my / sf;
    }
  }

  // Clamp to captured bounds
  const clampedX = Math.max(
    capturedBounds.x,
    Math.min(capturedBounds.x + capturedBounds.width, mx),
  );
  const clampedY = Math.max(
    capturedBounds.y,
    Math.min(capturedBounds.y + capturedBounds.height, my),
  );

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

  // Inverse relationship: closer to edge = higher zoom needed
  const edgeProximity = 1 - Math.min(1, minDist * 2); // 1 at edge, 0 at center

  // Interpolate: edge = max zoom, center = min zoom (user-configurable)
  let dynamicZoom =
    activeClickZoomMin + (activeClickZoomMax - activeClickZoomMin) * edgeProximity;

  // Smart zoom: apply edge boundary reduction
  if (activeSmartZoom) {
    dynamicZoom = applyEdgeBoundaryReduction(relX, relY, dynamicZoom);
  }

  // Hard cap — even the highest user setting can't exceed 3.0x
  return Math.min(dynamicZoom, 3.0);
}

// ---------------------------------------------------------------------------
// Smart zoom: edge boundary reduction
// ---------------------------------------------------------------------------

/**
 * Reduce zoom when cursor is near screen edges to avoid showing empty space.
 * Also reduces zoom in the title bar area for window captures.
 */
function applyEdgeBoundaryReduction(relX: number, relY: number, zoom: number): number {
  // Calculate how deep into the edge margin the cursor is (0 = not in margin, 1 = at edge)
  const edgeDepthLeft = Math.max(0, 1 - relX / EDGE_MARGIN_FRACTION);
  const edgeDepthRight = Math.max(0, 1 - (1 - relX) / EDGE_MARGIN_FRACTION);
  const edgeDepthTop = Math.max(0, 1 - relY / EDGE_MARGIN_FRACTION);
  const edgeDepthBottom = Math.max(0, 1 - (1 - relY) / EDGE_MARGIN_FRACTION);

  const maxEdgeDepth = Math.max(edgeDepthLeft, edgeDepthRight, edgeDepthTop, edgeDepthBottom);

  if (maxEdgeDepth > 0) {
    // Lerp between full zoom and reduced zoom based on edge depth
    const reduction = 1 - maxEdgeDepth * (1 - EDGE_ZOOM_REDUCTION);
    zoom = BASE_ZOOM + (zoom - BASE_ZOOM) * reduction;
  }

  // For window captures, reduce zoom in the title bar region
  if (isCapturingWindow && capturedBounds.height > 0) {
    const titleBarFraction = TITLE_BAR_HEIGHT_PX / capturedBounds.height;
    if (relY < titleBarFraction) {
      const titleBarDepth = 1 - relY / titleBarFraction;
      const titleReduction = 1 - titleBarDepth * (1 - EDGE_ZOOM_REDUCTION);
      zoom = BASE_ZOOM + (zoom - BASE_ZOOM) * titleReduction;
    }
  }

  return zoom;
}

// ---------------------------------------------------------------------------
// Smart zoom: click cluster detection
// ---------------------------------------------------------------------------

/**
 * Record a click and check if a cluster has formed.
 * Prunes old clicks outside the sliding window.
 */
function recordClick(x: number, y: number): void {
  const now = performance.now();

  // Add this click
  recentClicks.push({ time: now, x, y });

  // Prune clicks outside the sliding window
  recentClicks = recentClicks.filter(c => now - c.time <= CLUSTER_WINDOW_MS);

  // Check for cluster: find if CLUSTER_MIN_CLICKS clicks are within CLUSTER_RADIUS_PX
  if (recentClicks.length >= CLUSTER_MIN_CLICKS) {
    detectCluster();
  }
}

/**
 * Scan recent clicks for spatial clustering using a simple bounding-box check.
 * If a cluster is found, activates cluster zoom centered on the cluster.
 */
function detectCluster(): void {
  const n = recentClicks.length;

  // Try all subsets of size CLUSTER_MIN_CLICKS from the most recent clicks
  // For efficiency, just check the last CLUSTER_MIN_CLICKS clicks
  for (let start = Math.max(0, n - CLUSTER_MIN_CLICKS - 2); start <= n - CLUSTER_MIN_CLICKS; start++) {
    const subset = recentClicks.slice(start);

    // Calculate centroid
    let sumX = 0;
    let sumY = 0;
    for (const c of subset) {
      sumX += c.x;
      sumY += c.y;
    }
    const cx = sumX / subset.length;
    const cy = sumY / subset.length;

    // Check all clicks are within radius of centroid
    let allWithin = true;
    for (const c of subset) {
      const dx = c.x - cx;
      const dy = c.y - cy;
      if (Math.sqrt(dx * dx + dy * dy) > CLUSTER_RADIUS_PX) {
        allWithin = false;
        break;
      }
    }

    if (allWithin) {
      clusterCenter = { x: cx, y: cy };
      clusterZoomActive = true;
      return;
    }
  }
}

/**
 * Check if cursor has moved far enough from cluster center to release the cluster zoom.
 */
function checkClusterRelease(): boolean {
  if (!clusterCenter) return false;

  const dx = currentMouseX - clusterCenter.x;
  const dy = currentMouseY - clusterCenter.y;
  return Math.sqrt(dx * dx + dy * dy) > CLUSTER_RELEASE_DISTANCE_PX;
}

/**
 * Release the active cluster zoom.
 */
function releaseCluster(): void {
  clusterZoomActive = false;
  clusterCenter = null;
}

// ---------------------------------------------------------------------------
// Smart zoom: cursor velocity tracking
// ---------------------------------------------------------------------------

/**
 * Update cursor velocity. Called every frame from the render loop.
 * Uses exponential smoothing for stable velocity estimation.
 */
function updateCursorVelocity(): void {
  const now = performance.now();
  const dt = now - prevVelocityTime;
  prevVelocityTime = now;

  if (dt <= 0) return;

  // Calculate raw velocity in px/frame (normalized to 60fps)
  const dx = currentMouseX - prevMouseX;
  const dy = currentMouseY - prevMouseY;
  const rawDistance = Math.sqrt(dx * dx + dy * dy);
  const normalizedVelocity = rawDistance / (dt / 16.667); // normalize to 60fps frame

  prevMouseX = currentMouseX;
  prevMouseY = currentMouseY;

  // Exponential smoothing (α = 0.3 for responsiveness)
  cursorVelocity = cursorVelocity * 0.7 + normalizedVelocity * 0.3;

  const wasFast = cursorIsFast;

  if (cursorVelocity > VELOCITY_SLOW_THRESHOLD * 2) {
    // Cursor is moving fast — mark as fast, reset settle timer
    cursorIsFast = true;
    velocitySlowSince = 0;
    velocityZoomTriggered = false;
  } else if (cursorVelocity < VELOCITY_SLOW_THRESHOLD) {
    // Cursor is slow
    cursorIsFast = false;
    if (velocitySlowSince === 0) {
      velocitySlowSince = now;
    }
  }

  // If cursor was fast and just became slow, trigger zoom-out quickly
  if (wasFast && !cursorIsFast && currentZoom > BASE_ZOOM) {
    // Don't immediately zoom out — the easing zone handles the delay
  }

  // Auto-zoom on cursor stop (only if no click-based zoom is active)
  if (
    !velocityZoomTriggered &&
    !cursorIsFast &&
    velocitySlowSince > 0 &&
    !isMouseHeld &&
    !clusterZoomActive
  ) {
    const settledDuration = now - velocitySlowSince;

    if (settledDuration > EASING_ZONE_MS + VELOCITY_SETTLE_MS) {
      // Cursor has been still long enough — trigger gentle auto-zoom
      velocityZoomTriggered = true;
      triggerVelocityAutoZoom();
    }
  }
}

/**
 * Trigger a gentle auto-zoom to the current cursor position.
 * Uses a soft spring config for a subtle, non-jarring zoom.
 */
function triggerVelocityAutoZoom(): void {
  const relPos = getMouseRelativeToCaptured();
  if (!relPos) return;

  const dynamicZoom = calculateDynamicZoom(relPos.relX, relPos.relY);

  // Use a reduced zoom for velocity-based auto-zoom (less aggressive than click)
  const autoZoom = BASE_ZOOM + (dynamicZoom - BASE_ZOOM) * 0.6;

  activeSpringConfig = SMART_ZOOM_IN_SPRING;
  setSpringTarget(zoomSpring, autoZoom);

  // Set a timeout to zoom back out after the linger period
  if (zoomOutTimeout) {
    clearTimeout(zoomOutTimeout);
  }
  const timeout = setTimeout(() => {
    if (!isMouseHeld && !clusterZoomActive) {
      activeSpringConfig = ZOOM_OUT_SPRING;
      setSpringTarget(zoomSpring, BASE_ZOOM);
    }
    setZoomOutTimeout(null);
  }, zoomLingerTime);
  setZoomOutTimeout(timeout);
}

// ---------------------------------------------------------------------------
// Smart zoom: per-frame update (called from render loop)
// ---------------------------------------------------------------------------

/**
 * Per-frame smart zoom logic. Handles:
 * - Cursor velocity tracking and auto-zoom
 * - Cluster zoom hold/release
 * - Fast-movement zoom suppression
 */
function updateSmartZoom(): void {
  if (!activeSmartZoom) return;

  // Update velocity tracking
  updateCursorVelocity();

  // If cursor is moving fast and we're zoomed in (not from a cluster), zoom out quickly
  if (cursorIsFast && currentZoom > BASE_ZOOM && !clusterZoomActive && !isMouseHeld) {
    activeSpringConfig = SMART_ZOOM_OUT_SPRING;
    setSpringTarget(zoomSpring, BASE_ZOOM);

    // Cancel any pending zoom-out timeout
    if (zoomOutTimeout) {
      clearTimeout(zoomOutTimeout);
      setZoomOutTimeout(null);
    }
  }

  // Check cluster release
  if (clusterZoomActive && checkClusterRelease()) {
    releaseCluster();

    // Zoom out after cluster release (unless mouse is held from a new click)
    if (!isMouseHeld) {
      activeSpringConfig = ZOOM_OUT_SPRING;
      setSpringTarget(zoomSpring, BASE_ZOOM);
    }
  }

  // If cluster is active, keep zoom target refreshed (cursor may have moved within cluster)
  if (clusterZoomActive && clusterCenter) {
    const relPos = getMouseRelativeToCaptured();
    if (relPos) {
      const baseZoom = calculateDynamicZoom(relPos.relX, relPos.relY);
      const boostedZoom = Math.min(baseZoom * CLUSTER_ZOOM_BOOST, 3.0);
      setSpringTarget(zoomSpring, boostedZoom);
    }
  }
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

  // Smart zoom: suppress zoom-in if cursor is moving fast
  if (activeSmartZoom && cursorIsFast) {
    setLastClickDownTime(now);
    // Record the click for cluster detection even if zoom is suppressed
    recordClick(currentMouseX, currentMouseY);
    return;
  }

  // Smart zoom: record click for cluster detection
  if (activeSmartZoom) {
    recordClick(currentMouseX, currentMouseY);
  }

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

  let dynamicZoom = calculateDynamicZoom(relPos.relX, relPos.relY);

  // Smart zoom: apply cluster boost if cluster is active
  if (activeSmartZoom && clusterZoomActive) {
    dynamicZoom = Math.min(dynamicZoom * CLUSTER_ZOOM_BOOST, 3.0);
  }

  // Use appropriate spring config
  if (activeSmartZoom && clusterZoomActive) {
    // Soft spring for cluster focus — gentle, sustained
    activeSpringConfig = SMART_ZOOM_IN_SPRING;
  } else {
    // Standard snappy spring for click zoom-in
    activeSpringConfig = ZOOM_IN_SPRING;
  }

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

  // Smart zoom: if cluster is active, don't start zoom-out timer — hold the zoom
  if (activeSmartZoom && clusterZoomActive) {
    return;
  }

  if (zoomOutTimeout) {
    clearTimeout(zoomOutTimeout);
  }

  const timeout = setTimeout(() => {
    // Only zoom out if mouse is not being held (user may have clicked again)
    if (!isMouseHeld) {
      // Smart zoom: don't zoom out if a cluster is now active
      if (activeSmartZoom && clusterZoomActive) {
        setZoomOutTimeout(null);
        return;
      }
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

/** Position the cursor overlay on top of the screen video preview. */
function updateCursorOverlay(): void {
  if (!screenStream || !screenVideo.classList.contains('active')) {
    cursorOverlay.style.display = 'none';
    return;
  }

  const relPos = getMouseRelativeToCaptured();
  if (!relPos) {
    cursorOverlay.style.display = 'none';
    return;
  }

  // Get the video's visual rect relative to the preview container.
  // Use getBoundingClientRect() which accounts for CSS transforms (translateY, scale).
  const containerRect = previewContainer.getBoundingClientRect();
  const videoRect = screenVideo.getBoundingClientRect();

  // When zoomed, clip-path crops the scaled video back to its original bounds,
  // so the visible area is the unscaled size at the unscaled position.
  // getBoundingClientRect() returns the scaled (pre-clip) rect, so we must
  // use the layout dimensions instead.
  let videoLeft: number, videoTop: number, videoW: number, videoH: number;

  if (currentZoom > 1.0) {
    videoW = screenVideo.offsetWidth;
    videoH = screenVideo.offsetHeight;
    videoLeft = screenVideo.offsetLeft;
    // offsetTop gives CSS top (50% of container) — subtract half height for translateY(-50%)
    videoTop = screenVideo.offsetTop - videoH / 2;
  } else {
    // No zoom: getBoundingClientRect gives accurate visual position
    videoLeft = videoRect.left - containerRect.left;
    videoTop = videoRect.top - containerRect.top;
    videoW = videoRect.width;
    videoH = videoRect.height;
  }

  // Account for zoom crop — when zoomed, the visible region is smaller
  let visRelX = relPos.relX;
  let visRelY = relPos.relY;
  if (currentZoom > 1.0) {
    const halfView = 0.5 / currentZoom;
    const centerX = Math.max(halfView, Math.min(1 - halfView, relPos.relX));
    const centerY = Math.max(halfView, Math.min(1 - halfView, relPos.relY));
    visRelX = (relPos.relX - (centerX - halfView)) / (halfView * 2);
    visRelY = (relPos.relY - (centerY - halfView)) / (halfView * 2);
    visRelX = Math.max(0, Math.min(1, visRelX));
    visRelY = Math.max(0, Math.min(1, visRelY));
  }

  const cx = videoLeft + visRelX * videoW;
  const cy = videoTop + visRelY * videoH;

  cursorOverlay.style.display = 'block';
  cursorOverlay.style.left = `${Math.round(cx)}px`;
  cursorOverlay.style.top = `${Math.round(cy)}px`;
}

function zoomRenderLoop(): void {
  try {
    updateSmoothMouse();
    updateSmartZoom();
    applyScreenZoomTransform();
    updateCursorOverlay();
    getDrawPreviewBackground()();

    // Update preview spotlight overlay position (uses relative mouse coords)
    if (activeSpotlight) {
      const relPos = getMouseRelativeToCaptured();
      if (relPos) {
        updatePreviewSpotlight(relPos.relX, relPos.relY);
      }
    }
  } catch (err) {
    console.warn('zoomRenderLoop error:', err);
  }

  zoomAnimFrame = requestAnimationFrame(zoomRenderLoop);
}

export function startZoomLoop(): void {
  if (zoomAnimFrame) {
    return;
  }
  // Initialize velocity tracking state
  prevMouseX = currentMouseX;
  prevMouseY = currentMouseY;
  prevVelocityTime = performance.now();
  cursorVelocity = 0;
  velocitySlowSince = 0;
  velocityZoomTriggered = false;
  cursorIsFast = false;

  zoomAnimFrame = requestAnimationFrame(zoomRenderLoop);
}

export function stopZoomLoop(): void {
  if (zoomAnimFrame) {
    cancelAnimationFrame(zoomAnimFrame);
    zoomAnimFrame = 0;
  }
  cursorOverlay.style.display = 'none';
  // Reset smart zoom state
  recentClicks = [];
  clusterCenter = null;
  clusterZoomActive = false;
  cursorVelocity = 0;
  velocitySlowSince = 0;
  velocityZoomTriggered = false;
  cursorIsFast = false;
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

/** Check if a click cluster zoom is currently active */
export function isClusterZoomActive(): boolean {
  return clusterZoomActive;
}

/** Get the current smoothed cursor velocity (px/frame at 60fps) */
export function getCursorVelocity(): number {
  return cursorVelocity;
}

export { zoomSpring, MOUSE_ZOOM_DEFAULT, BASE_ZOOM };
