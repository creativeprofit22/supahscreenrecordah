import { ipcMain, dialog } from 'electron';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Channels } from '../../shared/channels';
import { findFfmpeg } from '../services/dependencies';
import { FFMPEG_EXEC_OPTIONS_SHORT } from '../services/ffmpeg';
import { isValidSender } from './helpers';

let playbackTempFile: string | null = null;

export function registerPlaybackHandlers(): void {
  // MediaRecorder produces fragmented MP4 (fMP4) which Chromium's <video>
  // element can't play smoothly from a blob URL (only keyframes display,
  // giving ~2fps). We remux the raw blob to a temp file with faststart
  // so the moov atom is at the front and the video plays normally.
  ipcMain.handle(Channels.RECORDING_PREPARE_PLAYBACK, async (event, buffer: ArrayBuffer) => {
    if (!isValidSender(event)) {
      throw new Error('Unauthorized IPC sender');
    }
    // Clean up any previous temp file
    if (playbackTempFile) {
      try {
        await fs.promises.unlink(playbackTempFile);
      } catch {
        // ignore
      }
      playbackTempFile = null;
    }

    // Detect container format from the buffer header to use correct extension.
    // WebM starts with 0x1A45DFA3 (EBML header), MP4 has 'ftyp' at offset 4.
    const headerView = new Uint8Array(buffer, 0, 12);
    const isWebM =
      headerView[0] === 0x1a &&
      headerView[1] === 0x45 &&
      headerView[2] === 0xdf &&
      headerView[3] === 0xa3;

    const rawExt = isWebM ? 'webm' : 'mp4';
    const rawPath = path.join(os.tmpdir(), `supahscreenrecordah-raw-${Date.now()}.${rawExt}`);
    const remuxedPath = path.join(os.tmpdir(), `supahscreenrecordah-playback-${Date.now()}.mp4`);

    await fs.promises.writeFile(rawPath, Buffer.from(buffer));

    const ffmpegPath = await findFfmpeg();
    if (ffmpegPath) {
      // Re-encode the video — stream copy isn't enough because the avc3
      // stream from MediaRecorder has broken frame timing that causes
      // Chromium to only display keyframes (~2fps).
      // Use ultrafast preset for speed; this is just for preview playback.
      // For WebM inputs from captureStream(0) with manual requestFrame(),
      // timestamps may be broken — use -fflags +genpts to regenerate them
      // and -vsync cfr to force constant frame rate output.
      const result = await new Promise<{ success: boolean; stderr: string }>((resolve) => {
        execFile(
          ffmpegPath,
          [
            '-fflags',
            '+genpts',
            '-i',
            rawPath,
            '-c:v',
            'libx264',
            '-preset',
            'ultrafast',
            '-crf',
            '18',
            '-r',
            '30',
            '-fps_mode',
            'cfr',
            '-af',
            'aresample=async=1000:first_pts=0',
            '-c:a',
            'aac',
            '-b:a',
            '192k',
            '-movflags',
            '+faststart',
            '-y',
            remuxedPath,
          ],
          FFMPEG_EXEC_OPTIONS_SHORT,
          (error, _stdout, stderr) => {
            if (error) {
              console.error('[preparePlayback] FFmpeg re-encode error:', error.message);
            }
            resolve({ success: !error, stderr });
          },
        );
      });

      if (result.success) {
        try {
          await fs.promises.unlink(rawPath);
        } catch {
          // ignore
        }
        playbackTempFile = remuxedPath;
        return remuxedPath;
      }
      console.warn('[preparePlayback] FFmpeg re-encode failed, falling back to raw file');
    }

    // Fallback: use raw file directly (may still stutter but better than blob)
    try {
      await fs.promises.unlink(remuxedPath);
    } catch {
      // ignore
    }
    playbackTempFile = rawPath;
    return rawPath;
  });

  ipcMain.handle(Channels.RECORDING_CLEANUP_PLAYBACK, async (event) => {
    if (!isValidSender(event)) {
      throw new Error('Unauthorized IPC sender');
    }
    if (playbackTempFile) {
      try {
        await fs.promises.unlink(playbackTempFile);
      } catch {
        // ignore
      }
      playbackTempFile = null;
    }
  });

  ipcMain.handle(Channels.RECORDING_EXPORT, async (event) => {
    if (!isValidSender(event)) {
      throw new Error('Unauthorized IPC sender');
    }
    const result = await dialog.showSaveDialog({
      title: 'Export Recording',
      defaultPath: `recording-${Date.now()}.mp4`,
      filters: [
        { name: 'MP4 Video', extensions: ['mp4'] },
        { name: 'WebM Video', extensions: ['webm'] },
      ],
    });
    return result.filePath ?? '';
  });
}
