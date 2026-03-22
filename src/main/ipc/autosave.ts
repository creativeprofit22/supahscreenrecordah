import { ipcMain, app, dialog } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Channels } from '../../shared/channels';
import { isValidSender } from './helpers';
import { postProcessRecording, applyIntroOutro } from '../services/ffmpeg';
import { processWithSilenceAndCaptions } from '../services/post-export';
import { getConfig } from '../store';
import { ASPECT_RATIOS } from '../../shared/feature-types';

/** Prefix for recovery temp files */
const RECOVERY_PREFIX = 'supah-recovery-';

/** Path to the active recovery file (set when first chunk arrives) */
let activeRecoveryPath: string | null = null;

/** Get the active recovery file path (for external cleanup) */
export function getActiveRecoveryPath(): string | null {
  return activeRecoveryPath;
}

/** Find any existing recovery files in the temp directory */
function findRecoveryFiles(): string[] {
  try {
    const tmpDir = os.tmpdir();
    const entries = fs.readdirSync(tmpDir);
    return entries
      .filter((e) => e.startsWith(RECOVERY_PREFIX))
      .map((e) => path.join(tmpDir, e));
  } catch {
    return [];
  }
}

/** Delete a recovery file safely */
function deleteRecoveryFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log('[autosave] Deleted recovery file:', filePath);
    }
  } catch (err) {
    console.warn('[autosave] Failed to delete recovery file:', err);
  }
}

/**
 * Check for recovery files on startup and prompt the user.
 * Should be called after the app is ready and windows are created.
 */
export async function checkForRecoveryFiles(): Promise<void> {
  const recoveryFiles = findRecoveryFiles();
  if (recoveryFiles.length === 0) {
    return;
  }

  // Find the largest/most recent recovery file
  let bestFile: string | null = null;
  let bestSize = 0;
  for (const file of recoveryFiles) {
    try {
      const stat = fs.statSync(file);
      if (stat.size > bestSize) {
        bestSize = stat.size;
        bestFile = file;
      }
    } catch {
      // skip unreadable files
    }
  }

  if (!bestFile || bestSize === 0) {
    // All recovery files are empty — clean them up
    for (const file of recoveryFiles) {
      deleteRecoveryFile(file);
    }
    return;
  }

  const sizeMB = (bestSize / (1024 * 1024)).toFixed(1);
  const ext = path.extname(bestFile).slice(1).toUpperCase() || 'WebM';

  const result = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Save Recording', 'Discard'],
    defaultId: 0,
    cancelId: 1,
    title: 'Recording Recovered',
    message: `A recording (${sizeMB} MB, ${ext}) was recovered from a previous session.`,
    detail: 'Would you like to save it? The recovered file will go through the normal export processing.',
  });

  if (result.response === 0) {
    // User wants to save — show save dialog
    const saveResult = await dialog.showSaveDialog({
      title: 'Save Recovered Recording',
      defaultPath: path.join(
        app.getPath('documents'),
        `recovered-recording.${ext.toLowerCase()}`,
      ),
      filters: [
        { name: `${ext} Video`, extensions: [ext.toLowerCase()] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (saveResult.filePath) {
      try {
        // Copy recovery file to chosen location
        await fs.promises.copyFile(bestFile, saveResult.filePath);
        console.log('[autosave] Saved recovered recording to:', saveResult.filePath);

        // Run full post-processing pipeline on the saved file
        const config = getConfig();
        try {
          await postProcessRecording(saveResult.filePath, config.overlay?.progressBar);
          const aspectRatio = config.overlay?.aspectRatio ?? '16:9';
          await processWithSilenceAndCaptions(
            saveResult.filePath,
            config.silenceRemoval,
            config.caption,
            aspectRatio,
          );
          const introOutro = config.overlay?.introOutro;
          if (introOutro && (introOutro.introEnabled || introOutro.outroEnabled)) {
            const ar = ASPECT_RATIOS[aspectRatio] ?? ASPECT_RATIOS['16:9'];
            await applyIntroOutro(saveResult.filePath, introOutro, ar.width, ar.height, config.overlay?.bgColor ?? '#000000');
          }
          console.log('[autosave] Full post-processing complete for recovered recording');
        } catch (err) {
          console.warn('[autosave] Post-processing failed (raw file was saved):', err);
        }
      } catch (err) {
        console.error('[autosave] Failed to save recovered recording:', err);
        await dialog.showMessageBox({
          type: 'error',
          title: 'Save Failed',
          message: 'Failed to save the recovered recording.',
          detail: String(err),
        });
      }
    }
  }

  // Clean up all recovery files regardless of user choice
  for (const file of recoveryFiles) {
    deleteRecoveryFile(file);
  }
}

export function registerAutosaveHandlers(): void {
  // Receive a chunk of recording data and append to the recovery temp file
  ipcMain.handle(
    Channels.AUTOSAVE_CHUNK,
    async (event, { buffer, extension }: { buffer: ArrayBuffer; extension: string }) => {
      if (!isValidSender(event)) {
        throw new Error('Unauthorized IPC sender');
      }

      // Validate extension to prevent path traversal
      const allowedExtensions = ['webm', 'mp4'];
      if (!allowedExtensions.includes(extension)) {
        throw new Error(`Invalid recovery file extension: ${extension}`);
      }

      // Create the recovery file on first chunk
      if (!activeRecoveryPath) {
        const timestamp = Date.now();
        activeRecoveryPath = path.join(
          os.tmpdir(),
          `${RECOVERY_PREFIX}${timestamp}.${extension}`,
        );
        console.log('[autosave] Created recovery file:', activeRecoveryPath);
      }

      try {
        await fs.promises.appendFile(activeRecoveryPath, Buffer.from(buffer));
      } catch (err) {
        console.error('[autosave] Failed to write chunk:', err);
      }
    },
  );

  // Clean up the recovery file (called after normal recording save)
  ipcMain.handle(Channels.AUTOSAVE_CLEANUP, async (event) => {
    if (!isValidSender(event)) {
      throw new Error('Unauthorized IPC sender');
    }

    if (activeRecoveryPath) {
      deleteRecoveryFile(activeRecoveryPath);
      activeRecoveryPath = null;
    }
  });
}
