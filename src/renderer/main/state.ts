import type { CameraEnhancement, BlurRegion, AspectRatio, CursorEffectConfig, WatermarkConfig } from '../../shared/types';

// ---------------------------------------------------------------------------
// Layout & stream state
// ---------------------------------------------------------------------------
export let screenStream: MediaStream | null = null;
export let cameraStream: MediaStream | null = null;
export let currentLayout = 'camera-right';
export let currentScreenSourceId = '';
export let currentCameraDeviceId = '';
export let screenX = 24; // default = container padding
export const TRANSITION_MS = 400; // matches CSS --transition-speed

// ---------------------------------------------------------------------------
// Overlay state
// ---------------------------------------------------------------------------
export let overlayName = '';
export let bgColor = '#6b8cce';
export let activeSocials: Array<{ platform: string; handle: string }> = [];
export let activeCinemaFilter = 'none';
export let activeCameraEnhancement: CameraEnhancement = {
  brightness: 105, contrast: 112, saturation: 130,
  warmth: 5, sharpness: 0, softness: 0,
};
export let ambientParticlesEnabled = false;
export let activeBgStyle = 'solid';

// ---------------------------------------------------------------------------
// CTA popup state
// ---------------------------------------------------------------------------
export let ctaText = '';
export let ctaIcon = '';
export let ctaFont = 'Datatype';
export let ctaIntervalMs = 180_000; // configurable: 45s–3min, default 3 minutes
export let ctaTimer: ReturnType<typeof setInterval> | null = null;
export let ctaHideTimeout: ReturnType<typeof setTimeout> | null = null;
export let ctaIsVisible = false;
export let ctaAnimStartTime = 0;
export let ctaAnimState: 'idle' | 'sliding-in' | 'visible' | 'sliding-out' = 'idle';

// ---------------------------------------------------------------------------
// Mouse / display / zoom state
// ---------------------------------------------------------------------------
export let currentMouseX = 0;
export let currentMouseY = 0;
export let smoothMouseX = 0;
export let smoothMouseY = 0;
export let displayBounds = { x: 0, y: 0, width: 1920, height: 1080 };
export let displayScaleFactor = 1;
export let capturedBounds = { x: 0, y: 0, width: 1920, height: 1080 };
export let isCapturingWindow = false;
export let currentZoom = 1.0;
export let activeClickZoomMin = 1.2;
export let activeClickZoomMax = 2.0;
export let zoomOutTimeout: ReturnType<typeof setTimeout> | null = null;
export let zoomLingerTime = 2500;
export let lastClickDownTime = 0;
export let isMouseHeld = false;

// ---------------------------------------------------------------------------
// Smart zoom state
// ---------------------------------------------------------------------------
export let activeSmartZoom = false;

// ---------------------------------------------------------------------------
// Blur region state
// ---------------------------------------------------------------------------
export let activeBlurRegions: BlurRegion[] = [];
export let blurModeActive = false;

// ---------------------------------------------------------------------------
// Aspect ratio state
// ---------------------------------------------------------------------------
export let activeAspectRatio: AspectRatio = '16:9';

// ---------------------------------------------------------------------------
// Perspective tilt state
// ---------------------------------------------------------------------------
export let activePerspective = false;
export let activePerspectiveIntensity = 2; // degrees, 1–5 range, default 2

// ---------------------------------------------------------------------------
// Spotlight state
// ---------------------------------------------------------------------------
export let activeSpotlight = false;

// ---------------------------------------------------------------------------
// Webcam blur state
// ---------------------------------------------------------------------------
export let activeWebcamBlur = false;
export let activeWebcamBlurIntensity = 30;
export let activeShortsBaseZoom = 2.2;

// ---------------------------------------------------------------------------
// Cursor effect state
// ---------------------------------------------------------------------------
export let activeCursorEffect: CursorEffectConfig = {
  trail: 'none',
  clickRipple: false,
  clickRippleColor: '#ffffff',
};

// ---------------------------------------------------------------------------
// Click sounds state
// ---------------------------------------------------------------------------
export let activeClickSounds = false;

// ---------------------------------------------------------------------------
// Audio ducking state
// ---------------------------------------------------------------------------
export let activeAudioDucking = false;

// ---------------------------------------------------------------------------
// Watermark state
// ---------------------------------------------------------------------------
export let activeWatermark: WatermarkConfig = {
  enabled: false,
  imagePath: '',
  position: 'bottom-right',
  opacity: 0.7,
  size: 10,
};

// ---------------------------------------------------------------------------
// Countdown state
// ---------------------------------------------------------------------------
export let countdownEnabled = true;

// ---------------------------------------------------------------------------
// Mic state
// ---------------------------------------------------------------------------
export let currentMicDeviceId: string | null = null;
export let savedMicDeviceIdForRestart: string | null = null;

// ---------------------------------------------------------------------------
// Setter functions
// (ES module exports are read-only bindings for importers — setters let
//  other modules mutate shared state through the owning module.)
// ---------------------------------------------------------------------------

// Layout & stream
export function setScreenStream(s: MediaStream | null): void { screenStream = s; }
export function setCameraStream(s: MediaStream | null): void { cameraStream = s; }
export function setCurrentLayout(l: string): void { currentLayout = l; }
export function setScreenX(x: number): void { screenX = x; }
export function setCurrentScreenSourceId(id: string): void { currentScreenSourceId = id; }
export function setCurrentCameraDeviceId(id: string): void { currentCameraDeviceId = id; }

// Overlay
export function setOverlayName(n: string): void { overlayName = n; }
export function setBgColor(c: string): void { bgColor = c; }
export function setActiveSocials(s: Array<{ platform: string; handle: string }>): void { activeSocials = s; }
export function setActiveCinemaFilter(f: string): void { activeCinemaFilter = f; }
export function setActiveCameraEnhancement(e: CameraEnhancement): void { activeCameraEnhancement = e; }
export function setAmbientParticlesEnabled(e: boolean): void { ambientParticlesEnabled = e; }
export function setActiveBgStyle(s: string): void { activeBgStyle = s; }

// CTA popup
export function setCtaText(t: string): void { ctaText = t; }
export function setCtaIcon(i: string): void { ctaIcon = i; }
export function setCtaFont(f: string): void { ctaFont = f; }
export function setCtaIntervalMs(ms: number): void { ctaIntervalMs = ms; }
export function setCtaTimer(t: ReturnType<typeof setInterval> | null): void { ctaTimer = t; }
export function setCtaHideTimeout(t: ReturnType<typeof setTimeout> | null): void { ctaHideTimeout = t; }
export function setCtaIsVisible(v: boolean): void { ctaIsVisible = v; }
export function setCtaAnimStartTime(t: number): void { ctaAnimStartTime = t; }
export function setCtaAnimState(s: 'idle' | 'sliding-in' | 'visible' | 'sliding-out'): void { ctaAnimState = s; }

// Mouse / display / zoom
export function setCurrentMouseX(x: number): void { currentMouseX = x; }
export function setCurrentMouseY(y: number): void { currentMouseY = y; }
export function setSmoothMouseX(x: number): void { smoothMouseX = x; }
export function setSmoothMouseY(y: number): void { smoothMouseY = y; }
export function setDisplayBounds(b: { x: number; y: number; width: number; height: number }): void { displayBounds = b; }
export function setDisplayScaleFactor(sf: number): void { displayScaleFactor = sf; }
export function setCapturedBounds(b: { x: number; y: number; width: number; height: number }): void { capturedBounds = b; }
export function setIsCapturingWindow(v: boolean): void { isCapturingWindow = v; }
export function setCurrentZoom(z: number): void { currentZoom = z; }
export function setActiveClickZoomMin(z: number): void { activeClickZoomMin = z; }
export function setActiveClickZoomMax(z: number): void { activeClickZoomMax = z; }
export function setZoomOutTimeout(t: ReturnType<typeof setTimeout> | null): void { zoomOutTimeout = t; }
export function setZoomLingerTime(ms: number): void { zoomLingerTime = ms; }
export function setLastClickDownTime(t: number): void { lastClickDownTime = t; }
export function setIsMouseHeld(v: boolean): void { isMouseHeld = v; }

// Smart zoom
export function setActiveSmartZoom(v: boolean): void { activeSmartZoom = v; }

// Blur regions
export function setActiveBlurRegions(regions: BlurRegion[]): void { activeBlurRegions = regions; }
export function setBlurModeActive(v: boolean): void { blurModeActive = v; }

// Aspect ratio
export function setActiveAspectRatio(r: AspectRatio): void { activeAspectRatio = r; }

// Perspective tilt
export function setActivePerspective(v: boolean): void { activePerspective = v; }
export function setActivePerspectiveIntensity(v: number): void { activePerspectiveIntensity = v; }

// Spotlight
export function setActiveSpotlight(v: boolean): void { activeSpotlight = v; }

// Webcam blur
export function setActiveWebcamBlur(v: boolean): void { activeWebcamBlur = v; }
export function setActiveWebcamBlurIntensity(v: number): void { activeWebcamBlurIntensity = v; }
export function setActiveShortsBaseZoom(v: number): void { activeShortsBaseZoom = v; }

// Cursor effect
export function setActiveCursorEffect(c: CursorEffectConfig): void { activeCursorEffect = c; }

// Click sounds
export function setActiveClickSounds(v: boolean): void { activeClickSounds = v; }

// Audio ducking
export function setActiveAudioDucking(v: boolean): void { activeAudioDucking = v; }

// Watermark
export function setActiveWatermark(w: WatermarkConfig): void { activeWatermark = w; }

// Countdown
export function setCountdownEnabled(v: boolean): void { countdownEnabled = v; }

// Mic
export function setCurrentMicDeviceId(id: string | null): void { currentMicDeviceId = id; }
export function setSavedMicDeviceIdForRestart(id: string | null): void { savedMicDeviceIdForRestart = id; }
