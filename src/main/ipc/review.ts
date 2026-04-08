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
import { findWhisper, findWhisperModel, installWhisper, installWhisperModel } from '../services/whisper';
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

  // Sort regions by start time, then deduplicate overlapping regions.
  // Filler takes precedence over silence when they overlap.
  const sorted = [...regions].sort((a, b) => a.start - b.start);
  const merged: SilenceRegion[] = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const cur = sorted[i];
    if (cur.start < last.end) {
      // Overlapping — extend the end, prefer filler type
      last.end = Math.max(last.end, cur.end);
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
    async (event, { filePath, keepSegments }: {
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

      // Use the remuxed playback file — same one whisper analyzed, so timestamps match
      const sourcePath = getPlaybackTempFile();
      if (!sourcePath) {
        throw new Error('No playback file available for export');
      }

      const tmpPath = path.join(os.tmpdir(), `supahscreenrecordah-review-export-${Date.now()}.mp4`);

      try {
        // Copy the remuxed source to a temp file for processing
        await fs.promises.copyFile(sourcePath, tmpPath);

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
    const logLines: string[] = [`[${new Date().toISOString()}] Analysis for: ${videoPath}`];

    // Run waveform extraction and transcription in parallel
    const [waveform, words] = await Promise.all([
      extractWaveform(videoPath),
      transcribeWithWhisper(videoPath),
    ]);

    logLines.push(`Waveform samples: ${waveform.samples.length}, duration: ${waveform.duration.toFixed(2)}s`);
    logLines.push(`Transcribed words: ${words.length}`);
    if (words.length > 0) {
      logLines.push('--- ALL WORDS ---');
      for (const w of words) {
        logLines.push(`  "${w.text}" ${w.start.toFixed(2)}-${w.end.toFixed(2)}`);
      }

      // Show gaps between words
      logLines.push('--- GAPS BETWEEN WORDS ---');
      for (let i = 0; i < words.length - 1; i++) {
        const gap = words[i + 1].start - words[i].end;
        if (gap > 0.3) {
          logLines.push(`  GAP ${gap.toFixed(2)}s after "${words[i].text}" (${words[i].end.toFixed(2)} - ${words[i + 1].start.toFixed(2)})`);
        }
      }
    }

    // Detect silences and fillers from transcribed words
    let segments: ReviewSegment[] = [];
    if (words.length > 0) {
      const silences = detectSilences(words, 500, 100);
      const fillers = detectFillers(words);
      const allRegions = [...silences, ...fillers];
      logLines.push(`Detected silences: ${silences.length}, fillers: ${fillers.length}`);
      logLines.push('--- SILENCE REGIONS ---');
      for (const s of silences) {
        logLines.push(`  ${s.start.toFixed(2)}-${s.end.toFixed(2)} (${(s.end - s.start).toFixed(2)}s)`);
      }
      logLines.push('--- FILLER REGIONS ---');
      for (const f of fillers) {
        const word = words.find(w => w.start <= f.start && w.end >= f.end);
        logLines.push(`  ${f.start.toFixed(2)}-${f.end.toFixed(2)} "${word?.text ?? '?'}"`);
      }
      segments = buildSegments(allRegions, waveform.duration);
      logLines.push('--- BUILT SEGMENTS ---');
      for (const s of segments) {
        logLines.push(`  ${s.type}: ${s.start.toFixed(2)}-${s.end.toFixed(2)} (enabled: ${s.enabled})`);
      }
    }

    // Write log to file
    const logPath = path.join(app.getPath('userData'), 'review-analysis.log');
    await fs.promises.writeFile(logPath, logLines.join('\n'), 'utf-8');
    console.log('[review] Analysis log written to', logPath);

    const result: ReviewAnalysisResult = { waveform, segments, words };
    return result;
  });

  // --- Check whisper availability -------------------------------------------
  ipcMain.handle(Channels.WHISPER_CHECK, async (event) => {
    if (!isValidSender(event)) {
      throw new Error('Unauthorized IPC sender');
    }
    const [binary, model] = await Promise.all([findWhisper(), findWhisperModel()]);
    return { binary: binary !== null, model: model !== null };
  });

  // --- Install whisper binary + model ----------------------------------------
  ipcMain.handle(Channels.WHISPER_INSTALL, async (event) => {
    if (!isValidSender(event)) {
      throw new Error('Unauthorized IPC sender');
    }
    const sendProgress = (progress: import('../../shared/activation-types').InstallProgress) => {
      event.sender.send(Channels.WHISPER_INSTALL_PROGRESS, progress);
    };

    const needsBinary = (await findWhisper()) === null;
    const needsModel = (await findWhisperModel()) === null;

    if (needsBinary) {
      await installWhisper(sendProgress);
    }
    if (needsModel) {
      await installWhisperModel(sendProgress);
    }
  });
}
