import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { promisify } from 'util';
import { findWhisper, findWhisperModel } from './whisper';
import { findFfmpeg } from './dependencies';
import { FFMPEG_EXEC_OPTIONS } from './ffmpeg/encode';
import type { TranscribedWord } from './assemblyai/types';

const execFileAsync = promisify(execFile);

interface WhisperToken {
  text: string;
  offsets: { from: number; to: number };
}

interface WhisperSegment {
  text: string;
  offsets: { from: number; to: number };
  tokens: WhisperToken[];
}

interface WhisperJson {
  transcription: WhisperSegment[];
}

/**
 * Transcribe a video file using local whisper.cpp.
 * Returns an empty array (no throw) if binaries/model are missing.
 */
export async function transcribeWithWhisper(videoPath: string): Promise<TranscribedWord[]> {
  const whisperBin = await findWhisper();
  if (!whisperBin) {
    console.warn('[whisper-transcribe] whisper-cli binary not found — skipping transcription');
    return [];
  }

  const modelPath = await findWhisperModel();
  if (!modelPath) {
    console.warn('[whisper-transcribe] whisper model (ggml-base.bin) not found — skipping transcription');
    return [];
  }

  const ffmpegBin = await findFfmpeg();
  if (!ffmpegBin) {
    console.warn('[whisper-transcribe] ffmpeg not found — skipping transcription');
    return [];
  }

  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'whisper-'));
  const wavPath = path.join(tmpDir, 'audio.wav');
  const outputBase = path.join(tmpDir, 'output');
  const jsonPath = outputBase + '.json';

  try {
    // Extract 16kHz mono WAV from video
    await execFileAsync(
      ffmpegBin,
      ['-i', videoPath, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-y', wavPath],
      FFMPEG_EXEC_OPTIONS,
    );

    // Run whisper with full JSON output (word-level tokens)
    await execFileAsync(
      whisperBin,
      ['-m', modelPath, '-f', wavPath, '-ojf', '-of', outputBase, '-l', 'en', '-np'],
      { timeout: 600_000, maxBuffer: 50 * 1024 * 1024 },
    );

    // Parse whisper JSON output
    const raw = await fs.promises.readFile(jsonPath, 'utf-8');
    const data: WhisperJson = JSON.parse(raw);

    return mergeTokensToWords(data);
  } catch (err) {
    console.warn('[whisper-transcribe] transcription failed:', err);
    return [];
  } finally {
    // Clean up temp files
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Max realistic duration for a single spoken word (seconds). */
const MAX_WORD_DURATION = 0.9;

/** whisper.cpp special tokens to filter out */
const SPECIAL_TOKEN_RE = /^\[_[A-Z]+_?\]$|^\[_TT_\d+\]$/;

/**
 * Merge whisper tokens into words.
 * Tokens starting with a space begin a new word; others append to the current word.
 * Filters special tokens, clamps inflated word durations, and strips trailing punctuation
 * from the text used for filler detection.
 */
function mergeTokensToWords(data: WhisperJson): TranscribedWord[] {
  const raw: TranscribedWord[] = [];

  for (const segment of data.transcription) {
    let currentText = '';
    let currentStart = 0;
    let currentEnd = 0;

    for (const token of segment.tokens) {
      const text = token.text;
      // Skip empty/whitespace-only tokens
      if (!text || text.trim() === '') continue;

      // Skip special whisper tokens like [_BEG_], [_TT_420]
      const trimmed = text.trim();
      if (SPECIAL_TOKEN_RE.test(trimmed)) continue;
      // Also filter tokens that contain special tokens appended to words (e.g. "are.[_TT_540]")
      const cleanedToken = trimmed.replace(/\[_[A-Z_]+\d*\]/g, '').trim();
      if (!cleanedToken) continue;

      if (text.startsWith(' ')) {
        // Flush previous word if any
        if (currentText) {
          raw.push({
            text: currentText,
            start: currentStart / 1000,
            end: currentEnd / 1000,
            confidence: 1.0,
          });
        }
        // Start new word (strip leading space)
        currentText = cleanedToken.startsWith(' ') ? cleanedToken.trimStart() : cleanedToken;
        currentStart = token.offsets.from;
        currentEnd = token.offsets.to;
      } else {
        if (!currentText) {
          currentText = cleanedToken;
          currentStart = token.offsets.from;
          currentEnd = token.offsets.to;
        } else {
          currentText += cleanedToken;
          currentEnd = token.offsets.to;
        }
      }
    }

    // Flush last word in segment
    if (currentText) {
      raw.push({
        text: currentText,
        start: currentStart / 1000,
        end: currentEnd / 1000,
        confidence: 1.0,
      });
    }
  }

  // Clamp inflated word durations — whisper often stretches word end times
  // to fill silence gaps. Cap each word to MAX_WORD_DURATION so the gap
  // detection can find the real silences.
  const clamped: TranscribedWord[] = [];
  for (const w of raw) {
    const duration = w.end - w.start;
    if (duration > MAX_WORD_DURATION) {
      clamped.push({ ...w, end: w.start + MAX_WORD_DURATION });
    } else {
      clamped.push(w);
    }
  }

  return clamped;
}
