import { contextBridge, ipcRenderer } from 'electron';
import { Channels } from '../shared/channels';
import type { ToolbarAPI, PreviewSelection, RecordingState, AppConfig } from '../shared/types';

const toolbarAPI: ToolbarAPI = {
  getScreens: () => ipcRenderer.invoke(Channels.DEVICES_GET_SCREENS),

  startRecording: (options) => ipcRenderer.invoke(Channels.RECORDING_START, options),

  stopRecording: () => ipcRenderer.invoke(Channels.RECORDING_STOP),

  pauseRecording: () => ipcRenderer.invoke(Channels.RECORDING_PAUSE),

  resumeRecording: () => ipcRenderer.invoke(Channels.RECORDING_RESUME),

  onStateUpdate: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, state: RecordingState) => callback(state);
    ipcRenderer.on(Channels.TOOLBAR_STATE_UPDATE, handler);
    return () => { ipcRenderer.removeListener(Channels.TOOLBAR_STATE_UPDATE, handler); };
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
};

contextBridge.exposeInMainWorld('toolbarAPI', toolbarAPI);
