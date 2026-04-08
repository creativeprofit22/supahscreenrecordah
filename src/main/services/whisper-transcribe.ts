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

/**
 * Merge whisper tokens into words.
 * Tokens starting with a space begin a new word; others append to the current word.
 */
function mergeTokensToWords(data: WhisperJson): TranscribedWord[] {
  const words: TranscribedWord[] = [];

  for (const segment of data.transcription) {
    let currentText = '';
    let currentStart = 0;
    let currentEnd = 0;

    for (const token of segment.tokens) {
      const text = token.text;
      // Skip empty/whitespace-only tokens
      if (!text || text.trim() === '') continue;

      if (text.startsWith(' ')) {
        // Flush previous word if any
        if (currentText) {
          words.push({
            text: currentText,
            start: currentStart / 1000,
            end: currentEnd / 1000,
            confidence: 1.0,
          });
        }
        // Start new word (strip leading space)
        currentText = text.trimStart();
        currentStart = token.offsets.from;
        currentEnd = token.offsets.to;
      } else {
        if (!currentText) {
          // First token in segment (no leading space)
          currentText = text;
          currentStart = token.offsets.from;
          currentEnd = token.offsets.to;
        } else {
          // Continuation of current word
          currentText += text;
          currentEnd = token.offsets.to;
        }
      }
    }

    // Flush last word in segment
    if (currentText) {
      words.push({
        text: currentText,
        start: currentStart / 1000,
        end: currentEnd / 1000,
        confidence: 1.0,
      });
    }
  }

  return words;
}
