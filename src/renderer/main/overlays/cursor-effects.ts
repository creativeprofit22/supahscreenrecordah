// Cursor trail and click ripple visual effects
// ---------------------------------------------------------------------------
// Draws subtle cursor trail (dots / glow / line) and expanding click ripples
// on the recording canvas, clipped to the screen capture area.
// ---------------------------------------------------------------------------

import type { CursorTrailStyle, CursorEffectConfig } from '../../../shared/feature-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrailPoint {
  x: number;
  y: number;
  time: number;
}

export interface ClickRipple {
  x: number;
  y: number;
  startTime: number;
  color: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRAIL_MAX_POINTS = 24;
const TRAIL_MAX_AGE_MS = 400;         // trail fades over this duration

const RIPPLE_DURATION_MS = 450;       // ripple expand + fade time
const RIPPLE_MAX_RADIUS = 28;         // max radius in screen pixels (before scale)
const RIPPLE_LINE_WIDTH = 2;          // stroke width in screen pixels (before scale)
const RIPPLE_CLEANUP_MS = 500;        // remove ripples older than this

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let trailPoints: TrailPoint[] = [];
let activeRipples: ClickRipple[] = [];
let cursorEffectConfig: CursorEffectConfig = {
  trail: 'none',
  clickRipple: false,
  clickRippleColor: '#ffffff',
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export function setCursorEffectConfig(config: CursorEffectConfig): void {
  cursorEffectConfig = config;
  // Clear trail when switching to 'none'
  if (config.trail === 'none') {
    trailPoints = [];
  }
}

export function getCursorEffectConfig(): CursorEffectConfig {
  return cursorEffectConfig;
}

// ---------------------------------------------------------------------------
// Trail point management
// ---------------------------------------------------------------------------

/**
 * Push a new trail point. Called every frame from the recording loop
 * with the current mouse position in screen coordinates.
 */
export function pushTrailPoint(x: number, y: number): void {
  if (cursorEffectConfig.trail === 'none') return;

  const now = performance.now();
  trailPoints.push({ x, y, time: now });

  // Trim old points
  while (trailPoints.length > TRAIL_MAX_POINTS) {
    trailPoints.shift();
  }
  // Remove points older than max age
  const cutoff = now - TRAIL_MAX_AGE_MS;
  while (trailPoints.length > 0 && trailPoints[0]!.time < cutoff) {
    trailPoints.shift();
  }
}

/** Clear all trail points (e.g. on recording stop). */
export function clearTrail(): void {
  trailPoints = [];
}

// ---------------------------------------------------------------------------
// Click ripple management
// ---------------------------------------------------------------------------

/** Spawn a click ripple at the given screen coordinates. */
export function addClickRipple(x: number, y: number): void {
  if (!cursorEffectConfig.clickRipple) return;
  activeRipples.push({
    x,
    y,
    startTime: performance.now(),
    color: cursorEffectConfig.clickRippleColor || '#ffffff',
  });
}

/** Remove expired ripples. */
function pruneRipples(): void {
  const now = performance.now();
  activeRipples = activeRipples.filter(r => now - r.startTime < RIPPLE_CLEANUP_MS);
}

/** Clear all ripples (e.g. on recording stop). */
export function clearRipples(): void {
  activeRipples = [];
}

// ---------------------------------------------------------------------------
// Hex → RGBA helper
// ---------------------------------------------------------------------------

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16) || 255;
  const g = parseInt(h.substring(2, 4), 16) || 255;
  const b = parseInt(h.substring(4, 6), 16) || 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---------------------------------------------------------------------------
// Trail drawing
// ---------------------------------------------------------------------------

/**
 * Draw cursor trail on the recording canvas.
 *
 * @param ctx       - Recording canvas context (already clipped to screen area)
 * @param screenX   - Screen area left edge in canvas coords
 * @param screenY   - Screen area top edge in canvas coords
 * @param screenW   - Screen area width in canvas coords
 * @param screenH   - Screen area height in canvas coords
 * @param relMouseX - Mouse X relative to captured content (0–1)
 * @param relMouseY - Mouse Y relative to captured content (0–1)
 * @param scale     - Canvas scale factor
 */
export function drawCursorTrail(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  screenW: number,
  screenH: number,
  scale: number,
): void {
  if (cursorEffectConfig.trail === 'none' || trailPoints.length < 2) return;

  const now = performance.now();
  const style = cursorEffectConfig.trail;

  // Convert trail points from screen coords to canvas coords
  // Trail points are stored as screen-relative (0–1) via pushTrailPoint
  // Actually they're stored as absolute relX/relY — we convert in the draw call
  // We'll work with the raw points and the caller should have stored them as
  // canvas-space positions already.

  // Map trail points to canvas coordinates
  const mapped = trailPoints.map(p => ({
    cx: screenX + p.x * screenW,
    cy: screenY + p.y * screenH,
    age: (now - p.time) / TRAIL_MAX_AGE_MS, // 0 = newest, 1 = oldest
  }));

  switch (style) {
    case 'dots':
      drawTrailDots(ctx, mapped, scale);
      break;
    case 'glow':
      drawTrailGlow(ctx, mapped, scale);
      break;
    case 'line':
      drawTrailLine(ctx, mapped, scale);
      break;
  }
}

/** Dots trail: circles decreasing in opacity and size. */
function drawTrailDots(
  ctx: CanvasRenderingContext2D,
  points: Array<{ cx: number; cy: number; age: number }>,
  scale: number,
): void {
  const maxRadius = 3 * scale;
  const color = '#a0b4d0'; // muted blue-grey

  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const alpha = Math.max(0, (1 - p.age) * 0.6);
    const radius = maxRadius * Math.max(0.3, 1 - p.age * 0.7);

    ctx.beginPath();
    ctx.arc(p.cx, p.cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = hexToRgba(color, alpha);
    ctx.fill();
  }
}

/** Glow trail: soft radial gradient at current position + fading positions. */
function drawTrailGlow(
  ctx: CanvasRenderingContext2D,
  points: Array<{ cx: number; cy: number; age: number }>,
  scale: number,
): void {
  const glowRadius = 12 * scale;

  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const alpha = Math.max(0, (1 - p.age) * 0.3);
    const radius = glowRadius * Math.max(0.4, 1 - p.age * 0.5);

    const gradient = ctx.createRadialGradient(p.cx, p.cy, 0, p.cx, p.cy, radius);
    gradient.addColorStop(0, hexToRgba('#c0d8f0', alpha));
    gradient.addColorStop(0.5, hexToRgba('#80a8d0', alpha * 0.4));
    gradient.addColorStop(1, hexToRgba('#80a8d0', 0));

    ctx.beginPath();
    ctx.arc(p.cx, p.cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
  }
}

/** Line trail: smooth curve through recent positions with decreasing width. */
function drawTrailLine(
  ctx: CanvasRenderingContext2D,
  points: Array<{ cx: number; cy: number; age: number }>,
  scale: number,
): void {
  if (points.length < 2) return;

  const maxWidth = 2.5 * scale;
  const color = '#a0b4d0';

  // Draw segments with varying width and opacity
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    const alpha = Math.max(0, (1 - curr.age) * 0.55);
    const width = maxWidth * Math.max(0.2, 1 - curr.age * 0.8);

    ctx.beginPath();
    ctx.moveTo(prev.cx, prev.cy);

    // Use quadratic curve through midpoint for smoothness
    if (i + 1 < points.length) {
      const next = points[i + 1]!;
      const midX = (curr.cx + next.cx) / 2;
      const midY = (curr.cy + next.cy) / 2;
      ctx.quadraticCurveTo(curr.cx, curr.cy, midX, midY);
    } else {
      ctx.lineTo(curr.cx, curr.cy);
    }

    ctx.strokeStyle = hexToRgba(color, alpha);
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Click ripple drawing
// ---------------------------------------------------------------------------

/**
 * Draw active click ripples on the recording canvas.
 *
 * @param ctx       - Recording canvas context (already clipped to screen area)
 * @param screenX   - Screen area left edge in canvas coords
 * @param screenY   - Screen area top edge in canvas coords
 * @param screenW   - Screen area width in canvas coords
 * @param screenH   - Screen area height in canvas coords
 * @param scale     - Canvas scale factor
 */
export function drawClickRipples(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  screenW: number,
  screenH: number,
  scale: number,
): void {
  pruneRipples();
  if (activeRipples.length === 0) return;

  const now = performance.now();
  const maxRadius = RIPPLE_MAX_RADIUS * scale;
  const lineWidth = RIPPLE_LINE_WIDTH * scale;

  for (const ripple of activeRipples) {
    const elapsed = now - ripple.startTime;
    if (elapsed > RIPPLE_DURATION_MS) continue;

    const progress = elapsed / RIPPLE_DURATION_MS;

    // Ease out cubic for smooth expansion
    const easedProgress = 1 - Math.pow(1 - progress, 3);
    const radius = maxRadius * easedProgress;

    // Alpha fades out, starting strong
    const alpha = Math.max(0, (1 - progress) * 0.7);

    // Convert ripple position (stored as relative 0–1) to canvas coords
    const cx = screenX + ripple.x * screenW;
    const cy = screenY + ripple.y * screenH;

    // Outer ring
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = hexToRgba(ripple.color, alpha);
    ctx.lineWidth = lineWidth;
    ctx.stroke();

    // Inner filled dot (fades faster)
    const dotAlpha = Math.max(0, (1 - progress * 1.5) * 0.4);
    if (dotAlpha > 0) {
      const dotRadius = 3 * scale * (1 - easedProgress * 0.5);
      ctx.beginPath();
      ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2);
      ctx.fillStyle = hexToRgba(ripple.color, dotAlpha);
      ctx.fill();
    }
  }
}

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

export function hasActiveEffects(): boolean {
  return (
    (cursorEffectConfig.trail !== 'none' && trailPoints.length >= 2) ||
    (cursorEffectConfig.clickRipple && activeRipples.length > 0)
  );
}
