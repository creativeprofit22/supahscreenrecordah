// Music IPC handlers — library CRUD, waveform extraction, mix export
// ---------------------------------------------------------------------------

import { ipcMain, dialog } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Channels } from '../../shared/channels';
import { isValidSender } from './helpers';
import { loadLibrary, addTrack, removeTrack, setLastTrack, setLastVolume } from '../services/music-library';
import { extractWaveform } from '../services/waveform';
import { mixMusic } from '../services/ffmpeg/music-mix';
import type { MusicMixOptions } from '../../shared/music-types';

/** Get the duration of an audio file via the waveform extractor (uses FFmpeg). */
async function getAudioDuration(filePath: string): Promise<number> {
  // extractWaveform already returns duration — reuse it
  const wf = await extractWaveform(filePath, 10); // minimal samples, we only want duration
  return wf.duration;
}

export function registerMusicHandlers(): void {
  // --- Library ---

  ipcMain.handle(Channels.MUSIC_GET_LIBRARY, (event) => {
    if (!isValidSender(event)) return null;
    return loadLibrary();
  });

  ipcMain.handle(Channels.MUSIC_ADD_TRACK, async (event, filePath: string) => {
    if (!isValidSender(event)) return null;
    const duration = await getAudioDuration(filePath);
    const track = addTrack(filePath, duration);
    return track;
  });

  ipcMain.handle(Channels.MUSIC_REMOVE_TRACK, (event, trackId: string) => {
    if (!isValidSender(event)) return;
    removeTrack(trackId);
  });

  ipcMain.handle(Channels.MUSIC_SET_LAST_TRACK, (event, trackId: string | null) => {
    if (!isValidSender(event)) return;
    setLastTrack(trackId);
  });

  ipcMain.handle(Channels.MUSIC_SET_LAST_VOLUME, (event, volume: number) => {
    if (!isValidSender(event)) return;
    setLastVolume(volume);
  });

  // --- File picker ---

  ipcMain.handle(Channels.MUSIC_PICK_FILE, async (event) => {
    if (!isValidSender(event)) return null;
    const result = await dialog.showOpenDialog({
      title: 'Select Music Track',
      filters: [
        { name: 'Audio', extensions: ['mp3', 'wav', 'aac', 'ogg', 'flac', 'm4a', 'wma'] },
      ],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(Channels.MUSIC_PICK_VIDEO, async (event) => {
    if (!isValidSender(event)) return null;
    const result = await dialog.showOpenDialog({
      title: 'Select Video',
      filters: [
        { name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'] },
      ],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // --- Waveform ---

  ipcMain.handle(Channels.MUSIC_GET_WAVEFORM, async (event, filePath: string) => {
    if (!isValidSender(event)) return { samples: [], duration: 0 };
    return extractWaveform(filePath, 800);
  });

  // --- Read file as ArrayBuffer (bypasses CSP for file:// URLs) ---

  ipcMain.handle(Channels.MUSIC_READ_FILE, async (event, filePath: string) => {
    if (!isValidSender(event)) return null;
    try {
      const buffer = await fs.promises.readFile(filePath);
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    } catch {
      return null;
    }
  });

  // --- Mix export ---

  ipcMain.handle(Channels.MUSIC_MIX_EXPORT, async (event, opts: MusicMixOptions) => {
    if (!isValidSender(event)) return null;

    // Write the mix to a sibling file named "<stem>.music.mp4" so the
    // original edited video is never overwritten. If a crash or power loss
    // interrupts ffmpeg mid-write, the source file is still intact.
    const dir = path.dirname(opts.videoPath);
    const ext = path.extname(opts.videoPath) || '.mp4';
    const stem = path.basename(opts.videoPath, ext);
    let finalOutput = path.join(dir, `${stem}.music${ext}`);
    let suffix = 2;
    while (fs.existsSync(finalOutput)) {
      finalOutput = path.join(dir, `${stem}.music-${suffix}${ext}`);
      suffix++;
    }

    // ffmpeg writes to a temp file in the OS temp dir first, then we move
    // it into place atomically — keeps partial writes out of the output dir.
    const tmpOutput = path.join(os.tmpdir(), `supahscreenrecordah-music-mix-${Date.now()}.mp4`);
    try {
      await mixMusic({ ...opts, outputPath: tmpOutput });
      await fs.promises.copyFile(tmpOutput, finalOutput);
    } finally {
      try { await fs.promises.unlink(tmpOutput); } catch { /* ignore */ }
    }
    return finalOutput;
  });
}
