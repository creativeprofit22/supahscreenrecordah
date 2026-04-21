import { contextBridge, ipcRenderer } from 'electron';
import { Channels } from '../shared/channels';
import type {
  MainAPI,
  PreviewSelection,
  OverlayConfig,
  MousePosition,
  MouseClickEvent,
  ActionEvent,
  AspectRatio,
  Quality,
} from '../shared/types';

const mainAPI: MainAPI = {
  onPreviewUpdate: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, selection: PreviewSelection) => callback(selection);
    ipcRenderer.removeAllListeners(Channels.PREVIEW_UPDATE);
    ipcRenderer.on(Channels.PREVIEW_UPDATE, handler);
    return () => { ipcRenderer.removeListener(Channels.PREVIEW_UPDATE, handler); };
  },

  onOverlayUpdate: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, settings: OverlayConfig) => callback(settings);
    ipcRenderer.removeAllListeners(Channels.OVERLAY_UPDATE);
    ipcRenderer.on(Channels.OVERLAY_UPDATE, handler);
    return () => { ipcRenderer.removeListener(Channels.OVERLAY_UPDATE, handler); };
  },

  onRecordingStart: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, micDeviceId: string) => callback(micDeviceId);
    ipcRenderer.removeAllListeners(Channels.MAIN_RECORDING_START);
    ipcRenderer.on(Channels.MAIN_RECORDING_START, handler);
    return () => { ipcRenderer.removeListener(Channels.MAIN_RECORDING_START, handler); };
  },

  signalRecordingReady: () => {
    ipcRenderer.send(Channels.MAIN_RECORDING_READY);
  },

  sendCountdownTick: (value: number | null) => {
    ipcRenderer.send(Channels.COUNTDOWN_TICK, value);
  },

  onRecordingStop: (callback) => {
    const handler = () => callback();
    ipcRenderer.removeAllListeners(Channels.MAIN_RECORDING_STOP);
    ipcRenderer.on(Channels.MAIN_RECORDING_STOP, handler);
    return () => { ipcRenderer.removeListener(Channels.MAIN_RECORDING_STOP, handler); };
  },

  onRecordingPause: (callback) => {
    const handler = () => callback();
    ipcRenderer.removeAllListeners(Channels.MAIN_RECORDING_PAUSE);
    ipcRenderer.on(Channels.MAIN_RECORDING_PAUSE, handler);
    return () => { ipcRenderer.removeListener(Channels.MAIN_RECORDING_PAUSE, handler); };
  },

  onRecordingResume: (callback) => {
    const handler = () => callback();
    ipcRenderer.removeAllListeners(Channels.MAIN_RECORDING_RESUME);
    ipcRenderer.on(Channels.MAIN_RECORDING_RESUME, handler);
    return () => { ipcRenderer.removeListener(Channels.MAIN_RECORDING_RESUME, handler); };
  },

  saveRecording: (filePath, buffer, pauseTimestamps) =>
    ipcRenderer.invoke(Channels.FILE_SAVE_RECORDING, { filePath, buffer, pauseTimestamps }),

  exportRecording: () => ipcRenderer.invoke(Channels.RECORDING_EXPORT),

  preparePlayback: (buffer) => ipcRenderer.invoke(Channels.RECORDING_PREPARE_PLAYBACK, buffer),

  cleanupPlayback: () => ipcRenderer.invoke(Channels.RECORDING_CLEANUP_PLAYBACK),

  getConfig: () => ipcRenderer.invoke(Channels.CONFIG_GET),

  startMouseTracking: () => ipcRenderer.invoke(Channels.MOUSE_TRACKING_START),

  stopMouseTracking: () => ipcRenderer.invoke(Channels.MOUSE_TRACKING_STOP),

  onMousePosition: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, position: MousePosition) => callback(position);
    ipcRenderer.removeAllListeners(Channels.MOUSE_POSITION);
    ipcRenderer.on(Channels.MOUSE_POSITION, handler);
    return () => { ipcRenderer.removeListener(Channels.MOUSE_POSITION, handler); };
  },

  onMouseClick: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, event: MouseClickEvent) => callback(event);
    ipcRenderer.removeAllListeners(Channels.MOUSE_CLICK);
    ipcRenderer.on(Channels.MOUSE_CLICK, handler);
    return () => { ipcRenderer.removeListener(Channels.MOUSE_CLICK, handler); };
  },

  getWindowBounds: (sourceId) => ipcRenderer.invoke(Channels.WINDOW_GET_BOUNDS, sourceId),

  selectScreenSource: (sourceId, sourceName) => ipcRenderer.invoke(Channels.DEVICES_SELECT_SCREEN_SOURCE, sourceId, sourceName),

  hideSystemCursor: () => ipcRenderer.invoke(Channels.CURSOR_HIDE),

  showSystemCursor: () => ipcRenderer.invoke(Channels.CURSOR_SHOW),

  onCtaTest: (callback) => {
    const handler = () => callback();
    ipcRenderer.removeAllListeners(Channels.CTA_TEST);
    ipcRenderer.on(Channels.CTA_TEST, handler);
    return () => { ipcRenderer.removeListener(Channels.CTA_TEST, handler); };
  },

  onActionEvent: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, actionEvent: ActionEvent) => callback(actionEvent);
    ipcRenderer.removeAllListeners(Channels.ACTION_EVENT);
    ipcRenderer.on(Channels.ACTION_EVENT, handler);
    return () => { ipcRenderer.removeListener(Channels.ACTION_EVENT, handler); };
  },

  onBlurModeToggle: (callback) => {
    const handler = () => callback();
    ipcRenderer.removeAllListeners(Channels.BLUR_MODE_TOGGLE);
    ipcRenderer.on(Channels.BLUR_MODE_TOGGLE, handler);
    return () => { ipcRenderer.removeListener(Channels.BLUR_MODE_TOGGLE, handler); };
  },

  onWebcamBlurToggle: (callback) => {
    const handler = () => callback();
    ipcRenderer.removeAllListeners(Channels.WEBCAM_BLUR_TOGGLE);
    ipcRenderer.on(Channels.WEBCAM_BLUR_TOGGLE, handler);
    return () => { ipcRenderer.removeListener(Channels.WEBCAM_BLUR_TOGGLE, handler); };
  },

  onAspectRatioUpdate: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, ratio: AspectRatio) => callback(ratio);
    ipcRenderer.removeAllListeners(Channels.ASPECT_RATIO_UPDATE);
    ipcRenderer.on(Channels.ASPECT_RATIO_UPDATE, handler);
    return () => { ipcRenderer.removeListener(Channels.ASPECT_RATIO_UPDATE, handler); };
  },

  onQualityUpdate: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, quality: Quality) => callback(quality);
    ipcRenderer.removeAllListeners(Channels.QUALITY_UPDATE);
    ipcRenderer.on(Channels.QUALITY_UPDATE, handler);
    return () => { ipcRenderer.removeListener(Channels.QUALITY_UPDATE, handler); };
  },

  sendAutosaveChunk: (buffer, extension) =>
    ipcRenderer.invoke(Channels.AUTOSAVE_CHUNK, { buffer, extension }),

  autosaveCleanup: () => ipcRenderer.invoke(Channels.AUTOSAVE_CLEANUP),

  analyzeForReview: () => ipcRenderer.invoke(Channels.REVIEW_ANALYZE),

  exportWithSegments: (filePath, buffer, keepSegments, captionOptions) =>
    ipcRenderer.invoke(Channels.REVIEW_EXPORT, { filePath, buffer, keepSegments, captionOptions }),

  checkWhisper: () => ipcRenderer.invoke(Channels.WHISPER_CHECK),

  installWhisper: () => ipcRenderer.invoke(Channels.WHISPER_INSTALL),

  onWhisperInstallProgress: (callback: (progress: import('../shared/activation-types').InstallProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: import('../shared/activation-types').InstallProgress) => callback(progress);
    ipcRenderer.on(Channels.WHISPER_INSTALL_PROGRESS, handler);
    return () => { ipcRenderer.removeListener(Channels.WHISPER_INSTALL_PROGRESS, handler); };
  },

  showToolbar: () => ipcRenderer.invoke(Channels.TOOLBAR_SHOW),

  hasLastRecording: () => ipcRenderer.invoke(Channels.PLAYBACK_HAS_LAST_RECORDING),
  loadLastRecording: () => ipcRenderer.invoke(Channels.PLAYBACK_LOAD_LAST_RECORDING),

  // Music mixer
  getMusicLibrary: () => ipcRenderer.invoke(Channels.MUSIC_GET_LIBRARY),
  addMusicTrack: (filePath: string) => ipcRenderer.invoke(Channels.MUSIC_ADD_TRACK, filePath),
  removeMusicTrack: (trackId: string) => ipcRenderer.invoke(Channels.MUSIC_REMOVE_TRACK, trackId),
  pickMusicFile: () => ipcRenderer.invoke(Channels.MUSIC_PICK_FILE),
  pickVideoFile: () => ipcRenderer.invoke(Channels.MUSIC_PICK_VIDEO),
  getMusicWaveform: (filePath: string) => ipcRenderer.invoke(Channels.MUSIC_GET_WAVEFORM, filePath),
  setLastMusicTrack: (trackId: string | null) => ipcRenderer.invoke(Channels.MUSIC_SET_LAST_TRACK, trackId),
  setLastMusicVolume: (volume: number) => ipcRenderer.invoke(Channels.MUSIC_SET_LAST_VOLUME, volume),
  mixMusicExport: (opts) => ipcRenderer.invoke(Channels.MUSIC_MIX_EXPORT, opts),
  readFileAsBuffer: (filePath: string) => ipcRenderer.invoke(Channels.MUSIC_READ_FILE, filePath),

  // Review session autosave (cuts/trims/captions on disk, survives crashes)
  saveReviewSession: (session) => ipcRenderer.invoke(Channels.REVIEW_SESSION_SAVE, session),
  loadReviewSession: () => ipcRenderer.invoke(Channels.REVIEW_SESSION_LOAD),
  clearReviewSession: () => ipcRenderer.invoke(Channels.REVIEW_SESSION_CLEAR),
};

contextBridge.exposeInMainWorld('mainAPI', mainAPI);
