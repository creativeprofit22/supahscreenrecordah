import { contextBridge, ipcRenderer } from 'electron';
import { Channels } from '../shared/channels';
import type {
  MainAPI,
  PreviewSelection,
  OverlayConfig,
  MousePosition,
  MouseClickEvent,
  ActionEvent,
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

  saveRecording: (filePath, buffer) =>
    ipcRenderer.invoke(Channels.FILE_SAVE_RECORDING, { filePath, buffer }),

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
};

contextBridge.exposeInMainWorld('mainAPI', mainAPI);
