// CTA Popup — periodic call-to-action that slides in during recording

import { ctaPopup } from '../dom';
import {
  ctaText, ctaIcon, ctaFont, ctaIntervalMs,
  ctaTimer, ctaHideTimeout, ctaIsVisible, ctaAnimStartTime, ctaAnimState,
  setCtaText, setCtaIcon, setCtaFont, setCtaIntervalMs,
  setCtaTimer, setCtaHideTimeout, setCtaIsVisible, setCtaAnimStartTime, setCtaAnimState,
} from '../state';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CTA_DISPLAY_MS = 8_000;        // show for 8 seconds
const CTA_SLIDE_DURATION_MS = 600;   // matches CSS transition

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------
const ctaNotifAudio = new Audio('assets/notif.mp3');
ctaNotifAudio.volume = 0.6;

// ---------------------------------------------------------------------------
// Config setter
// ---------------------------------------------------------------------------
export function setCtaConfig(text: string, icon: string, font: string, intervalMs: number): void {
  setCtaText(text);
  setCtaIcon(icon);
  setCtaFont(font);
  setCtaIntervalMs(intervalMs);
}

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------
export function isCtaVisible(): boolean {
  return ctaIsVisible;
}

export function getCtaAnimState(): 'idle' | 'sliding-in' | 'visible' | 'sliding-out' {
  return ctaAnimState;
}

// ---------------------------------------------------------------------------
// Show / hide
// ---------------------------------------------------------------------------
export function showCtaPopup(): void {
  if (!ctaText) {
    return;
  }
  ctaPopup.textContent = ctaIcon ? `${ctaIcon} ${ctaText}` : ctaText;
  ctaPopup.style.fontFamily = `"${ctaFont}", sans-serif`;
  ctaPopup.classList.remove('slide-out');
  ctaPopup.classList.add('active');

  // Play notification sound — clone so overlapping plays don't cut each other off
  const notifClone = ctaNotifAudio.cloneNode() as HTMLAudioElement;
  notifClone.volume = ctaNotifAudio.volume;
  notifClone.play().catch(() => { });

  setCtaIsVisible(true);
  setCtaAnimState('sliding-in');
  setCtaAnimStartTime(performance.now());

  if (ctaHideTimeout) {
    clearTimeout(ctaHideTimeout);
  }
  setCtaHideTimeout(setTimeout(() => {
    hideCtaPopup();
  }, CTA_DISPLAY_MS));
}

export function hideCtaPopup(): void {
  if (!ctaIsVisible) {
    return;
  }
  ctaPopup.classList.add('slide-out');
  ctaPopup.classList.remove('active');

  setCtaAnimState('sliding-out');
  setCtaAnimStartTime(performance.now());

  // After slide-out animation completes, mark as idle
  setTimeout(() => {
    if (ctaAnimState === 'sliding-out') {
      setCtaAnimState('idle');
      setCtaIsVisible(false);
    }
  }, CTA_SLIDE_DURATION_MS);

  if (ctaHideTimeout) {
    clearTimeout(ctaHideTimeout);
    setCtaHideTimeout(null);
  }
}

// ---------------------------------------------------------------------------
// Loop control
// ---------------------------------------------------------------------------
export function startCtaLoop(): void {
  stopCtaLoop();
  if (!ctaText) {
    return;
  }
  // Fire first CTA after one full interval, then repeat
  setCtaTimer(setInterval(() => {
    showCtaPopup();
  }, ctaIntervalMs));
}

export function stopCtaLoop(): void {
  if (ctaTimer) {
    clearInterval(ctaTimer);
    setCtaTimer(null);
  }
  hideCtaPopup();
  setCtaAnimState('idle');
  setCtaIsVisible(false);
}

// ---------------------------------------------------------------------------
// Canvas drawing
// ---------------------------------------------------------------------------
/** Draw the CTA popup on the recording canvas with slide animation */
export function drawCtaOnCanvas(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  scale: number,
): void {
  if (!ctaText || ctaAnimState === 'idle') {
    return;
  }

  const now = performance.now();
  const elapsed = now - ctaAnimStartTime;

  // Compute Y offset based on animation state
  let progress: number;
  let yOffset: number; // 0 = fully visible, 1 = fully below
  if (ctaAnimState === 'sliding-in') {
    progress = Math.min(1, elapsed / CTA_SLIDE_DURATION_MS);
    // Ease-out cubic for smooth deceleration
    const eased = 1 - Math.pow(1 - progress, 3);
    yOffset = 1 - eased;
    if (progress >= 1) {
      setCtaAnimState('visible');
    }
  } else if (ctaAnimState === 'sliding-out') {
    progress = Math.min(1, elapsed / CTA_SLIDE_DURATION_MS);
    // Ease-in cubic for acceleration
    const eased = Math.pow(progress, 3);
    yOffset = eased;
  } else {
    // visible
    yOffset = 0;
  }

  // Text measurement
  const fontSize = 16 * scale;
  const fontFamily = `"${ctaFont}", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.font = `600 ${fontSize}px ${fontFamily}`;
  const displayText = ctaIcon ? `${ctaIcon} ${ctaText}` : ctaText;
  const textMetrics = ctx.measureText(displayText);
  const textW = textMetrics.width;

  // Pill dimensions
  const padH = 24 * scale;
  const padV = 12 * scale;
  const pillW = textW + padH * 2;
  const pillH = fontSize + padV * 2;
  const cornerRadius = 12 * scale;

  // Position: bottom-center with slide offset
  const pillX = (canvasW - pillW) / 2;
  const bottomMargin = 24 * scale;
  const pillYBase = canvasH - pillH - bottomMargin;
  const pillYHidden = canvasH + pillH; // fully below canvas
  const pillY = pillYBase + (pillYHidden - pillYBase) * yOffset;
  const borderW = 2 * scale;

  ctx.save();

  // Shadow effect (drawn first, behind everything)
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = 32 * scale;
  ctx.shadowOffsetY = 8 * scale;
  ctx.fillStyle = 'rgba(30, 30, 46, 0.85)';
  ctx.beginPath();
  ctx.roundRect(pillX, pillY, pillW, pillH, cornerRadius);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // Rotating shimmer border — conic gradient matching the screen/camera borders
  const ctaBorderAngle = ((now % 4000) / 4000) * 360;
  const cx = pillX + pillW / 2;
  const cy = pillY + pillH / 2;
  const angleRad = (ctaBorderAngle * Math.PI) / 180;
  const gradient = ctx.createConicGradient(angleRad, cx, cy);
  gradient.addColorStop(0, '#d600ff');
  gradient.addColorStop(0.25, '#00ff9f');
  gradient.addColorStop(0.5, '#00b8ff');
  gradient.addColorStop(0.75, '#001eff');
  gradient.addColorStop(1, '#d600ff');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.roundRect(
    pillX - borderW, pillY - borderW,
    pillW + borderW * 2, pillH + borderW * 2,
    cornerRadius + borderW,
  );
  ctx.fill();

  // Inner fill — covers the gradient, leaving the border edge visible
  ctx.fillStyle = 'rgba(30, 30, 46, 0.92)';
  ctx.beginPath();
  ctx.roundRect(pillX, pillY, pillW, pillH, cornerRadius);
  ctx.fill();

  // Text
  ctx.fillStyle = '#ffffff';
  ctx.font = `600 ${fontSize}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(displayText, canvasW / 2, pillY + pillH / 2);

  ctx.restore();
}
