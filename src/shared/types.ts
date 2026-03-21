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
}

export interface AppConfig {
  screenName: string;
  cameraLabel: string;
  micLabel: string;
  layout: BgStyle;
  overlay: OverlayConfig;
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
  onRecordingStop: (callback: () => void) => () => void;
  onRecordingPause: (callback: () => void) => () => void;
  onRecordingResume: (callback: () => void) => () => void;
  saveRecording: (filePath: string, buffer: ArrayBuffer) => Promise<void>;
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
}

// ToolbarAPI
export interface ToolbarAPI {
  getScreens: () => Promise<ScreenSource[]>;
  startRecording: (options: { screenSourceId: string; cameraDeviceId: string | null; micDeviceId: string | null }) => Promise<void>;
  stopRecording: () => Promise<void>;
  pauseRecording: () => Promise<void>;
  resumeRecording: () => Promise<void>;
  onStateUpdate: (callback: (state: RecordingState) => void) => () => void;
  sendPreviewUpdate: (selection: PreviewSelection) => void;
  openEditModal: () => Promise<void>;
  getConfig: () => Promise<AppConfig>;
  saveConfig: (partial: Partial<AppConfig>) => void;
  checkForUpdate: () => Promise<{ available: boolean; version: string; url: string }>;
  openUrl: (url: string) => Promise<void>;
  quitApp: () => void;
}

// EditModalAPI
export interface EditModalAPI {
  close: () => void;
  save: (data: OverlayConfig) => void;
  previewOverlay: (data: OverlayConfig) => void;
  testCta: () => void;
  getConfig: () => Promise<AppConfig>;
}

import type { OnboardingAPI } from './activation-types';
export type { OnboardingAPI } from './activation-types';

declare global {
  interface Window {
    mainAPI: MainAPI;
    toolbarAPI: ToolbarAPI;
    editModalAPI: EditModalAPI;
    onboardingAPI: OnboardingAPI;
  }
}
