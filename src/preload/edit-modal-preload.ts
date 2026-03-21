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

  previewOverlay: (data) => {
    ipcRenderer.send(Channels.OVERLAY_PREVIEW, data);
  },

  testCta: () => {
    ipcRenderer.send(Channels.CTA_TEST);
  },

  getConfig: () => ipcRenderer.invoke(Channels.CONFIG_GET),
};

contextBridge.exposeInMainWorld('editModalAPI', editModalAPI);
