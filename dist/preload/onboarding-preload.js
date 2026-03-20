"use strict";

// src/preload/onboarding-preload.ts
var import_electron = require("electron");

// src/shared/channels.ts
var Channels = {
  // Recording
  RECORDING_START: "recording:start",
  RECORDING_STOP: "recording:stop",
  RECORDING_EXPORT: "recording:export",
  RECORDING_PREPARE_PLAYBACK: "recording:prepare-playback",
  RECORDING_CLEANUP_PLAYBACK: "recording:cleanup-playback",
  RECORDING_PAUSE: "recording:pause",
  RECORDING_RESUME: "recording:resume",
  // Devices
  DEVICES_GET_SCREENS: "devices:get-screens",
  DEVICES_SELECT_SCREEN_SOURCE: "devices:select-screen-source",
  // File
  FILE_SAVE_RECORDING: "file:save-recording",
  // Toolbar <-> Main sync
  TOOLBAR_STATE_UPDATE: "toolbar:state-update",
  // Preview — toolbar tells main window what devices are selected
  PREVIEW_UPDATE: "preview:update",
  // Overlay settings
  OVERLAY_UPDATE: "overlay:update",
  OVERLAY_PREVIEW: "overlay:preview",
  CTA_TEST: "cta:test",
  // Edit modal
  EDIT_MODAL_OPEN: "edit-modal:open",
  EDIT_MODAL_SAVE: "edit-modal:save",
  EDIT_MODAL_CLOSE: "edit-modal:close",
  // Main window recording (forwarded from toolbar via main process)
  MAIN_RECORDING_START: "main:recording-start",
  MAIN_RECORDING_READY: "main:recording-ready",
  MAIN_RECORDING_STOP: "main:recording-stop",
  MAIN_RECORDING_PAUSE: "main:recording-pause",
  MAIN_RECORDING_RESUME: "main:recording-resume",
  // Mouse tracking
  MOUSE_TRACKING_START: "mouse:tracking-start",
  MOUSE_TRACKING_STOP: "mouse:tracking-stop",
  MOUSE_POSITION: "mouse:position",
  MOUSE_CLICK: "mouse:click",
  // Window bounds (macOS native)
  WINDOW_GET_BOUNDS: "window:get-bounds",
  // Config persistence
  CONFIG_GET: "config:get",
  CONFIG_SAVE: "config:save",
  // Action tracking
  ACTION_EVENT: "action:event",
  // Cursor (native macOS)
  CURSOR_HIDE: "cursor:hide",
  CURSOR_SHOW: "cursor:show",
  // App control
  APP_QUIT: "app:quit",
  APP_OPEN_EXTERNAL: "app:open-external",
  APP_CHECK_UPDATE: "app:check-update",
  // Activation / onboarding
  ACTIVATION_CHECK: "activation:check",
  ACTIVATION_ACTIVATE: "activation:activate",
  ACTIVATION_DEACTIVATE: "activation:deactivate",
  // Onboarding — permissions & prerequisites
  ONBOARDING_CHECK_PERMISSIONS: "onboarding:check-permissions",
  ONBOARDING_REQUEST_PERMISSION: "onboarding:request-permission",
  ONBOARDING_CHECK_DEPENDENCIES: "onboarding:check-dependencies",
  ONBOARDING_INSTALL_DEPENDENCY: "onboarding:install-dependency",
  ONBOARDING_INSTALL_PROGRESS: "onboarding:install-progress",
  ONBOARDING_COMPLETE: "onboarding:complete",
  ONBOARDING_RESIZE: "onboarding:resize"
};

// src/preload/onboarding-preload.ts
var onboardingAPI = {
  activate: (email) => import_electron.ipcRenderer.invoke(Channels.ACTIVATION_ACTIVATE, email),
  getActivationState: () => import_electron.ipcRenderer.invoke(Channels.ACTIVATION_CHECK),
  checkPermissions: () => import_electron.ipcRenderer.invoke(Channels.ONBOARDING_CHECK_PERMISSIONS),
  requestPermission: (type) => import_electron.ipcRenderer.invoke(Channels.ONBOARDING_REQUEST_PERMISSION, type),
  checkDependencies: () => import_electron.ipcRenderer.invoke(Channels.ONBOARDING_CHECK_DEPENDENCIES),
  installDependency: (name) => import_electron.ipcRenderer.invoke(Channels.ONBOARDING_INSTALL_DEPENDENCY, name),
  onInstallProgress: (callback) => {
    import_electron.ipcRenderer.on(
      Channels.ONBOARDING_INSTALL_PROGRESS,
      (_event, progress) => callback(progress)
    );
  },
  completeOnboarding: () => import_electron.ipcRenderer.send(Channels.ONBOARDING_COMPLETE),
  quit: () => import_electron.ipcRenderer.send(Channels.APP_QUIT),
  openExternal: (url) => import_electron.ipcRenderer.invoke(Channels.APP_OPEN_EXTERNAL, url)
};
import_electron.contextBridge.exposeInMainWorld("onboardingAPI", onboardingAPI);
//# sourceMappingURL=onboarding-preload.js.map
