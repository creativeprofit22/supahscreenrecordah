import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { promisify } from 'util';
import { app } from 'electron';
import type { InstallProgress } from '../../shared/activation-types';

const execFileAsync = promisify(execFile);

/** Directory where downloaded binaries are stored */
function getBinDir(): string {
  return path.join(app.getPath('userData'), 'bin');
}

/** Directory where whisper models are stored */
function getWhisperModelDir(): string {
  return path.join(app.getPath('userData'), 'whisper');
}

const WHISPER_BINARY_NAME = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';

const WHISPER_WINDOWS_URL =
  'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.4/whisper-bin-x64.zip';

const WHISPER_MODEL_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin';

/** Find the whisper-cli binary — checks app userData, Homebrew paths, then PATH */
export async function findWhisper(): Promise<string | null> {
  // Check app-bundled binary first
  const userDataBin = path.join(getBinDir(), WHISPER_BINARY_NAME);
  try {
    const checkFlag = process.platform === 'win32' ? fs.constants.R_OK : fs.constants.X_OK;
    await fs.promises.access(userDataBin, checkFlag);
    return userDataBin;
  } catch {
    // Not installed locally
  }

  // Check well-known install locations
  const candidates = [
    '/opt/homebrew/bin/whisper-cli', // macOS ARM Homebrew
    '/usr/local/bin/whisper-cli', // macOS Intel Homebrew
    '/usr/bin/whisper-cli', // Linux system install
  ];
  for (const candidate of candidates) {
    try {
      await fs.promises.access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Try next candidate
    }
  }

  // Fall back to which/where to find it on PATH
  try {
    const cmd = process.platform === 'win32' ? 'where whisper-cli' : 'which whisper-cli';
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
    // whisper-cli not on PATH either
  }

  return null;
}

/** Find the whisper model file (ggml-base.bin) in the app data directory */
export async function findWhisperModel(): Promise<string | null> {
  const modelPath = path.join(getWhisperModelDir(), 'ggml-base.bin');
  try {
    await fs.promises.access(modelPath, fs.constants.R_OK);
    return modelPath;
  } catch {
    return null;
  }
}

/** Download and install whisper-cli binary (Windows only — macOS/Linux use brew) */
export async function installWhisper(
  onProgress: (progress: InstallProgress) => void,
): Promise<void> {
  if (process.platform !== 'win32') {
    onProgress({
      dependency: 'whisper',
      status: 'error',
      error: 'Please install whisper-cpp via Homebrew: brew install whisper-cpp',
    });
    return;
  }

  const binDir = getBinDir();
  await fs.promises.mkdir(binDir, { recursive: true });
  const targetPath = path.join(binDir, WHISPER_BINARY_NAME);

  onProgress({ dependency: 'whisper', status: 'downloading', progress: 0 });

  try {
    const tmpPath = path.join(binDir, 'whisper-download.zip');
    await downloadFile(WHISPER_WINDOWS_URL, tmpPath, (pct) => {
      onProgress({ dependency: 'whisper', status: 'downloading', progress: pct });
    });

    onProgress({ dependency: 'whisper', status: 'installing', progress: 100 });

    await extractWhisperFromZip(tmpPath, binDir);

    onProgress({ dependency: 'whisper', status: 'done', progress: 100 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onProgress({ dependency: 'whisper', status: 'error', error: message });
    // Clean up partial download
    try {
      await fs.promises.unlink(path.join(binDir, 'whisper-download.zip'));
    } catch {
      // ignore
    }
  }
}

/** Download the whisper model (ggml-base.bin) */
export async function installWhisperModel(
  onProgress: (progress: InstallProgress) => void,
): Promise<void> {
  const modelDir = getWhisperModelDir();
  await fs.promises.mkdir(modelDir, { recursive: true });
  const targetPath = path.join(modelDir, 'ggml-base.bin');

  onProgress({ dependency: 'whisper-model', status: 'downloading', progress: 0 });

  try {
    const tmpPath = targetPath + '.tmp';
    await downloadFile(WHISPER_MODEL_URL, tmpPath, (pct) => {
      onProgress({ dependency: 'whisper-model', status: 'downloading', progress: pct });
    });

    onProgress({ dependency: 'whisper-model', status: 'installing', progress: 100 });

    await fs.promises.rename(tmpPath, targetPath);

    onProgress({ dependency: 'whisper-model', status: 'done', progress: 100 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onProgress({ dependency: 'whisper-model', status: 'error', error: message });
    // Clean up partial download
    try {
      await fs.promises.unlink(targetPath + '.tmp');
    } catch {
      // ignore
    }
  }
}

/** Extract whisper-cli.exe + DLLs from the Windows zip */
async function extractWhisperFromZip(zipPath: string, binDir: string): Promise<void> {
  const extractDir = path.join(binDir, 'whisper-extract');
  await fs.promises.mkdir(extractDir, { recursive: true });

  await execFileAsync('powershell', [
    '-NoProfile',
    '-Command',
    `Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force`,
  ]);

  // Find and copy whisper-cli.exe
  const whisperExe = await findFileRecursive(extractDir, 'whisper-cli.exe');
  if (!whisperExe) {
    throw new Error('whisper-cli.exe not found in downloaded archive');
  }

  await fs.promises.copyFile(whisperExe, path.join(binDir, 'whisper-cli.exe'));

  // Copy all DLLs from the same directory as whisper-cli.exe
  const releaseDir = path.dirname(whisperExe);
  const entries = await fs.promises.readdir(releaseDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() && entry.name.endsWith('.dll')) {
      await fs.promises.copyFile(
        path.join(releaseDir, entry.name),
        path.join(binDir, entry.name),
      );
    }
  }

  // Clean up
  await fs.promises.rm(extractDir, { recursive: true, force: true });
  await fs.promises.unlink(zipPath);
}

function downloadFile(
  url: string,
  destPath: string,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const MAX_REDIRECTS = 10;
    const follow = (currentUrl: string, redirectCount = 0): void => {
      const get = currentUrl.startsWith('https') ? https.get : http.get;
      get(currentUrl, (res) => {
          // Handle redirects
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            res.resume();
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

          res.on('error', reject);

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
