import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { findFfmpeg } from '../dependencies';
import { FFMPEG_EXEC_OPTIONS } from './encode';

interface FfmpegResult {
  success: boolean;
  stderr: string;
}

/**
 * Build an FFmpeg filter_complex string that trims and concatenates keep segments.
 *
 * For each segment: trim video + audio, reset timestamps.
 * Then concat all segments into a single output.
 */
/** Audio crossfade duration in seconds — smooths hard cuts */
const CROSSFADE_SEC = 0.15;

/** Video fade-to-black duration at cut boundaries — matches audio crossfade */
const VIDEO_FADE_SEC = 0.15;

function buildFilterComplex(keepSegments: Array<{ start: number; end: number }>): string {
  const parts: string[] = [];
  const concatInputs: string[] = [];
  const lastIdx = keepSegments.length - 1;

  for (let i = 0; i < keepSegments.length; i++) {
    const { start, end } = keepSegments[i];
    // Add small audio fade-in/out to avoid pops at cut boundaries
    const fadeDur = CROSSFADE_SEC;
    const segDur = end - start;
    const fadeOutStart = Math.max(0, segDur - fadeDur);

    // Video: trim + optional fade-in/out at cut boundaries
    let videoFilter = `[0:v]trim=start=${start.toFixed(6)}:end=${end.toFixed(6)},setpts=PTS-STARTPTS`;
    if (i > 0) {
      videoFilter += `,fade=t=in:st=0:d=${VIDEO_FADE_SEC.toFixed(3)}`;
    }
    if (i < lastIdx) {
      const vFadeOutStart = Math.max(0, segDur - VIDEO_FADE_SEC);
      videoFilter += `,fade=t=out:st=${vFadeOutStart.toFixed(3)}:d=${VIDEO_FADE_SEC.toFixed(3)}`;
    }
    parts.push(`${videoFilter}[v${i}]`);

    parts.push(
      `[0:a]atrim=start=${start.toFixed(6)}:end=${end.toFixed(6)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${fadeDur.toFixed(3)},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeDur.toFixed(3)}[a${i}]`,
    );
    concatInputs.push(`[v${i}][a${i}]`);
  }

  parts.push(
    `${concatInputs.join('')}concat=n=${keepSegments.length}:v=1:a=1[outv][outa]`,
  );

  return parts.join(';');
}

/**
 * Cut silence/filler regions from a video by keeping only the specified segments.
 *
 * Uses FFmpeg filter_complex with trim/atrim + concat to produce a clean output.
 * Replaces the input file in-place on success.
 */
export async function cutSilenceRegions(
  videoPath: string,
  keepSegments: Array<{ start: number; end: number }>,
): Promise<boolean> {
  if (keepSegments.length === 0) {
    console.warn('[silence-cut] No segments to keep — skipping.');
    return false;
  }

  // Single segment covering the whole file means nothing to cut
  if (keepSegments.length === 1) {
    console.log('[silence-cut] Only one segment — nothing to cut.');
    return true;
  }

  const ffmpegPath = await findFfmpeg();
  if (!ffmpegPath) {
    console.warn('[silence-cut] FFmpeg not found — skipping silence removal.');
    return false;
  }

  const filterComplex = buildFilterComplex(keepSegments);
  console.log(`[silence-cut] Keep segments:`, keepSegments.map(s => `${s.start.toFixed(2)}-${s.end.toFixed(2)}`).join(', '));
  const tmpPath = path.join(os.tmpdir(), `supahscreenrecordah-silencecut-${Date.now()}.mp4`);

  console.log(`[silence-cut] Cutting ${keepSegments.length} segments from video…`);

  const result = await new Promise<FfmpegResult>((resolve) => {
    execFile(
      ffmpegPath,
      [
        '-i', videoPath,
        '-filter_complex', filterComplex,
        '-map', '[outv]',
        '-map', '[outa]',
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '18',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        '-y', tmpPath,
      ],
      FFMPEG_EXEC_OPTIONS,
      (error, _stdout, stderr) => {
        resolve({ success: !error, stderr });
      },
    );
  });

  if (result.success) {
    try {
      await fs.promises.copyFile(tmpPath, videoPath);
      await fs.promises.unlink(tmpPath);
      console.log('[silence-cut] Silence removal complete.');
      return true;
    } catch (copyErr) {
      console.warn('[silence-cut] Failed to replace original file:', copyErr);
      try {
        await fs.promises.unlink(tmpPath);
      } catch {
        // ignore
      }
      return false;
    }
  }

  console.warn('[silence-cut] FFmpeg filter_complex failed.');
  if (result.stderr) {
    console.warn('[silence-cut] FFmpeg stderr (tail):', result.stderr.slice(-500));
  }
  try {
    await fs.promises.unlink(tmpPath);
  } catch {
    // ignore
  }
  return false;
}
