// Screen + camera stream management — preview, layout, fade, drag
// ---------------------------------------------------------------------------

import {
  screenStream, setScreenStream,
  cameraStream, setCameraStream,
  currentLayout, setCurrentLayout,
  currentScreenSourceId, setCurrentScreenSourceId,
  currentCameraDeviceId, setCurrentCameraDeviceId,
  screenX, setScreenX,
  TRANSITION_MS,
  displayBounds,
  capturedBounds, setCapturedBounds,
  isCapturingWindow, setIsCapturingWindow,
  currentMicDeviceId,
  ambientParticlesEnabled,
  activeAspectRatio, setActiveAspectRatio,
  currentZoom,
  activeWebcamBlur, activeWebcamBlurIntensity,
} from './state';
import type { AspectRatio } from '../../shared/types';
import { ASPECT_RATIOS } from '../../shared/feature-types';
import {
  screenWrapper, screenVideo, cameraContainer, cameraVideo,
  previewContainer, idleState, waveformCanvas,
  shortsPreviewCanvas, shortsPreviewCtx,
} from './dom';
import { positionCameraName } from './overlays/camera-name';
import { positionSocialsOverlay } from './overlays/socials';
import { refreshBlurRegionPositions } from './overlays/blur-regions';
import { startZoomLoop, stopZoomLoop, sizeBgCanvas, getMouseRelativeToCaptured } from './zoom';
import { processBlurFrame } from './overlays/webcam-blur';
import { startWaveformCapture, stopWaveformCapture, sizeWaveformCanvas } from './overlays/waveform';
import type { PreviewSelection } from '../../shared/types';

// ---------------------------------------------------------------------------
// Fit screen video to native aspect ratio & position it
// ---------------------------------------------------------------------------

export function fitScreenVideo(): void {
  const natW = screenVideo.videoWidth;
  const natH = screenVideo.videoHeight;
  if (!natW || !natH) {
    return;
  }

  // Shorts mode has its own layout function
  if (isShortsMode()) {
    fitShortsLayout();
    return;
  }

  // Reset shorts-mode overrides
  stopShortsPreviewLoop();
  screenWrapper.removeAttribute('style');
  screenVideo.style.objectFit = '';

  const padding = 24;
  const hasCam = cameraContainer.classList.contains('active');
  const clientW = previewContainer.clientWidth;
  const clientH = previewContainer.clientHeight;
  const isVertical = activeAspectRatio === '4:5';

  if (isVertical && hasCam) {
    // Portrait (4:5): screen fills below camera, stacked vertically
    const camHeightPct = 0.25;
    const camH = clientH * camHeightPct + padding;
    const maxW = clientW - padding * 2;
    const maxH = clientH - camH - padding;
    const ratio = natW / natH;

    let w = maxW;
    let h = w / ratio;
    if (h > maxH) {
      h = maxH;
      w = h * ratio;
    }

    screenVideo.style.width = `${Math.round(w)}px`;
    screenVideo.style.height = `${Math.round(h)}px`;
    screenVideo.style.top = `${Math.round(camH + padding)}px`;
    screenVideo.style.transform = 'none';
    setScreenX(Math.round((clientW - w) / 2));
    screenVideo.style.left = `${Math.round(screenX)}px`;
    return;
  }

  // Reset vertical overrides for landscape/square
  screenVideo.style.top = '';
  screenVideo.style.transform = '';

  if (activeAspectRatio === '1:1' && hasCam) {
    // Square: camera is overlaid in corner — screen fills most of the frame
    const maxW = clientW - padding * 2;
    const maxH = clientH - padding * 2;
    const ratio = natW / natH;

    let w = maxW;
    let h = w / ratio;
    if (h > maxH) {
      h = maxH;
      w = h * ratio;
    }

    screenVideo.style.width = `${Math.round(w)}px`;
    screenVideo.style.height = `${Math.round(h)}px`;
    setScreenX(Math.round((clientW - w) / 2));
    clampScreenX();
    screenVideo.style.left = `${Math.round(screenX)}px`;
    return;
  }

  // Default landscape layout — camera CSS width = 22% of container
  const camW = hasCam ? clientW * 0.22 + padding : 0;
  const maxW = clientW - padding * 2 - camW;
  const maxH = clientH - padding * 2;
  const ratio = natW / natH;

  let w = maxW;
  let h = w / ratio;
  if (h > maxH) {
    h = maxH;
    w = h * ratio;
  }

  screenVideo.style.width = `${Math.round(w)}px`;
  screenVideo.style.height = `${Math.round(h)}px`;

  // Centre the screen when no camera is active
  if (!hasCam) {
    setScreenX(Math.round((clientW - w) / 2));
  }

  // Clamp screenX within allowed bounds
  clampScreenX();
  screenVideo.style.left = `${Math.round(screenX)}px`;
}

// ---------------------------------------------------------------------------
// Screen bounds helpers
// ---------------------------------------------------------------------------

function getScreenBounds(): { minX: number; maxX: number } {
  const padding = 24;
  const hasCam = cameraContainer.classList.contains('active');
  const containerW = previewContainer.clientWidth;
  const videoW = screenVideo.offsetWidth;
  const camZoneW = hasCam ? containerW * 0.22 + padding + padding : 0;

  let minX: number;
  let maxX: number;

  if (currentLayout === 'camera-left') {
    minX = hasCam ? camZoneW : padding;
    maxX = containerW - padding - videoW;
  } else {
    minX = padding;
    maxX = containerW - (hasCam ? camZoneW : padding) - videoW;
  }

  return { minX, maxX: Math.max(minX, maxX) };
}

function clampScreenX(): void {
  const { minX, maxX } = getScreenBounds();
  setScreenX(Math.max(minX, Math.min(maxX, screenX)));
}

function resetScreenPosition(): void {
  if (isShortsMode()) return; // shorts mode handles its own positioning

  const padding = 24;
  const hasCam = cameraContainer.classList.contains('active');
  const clientW = previewContainer.clientWidth;
  const videoW = screenVideo.offsetWidth;
  const isVertical = activeAspectRatio === '4:5';

  if (!hasCam || isVertical || activeAspectRatio === '1:1') {
    // No camera, vertical, or square — centre the screen horizontally
    setScreenX(Math.round((clientW - videoW) / 2));
  } else if (currentLayout === 'camera-left') {
    const camZoneW = clientW * 0.22 + padding + padding;
    setScreenX(camZoneW);
  } else {
    setScreenX(padding);
  }
}

// ---------------------------------------------------------------------------
// Apply layout — positions camera on the correct side
// ---------------------------------------------------------------------------

export function applyLayout(): void {
  if (isShortsMode()) {
    fitShortsLayout();
    return;
  }

  const isVertical = activeAspectRatio === '4:5';
  const isSquare = activeAspectRatio === '1:1';

  if (isVertical) {
    cameraContainer.style.left = '24px';
    cameraContainer.style.right = '24px';
  } else if (isSquare) {
    // Square: camera in corner — always bottom-right
    cameraContainer.style.left = '';
    cameraContainer.style.right = '24px';
  } else if (currentLayout === 'camera-left') {
    cameraContainer.style.right = '';
    cameraContainer.style.left = '24px';
  } else {
    cameraContainer.style.left = '';
    cameraContainer.style.right = '24px';
  }

  resetScreenPosition();
  fitScreenVideo();
  positionCameraName(positionSocialsOverlay);
}

// ---------------------------------------------------------------------------
// Fade helpers
// ---------------------------------------------------------------------------

export function fadeOut(el: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    if (!el.classList.contains('active')) {
      resolve();
      return;
    }
    el.classList.remove('active');
    setTimeout(resolve, TRANSITION_MS);
  });
}

export function fadeIn(el: HTMLElement): void {
  // Force a reflow so the browser registers the opacity:0 state before transitioning
  void el.offsetHeight;
  el.classList.add('active');
}

// ---------------------------------------------------------------------------
// Screen preview — uses getDisplayMedia via setDisplayMediaRequestHandler
// ---------------------------------------------------------------------------

export async function startScreenPreview(sourceId: string, animate?: boolean, sourceName?: string): Promise<void> {
  // If switching sources, fade out first
  if (animate && screenStream) {
    await fadeOut(screenVideo);
  }

  stopScreenPreviewImmediate();

  try {
    // Tell the main process which source to use, then request display media.
    await window.mainAPI.selectScreenSource(sourceId, sourceName);
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: true,
    });
    setScreenStream(stream);

    screenVideo.srcObject = stream;
    screenVideo.onloadedmetadata = () => {
      resetScreenPosition();
      fitScreenVideo();
      fadeIn(screenVideo);

      // Set capturedBounds based on capture type
      if (isCapturingWindow) {
        // Window capture: fetch actual window bounds from macOS via CGWindowListCopyWindowInfo
        setCapturedBounds({ ...displayBounds });
        void window.mainAPI.getWindowBounds(sourceId).then((bounds) => {
          if (bounds) {
            setCapturedBounds(bounds);
          }
        });
      } else {
        // Screen capture: video shows the full display
        setCapturedBounds({ ...displayBounds });
      }
    };

    // Start mouse tracking for click-to-zoom
    await window.mainAPI.startMouseTracking();
    startZoomLoop();
    idleState.classList.add('hidden');
  } catch (err) {
    console.warn('Screen preview failed:', err);
  }
}

function stopScreenPreviewImmediate(): void {
  stopZoomLoop();
  void window.mainAPI.stopMouseTracking();

  if (screenStream) {
    for (const track of screenStream.getTracks()) {
      track.stop();
    }
    setScreenStream(null);
  }
  screenVideo.srcObject = null;
  screenVideo.classList.remove('active');
}

export async function stopScreenPreview(): Promise<void> {
  stopZoomLoop();
  void window.mainAPI.stopMouseTracking();

  if (screenStream) {
    await fadeOut(screenVideo);
    for (const track of screenStream.getTracks()) {
      track.stop();
    }
    setScreenStream(null);
  }
  screenVideo.srcObject = null;
  screenVideo.classList.remove('active');
}

// ---------------------------------------------------------------------------
// Camera preview
// ---------------------------------------------------------------------------

export async function startCameraPreview(deviceId: string): Promise<void> {
  stopCameraPreviewImmediate();

  const maxRetries = 3;
  const retryDelayMs = 500;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      setCameraStream(stream);
      cameraVideo.srcObject = stream;
      fadeIn(cameraContainer);
      positionCameraName(positionSocialsOverlay);
      return;
    } catch (err) {
      const msg = err instanceof DOMException ? `${err.name}: ${err.message}` : String(err);
      // NotReadableError often means the camera is still locked by another
      // process or renderer — retry after a short delay.
      if (err instanceof DOMException && err.name === 'NotReadableError' && attempt < maxRetries) {
        console.warn(`Camera busy, retrying in ${retryDelayMs}ms (attempt ${attempt + 1}/${maxRetries})...`);
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        continue;
      }
      console.warn('Camera preview failed:', msg);
    }
  }
}

function stopCameraPreviewImmediate(): void {
  if (cameraStream) {
    for (const track of cameraStream.getTracks()) {
      track.stop();
    }
    setCameraStream(null);
  }
  cameraVideo.srcObject = null;
  cameraContainer.classList.remove('active');
}

export async function stopCameraPreview(): Promise<void> {
  if (cameraStream) {
    await fadeOut(cameraContainer);
    for (const track of cameraStream.getTracks()) {
      track.stop();
    }
    setCameraStream(null);
  }
  cameraVideo.srcObject = null;
  cameraContainer.classList.remove('active');
}

// ---------------------------------------------------------------------------
// Handle preview updates from toolbar
// ---------------------------------------------------------------------------

function updateIdleState(): void {
  const hasScreen = screenVideo.classList.contains('active') || screenStream !== null;
  const hasCamera = cameraContainer.classList.contains('active') || cameraStream !== null;

  if (hasScreen || hasCamera) {
    idleState.classList.add('hidden');
  } else {
    idleState.classList.remove('hidden');
  }
}

export function handlePreviewUpdate(selection: PreviewSelection): void {
  void (async () => {
    const layoutChanged = selection.layout !== currentLayout;
    const screenChanged = selection.screenSourceId !== currentScreenSourceId;
    const cameraChanged = selection.cameraDeviceId !== currentCameraDeviceId;

    if (selection.layout) {
      setCurrentLayout(selection.layout);
    }
    setCurrentScreenSourceId(selection.screenSourceId);
    setCurrentCameraDeviceId(selection.cameraDeviceId ?? '');

    // Track whether we're capturing a window vs full screen
    setIsCapturingWindow(selection.screenIsBrowser);

    // Handle camera first so screen sizing accounts for it
    if (cameraChanged) {
      if (selection.cameraDeviceId) {
        await startCameraPreview(selection.cameraDeviceId);
      } else {
        await stopCameraPreview();
      }
    }

    // Handle screen
    if (screenChanged) {
      if (selection.screenSourceId) {
        await startScreenPreview(selection.screenSourceId, true, selection.screenSourceName);
      } else {
        await stopScreenPreview();
      }
    }

    // Handle layout swap (camera side change) — animate positions
    if (layoutChanged) {
      applyLayout();
    } else if (!screenChanged) {
      // Camera toggled but screen didn't change — re-fit with animation
      fitScreenVideo();
    }

    // Handle mic for waveform visualization
    const micChanged = (selection.micDeviceId ?? null) !== currentMicDeviceId;
    if (micChanged) {
      if (selection.micDeviceId) {
        await startWaveformCapture(selection.micDeviceId);
      } else {
        stopWaveformCapture();
      }
    }

    updateIdleState();
  })();
}

// ---------------------------------------------------------------------------
// Window resize handler
// ---------------------------------------------------------------------------

export function initResizeHandler(): void {
  window.addEventListener('resize', () => {
    if (isShortsMode()) {
      fitShortsLayout();
      return;
    }
    fitScreenVideo();
    positionCameraName(positionSocialsOverlay);
    refreshBlurRegionPositions();

    // Resize waveform canvas pixel dimensions to match new container size
    if (waveformCanvas.classList.contains('active')) {
      sizeWaveformCanvas();
    }

    // Resize background particle canvas
    if (ambientParticlesEnabled) {
      sizeBgCanvas();
    }
  });
}

// ---------------------------------------------------------------------------
// Horizontal drag for screen video
// ---------------------------------------------------------------------------

export function initScreenDrag(): void {
  let isDragging = false;
  let dragStartMouseX = 0;
  let dragStartScreenX = 0;

  screenVideo.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button !== 0) {
      return;
    }
    isDragging = true;
    dragStartMouseX = e.clientX;
    dragStartScreenX = screenX;
    screenVideo.classList.add('dragging');
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (!isDragging) {
      return;
    }
    const dx = e.clientX - dragStartMouseX;
    setScreenX(dragStartScreenX + dx);
    clampScreenX();
    screenVideo.style.left = `${Math.round(screenX)}px`;
  });

  window.addEventListener('mouseup', () => {
    if (!isDragging) {
      return;
    }
    isDragging = false;
    screenVideo.classList.remove('dragging');
  });
}

// ---------------------------------------------------------------------------
// Aspect ratio layout adaptation
// ---------------------------------------------------------------------------

/**
 * Apply aspect ratio to preview container.
 * The preview window doesn't resize — the container uses CSS aspect-ratio
 * with letterboxing/pillarboxing inside the window. Camera and screen
 * positions adapt based on the selected ratio.
 */
/** Whether the app is in shorts mode (clean vertical output). */
export function isShortsMode(): boolean {
  return activeAspectRatio === '9:16';
}

export function applyAspectRatioLayout(ratio: AspectRatio): void {
  setActiveAspectRatio(ratio);

  // Remove all aspect-ratio-specific classes
  previewContainer.classList.remove('ar-landscape', 'ar-vertical', 'ar-square', 'ar-portrait', 'shorts-mode');

  // Stop shorts canvas loop and restore video elements when leaving shorts mode
  stopShortsPreviewLoop();
  screenWrapper.removeAttribute('style');

  if (ratio === '9:16') {
    // Shorts mode: canvas-based preview replaces video elements
    previewContainer.classList.add('ar-vertical', 'shorts-mode');
  } else if (ratio === '16:9') {
    previewContainer.classList.add('ar-landscape');
    // Default layout — camera on side (22% width, 70% height)
    cameraContainer.style.width = '';
    cameraContainer.style.height = '';
    cameraContainer.style.top = '';
    cameraContainer.style.left = '';
    cameraContainer.style.right = '';
    cameraContainer.style.transform = '';
    cameraContainer.style.bottom = '';
  } else if (ratio === '1:1') {
    previewContainer.classList.add('ar-square');
    cameraContainer.style.width = '30%';
    cameraContainer.style.height = '35%';
    cameraContainer.style.top = '';
    cameraContainer.style.left = '';
    cameraContainer.style.right = '24px';
    cameraContainer.style.bottom = '24px';
    cameraContainer.style.transform = 'none';
  } else if (ratio === '4:5') {
    previewContainer.classList.add('ar-portrait');
    cameraContainer.style.width = 'calc(100% - 48px)';
    cameraContainer.style.height = '25%';
    cameraContainer.style.top = '24px';
    cameraContainer.style.left = '24px';
    cameraContainer.style.right = '24px';
    cameraContainer.style.transform = 'none';
    cameraContainer.style.bottom = '';
  }

  // Wait for the main-process window resize to settle before reading dimensions
  setTimeout(() => {
    if (ratio === '9:16') {
      fitShortsLayout();
    } else if (ratio === '16:9') {
      applyLayout();
    } else {
      fitScreenVideo();
      positionCameraName(positionSocialsOverlay);
    }
    refreshBlurRegionPositions();
  }, 200);
}

/** Shorts preview render loop handle — cancelled when leaving shorts mode. */
let shortsPreviewRAF: number | null = null;

/** Fit the shorts mode layout — renders both videos on a canvas.
 *  Chromium's GPU compositor ignores CSS sizing/transform/object-fit on <video>
 *  elements with MediaStream sources, so we bypass it entirely with drawImage. */
export function fitShortsLayout(): void {
  const clientW = previewContainer.clientWidth;
  const clientH = previewContainer.clientHeight;

  // Size the canvas pixel buffer to match the container (1:1 CSS-to-pixel)
  shortsPreviewCanvas.width = clientW;
  shortsPreviewCanvas.height = clientH;

  // Hide the actual video elements — the canvas replaces them
  screenWrapper.style.display = 'none';
  cameraContainer.style.display = 'none';

  // Start the render loop if not already running
  if (shortsPreviewRAF === null) {
    startShortsPreviewLoop();
  }
}

/** Stop the shorts preview render loop and restore video elements. */
export function stopShortsPreviewLoop(): void {
  if (shortsPreviewRAF !== null) {
    cancelAnimationFrame(shortsPreviewRAF);
    shortsPreviewRAF = null;
  }
  // Restore video elements
  screenWrapper.removeAttribute('style');
  cameraContainer.removeAttribute('style');
}

function startShortsPreviewLoop(): void {
  const draw = (): void => {
    if (!isShortsMode()) {
      shortsPreviewRAF = null;
      return;
    }

    const w = shortsPreviewCanvas.width;
    const h = shortsPreviewCanvas.height;
    const ctx = shortsPreviewCtx;

    // Black background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);

    // Camera takes the bottom 35%, screen gets the top 65%
    const camZoneH = Math.round(h * 0.35);
    const screenZoneH = h - camZoneH;

    // ── Screen (top portion) — cover-crop with zoom support ──
    if (screenVideo.classList.contains('active') && screenStream) {
      const natW = screenVideo.videoWidth;
      const natH = screenVideo.videoHeight;
      if (natW && natH) {
        const dstAspect = w / screenZoneH;
        let sx = 0, sy = 0, sw = natW, sh = natH;

        // Zoom: crop source to zoom region first
        if (currentZoom > 1.0) {
          sw = natW / currentZoom;
          sh = natH / currentZoom;
          const relPos = getMouseRelativeToCaptured();
          if (relPos) {
            sx = Math.max(0, Math.min(natW - sw, relPos.relX * natW - sw / 2));
            sy = Math.max(0, Math.min(natH - sh, relPos.relY * natH - sh / 2));
          } else {
            sx = (natW - sw) / 2;
            sy = (natH - sh) / 2;
          }
        }

        // Cover crop on the (possibly zoomed) source region
        const zoomedAspect = sw / sh;
        if (zoomedAspect > dstAspect) {
          const cropW = sh * dstAspect;
          sx += (sw - cropW) / 2;
          sw = cropW;
        } else {
          const cropH = sw / dstAspect;
          sy += (sh - cropH) / 2;
          sh = cropH;
        }

        ctx.drawImage(screenVideo, sx, sy, sw, sh, 0, 0, w, screenZoneH);
      }
    }

    // ── Camera (bottom portion) — cover-crop, mirrored, with webcam blur ──
    if (cameraContainer.classList.contains('active') && cameraVideo.videoWidth) {
      const natW = cameraVideo.videoWidth;
      const natH = cameraVideo.videoHeight;
      const dstAspect = w / camZoneH;
      const vidAspect = natW / natH;
      let sx: number, sy: number, sw: number, sh: number;

      if (vidAspect > dstAspect) {
        sh = natH;
        sw = sh * dstAspect;
        sx = (natW - sw) / 2;
        sy = 0;
      } else {
        sw = natW;
        sh = sw / dstAspect;
        sx = 0;
        sy = (natH - sh) / 2;
      }

      // Mirror horizontally
      ctx.save();
      ctx.translate(w, screenZoneH);
      ctx.scale(-1, 1);

      // Use background-blurred frame when webcam blur is active
      const blurResult = activeWebcamBlur
        ? processBlurFrame(cameraVideo, activeWebcamBlurIntensity)
        : null;
      if (blurResult) {
        ctx.drawImage(blurResult, sx, sy, sw, sh, 0, 0, w, camZoneH);
      } else {
        ctx.drawImage(cameraVideo, sx, sy, sw, sh, 0, 0, w, camZoneH);
      }

      ctx.restore();
    }

    shortsPreviewRAF = requestAnimationFrame(draw);
  };

  shortsPreviewRAF = requestAnimationFrame(draw);
}
