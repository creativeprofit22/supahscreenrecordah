import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { findFfmpeg } from '../dependencies';
import { VIDEO_ENCODE_FLAGS, FFMPEG_EXEC_OPTIONS } from './encode';
import type { IntroOutroConfig, TemplateId } from '../../../shared/feature-types';

/** Escape text for FFmpeg drawtext filter (colons, backslashes, quotes) */
function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'");
}

/** Convert a hex color string (e.g. '#ff0000') to FFmpeg's 0xRRGGBB format */
function hexToFfmpegColor(hex: string): string {
  const clean = hex.replace('#', '');
  return `0x${clean}`;
}

/**
 * Build the video filter chain for a given template.
 * All templates render main text + subtext on a colored background.
 */
function buildTemplateFilter(
  template: TemplateId,
  mainText: string,
  subtext: string,
  duration: number,
  bgColor: string,
): string {
  const escaped = escapeDrawtext(mainText);
  const escapedSub = escapeDrawtext(subtext);
  const fadeOut = duration - 0.5;

  const subtextFilter = subtext
    ? buildSubtextFilter(template, escapedSub, duration, fadeOut)
    : '';

  switch (template) {
    case 'fade-title':
      return [
        `drawtext=text='${escaped}':fontsize=72:fontcolor=white:x=(w-tw)/2:y=(h-th)/2-30`,
        `fade=t=in:st=0:d=0.5,fade=t=out:st=${fadeOut}:d=0.5`,
        subtextFilter,
      ]
        .filter(Boolean)
        .join(',');

    case 'slide-in': {
      // Text slides in from left (x animates from -tw to center in first 0.5s),
      // holds, then slides out right in last 0.5s
      const slideInX = `'if(lt(t,0.5), -tw + (w/2+tw/2)*(t/0.5), if(gt(t,${fadeOut}), (w/2-tw/2) + (w+tw)*(t-${fadeOut})/0.5, (w-tw)/2))'`;
      return [
        `drawtext=text='${escaped}':fontsize=72:fontcolor=white:x=${slideInX}:y=(h-th)/2-30`,
        subtextFilter,
      ]
        .filter(Boolean)
        .join(',');
    }

    case 'zoom-burst': {
      // Text starts at 2x size and scales down to 1x with a subtle overshoot
      // We simulate zoom using fontsize animation: starts at 144 → 72 over 0.8s
      const zoomSize = `'if(lt(t,0.8), 144 - 90*(t/0.8), 72)'`;
      return [
        `drawtext=text='${escaped}':fontsize=${zoomSize}:fontcolor=white:x=(w-tw)/2:y=(h-th)/2-30`,
        `fade=t=out:st=${fadeOut}:d=0.5`,
        subtextFilter,
      ]
        .filter(Boolean)
        .join(',');
    }

    case 'minimal':
    default:
      return [
        `drawtext=text='${escaped}':fontsize=72:fontcolor=white:x=(w-tw)/2:y=(h-th)/2-30`,
        subtextFilter,
      ]
        .filter(Boolean)
        .join(',');
  }
}

/** Build subtext filter matching the template style */
function buildSubtextFilter(
  template: TemplateId,
  escapedSub: string,
  duration: number,
  fadeOut: number,
): string {
  const base = `drawtext=text='${escapedSub}':fontsize=36:fontcolor=gray:x=(w-tw)/2:y=(h/2)+40`;

  switch (template) {
    case 'fade-title':
      return `${base},fade=t=in:st=0.3:d=0.5,fade=t=out:st=${fadeOut}:d=0.5`;
    case 'slide-in': {
      const slideInX = `'if(lt(t,0.6), -tw + (w/2+tw/2)*(t/0.6), if(gt(t,${fadeOut}), (w/2-tw/2) + (w+tw)*(t-${fadeOut})/0.5, (w-tw)/2))'`;
      return `drawtext=text='${escapedSub}':fontsize=36:fontcolor=gray:x=${slideInX}:y=(h/2)+40`;
    }
    case 'zoom-burst': {
      const zoomSize = `'if(lt(t,0.8), 72 - 45*(t/0.8), 36)'`;
      return `drawtext=text='${escapedSub}':fontsize=${zoomSize}:fontcolor=gray:x=(w-tw)/2:y=(h/2)+40,fade=t=out:st=${fadeOut}:d=0.5`;
    }
    case 'minimal':
    default:
      return base;
  }
}

/** Generate a short intro or outro video clip using FFmpeg */
async function generateClip(
  type: 'intro' | 'outro',
  config: IntroOutroConfig,
  outputDir: string,
  width: number,
  height: number,
  bgColor: string,
): Promise<string | null> {
  const enabled = type === 'intro' ? config.introEnabled : config.outroEnabled;
  if (!enabled) return null;

  const template = type === 'intro' ? config.introTemplate : config.outroTemplate;
  const mainText = type === 'intro' ? config.introText : config.outroText;
  const subtext = type === 'intro' ? config.introSubtext : config.outroSubtext;
  const duration = type === 'intro' ? config.introDuration : config.outroDuration;

  if (!mainText.trim()) return null;

  const ffmpegPath = await findFfmpeg();
  if (!ffmpegPath) {
    console.warn(`[intro-outro] FFmpeg not found — skipping ${type} clip.`);
    return null;
  }

  const outPath = path.join(outputDir, `supahscreenrecordah-${type}-${Date.now()}.mp4`);
  const bgHex = template === 'slide-in' ? hexToFfmpegColor(bgColor) : 'black';
  const videoFilter = buildTemplateFilter(template, mainText, subtext, duration, bgColor);

  return new Promise((resolve) => {
    execFile(
      ffmpegPath,
      [
        '-f', 'lavfi',
        '-i', `color=c=${bgHex}:s=${width}x${height}:d=${duration}:r=30`,
        '-f', 'lavfi',
        '-i', `anullsrc=channel_layout=stereo:sample_rate=48000`,
        '-t', String(duration),
        '-vf', videoFilter,
        ...VIDEO_ENCODE_FLAGS,
        '-c:a', 'aac',
        '-b:a', '384k',
        '-ar', '48000',
        '-ac', '2',
        '-shortest',
        '-movflags', '+faststart',
        '-y', outPath,
      ],
      FFMPEG_EXEC_OPTIONS,
      (error, _stdout, stderr) => {
        if (error) {
          console.warn(`[intro-outro] Failed to generate ${type} clip:`, error.message);
          if (stderr) {
            console.warn(`[intro-outro] FFmpeg stderr (tail):`, stderr.slice(-500));
          }
          resolve(null);
          return;
        }
        console.log(`[intro-outro] Generated ${type} clip: ${outPath}`);
        resolve(outPath);
      },
    );
  });
}

/** Generate an intro clip */
export async function generateIntroClip(
  config: IntroOutroConfig,
  outputDir: string,
  width: number,
  height: number,
  bgColor: string,
): Promise<string | null> {
  return generateClip('intro', config, outputDir, width, height, bgColor);
}

/** Generate an outro clip */
export async function generateOutroClip(
  config: IntroOutroConfig,
  outputDir: string,
  width: number,
  height: number,
  bgColor: string,
): Promise<string | null> {
  return generateClip('outro', config, outputDir, width, height, bgColor);
}

/**
 * Concatenate intro/outro clips with the main video using FFmpeg concat demuxer.
 * All clips must have same resolution, codec, and framerate.
 * Replaces the main video file in-place.
 */
export async function concatenateWithIntroOutro(
  mainVideo: string,
  introClip: string | null,
  outroClip: string | null,
): Promise<void> {
  if (!introClip && !outroClip) return;

  const ffmpegPath = await findFfmpeg();
  if (!ffmpegPath) {
    console.warn('[intro-outro] FFmpeg not found — skipping concatenation.');
    return;
  }

  const tmpDir = os.tmpdir();
  const concatListPath = path.join(tmpDir, `supahscreenrecordah-concat-${Date.now()}.txt`);
  const outputPath = path.join(tmpDir, `supahscreenrecordah-concat-out-${Date.now()}.mp4`);

  // Build concat list
  const lines: string[] = [];
  if (introClip) lines.push(`file '${introClip.replace(/'/g, "'\\''")}'`);
  lines.push(`file '${mainVideo.replace(/'/g, "'\\''")}'`);
  if (outroClip) lines.push(`file '${outroClip.replace(/'/g, "'\\''")}'`);

  await fs.promises.writeFile(concatListPath, lines.join('\n'), 'utf-8');

  const success = await new Promise<boolean>((resolve) => {
    execFile(
      ffmpegPath,
      [
        '-f', 'concat',
        '-safe', '0',
        '-i', concatListPath,
        '-c', 'copy',
        '-movflags', '+faststart',
        '-y', outputPath,
      ],
      FFMPEG_EXEC_OPTIONS,
      (error, _stdout, stderr) => {
        if (error) {
          console.warn('[intro-outro] Concat failed:', error.message);
          if (stderr) {
            console.warn('[intro-outro] FFmpeg stderr (tail):', stderr.slice(-500));
          }
          resolve(false);
          return;
        }
        resolve(true);
      },
    );
  });

  // Cleanup temp files
  const cleanup = async (...paths: (string | null)[]) => {
    for (const p of paths) {
      if (p) {
        try {
          await fs.promises.unlink(p);
        } catch {
          // ignore
        }
      }
    }
  };

  if (success) {
    try {
      await fs.promises.copyFile(outputPath, mainVideo);
      console.log('[intro-outro] Successfully concatenated intro/outro with main video.');
    } catch (err) {
      console.warn('[intro-outro] Failed to replace original file:', err);
    }
  }

  await cleanup(concatListPath, outputPath, introClip, outroClip);
}

/**
 * Full intro/outro pipeline: generate clips and concatenate with main video.
 * This is the top-level function called from the export pipeline.
 */
export async function applyIntroOutro(
  filePath: string,
  config: IntroOutroConfig,
  width: number,
  height: number,
  bgColor: string,
): Promise<void> {
  if (!config.introEnabled && !config.outroEnabled) return;

  console.log('[intro-outro] Starting intro/outro generation...');
  const tmpDir = os.tmpdir();

  const [introClip, outroClip] = await Promise.all([
    generateIntroClip(config, tmpDir, width, height, bgColor),
    generateOutroClip(config, tmpDir, width, height, bgColor),
  ]);

  await concatenateWithIntroOutro(filePath, introClip, outroClip);
  console.log('[intro-outro] Pipeline complete.');
}
