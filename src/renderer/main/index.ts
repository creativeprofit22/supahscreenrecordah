// Main renderer entry point — wires all modules together
// ---------------------------------------------------------------------------
// Imports all overlay modules, preview, recording, playback, zoom, state, dom
// and sets up IPC event listeners, overlay application, and perf monitoring.
// ---------------------------------------------------------------------------

import '../lib/pep'; // Auto-registers click sound effect
import * as perfMonitor from '../lib/perf-monitor';

import { handlePreviewUpdate, initResizeHandler, initScreenDrag } from './preview';
import { startRecording, stopRecording, pauseRecording, resumeRecording, isRecordingActive, refreshRecLayoutCache } from './recording';
import { initPlaybackHandlers } from './playback';
import { updateCameraName, isMagnifyActive } from './overlays/camera-name';
import { updateSocialsOverlay } from './overlays/socials';
import { applyCameraFiltersToPreview, buildEnhancementFilter } from './overlays/cinema-filter';
import { setCtaConfig, showCtaPopup, startCtaLoop, stopCtaLoop } from './overlays/cta-popup';
import { initAmbientParticles, initMeshBlobs, getMeshBlobsColor, ensureMeshStartTime, startMeshLoop, startParticleLoop as startBgParticleLoop } from './overlays/background';
import { addActionFeedItem, hasActionFeedItems } from './overlays/action-feed';
import { isWaveformActive } from './overlays/waveform';
import { setZoomConfig, onMouseDown, onMouseUp, sizeBgCanvas, isZoomLoopRunning } from './zoom';
import { previewContainer, cameraContainer, bgCtx, bgCanvas } from './dom';
import {
  screenStream,
  activeSocials,
  activeCinemaFilter, activeCameraEnhancement,
  ctaText, ctaIntervalMs,
  setCurrentMouseX, setCurrentMouseY,
  setDisplayBounds,
  setOverlayName,
  setBgColor, bgColor,
  setActiveBgStyle, activeBgStyle,
  setActiveCinemaFilter,
  setActiveCameraEnhancement,
  setAmbientParticlesEnabled, ambientParticlesEnabled,
} from './state';

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
  startRecording(micDeviceId).catch((error) => {
    console.error('Failed to start recording:', error);
  });
  startCtaLoop();
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

  // Refresh recording layout cache if recording is active
  refreshRecLayoutCache();
}

// ---------------------------------------------------------------------------
// Init — playback handlers
// ---------------------------------------------------------------------------

initPlaybackHandlers();

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
    { name: 'Canvas recording (1920×1080)', cost: 'high', active: recording },
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
