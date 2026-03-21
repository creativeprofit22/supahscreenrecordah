// Mouse tracking — smooth interpolation with dead zone and velocity cap.
// No DOM-rendered cursor; the native cursor is hidden and coordinates
// drive zoom targeting via the zoom module.

import {
  currentMouseX, currentMouseY,
  smoothMouseX, smoothMouseY,
  setSmoothMouseX, setSmoothMouseY,
  currentZoom, setCurrentZoom,
} from '../state';
import { getZoomSpring, activeSpringConfig } from '../zoom';
import { stepSpring } from '../../../shared/zoom';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** ms to reach ~63% of target — time-based for consistent results regardless of frame rate */
const CAMERA_SMOOTH_TIME = 300;

/** Circular dead zone radius around camera centre (in screen pixels) */
const WIGGLE_ROOM_RADIUS = 20;

/** Max pixels the camera can move per second */
const MAX_CAMERA_VELOCITY = 2500;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let lastUpdateTime = performance.now();

// ---------------------------------------------------------------------------
// Smooth mouse interpolation (time-based, with wiggle room + velocity cap)
// ---------------------------------------------------------------------------

/**
 * Time-based exponential smoothing with a circular dead zone and velocity cap.
 *
 * Reads `currentMouseX/Y` from state, writes `smoothMouseX/Y`.
 * Also steps the zoom spring so zoom interpolation stays in sync.
 */
export function updateSmoothMouse(): void {
  const now = performance.now();
  const deltaTime = now - lastUpdateTime;
  lastUpdateTime = now;

  const cameraFactor = 1 - Math.exp(-deltaTime / CAMERA_SMOOTH_TIME);

  const offsetX = currentMouseX - smoothMouseX;
  const offsetY = currentMouseY - smoothMouseY;
  const distance = Math.sqrt(offsetX * offsetX + offsetY * offsetY);

  let targetX = smoothMouseX;
  let targetY = smoothMouseY;
  if (distance > WIGGLE_ROOM_RADIUS) {
    const angle = Math.atan2(offsetY, offsetX);
    targetX = currentMouseX - Math.cos(angle) * WIGGLE_ROOM_RADIUS;
    targetY = currentMouseY - Math.sin(angle) * WIGGLE_ROOM_RADIUS;
  }

  let moveX = (targetX - smoothMouseX) * cameraFactor;
  let moveY = (targetY - smoothMouseY) * cameraFactor;

  const maxMove = MAX_CAMERA_VELOCITY * (deltaTime / 1000);
  const moveDistance = Math.sqrt(moveX * moveX + moveY * moveY);
  if (moveDistance > maxMove && moveDistance > 0) {
    const scale = maxMove / moveDistance;
    moveX *= scale;
    moveY *= scale;
  }

  setSmoothMouseX(smoothMouseX + moveX);
  setSmoothMouseY(smoothMouseY + moveY);

  // Smooth zoom interpolation via spring physics — frame-rate independent,
  // preserves velocity across target changes for smooth mid-flight interruptions.
  const zoomSpring = getZoomSpring();
  stepSpring(zoomSpring, activeSpringConfig, deltaTime / 1000);
  setCurrentZoom(zoomSpring.position);
}
