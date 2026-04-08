// DOM references — grabbed once at init, used across all modules

export const screenWrapper = document.getElementById('screen-wrapper') as HTMLDivElement;
export const screenVideo = document.getElementById('screen-video') as HTMLVideoElement;
export const cameraContainer = document.getElementById('camera-container') as HTMLDivElement;
export const cameraVideo = document.getElementById('camera-video') as HTMLVideoElement;
export const cameraName = document.getElementById('camera-name') as HTMLDivElement;
export const cameraSocials = document.getElementById('camera-socials') as HTMLDivElement;
export const waveformCanvas = document.getElementById('waveform-canvas') as HTMLCanvasElement;
export const waveformCtx = waveformCanvas.getContext('2d')!;
export const actionFeedCanvas = document.getElementById('action-feed-canvas') as HTMLCanvasElement;
export const actionFeedCtx = actionFeedCanvas.getContext('2d')!;
export const bgCanvas = document.getElementById('bg-canvas') as HTMLCanvasElement;
export const bgCtx = bgCanvas.getContext('2d')!;
export const shortsPreviewCanvas = document.getElementById('shorts-preview-canvas') as HTMLCanvasElement;
export const shortsPreviewCtx = shortsPreviewCanvas.getContext('2d')!;
export const idleState = document.getElementById('idle-state') as HTMLDivElement;
export const previewContainer = document.querySelector('.preview-container') as HTMLDivElement;
export const playbackContainer = document.getElementById('playback-container') as HTMLDivElement;
export const playbackVideo = document.getElementById('playback-video') as HTMLVideoElement;
export const playbackExportBtn = document.getElementById('playback-export-btn') as HTMLButtonElement;
export const playbackExitBtn = document.getElementById('playback-exit-btn') as HTMLButtonElement;
export const processingOverlay = document.getElementById('processing-overlay') as HTMLDivElement;
export const processingSub = document.getElementById('processing-sub') as HTMLDivElement;
export const ctaPopup = document.getElementById('cta-popup') as HTMLDivElement;
