import { ipcMain, app } from 'electron';
import fs from 'fs';
import path from 'path';
import { Channels } from '../../shared/channels';
import { isValidSavePath } from '../../shared/paths';
import { postProcessRecording, buildEncodeFlags, applyIntroOutro } from '../services/ffmpeg';
import { processWithSilenceAndCaptions } from '../services/post-export';
import { ASPECT_RATIOS, EXPORT_PRESETS } from '../../shared/feature-types';
import type { ExportPlatform, ExportPreset } from '../../shared/feature-types';
import { getConfig } from '../store';
import { isValidSender } from './helpers';
import type { PauseTimestamp } from '../../shared/types';

// Allowed directories for saving recordings
const ALLOWED_SAVE_DIRS = [
  app.getPath('home'),
  app.getPath('desktop'),
  app.getPath('documents'),
];

/**
 * Deduplicate export presets: group platforms that share the same
 * aspectRatio + maxBitrate so we only encode once per unique combo.
 * Returns an array of { preset, platforms } groups.
 */
function deduplicatePresets(
  platforms: ExportPlatform[],
): Array<{ preset: ExportPreset; platforms: ExportPlatform[] }> {
  const groups = new Map<string, { preset: ExportPreset; platforms: ExportPlatform[] }>();
  for (const platform of platforms) {
    const preset = EXPORT_PRESETS[platform];
    if (!preset) continue;
    const key = `${preset.aspectRatio}_${preset.maxBitrate}`;
    const existing = groups.get(key);
    if (existing) {
      existing.platforms.push(platform);
    } else {
      groups.set(key, { preset, platforms: [platform] });
    }
  }
  return Array.from(groups.values());
}

/** Build a platform-suffixed output path: /dir/video_youtube.mp4 */
function buildPlatformPath(basePath: string, platform: ExportPlatform): string {
  const dir = path.dirname(basePath);
  const ext = path.extname(basePath);
  const name = path.basename(basePath, ext);
  return path.join(dir, `${name}_${platform}${ext}`);
}

/** Run the full post-process + silence/captions + intro/outro pipeline on a file */
async function runFullPipeline(
  filePath: string,
  pauseTimestamps: PauseTimestamp[] | undefined,
  customEncodeFlags?: string[],
): Promise<void> {
  const config = getConfig();
  await postProcessRecording(filePath, config.overlay?.progressBar, pauseTimestamps, customEncodeFlags);
  const aspectRatio = config.overlay?.aspectRatio ?? '16:9';
  await processWithSilenceAndCaptions(
    filePath,
    config.silenceRemoval,
    config.caption,
    aspectRatio,
  );
  const introOutro = config.overlay?.introOutro;
  if (introOutro && (introOutro.introEnabled || introOutro.outroEnabled)) {
    const ar = ASPECT_RATIOS[aspectRatio] ?? ASPECT_RATIOS['16:9'];
    await applyIntroOutro(filePath, introOutro, ar.width, ar.height, config.overlay?.bgColor ?? '#000000');
  }
}

export function registerFileHandlers(): void {
  ipcMain.handle(
    Channels.FILE_SAVE_RECORDING,
    async (event, { filePath, buffer, pauseTimestamps }: { filePath: string; buffer: ArrayBuffer; pauseTimestamps?: PauseTimestamp[] }) => {
      if (!isValidSender(event)) {
        throw new Error('Unauthorized IPC sender');
      }
      if (!isValidSavePath(filePath, ALLOWED_SAVE_DIRS)) {
        throw new Error(`Invalid save path: ${filePath}`);
      }

      const config = getConfig();
      const selectedPlatforms = config.exportPlatforms ?? [];

      // No platforms selected or only 'custom' — use original default behavior
      const nonCustomPlatforms = selectedPlatforms.filter((p) => p !== 'custom');
      if (nonCustomPlatforms.length === 0) {
        try {
          await fs.promises.writeFile(filePath, Buffer.from(buffer));
          await runFullPipeline(filePath, pauseTimestamps);
        } catch (err) {
          console.error('Failed to save recording:', err);
          throw err;
        }
        return;
      }

      // Multi-platform export with deduplication
      try {
        const buf = Buffer.from(buffer);
        const groups = deduplicatePresets(nonCustomPlatforms);
        const hasCustom = selectedPlatforms.includes('custom');
        const multiOutput = hasCustom || groups.length > 1 || (groups.length === 1 && groups[0].platforms.length > 1);

        for (const group of groups) {
          // Determine the output file path for the first platform in this group
          const primaryPlatform = group.platforms[0];
          const outputPath = multiOutput
            ? buildPlatformPath(filePath, primaryPlatform)
            : filePath;

          await fs.promises.writeFile(outputPath, buf);
          const encodeFlags = buildEncodeFlags(group.preset);
          await runFullPipeline(outputPath, pauseTimestamps, encodeFlags);

          // Warn about duration limits (don't truncate)
          if (group.preset.maxDuration) {
            console.log(
              `[export] Platform ${group.preset.label} has max duration ${group.preset.maxDuration}s — recording may exceed this limit.`,
            );
          }

          // Copy for any additional platforms that share the same encoding
          for (let i = 1; i < group.platforms.length; i++) {
            const aliasPath = buildPlatformPath(filePath, group.platforms[i]);
            await fs.promises.copyFile(outputPath, aliasPath);
            console.log(`[export] Copied ${primaryPlatform} output to ${group.platforms[i]}: ${aliasPath}`);
          }
        }

        // If 'custom' is also selected alongside platform presets, save a default version too
        if (hasCustom) {
          await fs.promises.writeFile(filePath, buf);
          await runFullPipeline(filePath, pauseTimestamps);
        }
      } catch (err) {
        console.error('Failed to save recording:', err);
        throw err;
      }
    },
  );
}
