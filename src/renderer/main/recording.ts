// Canvas-based recording — composites the full preview into a video file
// ---------------------------------------------------------------------------
// Draws screen capture, camera, overlays, and effects onto an offscreen canvas,
// captures the composited output via MediaRecorder, and mixes screen + mic audio
// through the Web Audio API.
// ---------------------------------------------------------------------------

import {
  screenStream, cameraStream,
  bgColor, overlayName, activeSocials,
  activeCinemaFilter, activeCameraEnhancement,
  ambientParticlesEnabled, activeBgStyle,
  currentZoom,
  ctaIsVisible, ctaText,
  currentMicDeviceId,
  savedMicDeviceIdForRestart, setSavedMicDeviceIdForRestart,
} from './state';
import {
  screenVideo, cameraVideo, cameraContainer,
  cameraName, cameraSocials,
  previewContainer, playbackContainer,
} from './dom';
import { enterPlaybackMode, exitPlaybackMode } from './playback';
import { getMouseRelativeToCaptured } from './zoom';
import { updateSmoothMouse } from './overlays/cursor';
import { drawAmbientParticles, updateAmbientParticles, drawMeshBackground, hasMeshBlobs } from './overlays/background';
import { buildEnhancementFilter, getCinemaCanvas, applyRecordingCinemaFilter } from './overlays/cinema-filter';
import { drawCtaOnCanvas } from './overlays/cta-popup';
import { drawWaveformOnCanvas, stopWaveformCapture } from './overlays/waveform';
import { drawActionFeedOnCanvas } from './overlays/action-feed';
import { getSocialPath2D } from './overlays/socials';
import { isVisible as isPerfVisible, updatePipelineState } from '../../renderer/lib/perf-monitor';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Cached layout measurements — snapshotted at recording start to avoid
 *  expensive DOM reads every frame. */
interface RecLayoutCache {
  containerRect: DOMRect;
  cameraName: {
    rect: DOMRect;
    fontSize: number;
    fontFamily: string;
    fontWeight: string;
  } | null;
  socialItems: SocialItemCache[];
  camRect: DOMRect | null;
}

interface SocialItemCache {
  type: 'dot' | 'item';
  rect: DOMRect;
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  color: string;
  svgRect?: DOMRect;
  textRect?: DOMRect;
}

// ---------------------------------------------------------------------------
// YouTube-optimal recording settings for 1080p SDR uploads:
// - Video: 8-12 Mbps at 30fps → we use 12 Mbps for headroom
// - Audio: AAC-LC stereo at 48 kHz, 384 kbps (YouTube's stereo recommendation)
// - Container: MP4 with H.264 High Profile
// ---------------------------------------------------------------------------
const REC_VIDEO_BITRATE = 12_000_000;
const REC_AUDIO_BITRATE = 384_000;
const REC_AUDIO_SAMPLE_RATE = 48_000;
const REC_FRAMERATE = 30;

// ---------------------------------------------------------------------------
// Recording state
// ---------------------------------------------------------------------------

let recCanvas: HTMLCanvasElement | null = null;
let recCtx: CanvasRenderingContext2D | null = null;
let recAnimFrame: ReturnType<typeof setInterval> | null = null;
let recBorderAngle = 0; // degrees, rotates over time for animated border
let recMediaRecorder: MediaRecorder | null = null;
let recChunks: Blob[] = [];
let recMicStream: MediaStream | null = null;
let recAudioCtx: AudioContext | null = null;
// Must keep references to Web Audio source nodes to prevent garbage collection,
// which would silently disconnect them and produce silent audio.
let recAudioSources: MediaStreamAudioSourceNode[] = [];
let recCanvasStream: MediaStream | null = null;
let recCaptureTrack: CanvasCapture | null = null;
let recCombinedStream: MediaStream | null = null;
let recGeneration = 0;
let recLayoutCache: RecLayoutCache | null = null;

/** Guard against setInterval frame pileup — skip if previous frame is still rendering */
let recFrameInProgress = false;

// ---------------------------------------------------------------------------
// Performance profiling
// ---------------------------------------------------------------------------

interface ProfileAccum {
  total: number;
  setup: number;
  screen: number;
  camera: number;
  overlays: number;
  socials: number;
  actionFeed: number;
  waveform: number;
  cinemaFilter: number;
}

let recProfileAccum: ProfileAccum = {
  total: 0,
  setup: 0,
  screen: 0,
  camera: 0,
  overlays: 0,
  socials: 0,
  actionFeed: 0,
  waveform: 0,
  cinemaFilter: 0,
};
let recProfileFrames = 0;
let recProfileDropped = 0;
let recProfileLastLog = 0;
const REC_PROFILE_LOG_INTERVAL = 3000; // ms between summary logs
const REC_FRAME_BUDGET = 1000 / 30; // 33.3ms at 30fps

// ---------------------------------------------------------------------------
// Canvas captureStream track type
// ---------------------------------------------------------------------------

/** The track returned by canvas.captureStream(0) has a requestFrame() method
 *  that is not part of the standard MediaStreamTrack type. */
interface CanvasCapture extends MediaStreamTrack {
  requestFrame(): void;
}

// ---------------------------------------------------------------------------
// Layout cache builder
// ---------------------------------------------------------------------------

function buildRecLayoutCache(): RecLayoutCache {
  const containerRect = previewContainer.getBoundingClientRect();

  let cameraNameData: RecLayoutCache['cameraName'] = null;
  if (overlayName && cameraName.classList.contains('active')) {
    const rect = cameraName.getBoundingClientRect();
    const cs = window.getComputedStyle(cameraName);
    cameraNameData = {
      rect,
      fontSize: parseFloat(cs.fontSize),
      fontFamily: cs.fontFamily,
      fontWeight: cs.fontWeight,
    };
  }

  const socialItems: SocialItemCache[] = [];
  if (activeSocials.length > 0 && cameraSocials.classList.contains('active')) {
    const children = cameraSocials.children;
    for (let ci = 0; ci < children.length; ci++) {
      const child = children[ci] as HTMLElement;
      if (child.tagName === 'DIV') {
        continue; // row break spacer
      }
      const childRect = child.getBoundingClientRect();
      const cs = window.getComputedStyle(child);
      const entry: SocialItemCache = {
        type: child.classList.contains('social-dot') ? 'dot' : 'item',
        rect: childRect,
        fontSize: parseFloat(cs.fontSize),
        fontFamily: cs.fontFamily,
        fontWeight: cs.fontWeight,
        color: cs.color,
      };
      if (entry.type === 'item') {
        const svg = child.querySelector('svg');
        if (svg) {
          entry.svgRect = svg.getBoundingClientRect();
        }
        const textNode = child.childNodes[child.childNodes.length - 1];
        if (textNode && textNode.nodeType === Node.TEXT_NODE) {
          const range = document.createRange();
          range.selectNode(textNode);
          entry.textRect = range.getBoundingClientRect();
        }
      }
      socialItems.push(entry);
    }
  }

  const hasCamActive = cameraContainer.classList.contains('active') && !!cameraStream;
  const camRect = hasCamActive ? cameraVideo.getBoundingClientRect() : null;

  return { containerRect, cameraName: cameraNameData, socialItems, camRect };
}

// ---------------------------------------------------------------------------
// Animated border
// ---------------------------------------------------------------------------

function drawAnimatedBorder(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  borderWidth: number, angle: number,
): void {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const angleRad = (angle * Math.PI) / 180;
  const gradient = ctx.createConicGradient(angleRad, cx, cy);
  gradient.addColorStop(0, '#d600ff');
  gradient.addColorStop(0.25, '#00ff9f');
  gradient.addColorStop(0.5, '#00b8ff');
  gradient.addColorStop(0.75, '#001eff');
  gradient.addColorStop(1, '#d600ff');

  ctx.fillStyle = gradient;
  // Draw border as the area between outer and inner rectangles
  ctx.beginPath();
  // Outer rect (clockwise)
  ctx.rect(x - borderWidth, y - borderWidth, w + borderWidth * 2, h + borderWidth * 2);
  // Inner rect (counter-clockwise to cut out)
  ctx.rect(x + w, y, -w, h);
  ctx.fill('evenodd');
}

// ---------------------------------------------------------------------------
// Frame profiling
// ---------------------------------------------------------------------------

function logFrameProfile(): void {
  const now = performance.now();
  if (now - recProfileLastLog < REC_PROFILE_LOG_INTERVAL || recProfileFrames === 0) {
    return;
  }
  const n = recProfileFrames;
  const avg = (v: number): string => (v / n).toFixed(1);
  const pct = (v: number): string => ((v / recProfileAccum.total) * 100).toFixed(0);

  console.log(
    `[rec-perf] ${n} frames, ${recProfileDropped} dropped | ` +
    `avg ${avg(recProfileAccum.total)}ms ` +
    `(setup ${avg(recProfileAccum.setup)}ms ${pct(recProfileAccum.setup)}%, ` +
    `screen ${avg(recProfileAccum.screen)}ms ${pct(recProfileAccum.screen)}%, ` +
    `camera ${avg(recProfileAccum.camera)}ms ${pct(recProfileAccum.camera)}%, ` +
    `overlays ${avg(recProfileAccum.overlays)}ms ${pct(recProfileAccum.overlays)}%, ` +
    `socials ${avg(recProfileAccum.socials)}ms ${pct(recProfileAccum.socials)}%, ` +
    `actionFeed ${avg(recProfileAccum.actionFeed)}ms ${pct(recProfileAccum.actionFeed)}%, ` +
    `waveform ${avg(recProfileAccum.waveform)}ms ${pct(recProfileAccum.waveform)}%, ` +
    `cinema ${avg(recProfileAccum.cinemaFilter)}ms ${pct(recProfileAccum.cinemaFilter)}%)`,
  );

  // Reset accumulators
  recProfileAccum = {
    total: 0,
    setup: 0,
    screen: 0,
    camera: 0,
    overlays: 0,
    socials: 0,
    actionFeed: 0,
    waveform: 0,
    cinemaFilter: 0,
  };
  recProfileDropped = 0;
  recProfileFrames = 0;
  recProfileLastLog = now;
}

// ---------------------------------------------------------------------------
// drawRecordingFrame — THE BIG ONE: composites everything per frame
// ---------------------------------------------------------------------------

function drawRecordingFrame(): void {
  if (!recCtx || !recCanvas) {
    return;
  }

  // Don't draw or push frames while the MediaRecorder is paused.
  // The audio stream pauses with the recorder, but if we keep calling
  // requestFrame() the video track accumulates frames that desync
  // from audio on resume.
  if (recMediaRecorder && recMediaRecorder.state === 'paused') {
    return;
  }

  if (recFrameInProgress) {
    recProfileDropped++;
    return; // previous frame still rendering — skip to prevent pileup
  }
  recFrameInProgress = true;

  const t0 = performance.now();

  // Use cached container rect (populated at recording start, refreshed on overlay change)
  const containerRect = recLayoutCache?.containerRect ?? previewContainer.getBoundingClientRect();

  const w = recCanvas.width;
  const h = recCanvas.height;

  // Uniform scale — preserves aspect ratio, centres content with letterboxing
  const scale = Math.min(w / containerRect.width, h / containerRect.height);
  const offsetX = (w - containerRect.width * scale) / 2;
  const offsetY = (h - containerRect.height * scale) / 2;

  // Update animated border angle (4s cycle at ~30fps)
  recBorderAngle = (recBorderAngle + 360 / (4 * REC_FRAMERATE)) % 360;

  // Background (fills any letterbox areas too)
  recCtx.fillStyle = bgColor;
  recCtx.fillRect(0, 0, w, h);

  // Mesh gradient background (replaces solid fill visually)
  if (activeBgStyle === 'mesh' && hasMeshBlobs()) {
    drawMeshBackground(recCtx, w, h);
  }

  // Ambient particles on background
  if (ambientParticlesEnabled) {
    updateAmbientParticles(1 / REC_FRAMERATE);
    drawAmbientParticles(recCtx, w, h);
  }

  // Update smooth mouse + zoom for recording frame
  updateSmoothMouse();

  const tSetup = performance.now();

  // Draw screen video (with click-to-zoom crop)
  // Compensate for Display P3 → sRGB gamut compression when canvas captures
  // macOS <video> elements.  A slight saturation/contrast bump restores the
  // vibrancy lost in the colour-space conversion.
  if (screenVideo.classList.contains('active') && screenStream) {
    // Use layout dimensions (offsetWidth/Height) instead of getBoundingClientRect()
    // so that CSS scale transforms from zoom don't inflate the destination size.
    const layoutW = screenVideo.offsetWidth;
    const layoutH = screenVideo.offsetHeight;
    const layoutLeft = screenVideo.offsetLeft;
    // offsetTop gives CSS `top: 50%` but doesn't include `translateY(-50%)`
    // which visually centres the element, so we compute the centred position manually.
    const layoutTop = screenVideo.offsetTop - layoutH / 2;

    const x = offsetX + layoutLeft * scale;
    const y = offsetY + layoutTop * scale;
    const vw = layoutW * scale;
    const vh = layoutH * scale;

    // Animated gradient border (drawn before vibrancy filter so border stays clean)
    const border = 4 * scale;
    drawAnimatedBorder(recCtx, x, y, vw, vh, border, recBorderAngle);

    // Clip all screen content (video + cursor) to the screen area
    recCtx.save();
    recCtx.beginPath();
    recCtx.rect(x, y, vw, vh);
    recCtx.clip();

    // Apply vibrancy boost only to the screen drawImage calls
    recCtx.filter = 'saturate(1.12) contrast(1.03)';

    // Apply zoom crop to the source video
    const natW = screenVideo.videoWidth;
    const natH = screenVideo.videoHeight;
    if (currentZoom > 1.0 && natW && natH) {
      // Crop region size (inverse of zoom)
      const cropW = natW / currentZoom;
      const cropH = natH / currentZoom;

      // Get mouse position relative to captured content
      const relPos = getMouseRelativeToCaptured();
      if (relPos) {
        // Centre crop on mouse position, clamped to bounds
        let cropX = relPos.relX * natW - cropW / 2;
        let cropY = relPos.relY * natH - cropH / 2;
        cropX = Math.max(0, Math.min(natW - cropW, cropX));
        cropY = Math.max(0, Math.min(natH - cropH, cropY));
        recCtx.drawImage(screenVideo, cropX, cropY, cropW, cropH, x, y, vw, vh);
      } else {
        // Fallback: draw full video if no valid mouse position
        recCtx.drawImage(screenVideo, x, y, vw, vh);
      }
    } else {
      // No zoom — draw full video
      recCtx.drawImage(screenVideo, x, y, vw, vh);
    }

    // Reset vibrancy filter after screen draw
    recCtx.filter = 'none';

    recCtx.restore(); // restore clip
  }

  const tScreen = performance.now();

  // Use cached camera bounding rect — position doesn't change during recording
  const camRect = recLayoutCache?.camRect ?? null;
  let camCanvasX = 0;
  let camCanvasY = 0;
  let camCanvasW = 0;
  let camCanvasH = 0;
  if (camRect) {
    camCanvasX = offsetX + (camRect.left - containerRect.left) * scale;
    camCanvasY = offsetY + (camRect.top - containerRect.top) * scale;
    camCanvasW = camRect.width * scale;
    camCanvasH = camRect.height * scale;
  }

  // Draw camera video (mirrored) — with cinema filter applied only to camera
  if (camRect) {
    const x = camCanvasX;
    const y = camCanvasY;
    const vw = camCanvasW;
    const vh = camCanvasH;

    // Animated gradient border
    const border = 4 * scale;
    drawAnimatedBorder(recCtx, x, y, vw, vh, border, recBorderAngle);

    // Apply combined enhancement + cinema filter to camera only
    const recEnhFilter = buildEnhancementFilter(activeCameraEnhancement);
    const recCinFilter = getCinemaCanvas(activeCinemaFilter);
    const recCombined = [recEnhFilter, recCinFilter].filter(Boolean).join(' ');
    if (recCombined) {
      recCtx.filter = recCombined;
    }

    // Camera uses object-fit: cover — manually crop to match
    const natW = cameraVideo.videoWidth;
    const natH = cameraVideo.videoHeight;
    if (natW && natH) {
      const drawAspect = camRect.width / camRect.height;
      const vidAspect = natW / natH;
      let sx: number, sy: number, sw: number, sh: number;
      if (vidAspect > drawAspect) {
        sh = natH;
        sw = sh * drawAspect;
        sx = (natW - sw) / 2;
        sy = 0;
      } else {
        sw = natW;
        sh = sw / drawAspect;
        sx = 0;
        sy = (natH - sh) / 2;
      }

      // Mirror the camera by flipping horizontally
      recCtx.save();
      recCtx.translate(x + vw, y);
      recCtx.scale(-1, 1);
      recCtx.drawImage(cameraVideo, sx, sy, sw, sh, 0, 0, vw, vh);
      recCtx.restore();
    }

    // Reset filter after camera draw
    if (recCombined) {
      recCtx.filter = 'none';
    }
  }

  const tCamera = performance.now();

  // Draw camera name text (above camera) — uses cached layout measurements
  if (recLayoutCache?.cameraName) {
    const cn = recLayoutCache.cameraName;
    const cx = offsetX + (cn.rect.left - containerRect.left + cn.rect.width / 2) * scale;
    const cy = offsetY + (cn.rect.top - containerRect.top + cn.rect.height / 2) * scale;
    const fontSize = cn.fontSize * scale;
    recCtx.fillStyle = '#ffffff';
    recCtx.font = `${cn.fontWeight} ${fontSize}px ${cn.fontFamily}`;
    recCtx.textAlign = 'center';
    recCtx.textBaseline = 'middle';
    recCtx.fillText(overlayName, cx, cy);
  }

  const tOverlays = performance.now();

  // Draw social links — uses cached layout measurements for pixel-perfect match
  if (recLayoutCache && recLayoutCache.socialItems.length > 0) {
    let socialIdx = 0; // tracks which activeSocials entry we're on
    for (const item of recLayoutCache.socialItems) {
      const cx = offsetX + (item.rect.left - containerRect.left) * scale;
      const cy = offsetY + (item.rect.top - containerRect.top) * scale;
      const cw = item.rect.width * scale;
      const ch = item.rect.height * scale;

      if (item.type === 'dot') {
        // Draw dot separator
        const dotFontSize = item.fontSize * scale;
        recCtx.fillStyle = item.color;
        recCtx.font = `${item.fontWeight} ${dotFontSize}px ${item.fontFamily}`;
        recCtx.textAlign = 'center';
        recCtx.textBaseline = 'middle';
        recCtx.fillText('•', cx + cw / 2, cy + ch / 2);
      } else {
        // Draw SVG icon
        const socialEntry = socialIdx < activeSocials.length ? activeSocials[socialIdx] : undefined;

        if (item.svgRect && socialEntry) {
          const svgX = offsetX + (item.svgRect.left - containerRect.left) * scale;
          const svgY = offsetY + (item.svgRect.top - containerRect.top) * scale;
          const svgSize = item.svgRect.width * scale;
          const iconScale = svgSize / 24; // SVG paths use 24x24 viewBox
          recCtx.save();
          recCtx.translate(svgX, svgY);
          recCtx.scale(iconScale, iconScale);
          recCtx.fillStyle = 'rgba(255, 255, 255, 0.85)';
          recCtx.fill(getSocialPath2D(socialEntry.platform));
          recCtx.restore();
        }

        // Draw username text
        const itemFontSize = item.fontSize * scale;
        if (item.textRect && socialEntry) {
          const textX = offsetX + (item.textRect.left - containerRect.left) * scale;
          const textY = offsetY + (item.textRect.top - containerRect.top) * scale;
          const textH = item.textRect.height * scale;
          recCtx.fillStyle = item.color;
          recCtx.font = `${item.fontWeight} ${itemFontSize}px ${item.fontFamily}`;
          recCtx.textAlign = 'left';
          recCtx.textBaseline = 'middle';
          recCtx.fillText(socialEntry.handle, textX, textY + textH / 2);
        }

        socialIdx++;
      }
    }
  }

  const tSocials = performance.now();

  // Draw action feed overlaid on the camera area (bottom-right)
  if (camRect && camCanvasW > 0) {
    drawActionFeedOnCanvas(recCtx, { x: camCanvasX, y: camCanvasY, w: camCanvasW, h: camCanvasH }, scale);
  }

  const tActionFeed = performance.now();

  // Draw waveform at bottom of camera area
  if (camRect) {
    drawWaveformOnCanvas(recCtx, camCanvasX, camCanvasY, camCanvasW, camCanvasH, scale);
  }

  const tWaveform = performance.now();

  // Cinema post-processing: shadow tints, highlight washes (camera-only effect)
  if (camRect) {
    applyRecordingCinemaFilter(
      recCtx,
      { x: camCanvasX, y: camCanvasY, width: camCanvasW, height: camCanvasH },
      activeCinemaFilter,
    );
  }

  // CTA popup overlay — slides in from bottom during recording
  if (ctaIsVisible && ctaText) {
    drawCtaOnCanvas(recCtx, w, h, scale);
  }

  const tEnd = performance.now();

  // Accumulate profiling data
  recProfileAccum.total += tEnd - t0;
  recProfileAccum.setup += tSetup - t0;
  recProfileAccum.screen += tScreen - tSetup;
  recProfileAccum.camera += tCamera - tScreen;
  recProfileAccum.overlays += tOverlays - tCamera;
  recProfileAccum.socials += tSocials - tOverlays;
  recProfileAccum.actionFeed += tActionFeed - tSocials;
  recProfileAccum.waveform += tWaveform - tActionFeed;
  recProfileAccum.cinemaFilter += tEnd - tWaveform;
  recProfileFrames++;

  // Log warning for individual slow frames
  const frameTime = tEnd - t0;
  if (frameTime > REC_FRAME_BUDGET * 1.5) {
    console.warn(
      `[rec-perf] SLOW FRAME ${frameTime.toFixed(1)}ms: ` +
      `setup=${(tSetup - t0).toFixed(1)} screen=${(tScreen - tSetup).toFixed(1)} ` +
      `camera=${(tCamera - tScreen).toFixed(1)} overlays=${(tOverlays - tCamera).toFixed(1)} ` +
      `socials=${(tSocials - tOverlays).toFixed(1)} actionFeed=${(tActionFeed - tSocials).toFixed(1)} ` +
      `waveform=${(tWaveform - tActionFeed).toFixed(1)} ` +
      `cinema=${(tEnd - tWaveform).toFixed(1)}`,
    );
  }

  logFrameProfile();

  // Feed data to performance monitor (only when visible to avoid overhead)
  if (isPerfVisible()) {
    updatePipelineState({
      isRecording: true,
      profile: { ...recProfileAccum },
      frameCount: recProfileFrames,
      droppedFrames: recProfileDropped,
      recorderState: recMediaRecorder?.state ?? null,
      chunkCount: recChunks.length,
      targetFps: REC_FRAMERATE,
    });
  }

  // Manually push this frame into the capture stream. We use captureStream(0)
  // (manual mode) so frames are delivered even when the window is hidden and
  // Chromium would otherwise throttle automatic capture to ~1 fps.
  if (recCaptureTrack) {
    recCaptureTrack.requestFrame();
  }

  recFrameInProgress = false;
}

// ---------------------------------------------------------------------------
// MIME type detection
// ---------------------------------------------------------------------------

/**
 * Pick the best MIME type + extension for recording.
 * Prefer MP4/H.264 (YouTube-optimal), fall back to WebM/VP9.
 */
export function pickRecordingFormat(): { mimeType: string; extension: string } {
  // Use avc3 (not avc1) — avc3 embeds codec parameters inline per frame,
  // so the encoder tolerates dynamic changes from captureStream() without
  // stalling. avc1 requires a fixed codec description for the entire
  // recording, which causes frame drops when the canvas content changes.
  // H.264 High Profile + AAC-LC (YouTube-optimal)
  // Level 4.0 for 1080p output, fall back to Level 5.1 (4K-capable), then generic
  const mp4Candidates = [
    'video/mp4;codecs=avc3.640028,mp4a.40.2',
    'video/mp4;codecs=avc3.640028',
    'video/mp4;codecs=avc3.640033,mp4a.40.2',
    'video/mp4;codecs=avc3.640033',
    'video/mp4;codecs=avc3',
    // Fall back to avc1 if avc3 is not supported
    'video/mp4;codecs=avc1.640028,mp4a.40.2',
    'video/mp4;codecs=avc1.640028',
    'video/mp4;codecs=avc1.640033,mp4a.40.2',
    'video/mp4;codecs=avc1.640033',
    'video/mp4;codecs=avc1',
    'video/mp4',
  ];

  for (const mime of mp4Candidates) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return { mimeType: mime, extension: 'mp4' };
    }
  }

  // Fallback to WebM
  if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
    return { mimeType: 'video/webm;codecs=vp9', extension: 'webm' };
  }
  return { mimeType: 'video/webm', extension: 'webm' };
}

// ---------------------------------------------------------------------------
// Recording lifecycle
// ---------------------------------------------------------------------------

/** Clean up all recording resources (streams, audio, canvas) */
function cleanupRecordingResources(): void {
  // Clean up compositing loop
  if (recAnimFrame !== null) {
    clearInterval(recAnimFrame);
    recAnimFrame = null;
  }

  // Clean up canvas stream tracks
  if (recCanvasStream) {
    for (const track of recCanvasStream.getTracks()) {
      track.stop();
    }
    recCanvasStream = null;
  }

  // Clean up combined stream tracks
  if (recCombinedStream) {
    for (const track of recCombinedStream.getTracks()) {
      track.stop();
    }
    recCombinedStream = null;
  }

  // Clean up mic stream
  if (recMicStream) {
    for (const track of recMicStream.getTracks()) {
      track.stop();
    }
    recMicStream = null;
  }

  // Disconnect audio source nodes before closing context
  for (const src of recAudioSources) {
    src.disconnect();
  }
  recAudioSources = [];

  if (recAudioCtx) {
    void recAudioCtx.close();
    recAudioCtx = null;
  }

  recLayoutCache = null;
  recCaptureTrack = null;
  recCanvas = null;
  recCtx = null;
  recMediaRecorder = null;
  recChunks = [];
}

/**
 * Start canvas-based recording.
 *
 * Creates an offscreen canvas, sets up Web Audio mixing (screen loopback + mic),
 * creates a MediaRecorder on canvas.captureStream(), and starts the frame
 * rendering loop.
 */
export async function startRecording(micDeviceId: string | null): Promise<void> {
  // Bump generation so any in-flight onstop/onerror from a previous session
  // will detect the mismatch and skip cleanup (the new session owns those vars).
  recGeneration++;
  const myGeneration = recGeneration;

  // Clean up any previous recording resources to prevent leaks
  if (recAnimFrame !== null) {
    clearInterval(recAnimFrame);
    recAnimFrame = null;
  }
  if (recMediaRecorder && recMediaRecorder.state !== 'inactive') {
    recMediaRecorder.stop();
    recMediaRecorder = null;
  }

  // Reset recChunks immediately after stopping the old recorder so that any
  // stale ondataavailable events from the previous session can't push old
  // data into the new recording's chunk array.
  recChunks = [];

  if (recCanvasStream) {
    for (const track of recCanvasStream.getTracks()) {
      track.stop();
    }
    recCanvasStream = null;
  }

  const outputW = 1920;
  const outputH = 1080;
  recCanvas = document.createElement('canvas');
  recCanvas.width = outputW;
  recCanvas.height = outputH;
  recCtx = recCanvas.getContext('2d');

  // Start compositing loop — use setInterval for consistent frame delivery
  // (requestAnimationFrame is throttled when the window is backgrounded)
  // If we're restarting from playback mode (e.g. retry), restore the preview
  // container so layout calculations get valid dimensions.
  if (!playbackContainer.classList.contains('hidden')) {
    exitPlaybackMode();
  }

  recAnimFrame = setInterval(drawRecordingFrame, 1000 / REC_FRAMERATE);
  recLayoutCache = buildRecLayoutCache();

  // Get canvas video stream in manual mode (0 = no automatic capture).
  // We call requestFrame() explicitly after each draw so frames are captured
  // even when the window is hidden / throttled by Chromium.
  recCanvasStream = recCanvas.captureStream(0);
  recCaptureTrack = (recCanvasStream.getVideoTracks()[0] ?? null) as CanvasCapture | null;

  const combinedTracks: MediaStreamTrack[] = [...recCanvasStream.getVideoTracks()];

  // Stop the waveform visualizer's mic capture — having two concurrent
  // getUserMedia streams on the same device can cause one to receive silence
  // on macOS / Chromium.  Save the device ID first so we can restart after
  // recording ends (stopWaveformCapture nulls currentMicDeviceId).
  setSavedMicDeviceIdForRestart(currentMicDeviceId);
  stopWaveformCapture();

  // Capture mic audio if selected
  const audioTracks: MediaStreamTrack[] = [];
  if (micDeviceId) {
    try {
      recMicStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: micDeviceId },
          sampleRate: { ideal: REC_AUDIO_SAMPLE_RATE },
          channelCount: { ideal: 2 },
        },
        video: false,
      });
      const micTracks = recMicStream.getAudioTracks();
      audioTracks.push(...micTracks);
    } catch (err) {
      console.warn('Mic capture for recording failed:', err);
    }
  }

  // Always route audio through AudioContext → MediaStreamDestination.
  // Chromium's MP4 MediaRecorder has a bug where it silently produces empty
  // audio when a raw getUserMedia audio track is combined with a canvas
  // captureStream video track. Routing through AudioContext creates a
  // "synthetic" MediaStreamTrack from the destination node, which the
  // MP4 muxer handles correctly.
  if (audioTracks.length > 0) {
    recAudioCtx = new AudioContext({ sampleRate: REC_AUDIO_SAMPLE_RATE });
    await recAudioCtx.resume();
    const dest = recAudioCtx.createMediaStreamDestination();
    recAudioSources = [];
    for (const track of audioTracks) {
      const source = recAudioCtx.createMediaStreamSource(new MediaStream([track]));
      source.connect(dest);
      recAudioSources.push(source); // prevent GC from disconnecting the node
    }
    combinedTracks.push(...dest.stream.getAudioTracks());
  }

  recCombinedStream = new MediaStream(combinedTracks);
  const { mimeType } = pickRecordingFormat();
  console.log('[rec] Selected recording format:', mimeType);

  // Track the active mimeType for this session — may change on encoder fallback
  let activeMimeType = mimeType;

  recMediaRecorder = new MediaRecorder(recCombinedStream, {
    mimeType,
    videoBitsPerSecond: REC_VIDEO_BITRATE,
    audioBitsPerSecond: REC_AUDIO_BITRATE,
  });
  recChunks = [];

  recMediaRecorder.ondataavailable = (e: BlobEvent) => {
    if (e.data.size > 0) {
      recChunks.push(e.data);
    }
  };

  // Track whether a fallback recorder has taken over — prevents the old
  // recorder's onstop from cleaning up resources the fallback still needs.
  let fallbackActive = false;

  recMediaRecorder.onerror = (event: Event) => {
    if (myGeneration !== recGeneration) {
      return; // stale session — new recording owns the shared state
    }

    const error = (event as ErrorEvent).error as DOMException | undefined;
    console.error('[rec] MediaRecorder error:', error?.name, error?.message);

    // Encoder initialization can fail even when isTypeSupported() returns true
    // (Chromium bug). If the encoder failed with the current format, retry with
    // a WebM fallback before giving up completely.
    if (
      error?.name === 'EncodingError' &&
      recCombinedStream &&
      !activeMimeType.startsWith('video/webm')
    ) {
      console.warn('[rec] MP4 encoder failed — retrying with WebM fallback');
      recChunks = [];
      const webmMime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm';
      activeMimeType = webmMime;
      console.log('[rec] Fallback format:', webmMime);

      try {
        // Mark fallback as active BEFORE creating the new recorder so the
        // old recorder's onstop (which may fire after onerror) is a no-op.
        fallbackActive = true;

        recMediaRecorder = new MediaRecorder(recCombinedStream, {
          mimeType: webmMime,
          videoBitsPerSecond: REC_VIDEO_BITRATE,
          audioBitsPerSecond: REC_AUDIO_BITRATE,
        });

        recMediaRecorder.ondataavailable = (ev: BlobEvent) => {
          if (ev.data.size > 0) {
            recChunks.push(ev.data);
          }
        };

        recMediaRecorder.onerror = (ev: Event) => {
          if (myGeneration !== recGeneration) {
            return;
          }
          const err2 = (ev as ErrorEvent).error as DOMException | undefined;
          console.error('[rec] Fallback MediaRecorder also failed:', err2?.name, err2?.message);
          cleanupRecordingResources();
        };

        recMediaRecorder.onstop = () => {
          if (myGeneration !== recGeneration) {
            return;
          }
          if (recAnimFrame) {
            clearInterval(recAnimFrame);
            recAnimFrame = null;
          }
          const blob = new Blob(recChunks, { type: webmMime });
          enterPlaybackMode(blob);
          cleanupRecordingResources();
        };

        recMediaRecorder.start(1000);
        console.log('[rec] Fallback MediaRecorder started successfully');
        return;
      } catch (fallbackErr) {
        console.error('[rec] Failed to create fallback MediaRecorder:', fallbackErr);
        fallbackActive = false;
      }
    }

    cleanupRecordingResources();
  };

  recMediaRecorder.onstop = () => {
    if (myGeneration !== recGeneration) {
      return; // stale session — new recording owns the shared state
    }

    // If a fallback recorder took over, this is the OLD recorder's onstop
    // firing after its onerror — ignore it so we don't kill the fallback.
    if (fallbackActive) {
      return;
    }

    // Stop compositing loop
    if (recAnimFrame) {
      clearInterval(recAnimFrame);
      recAnimFrame = null;
    }

    const blob = new Blob(recChunks, { type: activeMimeType });

    // Enter playback mode (playback.ts owns the blob for export)
    enterPlaybackMode(blob);

    // Clean up canvas stream tracks
    if (recCanvasStream) {
      for (const track of recCanvasStream.getTracks()) {
        track.stop();
      }
      recCanvasStream = null;
    }

    // Clean up combined stream tracks
    if (recCombinedStream) {
      for (const track of recCombinedStream.getTracks()) {
        track.stop();
      }
      recCombinedStream = null;
    }

    // Clean up mic stream
    if (recMicStream) {
      for (const track of recMicStream.getTracks()) {
        track.stop();
      }
      recMicStream = null;
    }

    // Disconnect audio source nodes before closing context
    for (const src of recAudioSources) {
      src.disconnect();
    }
    recAudioSources = [];

    if (recAudioCtx) {
      void recAudioCtx.close();
      recAudioCtx = null;
    }

    recLayoutCache = null;
    recCaptureTrack = null;
    recCanvas = null;
    recCtx = null;
    recMediaRecorder = null;
    recChunks = [];
  };

  recMediaRecorder.start(1000);

  // Signal main process that recording is fully started (mic acquired,
  // MediaRecorder running). Main process will now hide the window.
  // Hiding before this point causes Chromium to deliver a silent audio track.
  window.mainAPI.signalRecordingReady();
}

/**
 * Stop recording — stops the MediaRecorder which triggers onstop → playback mode.
 */
export function stopRecording(): void {
  if (!recMediaRecorder) {
    // Stale stop signal (e.g. app restart) — ignore silently
    return;
  }
  console.log(
    '[rec] stopRecording — recMediaRecorder:', recMediaRecorder.state,
    'chunks:', recChunks.length,
  );
  if (recMediaRecorder.state !== 'inactive') {
    recMediaRecorder.stop();
  }
}

/**
 * Pause recording — pauses the MediaRecorder (audio + video freeze).
 */
export function pauseRecording(): void {
  if (recMediaRecorder && recMediaRecorder.state === 'recording') {
    recMediaRecorder.pause();
  }
}

/**
 * Resume recording — resumes a paused MediaRecorder.
 */
export function resumeRecording(): void {
  if (recMediaRecorder && recMediaRecorder.state === 'paused') {
    recMediaRecorder.resume();
  }
}

// ---------------------------------------------------------------------------
// Accessors for external consumers
// ---------------------------------------------------------------------------

/** Refresh layout cache (call when overlay settings change during recording) */
export function refreshRecLayoutCache(): void {
  if (recCanvas) {
    recLayoutCache = buildRecLayoutCache();
  }
}

/** Check whether a recording animation frame loop is running. */
export function isRecordingActive(): boolean {
  return recAnimFrame !== null;
}

/** Get the current MediaRecorder state, or null if not recording. */
export function getRecorderState(): string | null {
  return recMediaRecorder?.state ?? null;
}

/** Get the total number of recorded chunks so far. */
export function getRecChunkCount(): number {
  return recChunks.length;
}
