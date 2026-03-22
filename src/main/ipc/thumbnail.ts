import { ipcMain, app } from 'electron';
import fs from 'fs';
import path from 'path';
import { Channels } from '../../shared/channels';
import type {
  ThumbnailGenerateRequest,
  ThumbnailSaveRequest,
  ExportPlatform,
} from '../../shared/types';
import { EXPORT_PRESETS } from '../../shared/feature-types';
import { isValidSavePath } from '../../shared/paths';
import {
  getThumbnailWindow,
  getThumbnailPayload,
  closeThumbnailWindow,
} from '../windows/thumbnail-window';
import { generateThumbnail, extractKeyFrames } from '../services/thumbnail';
import { isValidSender } from './helpers';

// Allowed directories for thumbnail file operations
const ALLOWED_DIRS = [
  app.getPath('home'),
  app.getPath('desktop'),
  app.getPath('documents'),
  app.getPath('temp'),
];

function sendProgress(
  stage: 'extracting' | 'generating' | 'saving' | 'done' | 'error',
  message: string,
  platform?: ExportPlatform,
): void {
  const win = getThumbnailWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(Channels.THUMBNAIL_PROGRESS, { stage, message, platform });
  }
}

export function registerThumbnailHandlers(): void {
  // Return the init payload set when the window was created
  ipcMain.handle(Channels.THUMBNAIL_OPEN, (event) => {
    if (!isValidSender(event)) {
      throw new Error('Unauthorized IPC sender');
    }
    return getThumbnailPayload();
  });

  // Extract key frames from the video
  ipcMain.handle(Channels.THUMBNAIL_EXTRACT_FRAMES, async (event, videoPath: string) => {
    if (!isValidSender(event)) {
      throw new Error('Unauthorized IPC sender');
    }
    if (!isValidSavePath(videoPath, ALLOWED_DIRS)) {
      throw new Error(`Invalid video path: ${videoPath}`);
    }
    try {
      sendProgress('extracting', 'Extracting key frames from video…');
      const frames = await extractKeyFrames(videoPath, 5);
      return frames;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendProgress('error', `Frame extraction failed: ${msg}`);
      return [];
    }
  });

  // Generate a single AI thumbnail for a given aspect ratio + prompt
  ipcMain.handle(
    Channels.THUMBNAIL_GENERATE,
    async (event, request: ThumbnailGenerateRequest) => {
      if (!isValidSender(event)) {
        throw new Error('Unauthorized IPC sender');
      }
      const { prompt, aspectRatio, platform } = request;
      try {
        sendProgress('generating', `Generating thumbnail for ${EXPORT_PRESETS[platform].label}…`, platform);
        const imagePath = await generateThumbnail(prompt, aspectRatio, '');
        sendProgress('done', `Thumbnail ready for ${EXPORT_PRESETS[platform].label}`, platform);
        return imagePath;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendProgress('error', `Generation failed: ${msg}`, platform);
        throw err;
      }
    },
  );

  // Save selected thumbnails next to the video file
  ipcMain.handle(Channels.THUMBNAIL_SAVE, async (event, request: ThumbnailSaveRequest) => {
    if (!isValidSender(event)) {
      throw new Error('Unauthorized IPC sender');
    }
    const { videoPath, selections } = request;

    // Validate videoPath is within allowed directories
    if (!isValidSavePath(videoPath, ALLOWED_DIRS)) {
      throw new Error(`Invalid video path: ${videoPath}`);
    }

    // Validate each selection's imagePath
    for (const sel of selections) {
      const resolvedImagePath = path.resolve(sel.imagePath);
      if (!isValidSavePath(resolvedImagePath, ALLOWED_DIRS)) {
        throw new Error(`Invalid image path: ${sel.imagePath}`);
      }
    }

    const videoDir = path.dirname(videoPath);
    const videoBaseName = path.basename(videoPath, path.extname(videoPath));
    const thumbDir = path.join(videoDir, 'thumbnails');
    await fs.promises.mkdir(thumbDir, { recursive: true });

    sendProgress('saving', 'Saving thumbnails…');

    const savedPaths: string[] = [];
    for (const sel of selections) {
      const aspectSafe = sel.aspectRatio.replace(':', 'x');
      const destName = `${videoBaseName}_${sel.platform}_${aspectSafe}.png`;
      const destPath = path.join(thumbDir, destName);

      await fs.promises.copyFile(sel.imagePath, destPath);
      savedPaths.push(destPath);
    }

    sendProgress('done', `Saved ${savedPaths.length} thumbnail(s)`);
    closeThumbnailWindow();
    return savedPaths;
  });

  // User skips thumbnails
  ipcMain.on(Channels.THUMBNAIL_SKIP, (event) => {
    if (!isValidSender(event)) return;
    closeThumbnailWindow();
  });

  // Close the thumbnail window
  ipcMain.on(Channels.THUMBNAIL_CLOSE, (event) => {
    if (!isValidSender(event)) return;
    closeThumbnailWindow();
  });
}
