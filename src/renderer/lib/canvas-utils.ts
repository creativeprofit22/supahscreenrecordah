/**
 * drawImage variant that handles source coordinates outside the video bounds.
 * When the crop region extends beyond the source (e.g. cursor-follow at screen edges),
 * only the valid portion is drawn; the overflow area keeps whatever was already painted
 * (typically the background fill).
 */
export function drawImageEdgeSafe(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sx: number, sy: number, sw: number, sh: number,
  dx: number, dy: number, dw: number, dh: number,
  sourceW: number, sourceH: number,
): void {
  // Clamp source rect to valid pixel range
  const clampedSx = Math.max(0, sx);
  const clampedSy = Math.max(0, sy);
  const clampedRight = Math.min(sourceW, sx + sw);
  const clampedBottom = Math.min(sourceH, sy + sh);
  const clampedSw = clampedRight - clampedSx;
  const clampedSh = clampedBottom - clampedSy;

  if (clampedSw <= 0 || clampedSh <= 0) return;

  // Map the clamped source region to the corresponding destination region
  const offsetX = (clampedSx - sx) / sw;
  const offsetY = (clampedSy - sy) / sh;
  const scaleX = clampedSw / sw;
  const scaleY = clampedSh / sh;

  ctx.drawImage(
    source,
    clampedSx, clampedSy, clampedSw, clampedSh,
    dx + offsetX * dw, dy + offsetY * dh,
    scaleX * dw, scaleY * dh,
  );
}
