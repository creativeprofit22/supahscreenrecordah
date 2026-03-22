import type { ExportPreset } from '../../../shared/feature-types';
import { ASPECT_RATIOS } from '../../../shared/feature-types';

/**
 * YouTube-optimal H.264 video encoding flags.
 * Re-encodes video instead of stream copy to guarantee clean H.264 output
 * regardless of what MediaRecorder produced (WebM/VP9 fallback, broken fMP4, etc).
 *
 * - High Profile Level 4.0: YouTube's expected profile for 1080p30
 * - CRF 17: visually lossless quality, slightly above YouTube's 12Mbps target
 * - maxrate 14M / bufsize 28M: caps bitrate spikes on complex scenes
 * - g 60: keyframe every 2s for smooth YouTube seeking
 * - pix_fmt yuv420p: required by YouTube and all web players
 */
export const VIDEO_ENCODE_FLAGS: string[] = [
  '-c:v', 'libx264',
  '-preset', 'medium',
  '-profile:v', 'high',
  '-level', '4.0',
  '-crf', '17',
  '-maxrate', '14M',
  '-bufsize', '28M',
  '-g', '60',
  '-pix_fmt', 'yuv420p',
  '-r', '30',
  '-colorspace', 'bt709',
  '-color_trc', 'bt709',
  '-color_primaries', 'bt709',
  '-tag:v', 'avc1',
];

/**
 * Build encoding flags customized for a specific export preset.
 * Adjusts maxrate/bufsize based on the preset's maxBitrate and adds
 * a scale filter for the target resolution.
 */
export function buildEncodeFlags(preset: ExportPreset): string[] {
  const maxrateKbps = preset.maxBitrate;
  const maxrateStr = `${maxrateKbps}k`;
  const bufsizeStr = `${maxrateKbps * 2}k`;
  const ar = ASPECT_RATIOS[preset.aspectRatio] ?? ASPECT_RATIOS['16:9'];

  return [
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-profile:v', 'high',
    '-level', '4.0',
    '-crf', '17',
    '-maxrate', maxrateStr,
    '-bufsize', bufsizeStr,
    '-g', '60',
    '-pix_fmt', 'yuv420p',
    '-r', '30',
    '-vf', `scale=${ar.width}:${ar.height}:force_original_aspect_ratio=decrease,pad=${ar.width}:${ar.height}:(ow-iw)/2:(oh-ih)/2`,
    '-colorspace', 'bt709',
    '-color_trc', 'bt709',
    '-color_primaries', 'bt709',
    '-tag:v', 'avc1',
  ];
}

export const FFMPEG_EXEC_OPTIONS = { timeout: 600_000, maxBuffer: 50 * 1024 * 1024 };
export const FFMPEG_EXEC_OPTIONS_SHORT = { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 };
