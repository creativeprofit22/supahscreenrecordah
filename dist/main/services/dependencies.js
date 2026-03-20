"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.findFfmpeg = findFfmpeg;
exports.checkDependencies = checkDependencies;
exports.installFfmpeg = installFfmpeg;
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const https_1 = __importDefault(require("https"));
const util_1 = require("util");
const electron_1 = require("electron");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
/** Directory where downloaded binaries are stored */
function getBinDir() {
    return path_1.default.join(electron_1.app.getPath('userData'), 'bin');
}
/** Find the ffmpeg binary — checks app userData, common locations, then falls back to PATH */
async function findFfmpeg() {
    // Check app-bundled binary first
    const userDataBin = path_1.default.join(getBinDir(), process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    try {
        await fs_1.default.promises.access(userDataBin, fs_1.default.constants.X_OK);
        return userDataBin;
    }
    catch {
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
            await fs_1.default.promises.access(candidate, fs_1.default.constants.X_OK);
            return candidate;
        }
        catch {
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
    }
    catch {
        // ffmpeg not on PATH either
    }
    return null;
}
async function checkDependencies() {
    const ffmpegPath = await findFfmpeg();
    return { ffmpeg: { installed: !!ffmpegPath, path: ffmpegPath ?? undefined } };
}
async function installFfmpeg(onProgress) {
    const binDir = getBinDir();
    await fs_1.default.promises.mkdir(binDir, { recursive: true });
    const targetName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const targetPath = path_1.default.join(binDir, targetName);
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
        }
        else {
            // Direct binary download (macOS evermeet)
            await fs_1.default.promises.rename(tmpPath, targetPath);
        }
        // Make executable on unix
        if (process.platform !== 'win32') {
            await fs_1.default.promises.chmod(targetPath, 0o755);
        }
        onProgress({ dependency: 'ffmpeg', status: 'done', progress: 100 });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        onProgress({ dependency: 'ffmpeg', status: 'error', error: message });
        // Clean up partial download
        try {
            await fs_1.default.promises.unlink(targetPath + '.tmp');
        }
        catch {
            // ignore
        }
    }
}
function getDownloadUrl() {
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
function downloadFile(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
        const follow = (currentUrl) => {
            https_1.default
                .get(currentUrl, (res) => {
                // Handle redirects
                if (res.statusCode &&
                    res.statusCode >= 300 &&
                    res.statusCode < 400 &&
                    res.headers.location) {
                    follow(res.headers.location);
                    return;
                }
                if (!res.statusCode || res.statusCode >= 400) {
                    reject(new Error(`Download failed with status ${res.statusCode ?? 'unknown'}`));
                    return;
                }
                const totalBytes = parseInt(res.headers['content-length'] ?? '0', 10);
                let receivedBytes = 0;
                const file = fs_1.default.createWriteStream(destPath);
                res.on('data', (chunk) => {
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
                    fs_1.default.unlink(destPath, () => {
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
async function extractFfmpegFromZip(zipPath, targetPath) {
    // Use unzip on macOS/Linux, or PowerShell on Windows
    if (process.platform === 'win32') {
        const extractDir = path_1.default.join(path_1.default.dirname(targetPath), 'ffmpeg-extract');
        await fs_1.default.promises.mkdir(extractDir, { recursive: true });
        await execFileAsync('powershell', [
            '-NoProfile',
            '-Command',
            `Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force`,
        ]);
        // Find ffmpeg.exe recursively
        const ffmpegExe = await findFileRecursive(extractDir, 'ffmpeg.exe');
        if (!ffmpegExe) {
            throw new Error('ffmpeg.exe not found in downloaded archive');
        }
        await fs_1.default.promises.copyFile(ffmpegExe, targetPath);
        await fs_1.default.promises.rm(extractDir, { recursive: true, force: true });
    }
    else {
        // macOS/Linux: use unzip
        const extractDir = path_1.default.join(path_1.default.dirname(targetPath), 'ffmpeg-extract');
        await fs_1.default.promises.mkdir(extractDir, { recursive: true });
        await execFileAsync('unzip', ['-o', zipPath, '-d', extractDir]);
        // Find ffmpeg binary
        const ffmpegBin = await findFileRecursive(extractDir, 'ffmpeg');
        if (!ffmpegBin) {
            throw new Error('ffmpeg binary not found in downloaded archive');
        }
        await fs_1.default.promises.copyFile(ffmpegBin, targetPath);
        await fs_1.default.promises.rm(extractDir, { recursive: true, force: true });
    }
    // Clean up zip
    await fs_1.default.promises.unlink(zipPath);
}
async function findFileRecursive(dir, name) {
    const entries = await fs_1.default.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path_1.default.join(dir, entry.name);
        if (entry.isDirectory()) {
            const result = await findFileRecursive(fullPath, name);
            if (result) {
                return result;
            }
        }
        else if (entry.name === name) {
            return fullPath;
        }
    }
    return null;
}
//# sourceMappingURL=dependencies.js.map