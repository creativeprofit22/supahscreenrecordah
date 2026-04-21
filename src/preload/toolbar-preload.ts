import { contextBridge, ipcRenderer } from 'electron';
import { Channels } from '../shared/channels';
import type { ToolbarAPI, PreviewSelection, RecordingState, AppConfig, CaptionStage, ExportPlatform } from '../shared/types';

const toolbarAPI: ToolbarAPI = {
  getScreens: () => ipcRenderer.invoke(Channels.DEVICES_GET_SCREENS),

  startRecording: (options) => ipcRenderer.invoke(Channels.RECORDING_START, options),

  stopRecording: () => ipcRenderer.invoke(Channels.RECORDING_STOP),

  pauseRecording: () => ipcRenderer.invoke(Channels.RECORDING_PAUSE),

  resumeRecording: () => ipcRenderer.invoke(Channels.RECORDING_RESUME),

  onStateUpdate: (callback) => {
    ipcRenderer.removeAllListeners(Channels.TOOLBAR_STATE_UPDATE);
    const handler = (_event: Electron.IpcRendererEvent, state: RecordingState) => callback(state);
    ipcRenderer.on(Channels.TOOLBAR_STATE_UPDATE, handler);
    return () => { ipcRenderer.removeListener(Channels.TOOLBAR_STATE_UPDATE, handler); };
  },

  onCaptionProgress: (callback) => {
    ipcRenderer.removeAllListeners(Channels.CAPTION_PROGRESS);
    const handler = (_event: Electron.IpcRendererEvent, stage: CaptionStage) => callback(stage);
    ipcRenderer.on(Channels.CAPTION_PROGRESS, handler);
    return () => { ipcRenderer.removeListener(Channels.CAPTION_PROGRESS, handler); };
  },

  sendPreviewUpdate: (selection) => {
    ipcRenderer.send(Channels.PREVIEW_UPDATE, selection);
  },

  openEditModal: () => ipcRenderer.invoke(Channels.EDIT_MODAL_OPEN),

  getConfig: () => ipcRenderer.invoke(Channels.CONFIG_GET),

  saveConfig: (partial) => {
    ipcRenderer.send(Channels.CONFIG_SAVE, partial);
  },

  checkForUpdate: () => ipcRenderer.invoke(Channels.APP_CHECK_UPDATE),

  openUrl: (url) => ipcRenderer.invoke(Channels.APP_OPEN_EXTERNAL, url),

  quitApp: () => {
    ipcRenderer.send(Channels.APP_QUIT);
  },

  toggleBlurMode: () => {
    ipcRenderer.send(Channels.BLUR_MODE_TOGGLE);
  },

  toggleWebcamBlur: () => {
    ipcRenderer.send(Channels.WEBCAM_BLUR_TOGGLE);
  },

  sendAspectRatioUpdate: (ratio) => {
    ipcRenderer.send(Channels.ASPECT_RATIO_UPDATE, ratio);
  },

  sendQualityUpdate: (quality) => {
    ipcRenderer.send(Channels.QUALITY_UPDATE, quality);
  },

  setExportPlatforms: (platforms) => ipcRenderer.invoke(Channels.EXPORT_PLATFORMS, platforms),

  onChaptersReady: (callback) => {
    ipcRenderer.removeAllListeners(Channels.CHAPTERS_READY);
    const handler = (_event: Electron.IpcRendererEvent, chapters: any) => callback(chapters);
    ipcRenderer.on(Channels.CHAPTERS_READY, handler);
    return () => { ipcRenderer.removeListener(Channels.CHAPTERS_READY, handler); };
  },
};

contextBridge.exposeInMainWorld('toolbarAPI', toolbarAPI);
