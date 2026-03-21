// Action feed — agent-style activity log overlaid on the camera area
// ---------------------------------------------------------------------------

import { actionFeedCanvas, actionFeedCtx, cameraContainer, cameraVideo, previewContainer } from '../dom';
import { cameraStream } from '../state';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActionFeedEvent {
  type: string;
  label: string;
}

interface ActionFeedItem {
  event: ActionFeedEvent;
  slotIndex: number;
  enterTime: number;
  opacity: number;
  slideX: number;
  targetY: number;
  currentY: number;
  computedHeight: number;
}

interface CamRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------------------------------------------------------------------------
// SVG icon paths for action types (16×16 viewBox)
// ---------------------------------------------------------------------------

export const ACTION_ICON_PATHS: Record<string, string> = {
  // Cursor/pointer icon
  click: 'M3 1L3 11L5.5 8.5L8 14L10 13L7.5 7L11 7Z',
  // Keyboard icon
  type: 'M1 4H15V13H1V4ZM3 6H5V8H3V6ZM7 6H9V8H7V6ZM11 6H13V8H11V6ZM4 9H12V11H4V9Z',
  // Lightning bolt icon
  shortcut: 'M9 1L4 9H8L7 15L12 7H8Z',
  // Mouse scroll icon
  scroll: 'M8 1C5.2 1 3 3.2 3 6V10C3 12.8 5.2 15 8 15C10.8 15 13 12.8 13 10V6C13 3.2 10.8 1 8 1ZM8 3C9.7 3 11 4.3 11 6V10C11 11.7 9.7 13 8 13C6.3 13 5 11.7 5 10V6C5 4.3 6.3 3 8 3ZM7.5 5V8H8.5V5H7.5Z',
};

// Cache parsed Path2D objects for action icons — avoids re-parsing SVG paths every frame
const actionPath2DCache = new Map<string, Path2D>();

function getActionPath2D(actionType: string): Path2D {
  let p = actionPath2DCache.get(actionType);
  if (!p) {
    p = new Path2D(ACTION_ICON_PATHS[actionType]);
    actionPath2DCache.set(actionType, p);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACTION_FEED_MAX = 5;
const ACTION_SLIDE_DURATION = 500;      // ms for slide-in
const ACTION_ITEM_HEIGHT = 28;          // px in preview space (single-line pill)
const ACTION_ITEM_GAP = 6;             // px gap between items
const ACTION_ITEM_PADDING_H = 10;      // horizontal padding inside pill
const ACTION_ITEM_PADDING_V = 7;       // vertical padding inside pill
const ACTION_ICON_SIZE = 14;           // icon size in preview space
const ACTION_FONT_SIZE = 11;           // font size in preview space
const ACTION_LINE_HEIGHT = 14;         // line height for wrapped text
const ACTION_MARGIN_BOTTOM = 12;       // px from bottom of camera
const ACTION_MARGIN_RIGHT = 12;        // px from right edge of camera
const ACTION_MAX_PILL_W_RATIO = 0.9;   // max pill width as fraction of camera width
const ACTION_MAX_LINES = 3;            // max text lines before truncation

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let actionFeedItems: ActionFeedItem[] = [];
let previewFeedAnimFrame = 0;
let lastActionFeedUpdateFrame = -1;

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/**
 * Truncate a single-line label to fit maxWidth.
 * For 'type' actions, keeps the END of the text (most recently typed) with leading …
 * For other actions, keeps the START with trailing …
 */
function truncateLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  fromStart: boolean,
): string {
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }

  if (fromStart) {
    // Keep the end (most recent typing), prepend …
    let truncated = text;
    while (ctx.measureText(`…${truncated}`).width > maxWidth && truncated.length > 1) {
      truncated = truncated.slice(1);
    }
    return `…${truncated}`;
  }

  // Keep the start, append …
  let truncated = text;
  while (ctx.measureText(`${truncated}…`).width > maxWidth && truncated.length > 1) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}…`;
}

/**
 * Word-wrap text to fit within maxWidth, returning an array of lines.
 * Truncates with ellipsis if more than maxLines are needed.
 * If fromStart is true, truncation removes the beginning (for typing labels).
 */
function wrapActionText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
  fromStart: boolean,
): string[] {
  // If the text has no spaces (common for typing), handle as single line
  if (!text.includes(' ')) {
    return [truncateLabel(ctx, text, maxWidth, fromStart)];
  }

  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = ctx.measureText(testLine).width;

    if (testWidth > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
      if (lines.length >= maxLines) {
        // Truncate the last line
        lines[lines.length - 1] = truncateLabel(ctx, lines[lines.length - 1] ?? '', maxWidth, fromStart);
        return lines;
      }
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine) {
    if (lines.length >= maxLines) {
      lines[lines.length - 1] = truncateLabel(ctx, lines[lines.length - 1] ?? '', maxWidth, fromStart);
    } else {
      lines.push(currentLine);
    }
  }

  return lines.length > 0 ? lines : [text];
}

// ---------------------------------------------------------------------------
// Icon drawing
// ---------------------------------------------------------------------------

/**
 * Draw an action type icon on the canvas.
 * Uses simple path rendering scaled to the icon size.
 */
function drawActionIcon(
  ctx: CanvasRenderingContext2D,
  actionType: string,
  x: number,
  y: number,
  size: number,
): void {
  const iconScale = size / 16; // paths are designed for 16×16 viewBox
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(iconScale, iconScale);
  ctx.fillStyle = '#000000';
  ctx.fill(getActionPath2D(actionType));
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Animation update (deduped per frame)
// ---------------------------------------------------------------------------

/** Update action feed animation state each frame. */
function updateActionFeed(): void {
  // Prevent double-updating when both preview and recording loops call this in the same frame
  const frame = Math.round(performance.now());
  if (frame === lastActionFeedUpdateFrame) {
    return;
  }
  lastActionFeedUpdateFrame = frame;

  const now = performance.now();

  // Sort by slotIndex ascending (0 = newest/bottom, higher = older/top)
  const sorted = [...actionFeedItems].sort((a, b) => a.slotIndex - b.slotIndex);

  // Compute targetY: cumulative heights of items below (slot 0 starts at y=0)
  let cumulativeY = 0;
  for (const item of sorted) {
    item.targetY = cumulativeY;
    cumulativeY += item.computedHeight + ACTION_ITEM_GAP;
  }

  for (const item of actionFeedItems) {
    // Slide-in animation: easeOutCubic from right edge into final position
    const slideElapsed = now - item.enterTime;
    const t = Math.min(1, slideElapsed / ACTION_SLIDE_DURATION);
    const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
    item.slideX = 1 - eased; // 1 (offscreen right) → 0 (in place)

    // Smooth Y interpolation (springy vertical movement)
    const yDiff = item.targetY - item.currentY;
    item.currentY += yDiff * 0.15; // smooth lerp factor

    // Time-based fade: fully visible for 3.5s, then fade over 1.5s (total 5s lifetime)
    const age = now - item.enterTime;
    const FADE_START = 3500;
    const FADE_DURATION = 1500;
    if (age > FADE_START) {
      item.opacity = Math.max(0, 1 - (age - FADE_START) / FADE_DURATION);
    }

    // Also immediately fade items pushed beyond max
    if (item.slotIndex >= ACTION_FEED_MAX) {
      item.opacity = Math.max(0, item.opacity - 0.05);
    }
  }

  // Remove fully faded items
  actionFeedItems = actionFeedItems.filter((item) => item.opacity > 0.01);
}

// ---------------------------------------------------------------------------
// Canvas drawing — recording canvas
// ---------------------------------------------------------------------------

/**
 * Draw the action feed on the recording canvas.
 * Positioned at bottom-right of the camera video area.
 */
export function drawActionFeedOnCanvas(
  ctx: CanvasRenderingContext2D,
  camRect: CamRect,
  scale: number,
): void {
  if (actionFeedItems.length === 0) {
    return;
  }

  updateActionFeed();

  // Clip to camera bounds so pills slide in from under the border
  ctx.save();
  ctx.beginPath();
  ctx.rect(camRect.x, camRect.y, camRect.w, camRect.h);
  ctx.clip();

  const fontSize = ACTION_FONT_SIZE * scale;
  const iconSize = ACTION_ICON_SIZE * scale;
  const padH = ACTION_ITEM_PADDING_H * scale;
  const padV = ACTION_ITEM_PADDING_V * scale;
  const lineHeight = ACTION_LINE_HEIGHT * scale;
  const marginBottom = ACTION_MARGIN_BOTTOM * scale;
  const marginRight = ACTION_MARGIN_RIGHT * scale;
  const cornerRadius = 6 * scale;
  const iconTextGap = 6 * scale;
  const maxPillTextW = camRect.w * ACTION_MAX_PILL_W_RATIO - padH * 2 - iconSize - iconTextGap;

  const boldFont = `400 ${fontSize}px "Datatype", "Roboto", system-ui, sans-serif`;
  ctx.font = boldFont;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  // Shimmer animation — sweeps a highlight across text over time
  const shimmerCycle = 1800; // ms per full sweep
  const now = performance.now();

  // Anchor point: bottom-right of camera
  const anchorRight = camRect.x + camRect.w - marginRight;
  const anchorBottom = camRect.y + camRect.h - marginBottom;

  for (const item of actionFeedItems) {
    const label = item.event.label;
    ctx.font = boldFont;

    // Word-wrap text if it exceeds the max pill width
    // For 'type' actions, truncate from the start to show most recently typed text
    const truncateFromStart = item.event.type === 'type';
    const lines = wrapActionText(ctx, label, maxPillTextW, ACTION_MAX_LINES, truncateFromStart);
    const numLines = lines.length;

    // Find the widest line for pill width
    let maxLineW = 0;
    for (const line of lines) {
      const lineW = ctx.measureText(line).width;
      if (lineW > maxLineW) {
        maxLineW = lineW;
      }
    }

    const pillW = padH + iconSize + iconTextGap + maxLineW + padH;
    const pillH = numLines === 1 ? ACTION_ITEM_HEIGHT * scale : padV * 2 + numLines * lineHeight;

    // Update computedHeight in preview-space px (unscaled) for targetY stacking
    item.computedHeight = pillH / scale;

    // Position: anchored at bottom-right, items stack upward
    const itemY = item.currentY * scale;
    // slideX is in [0, 1]: 1 = pill fully off right, 0 = at final position
    const slideOffset = item.slideX * (pillW + marginRight + 40 * scale);
    const pillX = anchorRight - pillW + slideOffset;
    const pillY = anchorBottom - pillH - itemY;

    ctx.save();
    ctx.globalAlpha = item.opacity;

    // Pill shadow — lightweight offset rectangle instead of expensive shadowBlur
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.beginPath();
    ctx.roundRect(pillX + 1, pillY + 2 * scale, pillW, pillH, cornerRadius);
    ctx.fill();

    // White pill background with rounded corners
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(pillX, pillY, pillW, pillH, cornerRadius);
    ctx.fill();

    // Icon — vertically centred in pill
    const iconX = pillX + padH;
    const iconY = pillY + (pillH - iconSize) / 2;
    drawActionIcon(ctx, item.event.type, iconX, iconY, iconSize);

    // Text with animated shimmer gradient — one line or multi-line
    const textX = iconX + iconSize + iconTextGap;
    ctx.font = boldFont;

    // Measure total text width for shimmer (use widest line)
    const shimmerWidth = maxLineW * 0.4;
    const elapsed = (now - item.enterTime) % shimmerCycle;
    const progress = elapsed / shimmerCycle;
    const shimmerPos = textX - shimmerWidth + (maxLineW + shimmerWidth * 2) * progress;

    const grad = ctx.createLinearGradient(shimmerPos, 0, shimmerPos + shimmerWidth, 0);
    grad.addColorStop(0, '#1a1a2e');
    grad.addColorStop(0.35, '#6c63ff');
    grad.addColorStop(0.5, '#e0e0ff');
    grad.addColorStop(0.65, '#6c63ff');
    grad.addColorStop(1, '#1a1a2e');

    // Clip to the text region so shimmer doesn't bleed outside the pill
    ctx.save();
    ctx.beginPath();
    ctx.rect(textX - 1, pillY, maxLineW + 2, pillH);
    ctx.clip();
    ctx.fillStyle = grad;

    if (numLines === 1) {
      // Single-line: vertically centred
      ctx.fillText(lines[0] ?? '', textX, pillY + pillH / 2);
    } else {
      // Multi-line: stack lines from top with padding
      for (let li = 0; li < numLines; li++) {
        const textY = pillY + padV + lineHeight * li + lineHeight / 2;
        ctx.fillText(lines[li] ?? '', textX, textY);
      }
    }

    ctx.restore();
    ctx.restore();
  }

  // Restore from camera clip
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Live preview action feed — overlay canvas on top of camera
// ---------------------------------------------------------------------------

/** Position & size the action feed canvas to match the camera video element */
function positionActionFeedCanvas(): void {
  const hasCam = cameraContainer.classList.contains('active');
  if (!hasCam) {
    actionFeedCanvas.classList.remove('active');
    return;
  }

  const camRect = cameraVideo.getBoundingClientRect();
  const containerRect = previewContainer.getBoundingClientRect();
  const left = camRect.left - containerRect.left;
  const top = camRect.top - containerRect.top;
  const w = camRect.width;
  const h = camRect.height;

  // Use 2x resolution for crisp text on retina displays
  const dpr = window.devicePixelRatio || 1;
  const newW = Math.round(w * dpr);
  const newH = Math.round(h * dpr);

  if (actionFeedCanvas.width !== newW || actionFeedCanvas.height !== newH) {
    actionFeedCanvas.width = newW;
    actionFeedCanvas.height = newH;
  }

  actionFeedCanvas.style.left = `${Math.round(left)}px`;
  actionFeedCanvas.style.top = `${Math.round(top)}px`;
  actionFeedCanvas.style.width = `${Math.round(w)}px`;
  actionFeedCanvas.style.height = `${Math.round(h)}px`;
  actionFeedCanvas.classList.add('active');
}

/** Render the action feed overlay on the preview canvas each frame */
function renderPreviewFeed(): void {
  const hasCam = cameraContainer.classList.contains('active') && cameraStream;
  if (!hasCam || actionFeedItems.length === 0) {
    // Nothing to draw — stop looping to save CPU. The loop is restarted by
    // startPreviewFeedLoop() when a new action feed item arrives.
    actionFeedCtx.clearRect(0, 0, actionFeedCanvas.width, actionFeedCanvas.height);
    previewFeedAnimFrame = 0;
    return;
  }

  // Re-position canvas to track camera (handles layout changes, resizes)
  positionActionFeedCanvas();

  const cw = actionFeedCanvas.width;
  const ch = actionFeedCanvas.height;
  actionFeedCtx.clearRect(0, 0, cw, ch);

  // The canvas covers the camera area exactly, so camRect in canvas coords is (0, 0, cw, ch)
  drawActionFeedOnCanvas(actionFeedCtx, { x: 0, y: 0, w: cw, h: ch }, window.devicePixelRatio || 1);

  previewFeedAnimFrame = requestAnimationFrame(renderPreviewFeed);
}

/** Start the preview feed animation loop (no-op if already running). */
export function startPreviewFeedLoop(): void {
  if (previewFeedAnimFrame) {
    return;
  }
  previewFeedAnimFrame = requestAnimationFrame(renderPreviewFeed);
}

/** Stop the preview feed animation loop. */
export function stopPreviewFeedLoop(): void {
  if (previewFeedAnimFrame) {
    cancelAnimationFrame(previewFeedAnimFrame);
    previewFeedAnimFrame = 0;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Add a new action to the feed. */
export function addActionFeedItem(event: ActionFeedEvent): void {
  const now = performance.now();

  // Push existing items up by one slot
  for (const item of actionFeedItems) {
    item.slotIndex += 1;
  }

  // Remove items beyond max (mark for fade-out)
  actionFeedItems = actionFeedItems.filter((item) => item.slotIndex < ACTION_FEED_MAX + 1);
  for (const item of actionFeedItems) {
    if (item.slotIndex >= ACTION_FEED_MAX) {
      item.opacity = 0; // will be cleaned up on next frame
    }
  }

  // Add new item at slot 0 (bottom)
  actionFeedItems.push({
    event,
    slotIndex: 0,
    enterTime: now,
    opacity: 1.0,
    slideX: 1.0, // starts fully offscreen right
    targetY: 0,
    currentY: 0,
    computedHeight: ACTION_ITEM_HEIGHT,
  });

  // Restart the preview feed render loop if it's not already running
  startPreviewFeedLoop();
}

/** Check whether the action feed has any visible items. */
export function hasActionFeedItems(): boolean {
  return actionFeedItems.length > 0;
}
