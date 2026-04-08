// Main renderer entry point — wires all modules together
// ---------------------------------------------------------------------------
// Imports all overlay modules, preview, recording, playback, zoom, state, dom
// and sets up IPC event listeners, overlay application, and perf monitoring.
// ---------------------------------------------------------------------------

import '../lib/pep'; // Auto-registers click sound effect
import * as perfMonitor from '../lib/perf-monitor';

import { handlePreviewUpdate, initResizeHandler, initScreenDrag, applyAspectRatioLayout, isShortsMode } from './preview';
import { startRecording, stopRecording, pauseRecording, resumeRecording, isRecordingActive, refreshRecLayoutCache } from './recording';
import { runCountdown, skipCountdown, isCountdownActive } from './overlays/countdown';
import { initPlaybackHandlers, enterPlaybackFromBuffer } from './playback';
import { updateCameraName, isMagnifyActive } from './overlays/camera-name';
import { updateSocialsOverlay } from './overlays/socials';
import { applyCameraFiltersToPreview, buildEnhancementFilter } from './overlays/cinema-filter';
import { setCtaConfig, showCtaPopup, startCtaLoop, stopCtaLoop } from './overlays/cta-popup';
import { initAmbientParticles, initMeshBlobs, getMeshBlobsColor, ensureMeshStartTime, startMeshLoop, startParticleLoop as startBgParticleLoop } from './overlays/background';
import { addActionFeedItem, hasActionFeedItems } from './overlays/action-feed';
import { handleKeyboardOverlayEvent } from './overlays/keyboard-overlay';
import { isWaveformActive } from './overlays/waveform';
import { setZoomConfig, onMouseDown, onMouseUp, sizeBgCanvas, isZoomLoopRunning, getMouseRelativeToCaptured } from './zoom';
import { toggleBlurMode, setBlurRegions, refreshBlurRegionPositions } from './overlays/blur-regions';
import { showPreviewSpotlight, hidePreviewSpotlight, updatePreviewSpotlight } from './overlays/spotlight';
import { setCursorEffectConfig, addClickRipple } from './overlays/cursor-effects';
import { initWebcamBlur, isSegmenterReady, startPreviewBlur, stopPreviewBlur, disposeWebcamBlur } from './overlays/webcam-blur';
import { playClickSound } from './audio/click-sounds';
import { loadWatermark, clearWatermark } from './overlays/watermark';
import { previewContainer, cameraContainer, cameraVideo, bgCtx, bgCanvas } from './dom';
import {
  screenStream,
  activeSocials,
  activeCinemaFilter, activeCameraEnhancement,
  ctaText, ctaIntervalMs,
  activeAspectRatio,
  countdownEnabled,
  setCurrentMouseX, setCurrentMouseY,
  setDisplayBounds,
  setOverlayName,
  setBgColor, bgColor,
  setActiveBgStyle, activeBgStyle,
  setActiveCinemaFilter,
  setActiveCameraEnhancement,
  setAmbientParticlesEnabled, ambientParticlesEnabled,
  setCountdownEnabled,
  activeWebcamBlur, activeWebcamBlurIntensity,
  setActiveWebcamBlur, setActiveWebcamBlurIntensity,
  setActiveShortsBaseZoom,
  activeSpotlight, setActiveSpotlight,
  setActiveCursorEffect,
  activeClickSounds, setActiveClickSounds,
  setActivePerspective, setActivePerspectiveIntensity,
  activeWatermark, setActiveWatermark,
} from './state';
import { ASPECT_RATIOS } from '../../shared/feature-types';

import type { OverlayConfig } from '../../shared/types';

// ---------------------------------------------------------------------------
// Wire IPC events — mouse tracking
// ---------------------------------------------------------------------------

window.mainAPI.onMousePosition((position) => {
  setCurrentMouseX(position.x);
  setCurrentMouseY(position.y);
  setDisplayBounds(position.displayBounds);
});

window.mainAPI.onMouseClick((event) => {
  if (event.type === 'down') {
    onMouseDown();
    // Spawn click ripple at the mouse position (relative to captured content)
    const relPos = getMouseRelativeToCaptured();
    if (relPos) {
      addClickRipple(relPos.relX, relPos.relY);
    }
    // Play click sound during recording
    if (activeClickSounds && isRecordingActive()) {
      playClickSound('mouse-click');
    }
  } else if (event.type === 'up') {
    onMouseUp();
  }
});

// ---------------------------------------------------------------------------
// Wire IPC events — preview updates
// ---------------------------------------------------------------------------

window.mainAPI.onPreviewUpdate((selection) => {
  handlePreviewUpdate(selection);
});

// ---------------------------------------------------------------------------
// Wire IPC events — overlay updates
// ---------------------------------------------------------------------------

window.mainAPI.onOverlayUpdate((settings) => {
  applyOverlay(settings);
});

// ---------------------------------------------------------------------------
// Wire IPC events — recording lifecycle
// ---------------------------------------------------------------------------

window.mainAPI.onRecordingStart((micDeviceId) => {
  console.log('[rec] onRecordingStart received, micDeviceId:', micDeviceId);

  // If a countdown is already running, skip it (user pressed record again)
  if (isCountdownActive()) {
    skipCountdown();
    return;
  }

  const doStart = (): void => {
    // Signal countdown finished (null = recording is now active)
    window.mainAPI.sendCountdownTick(null);
    startRecording(micDeviceId).catch((error) => {
      console.error('Failed to start recording:', error);
    });
    if (!isShortsMode()) {
      startCtaLoop();
    }
  };

  if (countdownEnabled) {
    runCountdown((value) => {
      window.mainAPI.sendCountdownTick(value);
    }).then(doStart).catch((error) => {
      console.error('Countdown error:', error);
    });
  } else {
    doStart();
  }
});

window.mainAPI.onRecordingStop(() => {
  stopCtaLoop();
  stopRecording();
});

window.mainAPI.onRecordingPause(() => {
  pauseRecording();
});

window.mainAPI.onRecordingResume(() => {
  resumeRecording();
});

// ---------------------------------------------------------------------------
// Wire IPC events — CTA test from edit modal
// ---------------------------------------------------------------------------

window.mainAPI.onCtaTest(() => {
  showCtaPopup();
});

// ---------------------------------------------------------------------------
// Wire IPC events — action feed from main process
// ---------------------------------------------------------------------------

window.mainAPI.onActionEvent((event) => {
  addActionFeedItem(event);
  handleKeyboardOverlayEvent(event);
  // Play key-press sound for typing/shortcut actions during recording
  if (activeClickSounds && isRecordingActive() && (event.type === 'type' || event.type === 'shortcut')) {
    playClickSound('key-press');
  }
});

// ---------------------------------------------------------------------------
// Wire IPC events — blur mode toggle from toolbar
// ---------------------------------------------------------------------------

window.mainAPI.onBlurModeToggle(() => {
  toggleBlurMode();
});

// ---------------------------------------------------------------------------
// Wire IPC events — webcam background blur toggle from toolbar
// ---------------------------------------------------------------------------

window.mainAPI.onWebcamBlurToggle(() => {
  if (activeWebcamBlur) {
    setActiveWebcamBlur(false);
    disposeWebcamBlur();
  } else {
    setActiveWebcamBlur(true);
    void initWebcamBlur().then(() => {
      // In shorts mode the canvas loop in preview.ts reads activeWebcamBlur
      // and calls processBlurFrame directly — no overlay needed.
      if (isShortsMode()) return;
      // Only start the overlay preview blur if the segmenter actually loaded.
      // If it failed (network, GPU), don't hide the camera for a blank canvas.
      if (!isSegmenterReady()) {
        console.warn('[webcam-blur] Segmenter failed to init — disabling');
        setActiveWebcamBlur(false);
        return;
      }
      startPreviewBlur(cameraVideo, cameraContainer, activeWebcamBlurIntensity);
    });
  }
});

// ---------------------------------------------------------------------------
// Wire IPC events — aspect ratio update from toolbar
// ---------------------------------------------------------------------------

window.mainAPI.onAspectRatioUpdate((ratio) => {
  applyAspectRatioLayout(ratio);
  refreshRecLayoutCache();
});

// ---------------------------------------------------------------------------
// Apply overlay settings — the main function that configures all modules
// ---------------------------------------------------------------------------

function applyOverlay(settings: OverlayConfig): void {
  // Update camera name overlay
  setOverlayName(settings.name);
  updateCameraName(settings.name, settings.nameFont, settings.nameFontSize);

  // Background color
  if (settings.bgColor) {
    setBgColor(settings.bgColor);
  }
  // CSS background is set after bgStyle is resolved (below)

  // Social overlays
  updateSocialsOverlay(settings.socials);

  // Cinema filter + camera enhancement
  setActiveCinemaFilter(settings.cinemaFilter ?? 'none');
  if (settings.cameraEnhancement) {
    setActiveCameraEnhancement(settings.cameraEnhancement);
  }
  applyCameraFiltersToPreview();

  // Mesh gradient background
  const newBgStyle = settings.bgStyle ?? 'solid';
  const bgStyleChanged = newBgStyle !== activeBgStyle;
  const colorChanged = settings.bgColor !== getMeshBlobsColor();
  setActiveBgStyle(newBgStyle);

  if (activeBgStyle === 'mesh') {
    // Make CSS background transparent so canvas mesh gradient shows through
    previewContainer.style.background = 'transparent';
    if (bgStyleChanged || colorChanged) {
      initMeshBlobs(bgColor);
      sizeBgCanvas();
      ensureMeshStartTime();
    }
    startMeshLoop();
  } else {
    // Solid mode — use CSS background color
    previewContainer.style.background = bgColor;
    if (bgStyleChanged) {
      // Switched away from mesh — clear bg canvas
      bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
    }
  }

  // Ambient particles
  const wantParticles = settings.ambientParticles ?? false;
  if (wantParticles && !ambientParticlesEnabled) {
    initAmbientParticles();
    sizeBgCanvas();
    // Start a standalone particle animation if the zoom render loop isn't running
    startBgParticleLoop();
  }
  setAmbientParticlesEnabled(wantParticles);
  if (!wantParticles) {
    bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
  }

  // Mouse zoom settings
  setZoomConfig(settings.mouseZoom ?? 1.5, settings.zoomLingerMs ?? 2500);

  // CTA popup text + font (uses same font as name overlay)
  // Save previous values to detect changes that require loop restart
  const prevCtaText = ctaText;
  const prevCtaInterval = ctaIntervalMs;

  setCtaConfig(
    settings.ctaText ?? '',
    settings.ctaIcon ?? '',
    settings.nameFont || 'Datatype',
    settings.ctaIntervalMs ?? 180_000,
  );

  // Restart CTA loop if text or interval changed (runs in both preview and recording)
  const newCtaText = settings.ctaText ?? '';
  if (newCtaText !== prevCtaText || (settings.ctaIntervalMs ?? 180_000) !== prevCtaInterval) {
    if (newCtaText) {
      startCtaLoop();
    } else {
      stopCtaLoop();
    }
  }

  // Blur regions from overlay config
  if (settings.blurRegions) {
    setBlurRegions(settings.blurRegions);
  }

  // Spotlight effect
  const wantSpotlight = settings.spotlight ?? false;
  if (wantSpotlight && !activeSpotlight) {
    setActiveSpotlight(true);
    showPreviewSpotlight();
  } else if (!wantSpotlight && activeSpotlight) {
    setActiveSpotlight(false);
    hidePreviewSpotlight();
  }

  // Cursor effects (trail + click ripple)
  const cursorEffect = settings.cursorEffect ?? { trail: 'none' as const, clickRipple: false, clickRippleColor: '#ffffff' };
  setActiveCursorEffect(cursorEffect);
  setCursorEffectConfig(cursorEffect);

  // Shorts mode base zoom
  setActiveShortsBaseZoom(settings.shortsBaseZoom ?? 2.2);

  // Webcam background blur
  const wantWebcamBlur = settings.webcamBlur ?? false;
  const webcamBlurIntensity = settings.webcamBlurIntensity ?? 30;
  setActiveWebcamBlurIntensity(webcamBlurIntensity);

  if (wantWebcamBlur && !activeWebcamBlur) {
    // Turning on — init segmenter; shorts mode uses its own canvas loop
    setActiveWebcamBlur(true);
    void initWebcamBlur().then(() => {
      if (isShortsMode()) return;
      if (!isSegmenterReady()) { setActiveWebcamBlur(false); return; }
      startPreviewBlur(cameraVideo, cameraContainer, webcamBlurIntensity);
    });
  } else if (!wantWebcamBlur && activeWebcamBlur) {
    // Turning off — dispose segmenter and stop preview blur
    setActiveWebcamBlur(false);
    disposeWebcamBlur();
  } else if (wantWebcamBlur && activeWebcamBlur) {
    // Already on — update intensity for preview (skip in shorts mode)
    if (!isShortsMode()) {
      stopPreviewBlur();
      startPreviewBlur(cameraVideo, cameraContainer, webcamBlurIntensity);
    }
  }

  // Click sounds
  setActiveClickSounds(settings.clickSounds ?? false);

  // Perspective tilt effect
  setActivePerspective(settings.perspective ?? false);
  setActivePerspectiveIntensity(settings.perspectiveIntensity ?? 2);

  // Countdown setting
  setCountdownEnabled(settings.countdownEnabled ?? true);

  // Watermark overlay
  const wm = settings.watermark ?? { enabled: false, imagePath: '', position: 'bottom-right' as const, opacity: 0.7, size: 10 };
  setActiveWatermark(wm);
  if (wm.enabled && wm.imagePath) {
    // Load/cache watermark image (only re-loads if path changed)
    void loadWatermark(wm.imagePath).catch(() => {
      // Image load failed — logged inside loadWatermark
    });
  } else {
    clearWatermark();
  }

  // Refresh recording layout cache if recording is active
  refreshRecLayoutCache();
}

// ---------------------------------------------------------------------------
// Init — playback handlers
// ---------------------------------------------------------------------------

initPlaybackHandlers();

// Check for a last recording to offer recovery
void (async () => {
  try {
    const info = await window.mainAPI.hasLastRecording();
    if (info.exists && info.size > 0) {
      const age = Date.now() - info.modified;
      const ageStr = age < 3600_000
        ? `${Math.round(age / 60_000)} min ago`
        : age < 86400_000
          ? `${Math.round(age / 3600_000)} hr ago`
          : `${Math.round(age / 86400_000)} days ago`;
      const sizeMB = (info.size / (1024 * 1024)).toFixed(1);

      // Show a non-blocking banner at the top of the preview
      const banner = document.createElement('div');
      banner.className = 'recovery-banner';
      banner.innerHTML = `
        <span class="recovery-text">Last recording available (${sizeMB} MB, ${ageStr})</span>
        <button class="recovery-btn recovery-btn--open">Review</button>
        <button class="recovery-btn recovery-btn--dismiss">Dismiss</button>
      `;
      document.body.appendChild(banner);

      const openBtn = banner.querySelector('.recovery-btn--open') as HTMLButtonElement;
      const dismissBtn = banner.querySelector('.recovery-btn--dismiss') as HTMLButtonElement;

      dismissBtn.addEventListener('click', () => banner.remove());

      openBtn.addEventListener('click', async () => {
        banner.remove();
        try {
          const buffer = await window.mainAPI.loadLastRecording();
          await enterPlaybackFromBuffer(buffer);
        } catch (err) {
          console.warn('[recovery] Failed to load last recording:', err);
        }
      });

    }
  } catch {
    // No last recording — ignore
  }
})();

// ---------------------------------------------------------------------------
// Init — window resize + screen drag
// ---------------------------------------------------------------------------

initResizeHandler();
initScreenDrag();

// ---------------------------------------------------------------------------
// Restore saved overlay on startup
// ---------------------------------------------------------------------------

void window.mainAPI.getConfig().then((config) => {
  if (config.overlay) {
    applyOverlay(config.overlay);
  }
});

// ---------------------------------------------------------------------------
// Performance monitor — toggle with Cmd+Shift+P
// ---------------------------------------------------------------------------

perfMonitor.initPerfMonitor();

/** Build the active features list for the performance monitor */
function refreshPerfMonitorFeatures(): void {
  const hasCam = cameraContainer.classList.contains('active');
  const hasCinema = activeCinemaFilter !== 'none';
  const recording = isRecordingActive();

  const features: Array<{ name: string; active: boolean; cost: 'low' | 'medium' | 'high' }> = [
    { name: 'Screen capture', cost: 'low', active: screenStream !== null },
    { name: 'Camera capture', cost: 'low', active: hasCam },
    { name: 'Click-to-zoom', cost: 'medium', active: isZoomLoopRunning() },
    { name: 'Waveform visualizer', cost: 'low', active: isWaveformActive() },
    { name: 'Action feed', cost: 'medium', active: hasActionFeedItems() },
    { name: 'Name magnify wave', cost: 'low', active: isMagnifyActive() },
    { name: `Cinema filter: ${activeCinemaFilter}`, cost: 'medium', active: hasCinema },
    { name: 'Social overlays', cost: 'low', active: activeSocials.length > 0 },
    { name: 'Animated border (conic gradient)', cost: 'medium', active: recording },
    { name: `Canvas recording (${ASPECT_RATIOS[activeAspectRatio].width}×${ASPECT_RATIOS[activeAspectRatio].height})`, cost: 'high', active: recording },
    {
      name: 'Camera enhancement filters',
      cost: 'low',
      active: buildEnhancementFilter(activeCameraEnhancement) !== '',
    },
  ];

  perfMonitor.updateActiveFeatures(features);
}

// Refresh features periodically when monitor is visible
setInterval(() => {
  if (perfMonitor.isVisible()) {
    refreshPerfMonitorFeatures();

    // Also update pipeline state when not recording (for preview-only metrics)
    if (!isRecordingActive()) {
      perfMonitor.updatePipelineState({
        isRecording: false,
        profile: {
          total: 0,
          setup: 0,
          screen: 0,
          camera: 0,
          overlays: 0,
          socials: 0,
          actionFeed: 0,
          waveform: 0,
          cinemaFilter: 0,
        },
        frameCount: 0,
        droppedFrames: 0,
        recorderState: null,
        chunkCount: 0,
        targetFps: 30,
      });
    }
  }
}, 500);
