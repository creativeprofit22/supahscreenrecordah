// Camera name overlay — magnify wave animation + positioning

import { cameraName, cameraContainer, previewContainer } from '../dom';
import { overlayName, currentLayout } from '../state';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MAGNIFY_INTERVAL_MS = 10_000;
const MAGNIFY_STEP_MS = 80; // delay between each letter

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let magnifyTimer: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Name character animation
// ---------------------------------------------------------------------------

export function wrapNameInCharSpans(text: string): void {
  cameraName.innerHTML = '';
  for (const ch of text) {
    const span = document.createElement('span');
    span.className = 'char';
    span.textContent = ch === ' ' ? '\u00A0' : ch;
    cameraName.appendChild(span);
  }
}

function runMagnifyWave(): void {
  const chars = cameraName.querySelectorAll('.char');
  if (chars.length === 0) {
    return;
  }
  chars.forEach((span, i) => {
    setTimeout(() => {
      span.classList.add('magnified');
      setTimeout(() => {
        span.classList.remove('magnified');
      }, MAGNIFY_STEP_MS * 2);
    }, i * MAGNIFY_STEP_MS);
  });
}

export function startMagnifyLoop(): void {
  stopMagnifyLoop();
  runMagnifyWave();
  magnifyTimer = setInterval(runMagnifyWave, MAGNIFY_INTERVAL_MS);
}

export function stopMagnifyLoop(): void {
  if (magnifyTimer) {
    clearInterval(magnifyTimer);
    magnifyTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Camera name update & positioning
// ---------------------------------------------------------------------------

export function updateCameraName(name: string, font?: string, fontSize?: number): void {
  if (name) {
    wrapNameInCharSpans(name);
    if (font) {
      cameraName.style.fontFamily = `"${font}", sans-serif`;
    }
    if (fontSize) {
      cameraName.style.fontSize = `${fontSize}px`;
    }
    cameraName.hidden = false;
    positionCameraName();
    startMagnifyLoop();
  } else {
    stopMagnifyLoop();
    cameraName.hidden = true;
    cameraName.classList.remove('active');
  }
}

/**
 * Position the camera name element centered above the camera preview.
 * Returns a callback that should be invoked to position socials afterward.
 */
export function positionCameraName(positionSocials?: () => void): void {
  const hasCam = cameraContainer.classList.contains('active');
  if (!overlayName || !hasCam) {
    cameraName.classList.remove('active');
    return;
  }
  // Camera is 22% wide, vertically centred at 70% height, anchored at 24px from one side.
  const containerH = previewContainer.clientHeight;
  const camH = containerH * 0.7;
  const camTop = (containerH - camH) / 2;
  // Place the name above the camera
  const nameTop = camTop - 20;
  const camWidthPct = 22;
  if (currentLayout === 'camera-left') {
    cameraName.style.right = '';
    cameraName.style.left = `calc(24px + ${camWidthPct / 2}%)`;
    cameraName.style.transform = 'translateX(-50%) translateY(-50%)';
  } else {
    cameraName.style.left = '';
    cameraName.style.right = `calc(24px + ${camWidthPct / 2}%)`;
    cameraName.style.transform = 'translateX(50%) translateY(-50%)';
  }
  cameraName.style.top = `${Math.round(nameTop)}px`;
  cameraName.style.textAlign = 'center';
  cameraName.classList.add('active');
  if (positionSocials) {
    positionSocials();
  }
}

/** Check whether the magnify loop is running. */
export function isMagnifyActive(): boolean {
  return magnifyTimer !== null;
}
