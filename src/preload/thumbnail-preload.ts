import { contextBridge, ipcRenderer } from 'electron';
import { Channels } from '../shared/channels';
import type {
  ThumbnailAPI,
  ThumbnailOpenPayload,
  ThumbnailGenerateRequest,
  ThumbnailSaveRequest,
  ThumbnailProgressUpdate,
} from '../shared/types';

const thumbnailAPI: ThumbnailAPI = {
  getInitData: () => ipcRenderer.invoke(Channels.THUMBNAIL_OPEN),

  extractFrames: (videoPath: string) =>
    ipcRenderer.invoke(Channels.THUMBNAIL_EXTRACT_FRAMES, videoPath),

  generate: (request: ThumbnailGenerateRequest) =>
    ipcRenderer.invoke(Channels.THUMBNAIL_GENERATE, request),

  save: (request: ThumbnailSaveRequest) =>
    ipcRenderer.invoke(Channels.THUMBNAIL_SAVE, request),

  skip: () => {
    ipcRenderer.send(Channels.THUMBNAIL_SKIP);
  },

  close: () => {
    ipcRenderer.send(Channels.THUMBNAIL_CLOSE);
  },

  onProgress: (callback: (update: ThumbnailProgressUpdate) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, update: ThumbnailProgressUpdate) =>
      callback(update);
    ipcRenderer.on(Channels.THUMBNAIL_PROGRESS, handler);
    return () => {
      ipcRenderer.removeListener(Channels.THUMBNAIL_PROGRESS, handler);
    };
  },
};

contextBridge.exposeInMainWorld('thumbnailAPI', thumbnailAPI);
