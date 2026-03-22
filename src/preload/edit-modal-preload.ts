import { contextBridge, ipcRenderer } from 'electron';
import { Channels } from '../shared/channels';
import type { EditModalAPI, OverlayConfig } from '../shared/types';

const editModalAPI: EditModalAPI = {
  close: () => {
    ipcRenderer.send(Channels.EDIT_MODAL_CLOSE);
  },

  save: (data) => {
    ipcRenderer.send(Channels.EDIT_MODAL_SAVE, data);
  },

  saveConfig: (partial) => {
    ipcRenderer.send(Channels.CONFIG_SAVE, partial);
  },

  previewOverlay: (data) => {
    ipcRenderer.send(Channels.OVERLAY_PREVIEW, data);
  },

  testCta: () => {
    ipcRenderer.send(Channels.CTA_TEST);
  },

  getConfig: () => ipcRenderer.invoke(Channels.CONFIG_GET),

  selectWatermarkFile: () => ipcRenderer.invoke(Channels.WATERMARK_SELECT_FILE),

  setExportPlatforms: (platforms) => ipcRenderer.invoke(Channels.EXPORT_PLATFORMS, platforms),
};

contextBridge.exposeInMainWorld('editModalAPI', editModalAPI);
