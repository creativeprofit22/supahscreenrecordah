// Blur regions overlay — lets users draw rectangular blur areas over the screen preview
// ---------------------------------------------------------------------------
// Regions are stored as percentage-based coordinates relative to the screen video
// element so they work at any resolution. In the DOM preview, each region is an
// absolutely positioned div with `backdrop-filter: blur(20px)`. During recording,
// the canvas compositing loop reads the same region data to apply canvas blur.
// ---------------------------------------------------------------------------

import type { BlurRegion } from '../../../shared/feature-types';
import { screenVideo, previewContainer } from '../dom';
import {
  activeBlurRegions, setActiveBlurRegions,
  blurModeActive, setBlurModeActive,
} from '../state';

// ---------------------------------------------------------------------------
// DOM container — holds blur region divs, sits on top of the screen video
// ---------------------------------------------------------------------------

let blurContainer: HTMLDivElement | null = null;
let drawingRegion: BlurRegion | null = null;
let drawStartX = 0;
let drawStartY = 0;

/** Minimum size (percentage) to avoid accidental micro-regions */
const MIN_SIZE_PCT = 1;

function ensureContainer(): HTMLDivElement {
  if (blurContainer) return blurContainer;
  blurContainer = document.createElement('div');
  blurContainer.className = 'blur-regions-container';
  blurContainer.style.cssText = `
    position: absolute;
    top: 0; left: 0; width: 100%; height: 100%;
    pointer-events: none;
    z-index: 15;
  `;
  previewContainer.appendChild(blurContainer);
  return blurContainer;
}

// ---------------------------------------------------------------------------
// Convert pixel coords (relative to screen video element) to percentages
// ---------------------------------------------------------------------------

function pxToPercent(px: number, total: number): number {
  return (px / total) * 100;
}

function percentToPx(pct: number, total: number): number {
  return (pct / 100) * total;
}

// ---------------------------------------------------------------------------
// Render blur region DOM elements
// ---------------------------------------------------------------------------

function generateId(): string {
  return `blur-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function renderBlurRegions(): void {
  const container = ensureContainer();
  // Remove old region elements
  container.innerHTML = '';

  // We position relative to the screen video element
  const videoRect = screenVideo.getBoundingClientRect();
  const containerRect = previewContainer.getBoundingClientRect();

  // Offset of video within the preview container
  const videoOffsetX = videoRect.left - containerRect.left;
  const videoOffsetY = videoRect.top - containerRect.top;
  const videoW = videoRect.width;
  const videoH = videoRect.height;

  for (const region of activeBlurRegions) {
    const el = document.createElement('div');
    el.className = 'blur-region';
    el.dataset.regionId = region.id;

    const left = videoOffsetX + percentToPx(region.x, videoW);
    const top = videoOffsetY + percentToPx(region.y, videoH);
    const width = percentToPx(region.width, videoW);
    const height = percentToPx(region.height, videoH);

    el.style.cssText = `
      position: absolute;
      left: ${left}px;
      top: ${top}px;
      width: ${width}px;
      height: ${height}px;
      backdrop-filter: blur(${region.intensity}px);
      -webkit-backdrop-filter: blur(${region.intensity}px);
      background: rgba(255, 255, 255, 0.05);
      border: ${blurModeActive ? '2px dashed rgba(255, 255, 255, 0.5)' : 'none'};
      border-radius: 4px;
      pointer-events: ${blurModeActive ? 'auto' : 'none'};
      cursor: ${blurModeActive ? 'move' : 'default'};
      box-sizing: border-box;
    `;

    // Delete button (only in blur mode)
    if (blurModeActive) {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'blur-region-delete';
      deleteBtn.innerHTML = '×';
      deleteBtn.style.cssText = `
        position: absolute;
        top: -8px;
        right: -8px;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: #e74c3c;
        color: white;
        border: none;
        font-size: 14px;
        line-height: 1;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        pointer-events: auto;
        z-index: 2;
      `;
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeBlurRegion(region.id);
      });
      el.appendChild(deleteBtn);

      // Resize handle (bottom-right corner)
      const resizeHandle = document.createElement('div');
      resizeHandle.className = 'blur-region-resize';
      resizeHandle.style.cssText = `
        position: absolute;
        bottom: 0;
        right: 0;
        width: 12px;
        height: 12px;
        cursor: se-resize;
        background: rgba(255, 255, 255, 0.6);
        border-radius: 2px;
        pointer-events: auto;
        z-index: 2;
      `;
      initResizeHandle(resizeHandle, region);
      el.appendChild(resizeHandle);

      // Right-click to delete
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        removeBlurRegion(region.id);
      });

      // Drag to move
      initDragHandle(el, region);
    }

    container.appendChild(el);
  }
}

// ---------------------------------------------------------------------------
// Drag to move a region
// ---------------------------------------------------------------------------

function initDragHandle(el: HTMLDivElement, region: BlurRegion): void {
  let isDragging = false;
  let startMouseX = 0;
  let startMouseY = 0;
  let startRegionX = 0;
  let startRegionY = 0;

  el.addEventListener('mousedown', (e) => {
    // Don't drag from resize handle or delete button
    if ((e.target as HTMLElement).classList.contains('blur-region-resize') ||
        (e.target as HTMLElement).classList.contains('blur-region-delete')) {
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    isDragging = true;
    startMouseX = e.clientX;
    startMouseY = e.clientY;
    startRegionX = region.x;
    startRegionY = region.y;

    const onMove = (ev: MouseEvent) => {
      if (!isDragging) return;
      const videoRect = screenVideo.getBoundingClientRect();
      const dx = pxToPercent(ev.clientX - startMouseX, videoRect.width);
      const dy = pxToPercent(ev.clientY - startMouseY, videoRect.height);
      region.x = Math.max(0, Math.min(100 - region.width, startRegionX + dx));
      region.y = Math.max(0, Math.min(100 - region.height, startRegionY + dy));
      renderBlurRegions();
    };

    const onUp = () => {
      isDragging = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

// ---------------------------------------------------------------------------
// Resize handle
// ---------------------------------------------------------------------------

function initResizeHandle(handle: HTMLDivElement, region: BlurRegion): void {
  handle.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    const startW = region.width;
    const startH = region.height;

    const onMove = (ev: MouseEvent) => {
      const videoRect = screenVideo.getBoundingClientRect();
      const dw = pxToPercent(ev.clientX - startMouseX, videoRect.width);
      const dh = pxToPercent(ev.clientY - startMouseY, videoRect.height);
      region.width = Math.max(MIN_SIZE_PCT, Math.min(100 - region.x, startW + dw));
      region.height = Math.max(MIN_SIZE_PCT, Math.min(100 - region.y, startH + dh));
      renderBlurRegions();
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

// ---------------------------------------------------------------------------
// Drawing new regions (click-drag on screen video when blur mode is active)
// ---------------------------------------------------------------------------

function onDrawStart(e: MouseEvent): void {
  if (!blurModeActive) return;
  if (e.button !== 0) return;

  const videoRect = screenVideo.getBoundingClientRect();
  // Only start if click is within the screen video bounds
  if (e.clientX < videoRect.left || e.clientX > videoRect.right ||
      e.clientY < videoRect.top || e.clientY > videoRect.bottom) {
    return;
  }

  e.preventDefault();
  e.stopPropagation();

  drawStartX = e.clientX;
  drawStartY = e.clientY;

  drawingRegion = {
    id: generateId(),
    x: pxToPercent(e.clientX - videoRect.left, videoRect.width),
    y: pxToPercent(e.clientY - videoRect.top, videoRect.height),
    width: 0,
    height: 0,
    intensity: 20,
  };

  window.addEventListener('mousemove', onDrawMove);
  window.addEventListener('mouseup', onDrawEnd);
}

function onDrawMove(e: MouseEvent): void {
  if (!drawingRegion) return;

  const videoRect = screenVideo.getBoundingClientRect();
  const currentX = pxToPercent(Math.max(videoRect.left, Math.min(videoRect.right, e.clientX)) - videoRect.left, videoRect.width);
  const currentY = pxToPercent(Math.max(videoRect.top, Math.min(videoRect.bottom, e.clientY)) - videoRect.top, videoRect.height);

  const startX = pxToPercent(drawStartX - videoRect.left, videoRect.width);
  const startY = pxToPercent(drawStartY - videoRect.top, videoRect.height);

  drawingRegion.x = Math.min(startX, currentX);
  drawingRegion.y = Math.min(startY, currentY);
  drawingRegion.width = Math.abs(currentX - startX);
  drawingRegion.height = Math.abs(currentY - startY);

  // Temporarily add drawing region for preview
  const allRegions = [...activeBlurRegions.filter(r => r.id !== drawingRegion!.id), drawingRegion];
  setActiveBlurRegions(allRegions);
  renderBlurRegions();
}

function onDrawEnd(): void {
  window.removeEventListener('mousemove', onDrawMove);
  window.removeEventListener('mouseup', onDrawEnd);

  if (drawingRegion) {
    if (drawingRegion.width < MIN_SIZE_PCT || drawingRegion.height < MIN_SIZE_PCT) {
      // Too small — discard
      setActiveBlurRegions(activeBlurRegions.filter(r => r.id !== drawingRegion!.id));
    }
    drawingRegion = null;
    renderBlurRegions();
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function toggleBlurMode(): void {
  setBlurModeActive(!blurModeActive);

  if (blurModeActive) {
    // Attach drawing listeners to the preview container
    previewContainer.addEventListener('mousedown', onDrawStart);
    previewContainer.style.cursor = 'crosshair';
  } else {
    previewContainer.removeEventListener('mousedown', onDrawStart);
    previewContainer.style.cursor = '';
  }

  renderBlurRegions();
}

export function setBlurRegions(regions: BlurRegion[]): void {
  setActiveBlurRegions(regions);
  renderBlurRegions();
}

export function removeBlurRegion(id: string): void {
  setActiveBlurRegions(activeBlurRegions.filter(r => r.id !== id));
  renderBlurRegions();
}

export function clearBlurRegions(): void {
  setActiveBlurRegions([]);
  renderBlurRegions();
}

export function isBlurModeActive(): boolean {
  return blurModeActive;
}

/** Re-render blur regions when screen video resizes/moves */
export function refreshBlurRegionPositions(): void {
  if (activeBlurRegions.length > 0) {
    renderBlurRegions();
  }
}

/**
 * Draw blur regions onto a recording canvas.
 * Called from the recording compositing loop after the screen video is drawn.
 * @param ctx        - The recording canvas 2D context
 * @param screenX    - Screen video left edge on canvas (px)
 * @param screenY    - Screen video top edge on canvas (px)
 * @param screenW    - Screen video width on canvas (px)
 * @param screenH    - Screen video height on canvas (px)
 * @param videoEl    - The screen video element to re-draw blurred
 * @param zoom       - Current zoom level
 * @param cropInfo   - If zoomed, the source crop region; null if no zoom
 */
export function drawBlurRegionsOnCanvas(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  screenW: number,
  screenH: number,
  videoEl: HTMLVideoElement,
  zoom: number,
  cropInfo: { sx: number; sy: number; sw: number; sh: number } | null,
): void {
  if (activeBlurRegions.length === 0) return;

  const natW = videoEl.videoWidth;
  const natH = videoEl.videoHeight;
  if (!natW || !natH) return;

  for (const region of activeBlurRegions) {
    // Convert percentage coords to canvas pixel coords within the screen area
    const rx = screenX + (region.x / 100) * screenW;
    const ry = screenY + (region.y / 100) * screenH;
    const rw = (region.width / 100) * screenW;
    const rh = (region.height / 100) * screenH;

    if (rw < 1 || rh < 1) continue;

    // Apply blur by re-drawing the screen video into just this clipped area
    ctx.save();
    ctx.beginPath();
    ctx.rect(rx, ry, rw, rh);
    ctx.clip();
    ctx.filter = `blur(${region.intensity}px)`;

    if (zoom > 1.0 && cropInfo) {
      ctx.drawImage(
        videoEl,
        cropInfo.sx, cropInfo.sy, cropInfo.sw, cropInfo.sh,
        screenX, screenY, screenW, screenH,
      );
    } else {
      ctx.drawImage(videoEl, screenX, screenY, screenW, screenH);
    }

    ctx.restore();
  }
}
