/**
 * Progress bar overlay — applied as an FFmpeg filter during post-processing.
 *
 * During live recording, the final duration is unknown, so the progress bar
 * cannot be rendered in real-time on the canvas. Instead, the progress bar
 * is added as a `drawbox` filter in the FFmpeg post-processing pipeline
 * (see src/main/services/ffmpeg/post-process.ts), which has access to the
 * total video duration.
 *
 * This file exists as a documentation placeholder and to maintain the
 * one-file-per-overlay convention in the overlays directory.
 *
 * Configuration is stored in OverlayConfig.progressBar (ProgressBarConfig):
 *   - enabled: boolean
 *   - position: 'top' | 'bottom'
 *   - color: hex color string
 *   - height: number (px, 2-6)
 */
