export * from './feature-types';
import type { BlurRegion, AspectRatio, CursorEffectConfig, ProgressBarConfig, WatermarkConfig, IntroOutroConfig, CaptionConfig, SilenceRemovalConfig, ThumbnailConfig, ExportPlatform } from './feature-types';

/** A pause/resume boundary in the recorded video timeline (seconds) */
export interface PauseTimestamp {
  /** Time in the output video (seconds) where the pause cut occurs */
  cutPoint: number;
}

export interface ActionEvent {
  type: string;
  label: string;
  detail: string;
  timestamp: number;
}

export interface MousePosition {
  x: number;
  y: number;
  cursorType: string;
  displayBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  scaleFactor: number;
}

export interface MouseClickEvent {
  type: string | null;
  x: number;
  y: number;
}

export interface ScreenSource {
  id: string;
  name: string;
  isBrowser: boolean;
}

export interface RecordingState {
  isRecording: boolean;
  isPaused: boolean;
  countdownValue?: number | null;
}

export interface PreviewSelection {
  screenSourceId: string;
  screenSourceName?: string;
  screenIsBrowser: boolean;
  cameraDeviceId: string | null;
  micDeviceId?: string | null;
  layout?: string;
}

export type BgStyle = 'camera-right' | 'camera-left';

export interface CameraEnhancement {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
  sharpness: number;
  softness: number;
}

export type Socials = { x: string; youtube: string; tiktok: string; instagram: string };

export type CinemaFilter = 'none' | 'matrix' | 'teal-orange' | 'noir' | 'vintage' | 'blade-runner' | 'moonlight';

export interface OverlayConfig {
  name: string;
  nameFont: string;
  nameFontSize: number;
  bgColor: string;
  bgStyle: string;
  cinemaFilter: CinemaFilter;
  cameraEnhancement: CameraEnhancement;
  socials: Socials;
  ambientParticles: boolean;
  mouseZoom: number;
  zoomLingerMs: number;
  ctaText: string;
  ctaIcon: string;
  ctaIntervalMs: number;
  blurRegions: BlurRegion[];
  aspectRatio: AspectRatio;
  cursorEffect: CursorEffectConfig;
  spotlight: boolean;
  clickSounds: boolean;
  progressBar: ProgressBarConfig;
  watermark: WatermarkConfig;
  webcamBlur: boolean;
  webcamBlurIntensity: number;
  shortsBaseZoom: number;
  introOutro: IntroOutroConfig;
  countdownEnabled: boolean;
  perspective: boolean;
  perspectiveIntensity: number;
}

export interface AppConfig {
  screenName: string;
  cameraLabel: string;
  micLabel: string;
  layout: BgStyle;
  overlay: OverlayConfig;
  caption: CaptionConfig;
  silenceRemoval: SilenceRemovalConfig;
  thumbnail: ThumbnailConfig;
  exportPlatforms: ExportPlatform[];
  autoSaveChunks: boolean;
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// MainAPI exposed via contextBridge to main preview window
export interface MainAPI {
  onPreviewUpdate: (callback: (selection: PreviewSelection) => void) => () => void;
  onOverlayUpdate: (callback: (settings: OverlayConfig) => void) => () => void;
  onRecordingStart: (callback: (micDeviceId: string) => void) => () => void;
  signalRecordingReady: () => void;
  sendCountdownTick: (value: number | null) => void;
  onRecordingStop: (callback: () => void) => () => void;
  onRecordingPause: (callback: () => void) => () => void;
  onRecordingResume: (callback: () => void) => () => void;
  saveRecording: (filePath: string, buffer: ArrayBuffer, pauseTimestamps?: PauseTimestamp[]) => Promise<void>;
  exportRecording: () => Promise<string>;
  preparePlayback: (buffer: ArrayBuffer) => Promise<string>;
  cleanupPlayback: () => Promise<void>;
  getConfig: () => Promise<AppConfig>;
  startMouseTracking: () => Promise<boolean>;
  stopMouseTracking: () => Promise<boolean>;
  onMousePosition: (callback: (position: MousePosition) => void) => () => void;
  onMouseClick: (callback: (event: MouseClickEvent) => void) => () => void;
  getWindowBounds: (sourceId: string) => Promise<WindowBounds | null>;
  selectScreenSource: (sourceId: string, sourceName?: string) => Promise<void>;
  hideSystemCursor: () => Promise<boolean>;
  showSystemCursor: () => Promise<boolean>;
  onCtaTest: (callback: () => void) => () => void;
  onActionEvent: (callback: (event: ActionEvent) => void) => () => void;
  onBlurModeToggle: (callback: () => void) => () => void;
  onWebcamBlurToggle: (callback: () => void) => () => void;
  onAspectRatioUpdate: (callback: (ratio: AspectRatio) => void) => () => void;
  sendAutosaveChunk: (buffer: ArrayBuffer, extension: string) => Promise<void>;
  autosaveCleanup: () => Promise<void>;
}

// ToolbarAPI
export type CaptionStage = 'uploading' | 'transcribing' | 'generating' | 'burning' | 'done';

export interface ToolbarAPI {
  getScreens: () => Promise<ScreenSource[]>;
  startRecording: (options: { screenSourceId: string; cameraDeviceId: string | null; micDeviceId: string | null }) => Promise<void>;
  stopRecording: () => Promise<void>;
  pauseRecording: () => Promise<void>;
  resumeRecording: () => Promise<void>;
  onStateUpdate: (callback: (state: RecordingState) => void) => () => void;
  onCaptionProgress: (callback: (stage: CaptionStage) => void) => () => void;
  sendPreviewUpdate: (selection: PreviewSelection) => void;
  sendAspectRatioUpdate: (ratio: AspectRatio) => void;
  openEditModal: () => Promise<void>;
  getConfig: () => Promise<AppConfig>;
  saveConfig: (partial: Partial<AppConfig>) => void;
  checkForUpdate: () => Promise<{ available: boolean; version: string; url: string }>;
  openUrl: (url: string) => Promise<void>;
  quitApp: () => void;
  toggleBlurMode: () => void;
  toggleWebcamBlur: () => void;
  setExportPlatforms: (platforms: ExportPlatform[]) => Promise<ExportPlatform[]>;
  onChaptersReady: (callback: (chapters: Array<{ start: number; end: number; headline: string; summary: string; gist: string }>) => void) => () => void;
}

// EditModalAPI
export interface EditModalAPI {
  close: () => void;
  save: (data: OverlayConfig) => void;
  saveConfig: (partial: Partial<AppConfig>) => void;
  previewOverlay: (data: OverlayConfig) => void;
  testCta: () => void;
  getConfig: () => Promise<AppConfig>;
  selectWatermarkFile: () => Promise<string | null>;
  setExportPlatforms: (platforms: ExportPlatform[]) => Promise<ExportPlatform[]>;
}

import type { OnboardingAPI } from './activation-types';
export type { OnboardingAPI } from './activation-types';

// Thumbnail review modal API
export interface ThumbnailOpenPayload {
  videoPath: string;
  transcriptSummary?: string;
  videoTitle?: string;
  platforms: ExportPlatform[];
}

export interface ThumbnailGenerateRequest {
  prompt: string;
  aspectRatio: string;
  platform: ExportPlatform;
}

export interface ThumbnailSaveRequest {
  videoPath: string;
  selections: Array<{
    platform: ExportPlatform;
    aspectRatio: string;
    imagePath: string; // local temp path to selected thumbnail
  }>;
}

export interface ThumbnailProgressUpdate {
  stage: 'extracting' | 'generating' | 'saving' | 'done' | 'error';
  platform?: ExportPlatform;
  message: string;
}

export interface ThumbnailAPI {
  getInitData: () => Promise<ThumbnailOpenPayload>;
  extractFrames: (videoPath: string) => Promise<string[]>;
  generate: (request: ThumbnailGenerateRequest) => Promise<string>;
  save: (request: ThumbnailSaveRequest) => Promise<string[]>;
  skip: () => void;
  close: () => void;
  onProgress: (callback: (update: ThumbnailProgressUpdate) => void) => () => void;
}

declare global {
  interface Window {
    mainAPI: MainAPI;
    toolbarAPI: ToolbarAPI;
    editModalAPI: EditModalAPI;
    onboardingAPI: OnboardingAPI;
    thumbnailAPI: ThumbnailAPI;
  }
}
