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
import { findFfmpeg } from '../services/dependencies';
import { buildCaptionOptions, burnSubtitles } from '../services/post-export';
import { generateASS, generateSRT } from '../services/assemblyai/captions';
import { adjustWordsForCuts } from '../services/assemblyai/silence';
import { getConfig } from '../store';
import type { ReviewSegment, ReviewAnalysisResult } from '../../shared/review-types';
import type { SilenceRegion, TranscribedWord } from '../services/assemblyai/types';
import type { CaptionStylePreset } from '../../shared/feature-types';

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

  // Close short speech gaps (< 0.8s) between adjacent non-speech segments.
  // These are typically whisper timestamp imprecision, not real speech.
  // Extend the previous non-speech to meet the next one; keep them as separate segments.
  const closed: ReviewSegment[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const prev = closed[closed.length - 1];
    const next = segments[i + 1];
    if (
      seg.type === 'speech' &&
      (seg.end - seg.start) < 0.8 &&
      prev && prev.type !== 'speech' &&
      next && next.type !== 'speech'
    ) {
      // Bridge the gap: extend prev to the midpoint, start next from midpoint
      const mid = (seg.start + seg.end) / 2;
      prev.end = mid;
      next.start = mid;
      // Skip this short speech segment
    } else {
      closed.push(seg);
    }
  }

  return closed;
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
    async (event, { filePath, keepSegments, captionOptions }: {
      filePath: string;
      buffer: ArrayBuffer;
      keepSegments: Array<{ start: number; end: number }>;
      captionOptions?: {
        style: CaptionStylePreset;
        words: TranscribedWord[];
        resolution: { width: number; height: number };
        exportSrt?: boolean;
        yFraction?: number;
      };
    }) => {
      if (!isValidSender(event)) {
        throw new Error('Unauthorized IPC sender');
      }
      if (!isValidSavePath(filePath, ALLOWED_SAVE_DIRS)) {
        throw new Error(`Invalid save path: ${filePath}`);
      }

      console.log('[review-export] Keep segments from renderer:', keepSegments.map(s => `${s.start.toFixed(2)}-${s.end.toFixed(2)}`).join(', '));

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
        let didCut = false;
        if (keepSegments.length > 1) {
          const cutSuccess = await cutSilenceRegions(tmpPath, keepSegments);
          if (cutSuccess) {
            didCut = true;
          } else {
            console.warn('[review-export] Silence cut failed — exporting without cuts.');
          }
        }

        // Burn captions if requested
        let adjustedCaptionWords: TranscribedWord[] | null = null;
        if (captionOptions && captionOptions.words.length > 0) {
          // Adjust word timestamps for cuts
          adjustedCaptionWords = captionOptions.words;
          if (didCut) {
            const cutRegions: SilenceRegion[] = [];
            let pos = 0;
            for (const seg of keepSegments) {
              if (seg.start > pos) {
                cutRegions.push({ start: pos, end: seg.start, reason: 'silence' });
              }
              pos = seg.end;
            }
            adjustedCaptionWords = adjustWordsForCuts(captionOptions.words, cutRegions);
            console.log(`[review-export] Adjusted ${adjustedCaptionWords.length} words for trimmed captions (from ${captionOptions.words.length}).`);
          }

          const ffmpegPath = await findFfmpeg();
          if (ffmpegPath) {
            const { width, height } = captionOptions.resolution;
            const isVertical = height > width;
            const aspectRatio = isVertical ? '9:16' as const : '16:9' as const;

            const yFrac = captionOptions.yFraction ?? 0.5;
            // Map yFraction to ASS position: use alignment 5 (center) with marginV offset
            // marginV in ASS moves the subtitle from center when alignment=5
            // yFrac 0.5 → marginV 0, yFrac 0.3 → positive offset upward, yFrac 0.7 → negative (downward)
            const centerOffset = Math.round((0.5 - yFrac) * height);

            const captionConfig = {
              enabled: true,
              style: captionOptions.style,
              position: 'center' as const,
              fontSize: isVertical ? 72 : 48,
              powerWords: captionOptions.style === 'viral' || captionOptions.style === 'mrbeast',
            };

            const captionOpts = buildCaptionOptions(captionConfig, aspectRatio);
            captionOpts.resolution = { width, height };
            // Apply user's dragged Y position
            if (captionOpts.style) {
              captionOpts.style.marginV = Math.max(0, centerOffset);
              captionOpts.style.alignment = yFrac < 0.4 ? 8 : yFrac > 0.6 ? 2 : 5;
            }

            const assContent = generateASS(adjustedCaptionWords, captionOpts);
            const assPath = path.join(os.tmpdir(), `supahscreenrecordah-review-captions-${Date.now()}.ass`);
            await fs.promises.writeFile(assPath, assContent, 'utf-8');
            console.log(`[review-export] Generated ASS: ${adjustedCaptionWords.length} words, style: ${captionOptions.style}`);

            const captionTmp = path.join(os.tmpdir(), `supahscreenrecordah-review-captioned-${Date.now()}.mp4`);
            const result = await burnSubtitles(ffmpegPath, tmpPath, assPath, captionTmp);

            try { await fs.promises.unlink(assPath); } catch { /* ignore */ }

            if (result.success) {
              await fs.promises.copyFile(captionTmp, tmpPath);
              await fs.promises.unlink(captionTmp);
              console.log('[review-export] Captions burned successfully.');
            } else {
              console.warn('[review-export] Caption burn failed:', result.stderr?.slice(-300));
              try { await fs.promises.unlink(captionTmp); } catch { /* ignore */ }
            }
          } else {
            console.warn('[review-export] FFmpeg not found — skipping captions.');
          }
        }

        // Post-process (audio enhancement)
        const config = getConfig();
        await postProcessRecording(tmpPath, config.overlay?.progressBar);

        // Move result to user's chosen path
        await fs.promises.copyFile(tmpPath, filePath);
        console.log('[review-export] Export complete:', filePath);

        // Write SRT file alongside video if requested
        if (captionOptions?.exportSrt && adjustedCaptionWords && adjustedCaptionWords.length > 0) {
          const srtPath = filePath.replace(/\.[^.]+$/, '.srt');
          const srtContent = generateSRT(adjustedCaptionWords);
          await fs.promises.writeFile(srtPath, srtContent, 'utf-8');
          console.log('[review-export] SRT file written:', srtPath);
        }
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
