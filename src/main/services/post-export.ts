import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { clipboard, Notification } from 'electron';
import { findFfmpeg } from './dependencies';
import { VIDEO_ENCODE_FLAGS, FFMPEG_EXEC_OPTIONS } from './ffmpeg';
import { transcribe } from './assemblyai';
import { generateASS, type CaptionOptions } from './assemblyai/captions';
import { detectSilences, detectFillers, buildCutSegments, adjustWordsForCuts } from './assemblyai/silence';
import { formatYouTubeChapters, adjustChaptersForCuts, type Chapter } from './assemblyai/chapters';
import { cutSilenceRegions } from './ffmpeg/silence-cut';
import type { TranscriptResult } from './assemblyai/types';
import type { SilenceRegion } from './assemblyai/types';
import type { CaptionConfig, SilenceRemovalConfig, AspectRatio } from '../../shared/feature-types';
import { ASPECT_RATIOS } from '../../shared/feature-types';
import { Channels } from '../../shared/channels';
import { getToolbarWindow } from '../windows/toolbar-window';

export type CaptionStage = 'uploading' | 'transcribing' | 'generating' | 'burning' | 'done';

/** Send caption progress updates to the toolbar window. */
function sendCaptionProgress(stage: CaptionStage): void {
  const toolbar = getToolbarWindow();
  if (toolbar && !toolbar.isDestroyed()) {
    toolbar.webContents.send(Channels.CAPTION_PROGRESS, stage);
  }
  console.log(`[captions] Stage: ${stage}`);
}

/** Build CaptionOptions from user CaptionConfig and aspect ratio. */
function buildCaptionOptions(config: CaptionConfig, aspectRatio: AspectRatio): CaptionOptions {
  const { width, height } = ASPECT_RATIOS[aspectRatio];

  const options: CaptionOptions = {
    position: config.position,
    fontSize: config.fontSize,
    resolution: { width, height },
    maxWordsPerGroup: 4,
    powerWords: config.powerWords ? undefined : {},
  };

  switch (config.style) {
    case 'minimal':
      options.style = {
        font: 'Arial',
        size: config.fontSize,
        color: '&HFFFFFF&',
        outlineColor: '&H000000&',
        bold: false,
        outlineWidth: 2,
        shadowDepth: 1,
        alignment: 2, // bottom-center
      };
      options.position = 'bottom';
      break;

    case 'bold':
      options.style = {
        font: 'Arial',
        size: Math.round(config.fontSize * 1.3),
        color: '&HFFFFFF&',
        outlineColor: '&H000000&',
        bold: true,
        outlineWidth: 6,
        shadowDepth: 3,
        alignment: 5, // center
      };
      options.position = 'center';
      break;

    case 'viral':
      // Power word colorization enabled, center-positioned
      options.style = {
        font: 'Arial',
        size: Math.round(config.fontSize * 1.2),
        color: '&HFFFFFF&',
        outlineColor: '&H000000&',
        bold: true,
        outlineWidth: 5,
        shadowDepth: 2,
        alignment: 5, // center
      };
      options.position = 'center';
      // For viral style, always enable power words regardless of config toggle
      options.powerWords = undefined; // uses built-in POWER_WORDS
      break;
  }

  return options;
}

/** Burn ASS subtitles into a video using FFmpeg. */
function burnSubtitles(
  ffmpegPath: string,
  videoPath: string,
  assPath: string,
  outputPath: string,
): Promise<{ success: boolean; stderr: string }> {
  // Escape backslashes and colons in the ASS path for the FFmpeg filter
  const escapedAssPath = assPath
    .replace(/\\/g, '\\\\\\\\')
    .replace(/:/g, '\\:');

  return new Promise((resolve) => {
    execFile(
      ffmpegPath,
      [
        '-i', videoPath,
        ...VIDEO_ENCODE_FLAGS,
        '-vf', `ass=${escapedAssPath}`,
        '-c:a', 'copy',
        '-movflags', '+faststart',
        '-y', outputPath,
      ],
      FFMPEG_EXEC_OPTIONS,
      (error, _stdout, stderr) => {
        resolve({ success: !error, stderr });
      },
    );
  });
}

/**
 * Process chapters from a transcript: adjust for cuts, format, copy to clipboard, save file, notify UI.
 */
function processChapters(
  transcript: TranscriptResult,
  videoPath: string,
  cutRegions: SilenceRegion[],
): void {
  if (!transcript.chapters || transcript.chapters.length === 0) {
    console.log('[chapters] No chapters returned by AssemblyAI.');
    return;
  }

  let chapters: Chapter[] = transcript.chapters;

  // Adjust chapter timestamps if silences were cut
  if (cutRegions.length > 0) {
    chapters = adjustChaptersForCuts(chapters, cutRegions);
    console.log(`[chapters] Adjusted ${chapters.length} chapters for trimmed timeline.`);
  }

  // Format as YouTube timestamps
  const youtubeChapters = formatYouTubeChapters(chapters);

  // Copy to clipboard
  clipboard.writeText(youtubeChapters);
  console.log(`[chapters] Copied ${chapters.length} chapters to clipboard.`);

  // Save alongside video as .chapters.txt
  const chaptersPath = videoPath.replace(/\.[^.]+$/, '.chapters.txt');
  try {
    fs.writeFileSync(chaptersPath, youtubeChapters, 'utf-8');
    console.log(`[chapters] Saved chapters to: ${chaptersPath}`);
  } catch (err) {
    console.warn('[chapters] Failed to save chapters file:', err);
  }

  // Show notification
  if (Notification.isSupported()) {
    new Notification({
      title: 'Chapters Ready',
      body: 'Chapters copied to clipboard!',
    }).show();
  }

  // Send chapters to UI for review
  const toolbar = getToolbarWindow();
  if (toolbar && !toolbar.isDestroyed()) {
    toolbar.webContents.send(Channels.CHAPTERS_READY, chapters);
  }
}

/**
 * Combined post-export pipeline: silence removal + captions + chapters.
 *
 * Shares a single transcription when both features are enabled.
 * Order: transcribe → cut silences → adjust timestamps → burn captions → process chapters.
 */
export async function processWithSilenceAndCaptions(
  videoPath: string,
  silenceConfig: SilenceRemovalConfig | undefined,
  captionConfig: CaptionConfig | undefined,
  aspectRatio: AspectRatio,
): Promise<string> {
  const needSilence = silenceConfig?.enabled ?? false;
  const needCaptions = captionConfig?.enabled ?? false;

  if (!needSilence && !needCaptions) {
    return videoPath;
  }

  // Both features need a transcript — transcribe once
  let transcript: TranscriptResult | null = null;

  if (needSilence || needCaptions) {
    try {
      sendCaptionProgress('uploading');
      sendCaptionProgress('transcribing');
      transcript = await transcribe(videoPath);

      if (!transcript.words || transcript.words.length === 0) {
        console.warn('[post-export] No words transcribed — skipping silence/caption processing.');
        sendCaptionProgress('done');
        return videoPath;
      }

      console.log(`[post-export] Transcript: ${transcript.words.length} words, ${transcript.duration.toFixed(1)}s`);
    } catch (err) {
      console.error('[post-export] Transcription failed:', err);
      sendCaptionProgress('done');
      return videoPath;
    }
  }

  // Step 1: Silence removal (runs BEFORE captions so captions align to trimmed video)
  let cutRegions: SilenceRegion[] = [];
  let adjustedWords = transcript!.words;

  if (needSilence && transcript) {
    sendCaptionProgress('uploading'); // repurpose as "Removing silences..."
    console.log('[post-export] Detecting silences and fillers…');

    const silences = detectSilences(
      transcript.words,
      silenceConfig!.minSilenceMs,
      silenceConfig!.keepPaddingMs,
    );

    const fillers = silenceConfig!.removeFillers ? detectFillers(transcript.words) : [];

    cutRegions = [...silences, ...fillers];

    if (cutRegions.length > 0) {
      const keepSegments = buildCutSegments(cutRegions, transcript.duration);
      const totalCut = cutRegions.reduce((sum, r) => sum + (r.end - r.start), 0);

      console.log(
        `[post-export] Found ${silences.length} silences + ${fillers.length} fillers — ` +
        `cutting ${totalCut.toFixed(1)}s, keeping ${keepSegments.length} segments`,
      );

      const cutSuccess = await cutSilenceRegions(videoPath, keepSegments);

      if (cutSuccess) {
        // Adjust word timestamps for the trimmed video
        adjustedWords = adjustWordsForCuts(transcript.words, cutRegions);
        console.log(`[post-export] Adjusted ${adjustedWords.length} words for trimmed timeline.`);
      } else {
        console.warn('[post-export] Silence cut failed — proceeding with original timestamps.');
        cutRegions = [];
        adjustedWords = transcript.words;
      }
    } else {
      console.log('[post-export] No silences or fillers detected.');
    }
  }

  // Step 2: Caption burn-in (uses adjusted timestamps if silences were cut)
  if (needCaptions && captionConfig && adjustedWords.length > 0) {
    const ffmpegPath = await findFfmpeg();
    if (!ffmpegPath) {
      console.warn('[post-export] FFmpeg not found — skipping caption burn-in.');
      sendCaptionProgress('done');
      return videoPath;
    }

    try {
      sendCaptionProgress('generating');
      const captionOptions = buildCaptionOptions(captionConfig, aspectRatio);
      const assContent = generateASS(adjustedWords, captionOptions);

      const assPath = path.join(os.tmpdir(), `supahscreenrecordah-captions-${Date.now()}.ass`);
      await fs.promises.writeFile(assPath, assContent, 'utf-8');
      console.log(`[post-export] Generated ASS file: ${assPath} (${adjustedWords.length} words)`);

      sendCaptionProgress('burning');
      const tmpOutput = path.join(os.tmpdir(), `supahscreenrecordah-captioned-${Date.now()}.mp4`);
      const result = await burnSubtitles(ffmpegPath, videoPath, assPath, tmpOutput);

      try {
        await fs.promises.unlink(assPath);
      } catch {
        // ignore
      }

      if (result.success) {
        try {
          await fs.promises.copyFile(tmpOutput, videoPath);
          await fs.promises.unlink(tmpOutput);
        } catch (copyErr) {
          console.warn('[post-export] Failed to replace original with captioned file:', copyErr);
          try {
            await fs.promises.unlink(tmpOutput);
          } catch {
            // ignore
          }
        }
      } else {
        console.warn('[post-export] FFmpeg subtitle burn-in failed.');
        if (result.stderr) {
          console.warn('[post-export] FFmpeg stderr (tail):', result.stderr.slice(-500));
        }
        try {
          await fs.promises.unlink(tmpOutput);
        } catch {
          // ignore
        }
      }
    } catch (err) {
      console.error('[post-export] Caption burn-in failed:', err);
    }
  }

  // Step 3: Process chapters (reuses the same transcript)
  if (transcript) {
    processChapters(transcript, videoPath, cutRegions);
  }

  sendCaptionProgress('done');
  return videoPath;
}
