import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { findFfmpeg } from '../dependencies';
import {
  VOICE_ENHANCE_FILTER_BASE,
  LOUDNORM_I,
  LOUDNORM_TP,
  LOUDNORM_LRA,
  POST_BOOST_FILTERS,
} from './filters';
import { VIDEO_ENCODE_FLAGS, FFMPEG_EXEC_OPTIONS, FFMPEG_EXEC_OPTIONS_SHORT } from './encode';

interface LoudnormMeasurement {
  input_i: string;
  input_lra: string;
  input_tp: string;
  input_thresh: string;
  target_offset: string;
}

interface FfmpegResult {
  success: boolean;
  stderr: string;
}

/** Run FFmpeg pass 1: apply voice filters + loudnorm in measure-only mode */
function runLoudnormPass1(
  ffmpegPath: string,
  filePath: string,
): Promise<LoudnormMeasurement | null> {
  const pass1Filter = [
    VOICE_ENHANCE_FILTER_BASE,
    `loudnorm=I=${LOUDNORM_I}:TP=${LOUDNORM_TP}:LRA=${LOUDNORM_LRA}:print_format=json`,
    POST_BOOST_FILTERS,
  ].join(',');

  return new Promise((resolve) => {
    execFile(
      ffmpegPath,
      ['-i', filePath, '-af', pass1Filter, '-f', 'null', '-'],
      FFMPEG_EXEC_OPTIONS,
      (_error, _stdout, stderr) => {
        // loudnorm outputs JSON to stderr even on "error" (null output)
        try {
          const jsonMatch = /\{[^{}]*"input_i"\s*:\s*"[^"]*"[^{}]*\}/s.exec(stderr);
          if (jsonMatch) {
            const data = JSON.parse(jsonMatch[0]) as Record<string, string>;
            if (data.input_i && data.input_lra && data.input_tp && data.input_thresh) {
              resolve({
                input_i: data.input_i,
                input_lra: data.input_lra,
                input_tp: data.input_tp,
                input_thresh: data.input_thresh,
                target_offset: data.target_offset ?? '0',
              });
              return;
            }
          }
        } catch {
          // JSON parse failed
        }
        console.warn('[export] Pass 1 failed to extract loudnorm measurements');
        if (stderr) {
          console.warn('[export] FFmpeg stderr (tail):', stderr.slice(-500));
        }
        resolve(null);
      },
    );
  });
}

/** Run FFmpeg pass 2: apply voice filters + loudnorm with measured values */
function runLoudnormPass2(
  ffmpegPath: string,
  filePath: string,
  tmpPath: string,
  measured: LoudnormMeasurement,
): Promise<FfmpegResult> {
  const pass2Filter = [
    'aresample=async=1000:first_pts=0',
    VOICE_ENHANCE_FILTER_BASE,
    `loudnorm=linear=true:I=${LOUDNORM_I}:TP=${LOUDNORM_TP}:LRA=${LOUDNORM_LRA}` +
      `:measured_i=${measured.input_i}:measured_lra=${measured.input_lra}` +
      `:measured_tp=${measured.input_tp}:measured_thresh=${measured.input_thresh}` +
      `:offset=${measured.target_offset}`,
    POST_BOOST_FILTERS,
  ].join(',');

  return new Promise((resolve) => {
    execFile(
      ffmpegPath,
      [
        '-fflags', '+genpts',
        '-i', filePath,
        ...VIDEO_ENCODE_FLAGS,
        '-af', pass2Filter,
        '-c:a', 'aac',
        '-b:a', '384k',
        '-ar', '48000',
        '-ac', '2',
        '-movflags', '+faststart',
        '-y', tmpPath,
      ],
      FFMPEG_EXEC_OPTIONS,
      (error, _stdout, stderr) => {
        resolve({ success: !error, stderr });
      },
    );
  });
}

/** Single-pass fallback when pass 1 measurement fails */
function runSinglePassEnhance(
  ffmpegPath: string,
  filePath: string,
  tmpPath: string,
): Promise<FfmpegResult> {
  const filter = [
    'aresample=async=1000:first_pts=0',
    VOICE_ENHANCE_FILTER_BASE,
    `loudnorm=I=${LOUDNORM_I}:TP=${LOUDNORM_TP}:LRA=${LOUDNORM_LRA}`,
    POST_BOOST_FILTERS,
  ].join(',');

  return new Promise((resolve) => {
    execFile(
      ffmpegPath,
      [
        '-fflags', '+genpts',
        '-i', filePath,
        ...VIDEO_ENCODE_FLAGS,
        '-af', filter,
        '-c:a', 'aac',
        '-b:a', '384k',
        '-ar', '48000',
        '-ac', '2',
        '-movflags', '+faststart',
        '-y', tmpPath,
      ],
      FFMPEG_EXEC_OPTIONS,
      (error, _stdout, stderr) => {
        resolve({ success: !error, stderr });
      },
    );
  });
}

/**
 * Post-process a recording: remux fMP4 → standard MP4, enhance voice audio.
 *
 * Uses two-pass loudnorm for precise loudness normalization:
 * - Pass 1: measures actual loudness levels (outputs to /dev/null)
 * - Pass 2: applies exact correction using measured values
 *
 * Falls back gracefully: two-pass → single-pass → simple remux
 */
export async function postProcessRecording(filePath: string): Promise<void> {
  if (!filePath.toLowerCase().endsWith('.mp4')) {
    return;
  }

  const ffmpegPath = await findFfmpeg();
  if (!ffmpegPath) {
    console.warn('[export] FFmpeg not found — skipping post-processing.');
    return;
  }

  const tmpPath = path.join(os.tmpdir(), `supahscreenrecordah-export-${Date.now()}.mp4`);

  // Pass 1: measure loudness
  const measured = await runLoudnormPass1(ffmpegPath, filePath);

  let result: FfmpegResult;
  if (measured) {
    // Pass 2: apply precise normalization with measured values
    result = await runLoudnormPass2(ffmpegPath, filePath, tmpPath, measured);
  } else {
    // Fallback to single-pass if measurement failed
    console.warn('[export] Falling back to single-pass loudnorm.');
    result = await runSinglePassEnhance(ffmpegPath, filePath, tmpPath);
  }

  if (result.success) {
    try {
      await fs.promises.copyFile(tmpPath, filePath);
      await fs.promises.unlink(tmpPath);
    } catch (copyErr) {
      console.warn('[export] Failed to replace original file:', copyErr);
      try {
        await fs.promises.unlink(tmpPath);
      } catch {
        // ignore cleanup failure
      }
    }
    return;
  }

  // Log stderr for diagnostics
  if (result.stderr) {
    console.warn('[export] FFmpeg stderr (tail):', result.stderr.slice(-500));
  }

  // Final fallback: simple remux without audio enhancement
  console.warn('[export] Audio enhancement failed — falling back to simple remux.');
  await fallbackRemux(ffmpegPath, filePath, tmpPath);
}

/** Fallback: simple remux without audio enhancement (stream copy only) */
async function fallbackRemux(
  ffmpegPath: string,
  filePath: string,
  tmpPath: string,
): Promise<void> {
  const { error, stderr } = await new Promise<{ error: Error | null; stderr: string }>(
    (resolve) => {
      execFile(
        ffmpegPath,
        [
          '-i', filePath,
          '-c', 'copy',
          '-tag:v', 'avc1',
          '-movflags', '+faststart',
          '-y', tmpPath,
        ],
        FFMPEG_EXEC_OPTIONS_SHORT,
        (err, _stdout, stderrOut) => {
          resolve({ error: err, stderr: stderrOut });
        },
      );
    },
  );

  if (error) {
    console.warn('[export] Fallback remux also failed:', error.message);
    if (stderr) {
      console.warn('[export] FFmpeg stderr (tail):', stderr.slice(-500));
    }
    try {
      await fs.promises.unlink(tmpPath);
    } catch {
      // ignore
    }
    return;
  }

  try {
    await fs.promises.copyFile(tmpPath, filePath);
    await fs.promises.unlink(tmpPath);
  } catch (copyErr) {
    console.warn('[export] Failed to replace original file:', copyErr);
  }
}
