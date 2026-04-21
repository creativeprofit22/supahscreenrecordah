// Screen blur regions (pre-recording)
export interface BlurRegion {
  id: string;
  x: number;      // percentage 0-100 relative to screen area
  y: number;
  width: number;
  height: number;
  intensity: number; // blur radius in px (default 20)
}

// Multi-aspect ratio
export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5';

export interface AspectRatioConfig {
  ratio: AspectRatio;
  width: number;
  height: number;
  label: string;
  platforms: string[]; // e.g. ['YouTube', 'Twitter']
}

export const ASPECT_RATIOS: Record<AspectRatio, AspectRatioConfig> = {
  '16:9': { ratio: '16:9', width: 1920, height: 1080, label: 'Landscape', platforms: ['YouTube', 'Twitter', 'LinkedIn'] },
  '9:16': { ratio: '9:16', width: 1080, height: 1920, label: 'Vertical', platforms: ['TikTok', 'YouTube Shorts', 'Instagram Reels'] },
  '1:1':  { ratio: '1:1',  width: 1080, height: 1080, label: 'Square', platforms: ['Instagram Feed'] },
  '4:5':  { ratio: '4:5',  width: 1080, height: 1350, label: 'Portrait', platforms: ['Instagram Feed'] },
};

// Output-quality selector — controls canvas output dimensions + encoder bitrate.
// "short edge" = the smaller dimension of the output (height for landscape,
// width for vertical). Each preset pins the short edge; the other dimension
// is derived from the active aspect ratio.
export type Quality = 'auto' | '1080p' | '1440p' | '4k';

export interface QualityConfig {
  id: Quality;
  label: string;
  shortEdge: number | null; // null = auto (derived from capture source)
}

export const QUALITY_PRESETS: Record<Quality, QualityConfig> = {
  'auto':  { id: 'auto',  label: 'Auto (match screen)', shortEdge: null },
  '1080p': { id: '1080p', label: '1080p',               shortEdge: 1080 },
  '1440p': { id: '1440p', label: '1440p (2K)',          shortEdge: 1440 },
  '4k':    { id: '4k',    label: '2160p (4K)',          shortEdge: 2160 },
};

/** Snap an auto-detected source dimension to the nearest standard preset. */
function snapToPreset(shortEdge: number): number {
  if (shortEdge >= 2000) return 2160;
  if (shortEdge >= 1300) return 1440;
  return 1080;
}

/**
 * Resolve the output resolution + target bitrate for a recording.
 *
 * Bitrate scales linearly with pixel count from a 1080p baseline of 12 Mbps,
 * which lands near YouTube's published recommendations (1440p → ~21 Mbps,
 * 4K → ~48 Mbps).
 */
export function resolveRecordingResolution(
  quality: Quality,
  aspect: AspectRatio,
  sourceWidth?: number,
  sourceHeight?: number,
): { width: number; height: number; bitrate: number } {
  const aspectCfg = ASPECT_RATIOS[aspect];
  const ratio = aspectCfg.width / aspectCfg.height;

  let shortEdge: number;
  if (quality === 'auto') {
    const src = sourceWidth && sourceHeight ? Math.min(sourceWidth, sourceHeight) : 1080;
    shortEdge = snapToPreset(src);
  } else {
    shortEdge = QUALITY_PRESETS[quality].shortEdge ?? 1080;
  }

  let width: number;
  let height: number;
  if (ratio >= 1) {
    // Landscape-ish: short edge = height
    height = shortEdge;
    width = Math.round(height * ratio);
  } else {
    // Vertical: short edge = width
    width = shortEdge;
    height = Math.round(width / ratio);
  }
  // H.264 requires even dimensions
  width -= width % 2;
  height -= height % 2;

  const BASE_BITRATE = 12_000_000; // 12 Mbps at 1920x1080
  const BASE_PIXELS = 1920 * 1080;
  const scaled = BASE_BITRATE * ((width * height) / BASE_PIXELS);
  const bitrate = Math.max(8_000_000, Math.min(60_000_000, Math.round(scaled)));

  return { width, height, bitrate };
}

// Export presets
export type ExportPlatform = 'youtube' | 'youtube-shorts' | 'tiktok' | 'instagram-reels' | 'instagram-feed' | 'twitter' | 'linkedin' | 'custom';

export interface ExportPreset {
  platform: ExportPlatform;
  label: string;
  aspectRatio: AspectRatio;
  maxBitrate: number;    // kbps
  maxDuration?: number;  // seconds, undefined = no limit
  thumbnailAspect: string; // KIE.ai aspect ratio string
  thumbnailSize: { width: number; height: number };
}

export const EXPORT_PRESETS: Record<ExportPlatform, ExportPreset> = {
  'youtube':          { platform: 'youtube',          label: 'YouTube',          aspectRatio: '16:9', maxBitrate: 12000, thumbnailAspect: '16:9', thumbnailSize: { width: 1280, height: 720 } },
  'youtube-shorts':   { platform: 'youtube-shorts',   label: 'YouTube Shorts',   aspectRatio: '9:16', maxBitrate: 8000,  maxDuration: 60,  thumbnailAspect: '9:16', thumbnailSize: { width: 1080, height: 1920 } },
  'tiktok':           { platform: 'tiktok',           label: 'TikTok',           aspectRatio: '9:16', maxBitrate: 8000,  maxDuration: 180, thumbnailAspect: '9:16', thumbnailSize: { width: 1080, height: 1920 } },
  'instagram-reels':  { platform: 'instagram-reels',  label: 'Instagram Reels',  aspectRatio: '9:16', maxBitrate: 8000,  maxDuration: 90,  thumbnailAspect: '9:16', thumbnailSize: { width: 1080, height: 1920 } },
  'instagram-feed':   { platform: 'instagram-feed',   label: 'Instagram Feed',   aspectRatio: '1:1',  maxBitrate: 8000,  maxDuration: 60,  thumbnailAspect: '1:1',  thumbnailSize: { width: 1080, height: 1080 } },
  'twitter':          { platform: 'twitter',          label: 'Twitter/X',        aspectRatio: '16:9', maxBitrate: 8000,  maxDuration: 140, thumbnailAspect: '16:9', thumbnailSize: { width: 1200, height: 675 } },
  'linkedin':         { platform: 'linkedin',         label: 'LinkedIn',         aspectRatio: '16:9', maxBitrate: 8000,  maxDuration: 600, thumbnailAspect: '16:9', thumbnailSize: { width: 1200, height: 675 } },
  'custom':           { platform: 'custom',           label: 'Custom',           aspectRatio: '16:9', maxBitrate: 12000, thumbnailAspect: '16:9', thumbnailSize: { width: 1280, height: 720 } },
};

// Cursor effects
export type CursorTrailStyle = 'none' | 'dots' | 'glow' | 'line';
export interface CursorEffectConfig {
  trail: CursorTrailStyle;
  clickRipple: boolean;
  clickRippleColor: string;
}

// Intro/outro
export type TemplateId = 'fade-title' | 'slide-in' | 'zoom-burst' | 'minimal';
export interface IntroOutroConfig {
  introEnabled: boolean;
  introTemplate: TemplateId;
  introText: string;
  introSubtext: string;
  outroDuration: number; // seconds, 3-5
  outroEnabled: boolean;
  outroTemplate: TemplateId;
  outroText: string;
  outroSubtext: string;
  introDuration: number;
}

// Thumbnail generation
export interface ThumbnailConfig {
  enabled: boolean; // user can skip entirely
  platforms: ExportPlatform[]; // which aspect ratios to generate
  customPrompt?: string; // user override for AI prompt
}

export interface ThumbnailResult {
  platform: ExportPlatform;
  aspectRatio: string;
  imagePath: string; // local path to generated/selected thumbnail
  prompt: string;
}

// Watermark
export interface WatermarkConfig {
  enabled: boolean;
  imagePath: string; // local path to logo
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  opacity: number; // 0-1
  size: number; // percentage of canvas width, 5-20
}

// Progress bar
export interface ProgressBarConfig {
  enabled: boolean;
  position: 'top' | 'bottom';
  color: string;
  height: number; // px
}

// Caption style for the recorder
export type CaptionStylePreset = 'clean' | 'spotlight' | 'electric' | 'candy' | 'flow' | 'knockout';

export interface CaptionConfig {
  enabled: boolean;
  style: CaptionStylePreset;
  position: 'bottom' | 'center' | 'top';
  fontSize: number;
  powerWords: boolean; // colorize power words
}

// Silence removal
export interface SilenceRemovalConfig {
  enabled: boolean;
  minSilenceMs: number; // minimum silence to cut (default 1500)
  keepPaddingMs: number; // padding around speech (default 150)
  removeFillers: boolean; // cut "um", "uh", "like"
}
