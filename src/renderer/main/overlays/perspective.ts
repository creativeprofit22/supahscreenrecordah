// 3D perspective tilt effect — subtle skew transform that follows cursor movement
// to simulate looking at the screen from slightly different angles.
// Uses canvas 2D affine transforms (skew approximation of 3D tilt).

/**
 * Affine transform matrix components for canvas setTransform().
 * Represents: | a c e |
 *             | b d f |
 */
export interface PerspectiveTransform {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/**
 * Calculate a 2D affine transform that simulates 3D perspective tilt
 * based on mouse position relative to the screen center.
 *
 * @param mouseX     - 0–1 relative X within the screen area
 * @param mouseY     - 0–1 relative Y within the screen area
 * @param maxAngleDeg - maximum tilt angle in degrees (2–3 recommended)
 * @param screenW    - destination screen width on canvas (pixels)
 * @param screenH    - destination screen height on canvas (pixels)
 * @returns Affine transform components to multiply with existing transform
 */
export function getPerspectiveTransform(
  mouseX: number,
  mouseY: number,
  maxAngleDeg: number,
  screenW: number,
  screenH: number,
): PerspectiveTransform {
  // Convert mouse position to offset from center (-0.5 to 0.5)
  const dx = mouseX - 0.5;
  const dy = mouseY - 0.5;

  // Calculate tilt angles
  // Mouse right → tilt right edge away (positive Y rotation)
  // Mouse down  → tilt bottom edge away (positive X rotation)
  const tiltX = -dy * maxAngleDeg * (Math.PI / 180); // vertical tilt
  const tiltY = dx * maxAngleDeg * (Math.PI / 180);  // horizontal tilt

  // Build a perspective-like transform using subtle skew.
  // True 3D requires WebGL, but a slight skew on canvas 2D produces a
  // convincing tilt at small angles (< 5°).  The 0.3 factor keeps the
  // skew visually proportional to the tilt angle.
  return {
    a: 1,
    b: Math.tan(tiltX) * 0.3, // vertical skew component
    c: Math.tan(tiltY) * 0.3, // horizontal skew component
    d: 1,
    e: 0,
    f: 0,
  };
}

/**
 * Apply perspective transform to a canvas context around a given screen rect.
 * The transform is centred on the screen area so the tilt pivots from the middle.
 *
 * @returns true if a transform was applied (caller must reset after drawing)
 */
export function applyPerspectiveToCtx(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  mouseX: number,
  mouseY: number,
  maxAngleDeg: number,
  screenX: number,
  screenY: number,
  screenW: number,
  screenH: number,
): boolean {
  if (maxAngleDeg <= 0) return false;

  const t = getPerspectiveTransform(mouseX, mouseY, maxAngleDeg, screenW, screenH);

  // Translate so the centre of the screen area is at the origin,
  // apply the skew, then translate back.
  const cx = screenX + screenW / 2;
  const cy = screenY + screenH / 2;

  ctx.translate(cx, cy);
  ctx.transform(t.a, t.b, t.c, t.d, t.e, t.f);
  ctx.translate(-cx, -cy);

  return true;
}
