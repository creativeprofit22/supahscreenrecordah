import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { promisify } from 'util';
import { findFfmpeg } from './dependencies';
import { FFMPEG_EXEC_OPTIONS } from './ffmpeg/encode';
import type { WaveformData } from '../../shared/review-types';

const execFileAsync = promisify(execFile);

const SAMPLE_RATE = 8000;

/**
 * Extract a downsampled waveform from a video file's audio track.
 * Runs FFmpeg in the main process to decode audio to raw PCM,
 * then computes RMS amplitude per block.
 */
export async function extractWaveform(
  videoPath: string,
  samples: number = 800,
): Promise<WaveformData> {
  const empty: WaveformData = { samples: [], duration: 0 };

  const ffmpeg = await findFfmpeg();
  if (!ffmpeg) return empty;

  const tempPcm = path.join(os.tmpdir(), `waveform-${Date.now()}.pcm`);

  try {
    // Extract mono f32le PCM at 8kHz
    await execFileAsync(
      ffmpeg,
      ['-i', videoPath, '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', '-y', tempPcm],
      FFMPEG_EXEC_OPTIONS,
    );

    const buffer = await fs.promises.readFile(tempPcm);
    if (buffer.byteLength < 4) return empty;

    const floats = new Float32Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength / 4,
    );

    const duration = floats.length / SAMPLE_RATE;
    const blockSize = Math.floor(floats.length / samples);
    if (blockSize < 1) {
      // Fewer raw samples than target — return what we have
      const result: number[] = [];
      for (let i = 0; i < floats.length; i++) {
        result.push(Math.abs(floats[i]!));
      }
      return { samples: result, duration };
    }

    const waveform: number[] = [];
    for (let i = 0; i < samples; i++) {
      const start = i * blockSize;
      let sum = 0;
      for (let j = 0; j < blockSize; j++) {
        sum += Math.abs(floats[start + j]!);
      }
      waveform.push(sum / blockSize);
    }

    return { samples: waveform, duration };
  } catch {
    return empty;
  } finally {
    try {
      await fs.promises.unlink(tempPcm);
    } catch {
      // temp file may not exist if FFmpeg failed early
    }
  }
}
