import { contextBridge, ipcRenderer } from 'electron';
import { Channels } from '../shared/channels';
import type { OnboardingAPI, InstallProgress } from '../shared/activation-types';

const onboardingAPI: OnboardingAPI = {
  checkPermissions: () => ipcRenderer.invoke(Channels.ONBOARDING_CHECK_PERMISSIONS),

  requestPermission: (type) => ipcRenderer.invoke(Channels.ONBOARDING_REQUEST_PERMISSION, type),

  checkDependencies: () => ipcRenderer.invoke(Channels.ONBOARDING_CHECK_DEPENDENCIES),

  installDependency: (name) => ipcRenderer.invoke(Channels.ONBOARDING_INSTALL_DEPENDENCY, name),

  onInstallProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: InstallProgress) => callback(progress);
    ipcRenderer.on(Channels.ONBOARDING_INSTALL_PROGRESS, handler);
    return () => { ipcRenderer.removeListener(Channels.ONBOARDING_INSTALL_PROGRESS, handler); };
  },

  completeOnboarding: () => ipcRenderer.send(Channels.ONBOARDING_COMPLETE),

  quit: () => ipcRenderer.send(Channels.APP_QUIT),

  openExternal: (url) => ipcRenderer.invoke(Channels.APP_OPEN_EXTERNAL, url),
};

contextBridge.exposeInMainWorld('onboardingAPI', onboardingAPI);
