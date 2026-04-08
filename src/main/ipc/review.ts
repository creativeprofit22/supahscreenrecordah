import { ipcMain, app } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Channels } from '../../shared/channels';
import { isValidSender } from './helpers';
import { isValidSavePath } from '../../shared/paths';
import { getPlaybackTempFile } from './playback';
import { extractWaveform } from '../services/waveform';
import { transcribeWithWhisper } from '../services/whisper-transcribe';
import { detectSilences, detectFillers } from '../services/assemblyai/silence';
import { cutSilenceRegions } from '../services/ffmpeg/silence-cut';
import { postProcessRecording } from '../services/ffmpeg';
import { getConfig } from '../store';
import type { ReviewSegment, ReviewAnalysisResult } from '../../shared/review-types';
import type { SilenceRegion } from '../services/assemblyai/types';

let idCounter = 0;

function nextId(): string {
  return `seg-${++idCounter}`;
}

/**
 * Convert silence/filler regions into ReviewSegments and fill gaps with speech segments.
 */
function buildSegments(regions: SilenceRegion[], duration: number): ReviewSegment[] {
  if (regions.length === 0) return [];

  // Sort and merge overlapping regions
  const sorted = [...regions].sort((a, b) => a.start - b.start);
  const merged: SilenceRegion[] = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const cur = sorted[i];
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
      // Keep the more specific reason
      if (cur.reason === 'filler') last.reason = 'filler';
    } else {
      merged.push({ ...cur });
    }
  }

  const segments: ReviewSegment[] = [];
  let pos = 0;

  for (const region of merged) {
    // Speech gap before this region
    if (region.start > pos) {
      segments.push({
        id: nextId(),
        start: pos,
        end: region.start,
        type: 'speech',
        enabled: true,
      });
    }

    segments.push({
      id: nextId(),
      start: region.start,
      end: region.end,
      type: region.reason === 'filler' ? 'filler' : 'silence',
      enabled: true,
    });

    pos = region.end;
  }

  // Trailing speech
  if (pos < duration) {
    segments.push({
      id: nextId(),
      start: pos,
      end: duration,
      type: 'speech',
      enabled: true,
    });
  }

  return segments;
}

// Allowed directories for saving recordings
const ALLOWED_SAVE_DIRS = [
  app.getPath('home'),
  app.getPath('desktop'),
  app.getPath('documents'),
];

export function registerReviewHandlers(): void {
  // --- Export with pre-computed keep-segments from the review screen ---------
  ipcMain.handle(
    Channels.REVIEW_EXPORT,
    async (event, { filePath, buffer, keepSegments }: {
      filePath: string;
      buffer: ArrayBuffer;
      keepSegments: Array<{ start: number; end: number }>;
    }) => {
      if (!isValidSender(event)) {
        throw new Error('Unauthorized IPC sender');
      }
      if (!isValidSavePath(filePath, ALLOWED_SAVE_DIRS)) {
        throw new Error(`Invalid save path: ${filePath}`);
      }

      const tmpPath = path.join(os.tmpdir(), `supahscreenrecordah-review-export-${Date.now()}.mp4`);

      try {
        // Write buffer to temp file
        await fs.promises.writeFile(tmpPath, Buffer.from(buffer));

        // Cut segments if there are actual cuts (more than 1 keep-segment)
        if (keepSegments.length > 1) {
          const cutSuccess = await cutSilenceRegions(tmpPath, keepSegments);
          if (!cutSuccess) {
            console.warn('[review-export] Silence cut failed — exporting without cuts.');
          }
        }

        // Post-process (audio enhancement)
        const config = getConfig();
        await postProcessRecording(tmpPath, config.overlay?.progressBar);

        // Move result to user's chosen path
        await fs.promises.copyFile(tmpPath, filePath);
        console.log('[review-export] Export complete:', filePath);
      } catch (err) {
        console.error('[review-export] Failed:', err);
        throw err;
      } finally {
        // Clean up temp file
        try {
          await fs.promises.unlink(tmpPath);
        } catch {
          // ignore
        }
      }
    },
  );

  // --- Analyze recording for review timeline --------------------------------
  ipcMain.handle(Channels.REVIEW_ANALYZE, async (event) => {
    if (!isValidSender(event)) {
      throw new Error('Unauthorized IPC sender');
    }

    const videoPath = getPlaybackTempFile();
    if (!videoPath) {
      throw new Error('No playback file available for analysis');
    }

    console.log('[review] Starting analysis for:', videoPath);

    // Run waveform extraction and transcription in parallel
    const [waveform, words] = await Promise.all([
      extractWaveform(videoPath),
      transcribeWithWhisper(videoPath),
    ]);

    console.log('[review] Waveform samples:', waveform.samples.length, 'duration:', waveform.duration);
    console.log('[review] Transcribed words:', words.length);

    // Detect silences and fillers from transcribed words
    let segments: ReviewSegment[] = [];
    if (words.length > 0) {
      const silences = detectSilences(words, 1500, 150);
      const fillers = detectFillers(words);
      const allRegions = [...silences, ...fillers];
      console.log('[review] Detected silences:', silences.length, 'fillers:', fillers.length);
      segments = buildSegments(allRegions, waveform.duration);
    }

    const result: ReviewAnalysisResult = { waveform, segments, words };
    return result;
  });
}
