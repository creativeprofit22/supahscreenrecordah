"use strict";

// src/preload/main-preload.ts
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

// src/preload/main-preload.ts
var mainAPI = {
  onPreviewUpdate: (callback) => {
    const handler = (_event, selection) => callback(selection);
    import_electron.ipcRenderer.removeAllListeners(Channels.PREVIEW_UPDATE);
    import_electron.ipcRenderer.on(Channels.PREVIEW_UPDATE, handler);
    return () => {
      import_electron.ipcRenderer.removeListener(Channels.PREVIEW_UPDATE, handler);
    };
  },
  onOverlayUpdate: (callback) => {
    const handler = (_event, settings) => callback(settings);
    import_electron.ipcRenderer.removeAllListeners(Channels.OVERLAY_UPDATE);
    import_electron.ipcRenderer.on(Channels.OVERLAY_UPDATE, handler);
    return () => {
      import_electron.ipcRenderer.removeListener(Channels.OVERLAY_UPDATE, handler);
    };
  },
  onRecordingStart: (callback) => {
    const handler = (_event, micDeviceId) => callback(micDeviceId);
    import_electron.ipcRenderer.removeAllListeners(Channels.MAIN_RECORDING_START);
    import_electron.ipcRenderer.on(Channels.MAIN_RECORDING_START, handler);
    return () => {
      import_electron.ipcRenderer.removeListener(Channels.MAIN_RECORDING_START, handler);
    };
  },
  signalRecordingReady: () => {
    import_electron.ipcRenderer.send(Channels.MAIN_RECORDING_READY);
  },
  onRecordingStop: (callback) => {
    const handler = () => callback();
    import_electron.ipcRenderer.removeAllListeners(Channels.MAIN_RECORDING_STOP);
    import_electron.ipcRenderer.on(Channels.MAIN_RECORDING_STOP, handler);
    return () => {
      import_electron.ipcRenderer.removeListener(Channels.MAIN_RECORDING_STOP, handler);
    };
  },
  onRecordingPause: (callback) => {
    const handler = () => callback();
    import_electron.ipcRenderer.removeAllListeners(Channels.MAIN_RECORDING_PAUSE);
    import_electron.ipcRenderer.on(Channels.MAIN_RECORDING_PAUSE, handler);
    return () => {
      import_electron.ipcRenderer.removeListener(Channels.MAIN_RECORDING_PAUSE, handler);
    };
  },
  onRecordingResume: (callback) => {
    const handler = () => callback();
    import_electron.ipcRenderer.removeAllListeners(Channels.MAIN_RECORDING_RESUME);
    import_electron.ipcRenderer.on(Channels.MAIN_RECORDING_RESUME, handler);
    return () => {
      import_electron.ipcRenderer.removeListener(Channels.MAIN_RECORDING_RESUME, handler);
    };
  },
  saveRecording: (filePath, buffer) => import_electron.ipcRenderer.invoke(Channels.FILE_SAVE_RECORDING, { filePath, buffer }),
  exportRecording: () => import_electron.ipcRenderer.invoke(Channels.RECORDING_EXPORT),
  preparePlayback: (buffer) => import_electron.ipcRenderer.invoke(Channels.RECORDING_PREPARE_PLAYBACK, buffer),
  cleanupPlayback: () => import_electron.ipcRenderer.invoke(Channels.RECORDING_CLEANUP_PLAYBACK),
  getConfig: () => import_electron.ipcRenderer.invoke(Channels.CONFIG_GET),
  startMouseTracking: () => import_electron.ipcRenderer.invoke(Channels.MOUSE_TRACKING_START),
  stopMouseTracking: () => import_electron.ipcRenderer.invoke(Channels.MOUSE_TRACKING_STOP),
  onMousePosition: (callback) => {
    const handler = (_event, position) => callback(position);
    import_electron.ipcRenderer.removeAllListeners(Channels.MOUSE_POSITION);
    import_electron.ipcRenderer.on(Channels.MOUSE_POSITION, handler);
    return () => {
      import_electron.ipcRenderer.removeListener(Channels.MOUSE_POSITION, handler);
    };
  },
  onMouseClick: (callback) => {
    const handler = (_event, event) => callback(event);
    import_electron.ipcRenderer.removeAllListeners(Channels.MOUSE_CLICK);
    import_electron.ipcRenderer.on(Channels.MOUSE_CLICK, handler);
    return () => {
      import_electron.ipcRenderer.removeListener(Channels.MOUSE_CLICK, handler);
    };
  },
  getWindowBounds: (sourceId) => import_electron.ipcRenderer.invoke(Channels.WINDOW_GET_BOUNDS, sourceId),
  selectScreenSource: (sourceId) => import_electron.ipcRenderer.invoke(Channels.DEVICES_SELECT_SCREEN_SOURCE, sourceId),
  hideSystemCursor: () => import_electron.ipcRenderer.invoke(Channels.CURSOR_HIDE),
  showSystemCursor: () => import_electron.ipcRenderer.invoke(Channels.CURSOR_SHOW),
  onCtaTest: (callback) => {
    const handler = () => callback();
    import_electron.ipcRenderer.removeAllListeners(Channels.CTA_TEST);
    import_electron.ipcRenderer.on(Channels.CTA_TEST, handler);
    return () => {
      import_electron.ipcRenderer.removeListener(Channels.CTA_TEST, handler);
    };
  },
  onActionEvent: (callback) => {
    const handler = (_event, actionEvent) => callback(actionEvent);
    import_electron.ipcRenderer.removeAllListeners(Channels.ACTION_EVENT);
    import_electron.ipcRenderer.on(Channels.ACTION_EVENT, handler);
    return () => {
      import_electron.ipcRenderer.removeListener(Channels.ACTION_EVENT, handler);
    };
  }
};
import_electron.contextBridge.exposeInMainWorld("mainAPI", mainAPI);
//# sourceMappingURL=main-preload.js.map
