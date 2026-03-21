// Audio Waveform Visualizer — real-time frequency bars from mic input
// ---------------------------------------------------------------------------

import { waveformCanvas, waveformCtx } from '../dom';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WAVEFORM_BAR_COUNT = 48;
const WAVEFORM_BAR_WIDTH = 3;   // px in preview space
const WAVEFORM_BAR_GAP = 2;     // px between bars
const WAVEFORM_HEIGHT = 48;     // px — matches CSS height
const WAVEFORM_FFT_SIZE = 256;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let waveformAudioCtx: AudioContext | null = null;
let waveformAnalyser: AnalyserNode | null = null;
let waveformSource: MediaStreamAudioSourceNode | null = null;
let waveformMicStream: MediaStream | null = null;
let waveformAnimFrame = 0;
let waveformFreqData = new Uint8Array(0);
let currentMicDeviceId: string | null = null;
let savedMicDeviceIdForRestart: string | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Set the waveform canvas pixel dimensions for DPR-crisp rendering.
 * CSS handles position/size (bottom of camera container).
 */
export function sizeWaveformCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  const cssW = waveformCanvas.clientWidth;
  const cssH = waveformCanvas.clientHeight;
  if (cssW > 0 && cssH > 0) {
    waveformCanvas.width = Math.round(cssW * dpr);
    waveformCanvas.height = Math.round(cssH * dpr);
  }
}

// ---------------------------------------------------------------------------
// Preview rendering loop
// ---------------------------------------------------------------------------

function renderWaveform(): void {
  if (!waveformAnalyser) {
    waveformAnimFrame = 0;
    return;
  }

  waveformAnalyser.getByteFrequencyData(waveformFreqData);

  const dpr = window.devicePixelRatio || 1;
  const cw = waveformCanvas.width;
  const ch = waveformCanvas.height;
  waveformCtx.clearRect(0, 0, cw, ch);

  const barW = WAVEFORM_BAR_WIDTH * dpr;
  const gap = WAVEFORM_BAR_GAP * dpr;
  const totalBarsW = WAVEFORM_BAR_COUNT * (barW + gap) - gap;
  const startX = (cw - totalBarsW) / 2;

  // Map frequency bins to bar count
  const binCount = waveformFreqData.length;
  const binsPerBar = Math.floor(binCount / WAVEFORM_BAR_COUNT);

  // Shared gradient for all bars — avoids 48 createLinearGradient() calls per frame.
  const minH = 2 * dpr;
  const maxH = ch * 0.85;
  const sharedGradient = waveformCtx.createLinearGradient(0, ch, 0, ch * 0.15);
  sharedGradient.addColorStop(0, 'rgba(0, 180, 255, 0.55)');
  sharedGradient.addColorStop(0.5, 'rgba(0, 255, 255, 0.75)');
  sharedGradient.addColorStop(1, 'rgba(180, 255, 255, 0.8)');
  waveformCtx.fillStyle = sharedGradient;

  for (let i = 0; i < WAVEFORM_BAR_COUNT; i++) {
    // Average the frequency bins for this bar
    let sum = 0;
    for (let b = 0; b < binsPerBar; b++) {
      sum += waveformFreqData[i * binsPerBar + b] ?? 0;
    }
    const avg = sum / binsPerBar / 255; // 0-1
    const barH = Math.max(minH, avg * maxH);
    const x = startX + i * (barW + gap);
    const y = ch - barH;

    // Approximate per-bar alpha variation via globalAlpha
    waveformCtx.globalAlpha = 0.5 + avg * 0.5;
    waveformCtx.beginPath();
    waveformCtx.roundRect(x, y, barW, barH, barW / 2);
    waveformCtx.fill();

    // Glow effect on active bars
    if (avg > 0.3) {
      waveformCtx.shadowColor = 'rgba(0, 255, 255, 0.4)';
      waveformCtx.shadowBlur = 6 * dpr;
      waveformCtx.beginPath();
      waveformCtx.roundRect(x, y, barW, barH, barW / 2);
      waveformCtx.fill();
      waveformCtx.shadowColor = 'transparent';
      waveformCtx.shadowBlur = 0;
    }
  }

  waveformCtx.globalAlpha = 1;
  waveformAnimFrame = requestAnimationFrame(renderWaveform);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Start capturing audio from the given mic device and rendering the waveform. */
export async function startWaveformCapture(deviceId: string): Promise<void> {
  stopWaveformCapture();

  try {
    waveformMicStream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: deviceId } },
      video: false,
    });

    waveformAudioCtx = new AudioContext();
    waveformAnalyser = waveformAudioCtx.createAnalyser();
    waveformAnalyser.fftSize = WAVEFORM_FFT_SIZE;
    waveformAnalyser.smoothingTimeConstant = 0.8;

    waveformSource = waveformAudioCtx.createMediaStreamSource(waveformMicStream);
    waveformSource.connect(waveformAnalyser);
    waveformFreqData = new Uint8Array(waveformAnalyser.frequencyBinCount);
    currentMicDeviceId = deviceId;

    // Size the canvas pixel dimensions for DPR-crisp rendering
    sizeWaveformCanvas();
    waveformCanvas.classList.add('active');

    if (!waveformAnimFrame) {
      waveformAnimFrame = requestAnimationFrame(renderWaveform);
    }
  } catch (err) {
    console.warn('Waveform mic capture failed:', err);
  }
}

/** Stop capturing and clean up all waveform resources. */
export function stopWaveformCapture(): void {
  if (waveformMicStream) {
    for (const track of waveformMicStream.getTracks()) {
      track.stop();
    }
    waveformMicStream = null;
  }
  if (waveformSource) {
    waveformSource.disconnect();
    waveformSource = null;
  }
  if (waveformAudioCtx) {
    void waveformAudioCtx.close();
    waveformAudioCtx = null;
  }
  waveformAnalyser = null;
  currentMicDeviceId = null;
  waveformCanvas.classList.remove('active');
  if (waveformAnimFrame) {
    cancelAnimationFrame(waveformAnimFrame);
    waveformAnimFrame = 0;
  }
}

/**
 * Draw the waveform on the recording canvas at the bottom of the camera area.
 * Performance-sensitive — avoids per-bar gradient allocation and shadowBlur
 * (which is expensive on the recording canvas). Uses a single shared gradient
 * and a wider translucent bar for the glow effect instead.
 */
export function drawWaveformOnCanvas(
  ctx: CanvasRenderingContext2D,
  camX: number,
  camY: number,
  camW: number,
  camH: number,
  scale: number,
): void {
  if (!waveformAnalyser || waveformFreqData.length === 0) {
    return;
  }

  const barW = WAVEFORM_BAR_WIDTH * scale;
  const gap = WAVEFORM_BAR_GAP * scale;
  const wfH = WAVEFORM_HEIGHT * scale;
  const totalBarsW = WAVEFORM_BAR_COUNT * (barW + gap) - gap;
  const startX = camX + (camW - totalBarsW) / 2;
  const baseY = camY + camH; // bottom of camera

  const maxH = wfH * 0.85;
  const minH = 2 * scale;

  // Single shared gradient for all bars (vertical, covering full waveform height)
  const gradient = ctx.createLinearGradient(0, baseY, 0, baseY - maxH);
  gradient.addColorStop(0, 'rgba(0, 180, 255, 0.6)');
  gradient.addColorStop(0.5, 'rgba(0, 255, 255, 0.8)');
  gradient.addColorStop(1, 'rgba(180, 255, 255, 0.9)');

  const binCount = waveformFreqData.length;
  const binsPerBar = Math.floor(binCount / WAVEFORM_BAR_COUNT);

  // Pre-compute bar averages once — avoids redundant iteration in glow + solid passes
  const barAverages = new Float32Array(WAVEFORM_BAR_COUNT);
  for (let i = 0; i < WAVEFORM_BAR_COUNT; i++) {
    let sum = 0;
    for (let b = 0; b < binsPerBar; b++) {
      sum += waveformFreqData[i * binsPerBar + b] ?? 0;
    }
    barAverages[i] = sum / binsPerBar / 255;
  }

  // Draw glow layer first (wider translucent bars — cheap shadowBlur substitute)
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = 'rgba(0, 255, 255, 0.5)';
  const glowPad = 3 * scale;
  for (let i = 0; i < WAVEFORM_BAR_COUNT; i++) {
    const avg = barAverages[i];
    if (avg > 0.3) {
      const barH = Math.max(minH, avg * maxH);
      const x = startX + i * (barW + gap);
      const y = baseY - barH;
      ctx.beginPath();
      ctx.roundRect(x - glowPad, y - glowPad, barW + glowPad * 2, barH + glowPad * 2, (barW + glowPad * 2) / 2);
      ctx.fill();
    }
  }
  ctx.restore();

  // Draw solid bars
  ctx.fillStyle = gradient;
  for (let i = 0; i < WAVEFORM_BAR_COUNT; i++) {
    const avg = barAverages[i];
    const barH = Math.max(minH, avg * maxH);
    const x = startX + i * (barW + gap);
    const y = baseY - barH;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, barW / 2);
    ctx.fill();
  }
}

/** Get the current mic device ID (if waveform capture is active). */
export function getCurrentMicDeviceId(): string | null {
  return currentMicDeviceId;
}

/** Save the current mic device ID so it can be restored after a restart. */
export function saveMicDeviceIdForRestart(): void {
  savedMicDeviceIdForRestart = currentMicDeviceId;
}

/** Get the saved mic device ID for restart. */
export function getSavedMicDeviceIdForRestart(): string | null {
  return savedMicDeviceIdForRestart;
}

/** Clear the saved mic device ID after it has been consumed. */
export function clearSavedMicDeviceIdForRestart(): void {
  savedMicDeviceIdForRestart = null;
}

/** Check whether the waveform analyser is active. */
export function isWaveformActive(): boolean {
  return waveformAnalyser !== null;
}
