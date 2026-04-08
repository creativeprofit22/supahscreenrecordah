export const Channels = {
  // Recording
  RECORDING_START: 'recording:start',
  RECORDING_STOP: 'recording:stop',
  RECORDING_EXPORT: 'recording:export',
  RECORDING_PREPARE_PLAYBACK: 'recording:prepare-playback',
  RECORDING_CLEANUP_PLAYBACK: 'recording:cleanup-playback',
  RECORDING_PAUSE: 'recording:pause',
  RECORDING_RESUME: 'recording:resume',
  // Devices
  DEVICES_GET_SCREENS: 'devices:get-screens',
  DEVICES_SELECT_SCREEN_SOURCE: 'devices:select-screen-source',
  // File
  FILE_SAVE_RECORDING: 'file:save-recording',
  // Toolbar <-> Main sync
  TOOLBAR_STATE_UPDATE: 'toolbar:state-update',
  // Preview — toolbar tells main window what devices are selected
  PREVIEW_UPDATE: 'preview:update',
  // Overlay settings
  OVERLAY_UPDATE: 'overlay:update',
  OVERLAY_PREVIEW: 'overlay:preview',
  CTA_TEST: 'cta:test',
  // Edit modal
  EDIT_MODAL_OPEN: 'edit-modal:open',
  EDIT_MODAL_SAVE: 'edit-modal:save',
  EDIT_MODAL_CLOSE: 'edit-modal:close',
  // Main window recording (forwarded from toolbar via main process)
  MAIN_RECORDING_START: 'main:recording-start',
  MAIN_RECORDING_READY: 'main:recording-ready',
  MAIN_RECORDING_STOP: 'main:recording-stop',
  MAIN_RECORDING_PAUSE: 'main:recording-pause',
  MAIN_RECORDING_RESUME: 'main:recording-resume',
  // Mouse tracking
  MOUSE_TRACKING_START: 'mouse:tracking-start',
  MOUSE_TRACKING_STOP: 'mouse:tracking-stop',
  MOUSE_POSITION: 'mouse:position',
  MOUSE_CLICK: 'mouse:click',
  // Window bounds (macOS native)
  WINDOW_GET_BOUNDS: 'window:get-bounds',
  // Config persistence
  CONFIG_GET: 'config:get',
  CONFIG_SAVE: 'config:save',
  // Action tracking
  ACTION_EVENT: 'action:event',
  // Cursor (native macOS)
  CURSOR_HIDE: 'cursor:hide',
  CURSOR_SHOW: 'cursor:show',
  // App control
  APP_QUIT: 'app:quit',
  APP_OPEN_EXTERNAL: 'app:open-external',
  APP_CHECK_UPDATE: 'app:check-update',
  // Onboarding — permissions & prerequisites
  ONBOARDING_CHECK_PERMISSIONS: 'onboarding:check-permissions',
  ONBOARDING_REQUEST_PERMISSION: 'onboarding:request-permission',
  ONBOARDING_CHECK_DEPENDENCIES: 'onboarding:check-dependencies',
  ONBOARDING_INSTALL_DEPENDENCY: 'onboarding:install-dependency',
  ONBOARDING_INSTALL_PROGRESS: 'onboarding:install-progress',
  ONBOARDING_COMPLETE: 'onboarding:complete',
  // Blur regions
  BLUR_MODE_TOGGLE: 'blur:mode-toggle',
  // Webcam background blur
  WEBCAM_BLUR_TOGGLE: 'webcam-blur:toggle',
  // Aspect ratio
  ASPECT_RATIO_UPDATE: 'aspect-ratio:update',
  // Countdown
  COUNTDOWN_TICK: 'countdown:tick',
  // Watermark
  WATERMARK_SELECT_FILE: 'watermark:select-file',
  // Captions
  CAPTION_PROGRESS: 'caption:progress',
  // Chapters
  CHAPTERS_READY: 'chapters:ready',
  // Thumbnail review
  THUMBNAIL_OPEN: 'thumbnail:open',
  THUMBNAIL_GENERATE: 'thumbnail:generate',
  THUMBNAIL_SAVE: 'thumbnail:save',
  THUMBNAIL_SKIP: 'thumbnail:skip',
  THUMBNAIL_PROGRESS: 'thumbnail:progress',
  THUMBNAIL_EXTRACT_FRAMES: 'thumbnail:extract-frames',
  THUMBNAIL_CLOSE: 'thumbnail:close',
  // Export platforms
  EXPORT_PLATFORMS: 'export:platforms',
  // Auto-save (crash recovery)
  AUTOSAVE_CHUNK: 'autosave:chunk',
  AUTOSAVE_CLEANUP: 'autosave:cleanup',
  // Review screen analysis
  REVIEW_ANALYZE: 'review:analyze',
  REVIEW_EXPORT: 'review:export',
} as const;
