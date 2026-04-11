import { contextBridge, ipcRenderer } from 'electron';

const splashAPI = {
  onReady: (callback: () => void) => {
    ipcRenderer.on('splash:ready', () => callback());
  },

  getVersion: (): Promise<string> =>
    ipcRenderer.invoke('splash:get-version'),
};

contextBridge.exposeInMainWorld('splashAPI', splashAPI);
