import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { promisify } from 'util';
import { app } from 'electron';
import type { DependencyStatus, InstallProgress } from '../../shared/activation-types';

const execFileAsync = promisify(execFile);

/** Directory where downloaded binaries are stored */
function getBinDir(): string {
  return path.join(app.getPath('userData'), 'bin');
}

/** Find the ffmpeg binary — checks app userData, common locations, then falls back to PATH */
export async function findFfmpeg(): Promise<string | null> {
  // Check app-bundled binary first
  const userDataBin = path.join(getBinDir(), process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  try {
    await fs.promises.access(userDataBin, fs.constants.X_OK);
    return userDataBin;
  } catch {
    // Not installed locally
  }

  // Check well-known install locations (avoids PATH lookup overhead)
  const candidates = [
    '/opt/homebrew/bin/ffmpeg', // macOS ARM Homebrew
    '/usr/local/bin/ffmpeg', // macOS Intel Homebrew
    '/usr/bin/ffmpeg', // Linux apt / system install
  ];
  for (const candidate of candidates) {
    try {
      await fs.promises.access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Try next candidate
    }
  }

  // Fall back to `which ffmpeg` to find it anywhere on PATH
  try {
    const cmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
    const cmdParts = cmd.split(' ');
    const cmdName = cmdParts[0] ?? 'which';
    const { stdout } = await execFileAsync(cmdName, cmdParts.slice(1), {
      encoding: 'utf-8',
      timeout: 3000,
    });
    const result = stdout.trim();
    if (result) {
      return result.split('\n')[0] ?? result;
    }
  } catch {
    // ffmpeg not on PATH either
  }

  return null;
}

export async function checkDependencies(): Promise<DependencyStatus> {
  const ffmpegPath = await findFfmpeg();
  return { ffmpeg: { installed: !!ffmpegPath, path: ffmpegPath ?? undefined } };
}

export async function installFfmpeg(
  onProgress: (progress: InstallProgress) => void,
): Promise<void> {
  const binDir = getBinDir();
  await fs.promises.mkdir(binDir, { recursive: true });
  const targetName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const targetPath = path.join(binDir, targetName);

  // Determine download URL based on platform + arch
  const url = getDownloadUrl();
  if (!url) {
    onProgress({ dependency: 'ffmpeg', status: 'error', error: 'Unsupported platform' });
    return;
  }

  onProgress({ dependency: 'ffmpeg', status: 'downloading', progress: 0 });

  try {
    const tmpPath = targetPath + '.tmp';
    await downloadFile(url, tmpPath, (pct) => {
      onProgress({ dependency: 'ffmpeg', status: 'downloading', progress: pct });
    });

    onProgress({ dependency: 'ffmpeg', status: 'installing', progress: 100 });

    // If the download is a zip/7z, extract it; otherwise just rename
    if (url.endsWith('.zip')) {
      await extractFfmpegFromZip(tmpPath, targetPath);
    } else {
      // Direct binary download (macOS evermeet)
      await fs.promises.rename(tmpPath, targetPath);
    }

    // Make executable on unix
    if (process.platform !== 'win32') {
      await fs.promises.chmod(targetPath, 0o755);
    }

    onProgress({ dependency: 'ffmpeg', status: 'done', progress: 100 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onProgress({ dependency: 'ffmpeg', status: 'error', error: message });
    // Clean up partial download
    try {
      await fs.promises.unlink(targetPath + '.tmp');
    } catch {
      // ignore
    }
  }
}

function getDownloadUrl(): string | null {
  if (process.platform === 'darwin') {
    // Static binary from evermeet.cx (universal macOS build)
    return 'https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip';
  }
  if (process.platform === 'win32') {
    return 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
  }
  // Linux — user should install via package manager
  return null;
}

function downloadFile(
  url: string,
  destPath: string,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const MAX_REDIRECTS = 5;
    const follow = (currentUrl: string, redirectCount = 0): void => {
      https
        .get(currentUrl, (res) => {
          // Handle redirects
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            res.resume(); // drain response to free the socket
            if (redirectCount >= MAX_REDIRECTS) {
              reject(new Error('Too many redirects'));
              return;
            }
            follow(res.headers.location, redirectCount + 1);
            return;
          }

          if (!res.statusCode || res.statusCode >= 400) {
            reject(new Error(`Download failed with status ${res.statusCode ?? 'unknown'}`));
            return;
          }

          const totalBytes = parseInt(res.headers['content-length'] ?? '0', 10);
          let receivedBytes = 0;
          const file = fs.createWriteStream(destPath);

          res.on('data', (chunk: Buffer) => {
            receivedBytes += chunk.length;
            if (totalBytes > 0) {
              onProgress(Math.round((receivedBytes / totalBytes) * 100));
            }
          });

          res.pipe(file);

          file.on('finish', () => {
            file.close();
            resolve();
          });

          file.on('error', (err) => {
            fs.unlink(destPath, () => {
              /* ignore */
            });
            reject(err);
          });
        })
        .on('error', reject);
    };
    follow(url);
  });
}

async function extractFfmpegFromZip(zipPath: string, targetPath: string): Promise<void> {
  if (process.platform === 'win32') {
    const extractDir = path.join(path.dirname(targetPath), 'ffmpeg-extract');
    await fs.promises.mkdir(extractDir, { recursive: true });
    await execFileAsync('powershell', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force`,
    ]);

    const ffmpegExe = await findFileRecursive(extractDir, 'ffmpeg.exe');
    if (!ffmpegExe) {
      throw new Error('ffmpeg.exe not found in downloaded archive');
    }

    await fs.promises.copyFile(ffmpegExe, targetPath);
    await fs.promises.rm(extractDir, { recursive: true, force: true });
  } else {
    // macOS/Linux: use unzip
    const extractDir = path.join(path.dirname(targetPath), 'ffmpeg-extract');
    await fs.promises.mkdir(extractDir, { recursive: true });
    await execFileAsync('unzip', ['-o', zipPath, '-d', extractDir]);

    const ffmpegBin = await findFileRecursive(extractDir, 'ffmpeg');
    if (!ffmpegBin) {
      throw new Error('ffmpeg binary not found in downloaded archive');
    }

    await fs.promises.copyFile(ffmpegBin, targetPath);
    await fs.promises.rm(extractDir, { recursive: true, force: true });
  }

  // Clean up zip
  await fs.promises.unlink(zipPath);
}

async function findFileRecursive(dir: string, name: string): Promise<string | null> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const result = await findFileRecursive(fullPath, name);
      if (result) {
        return result;
      }
    } else if (entry.name === name) {
      return fullPath;
    }
  }
  return null;
}
