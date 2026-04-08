import { ipcMain, dialog, app } from 'electron';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Channels } from '../../shared/channels';
import { findFfmpeg } from '../services/dependencies';
import { FFMPEG_EXEC_OPTIONS_SHORT } from '../services/ffmpeg';
import { isValidSender } from './helpers';

let playbackTempFile: string | null = null;

/** Returns the current temp playback file path (used by review analysis). */
export function getPlaybackTempFile(): string | null {
  return playbackTempFile;
}

/** Persistent path for the last recording (survives app restarts). */
function getLastRecordingPath(): string {
  return path.join(app.getPath('userData'), 'last-recording.mp4');
}

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
        // Persist a copy so the last recording survives app restarts
        try {
          await fs.promises.copyFile(remuxedPath, getLastRecordingPath());
          console.log('[playback] Saved last recording to', getLastRecordingPath());
        } catch (copyErr) {
          console.warn('[playback] Failed to save last recording:', copyErr);
        }
        // Return the file contents as a buffer — Electron blocks file:// URLs
        // in renderer, so the renderer will create a blob URL instead.
        const fileBuffer = await fs.promises.readFile(remuxedPath);
        return fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength);
      }
      console.warn('[preparePlayback] FFmpeg re-encode failed, falling back to raw file');
    }

    // Fallback: return raw file as buffer (may still stutter but better than nothing)
    try {
      await fs.promises.unlink(remuxedPath);
    } catch {
      // ignore
    }
    playbackTempFile = rawPath;
    const rawBuffer = await fs.promises.readFile(rawPath);
    return rawBuffer.buffer.slice(rawBuffer.byteOffset, rawBuffer.byteOffset + rawBuffer.byteLength);
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

  // Check if a last recording exists (for recovery / re-review)
  ipcMain.handle(Channels.PLAYBACK_HAS_LAST_RECORDING, async (event) => {
    if (!isValidSender(event)) {
      throw new Error('Unauthorized IPC sender');
    }
    try {
      await fs.promises.access(getLastRecordingPath(), fs.constants.R_OK);
      const stat = await fs.promises.stat(getLastRecordingPath());
      return { exists: true, size: stat.size, modified: stat.mtimeMs };
    } catch {
      return { exists: false, size: 0, modified: 0 };
    }
  });

  // Load the last recording into playback mode
  ipcMain.handle(Channels.PLAYBACK_LOAD_LAST_RECORDING, async (event) => {
    if (!isValidSender(event)) {
      throw new Error('Unauthorized IPC sender');
    }
    const lastPath = getLastRecordingPath();
    try {
      await fs.promises.access(lastPath, fs.constants.R_OK);
    } catch {
      throw new Error('No last recording found');
    }
    // Copy to a temp file so cleanup doesn't delete the persistent copy
    const tmpPath = path.join(os.tmpdir(), `supahscreenrecordah-recovery-${Date.now()}.mp4`);
    await fs.promises.copyFile(lastPath, tmpPath);
    playbackTempFile = tmpPath;
    // Return the file contents as a buffer
    const fileBuffer = await fs.promises.readFile(tmpPath);
    return fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength);
  });
}
