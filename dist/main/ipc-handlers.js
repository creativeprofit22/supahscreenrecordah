"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerIpcHandlers = registerIpcHandlers;
exports.registerActivationHandlers = registerActivationHandlers;
exports.resendStateToMainWindow = resendStateToMainWindow;
exports.stopUiohook = stopUiohook;
const electron_1 = require("electron");
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const uiohook_napi_1 = require("uiohook-napi");
const channels_1 = require("../shared/channels");
const shortcuts_1 = require("../shared/shortcuts");
// Native macOS cursor addon (optional — graceful fallback on other platforms)
let macosCursor = null;
try {
    if (process.platform === 'darwin') {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        macosCursor = require('../../native/macos-cursor');
    }
}
catch (err) {
    console.warn('macos-cursor native addon not available:', err);
}
const toolbar_window_1 = require("./windows/toolbar-window");
const main_window_1 = require("./windows/main-window");
const edit_modal_window_1 = require("./windows/edit-modal-window");
const onboarding_window_1 = require("./windows/onboarding-window");
const store_1 = require("./store");
const paths_1 = require("../shared/paths");
const permissions_1 = require("./services/permissions");
const dependencies_1 = require("./services/dependencies");
/**
 * Validate that an IPC event originates from one of our known windows.
 * Rejects messages from unknown or compromised webContents.
 */
function isValidSender(event) {
    const validWebContents = [
        (0, main_window_1.getMainWindow)()?.webContents,
        (0, toolbar_window_1.getToolbarWindow)()?.webContents,
        (0, edit_modal_window_1.getEditModalWindow)()?.webContents,
        (0, onboarding_window_1.getOnboardingWindow)()?.webContents,
    ].filter(Boolean);
    return validWebContents.some((wc) => wc === event.sender);
}
// ── FFmpeg exec options ─────────────────────────────────────────
// FFmpeg writes verbose progress to stderr; default 1 MB maxBuffer is too small
// for long recordings and will crash with ERR_CHILD_PROCESS_STDIO_MAXBUFFER.
/** Last preview selection — cached so we can resend to a recreated main window. */
let lastPreviewSelection = null;
const FFMPEG_EXEC_OPTIONS = { timeout: 600_000, maxBuffer: 50 * 1024 * 1024 };
const FFMPEG_EXEC_OPTIONS_SHORT = { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 };
/**
 * Podcast-quality voice enhancement filter chain for YouTube-optimal output.
 *
 * Pipeline order (each stage feeds into the next):
 *
 * 1. NOISE GATE — silence background noise when nobody is speaking
 *    threshold=0.015 (~-36 dBFS), attack=20ms, release=250ms
 *
 * 2. HIGHPASS f=80 — remove sub-bass rumble (desk vibration, AC hum)
 *
 * 3. NOISE REDUCTION — FFT-based (fan, hiss, hum), nf=-35
 *
 * 4. LOW MUD CUT — -3 dB at 200 Hz (proximity boominess)
 *
 * 5. PRESENCE BOOST — +4 dB at 2.5 kHz (vocal clarity)
 *
 * 6. AIR / BRILLIANCE — +2 dB at 8 kHz (crispy top end)
 *
 * 7. EXCITER — harmonic generation for crispness (not just EQ)
 *
 * 8. COMPRESSOR — broadcast-style dynamics (4:1, makeup=8)
 *
 * 9. LOUDNORM — two-pass EBU R128 normalization (see postProcessRecording)
 *    Pass 1 measures actual loudness; pass 2 applies precise correction.
 *    This replaces single-pass loudnorm which has limited gain range.
 */
const VOICE_ENHANCE_FILTER_BASE = [
    'agate=threshold=0.015:attack=20:release=250',
    'highpass=f=80',
    'afftdn=nf=-35',
    'equalizer=f=200:width_type=h:width=150:g=-3',
    'equalizer=f=2500:width_type=h:width=1000:g=4',
    'equalizer=f=8000:width_type=h:width=2000:g=2',
    'aexciter=level_in=1:level_out=1:amount=2:drive=8.5',
    'acompressor=threshold=0.089:ratio=4:attack=10:release=250:makeup=4',
].join(',');
/** Loudnorm target values — -14 LUFS matches YouTube's normalization target.
 *  Delivering at -14 means YouTube won't turn it up or down, preserving
 *  the exact dynamics and loudness you mixed. True peak at -1.5 dBTP gives
 *  headroom for lossy codec overshoot (AAC/Opus can exceed source peaks). */
const LOUDNORM_I = -14;
const LOUDNORM_TP = -1.5;
const LOUDNORM_LRA = 11;
/** No post-loudnorm boost — loudnorm at -14 LUFS is YouTube's exact target.
 *  Any boost would push above -14 and YouTube would turn it back down.
 *  The limiter at -1 dBFS is a safety net for intersample peak overshoot
 *  that can occur after AAC encoding. */
const POST_BOOST_FILTERS = 'alimiter=limit=0.89:level=false';
/** Run FFmpeg pass 1: apply voice filters + loudnorm in measure-only mode */
function runLoudnormPass1(ffmpegPath, filePath) {
    const pass1Filter = [
        VOICE_ENHANCE_FILTER_BASE,
        `loudnorm=I=${LOUDNORM_I}:TP=${LOUDNORM_TP}:LRA=${LOUDNORM_LRA}:print_format=json`,
        POST_BOOST_FILTERS,
    ].join(',');
    return new Promise((resolve) => {
        (0, child_process_1.execFile)(ffmpegPath, ['-i', filePath, '-af', pass1Filter, '-f', 'null', '-'], FFMPEG_EXEC_OPTIONS, (_error, _stdout, stderr) => {
            // loudnorm outputs JSON to stderr even on "error" (null output)
            try {
                // Find the last JSON block in stderr — loudnorm appends it at the end
                const jsonMatch = /\{[^{}]*"input_i"\s*:\s*"[^"]*"[^{}]*\}/s.exec(stderr);
                if (jsonMatch) {
                    const data = JSON.parse(jsonMatch[0]);
                    if (data.input_i && data.input_lra && data.input_tp && data.input_thresh) {
                        resolve({
                            input_i: data.input_i,
                            input_lra: data.input_lra,
                            input_tp: data.input_tp,
                            input_thresh: data.input_thresh,
                            target_offset: data.target_offset ?? '0',
                        });
                        return;
                    }
                }
            }
            catch {
                // JSON parse failed
            }
            console.warn('[export] Pass 1 failed to extract loudnorm measurements');
            if (stderr) {
                // Log last 500 chars of stderr for diagnostics
                console.warn('[export] FFmpeg stderr (tail):', stderr.slice(-500));
            }
            resolve(null);
        });
    });
}
/**
 * YouTube-optimal H.264 video encoding flags.
 * Re-encodes video instead of stream copy to guarantee clean H.264 output
 * regardless of what MediaRecorder produced (WebM/VP9 fallback, broken fMP4, etc).
 *
 * - High Profile Level 4.0: YouTube's expected profile for 1080p30
 * - CRF 17: visually lossless quality, slightly above YouTube's 12Mbps target
 * - maxrate 14M / bufsize 28M: caps bitrate spikes on complex scenes
 * - g 60: keyframe every 2s for smooth YouTube seeking
 * - pix_fmt yuv420p: required by YouTube and all web players
 */
const VIDEO_ENCODE_FLAGS = [
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-profile:v',
    'high',
    '-level',
    '4.0',
    '-crf',
    '17',
    '-maxrate',
    '14M',
    '-bufsize',
    '28M',
    '-g',
    '60',
    '-pix_fmt',
    'yuv420p',
    '-r',
    '30',
    '-colorspace',
    'bt709',
    '-color_trc',
    'bt709',
    '-color_primaries',
    'bt709',
    '-tag:v',
    'avc1',
];
/** Run FFmpeg pass 2: apply voice filters + loudnorm with measured values */
function runLoudnormPass2(ffmpegPath, filePath, tmpPath, measured) {
    const pass2Filter = [
        'aresample=async=1000:first_pts=0',
        VOICE_ENHANCE_FILTER_BASE,
        `loudnorm=linear=true:I=${LOUDNORM_I}:TP=${LOUDNORM_TP}:LRA=${LOUDNORM_LRA}` +
            `:measured_i=${measured.input_i}:measured_lra=${measured.input_lra}` +
            `:measured_tp=${measured.input_tp}:measured_thresh=${measured.input_thresh}` +
            `:offset=${measured.target_offset}`,
        POST_BOOST_FILTERS,
    ].join(',');
    return new Promise((resolve) => {
        (0, child_process_1.execFile)(ffmpegPath, [
            '-fflags',
            '+genpts',
            '-i',
            filePath,
            ...VIDEO_ENCODE_FLAGS,
            '-af',
            pass2Filter,
            '-c:a',
            'aac',
            '-b:a',
            '384k',
            '-ar',
            '48000',
            '-ac',
            '2',
            '-movflags',
            '+faststart',
            '-y',
            tmpPath,
        ], FFMPEG_EXEC_OPTIONS, (error, _stdout, stderr) => {
            resolve({ success: !error, stderr });
        });
    });
}
/** Single-pass fallback when pass 1 measurement fails */
function runSinglePassEnhance(ffmpegPath, filePath, tmpPath) {
    const filter = [
        'aresample=async=1000:first_pts=0',
        VOICE_ENHANCE_FILTER_BASE,
        `loudnorm=I=${LOUDNORM_I}:TP=${LOUDNORM_TP}:LRA=${LOUDNORM_LRA}`,
        POST_BOOST_FILTERS,
    ].join(',');
    return new Promise((resolve) => {
        (0, child_process_1.execFile)(ffmpegPath, [
            '-fflags',
            '+genpts',
            '-i',
            filePath,
            ...VIDEO_ENCODE_FLAGS,
            '-af',
            filter,
            '-c:a',
            'aac',
            '-b:a',
            '384k',
            '-ar',
            '48000',
            '-ac',
            '2',
            '-movflags',
            '+faststart',
            '-y',
            tmpPath,
        ], FFMPEG_EXEC_OPTIONS, (error, _stdout, stderr) => {
            resolve({ success: !error, stderr });
        });
    });
}
/**
 * Post-process a recording: remux fMP4 → standard MP4, enhance voice audio.
 *
 * Uses two-pass loudnorm for precise loudness normalization:
 * - Pass 1: measures actual loudness levels (outputs to /dev/null)
 * - Pass 2: applies exact correction using measured values
 *
 * Falls back gracefully: two-pass → single-pass → simple remux
 */
async function postProcessRecording(filePath) {
    if (!filePath.toLowerCase().endsWith('.mp4')) {
        return;
    }
    const ffmpegPath = await (0, dependencies_1.findFfmpeg)();
    if (!ffmpegPath) {
        console.warn('[export] FFmpeg not found — skipping post-processing.');
        return;
    }
    const tmpPath = path_1.default.join(os_1.default.tmpdir(), `supahscreenrecordah-export-${Date.now()}.mp4`);
    // Pass 1: measure loudness
    const measured = await runLoudnormPass1(ffmpegPath, filePath);
    let result;
    if (measured) {
        // Pass 2: apply precise normalization with measured values
        result = await runLoudnormPass2(ffmpegPath, filePath, tmpPath, measured);
    }
    else {
        // Fallback to single-pass if measurement failed
        console.warn('[export] Falling back to single-pass loudnorm.');
        result = await runSinglePassEnhance(ffmpegPath, filePath, tmpPath);
    }
    if (result.success) {
        try {
            await fs_1.default.promises.copyFile(tmpPath, filePath);
            await fs_1.default.promises.unlink(tmpPath);
        }
        catch (copyErr) {
            console.warn('[export] Failed to replace original file:', copyErr);
            try {
                await fs_1.default.promises.unlink(tmpPath);
            }
            catch {
                // ignore cleanup failure
            }
        }
        return;
    }
    // Log stderr for diagnostics
    if (result.stderr) {
        console.warn('[export] FFmpeg stderr (tail):', result.stderr.slice(-500));
    }
    // Final fallback: simple remux without audio enhancement
    console.warn('[export] Audio enhancement failed — falling back to simple remux.');
    await fallbackRemux(ffmpegPath, filePath, tmpPath);
}
/** Fallback: simple remux without audio enhancement (stream copy only) */
async function fallbackRemux(ffmpegPath, filePath, tmpPath) {
    const { error, stderr } = await new Promise((resolve) => {
        (0, child_process_1.execFile)(ffmpegPath, ['-i', filePath, '-c', 'copy', '-tag:v', 'avc1', '-movflags', '+faststart', '-y', tmpPath], FFMPEG_EXEC_OPTIONS_SHORT, (err, _stdout, stderrOut) => {
            resolve({ error: err, stderr: stderrOut });
        });
    });
    if (error) {
        console.warn('[export] Fallback remux also failed:', error.message);
        if (stderr) {
            console.warn('[export] FFmpeg stderr (tail):', stderr.slice(-500));
        }
        try {
            await fs_1.default.promises.unlink(tmpPath);
        }
        catch {
            // ignore
        }
        return;
    }
    try {
        await fs_1.default.promises.copyFile(tmpPath, filePath);
        await fs_1.default.promises.unlink(tmpPath);
    }
    catch (copyErr) {
        console.warn('[export] Failed to replace original file:', copyErr);
    }
}
/**
 * Query macOS CGWindowListCopyWindowInfo for ALL windows (including minimized).
 * desktopCapturer only returns on-screen windows, so this fills the gap.
 */
function getMacOSAllWindows() {
    if (process.platform !== 'darwin') {
        return Promise.resolve([]);
    }
    const swiftCode = `
import CoreGraphics
import Foundation

let options: CGWindowListOption = [.optionAll, .excludeDesktopElements]
guard let windowList = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
    print("[]")
    exit(0)
}

var result: [[String: Any]] = []
for w in windowList {
    guard let layer = w[kCGWindowLayer as String] as? Int, layer == 0,
          let owner = w[kCGWindowOwnerName as String] as? String,
          let windowId = w[kCGWindowNumber as String] as? Int else { continue }
    let name = (w[kCGWindowName as String] as? String) ?? owner
    let onScreen = (w[kCGWindowIsOnscreen as String] as? Bool) ?? false
    if !name.isEmpty {
        result.append(["id": windowId, "name": name, "owner": owner, "onScreen": onScreen])
    }
}
if let data = try? JSONSerialization.data(withJSONObject: result),
   let str = String(data: data, encoding: .utf8) {
    print(str)
}
`;
    return new Promise((resolve) => {
        (0, child_process_1.execFile)('swift', ['-e', swiftCode], { timeout: 5000 }, (error, stdout) => {
            if (error) {
                console.warn('[screens] Failed to query macOS CGWindowList:', error.message);
                resolve([]);
                return;
            }
            try {
                const parsed = JSON.parse(stdout.trim());
                resolve(parsed);
            }
            catch {
                console.warn('[screens] Failed to parse CGWindowList output');
                resolve([]);
            }
        });
    });
}
let mouseTrackingInterval = null;
let isUiohookStarted = false;
// Allowed directories for saving recordings
const ALLOWED_SAVE_DIRS = [electron_1.app.getPath('home'), electron_1.app.getPath('desktop'), electron_1.app.getPath('documents')];
let recordingState = {
    isRecording: false,
    isPaused: false,
};
function sendStateToToolbar(state) {
    const toolbar = (0, toolbar_window_1.getToolbarWindow)();
    if (toolbar && !toolbar.isDestroyed()) {
        toolbar.webContents.send(channels_1.Channels.TOOLBAR_STATE_UPDATE, state);
    }
}
function registerIpcHandlers() {
    // ── Device handlers ──────────────────────────────────────────────
    electron_1.ipcMain.handle(channels_1.Channels.DEVICES_GET_SCREENS, async (event) => {
        if (!isValidSender(event)) {
            throw new Error('Unauthorized IPC sender');
        }
        const sources = await electron_1.desktopCapturer.getSources({
            types: ['screen', 'window'],
            thumbnailSize: { width: 320, height: 180 },
        });
        const ownNames = new Set(['supahscreenrecordah', 'supahscreenrecordah toolbar', 'supahscreenrecordah — preview']);
        const results = sources
            .filter((source) => !ownNames.has(source.name.toLowerCase()))
            .map((source) => {
            const isWindow = source.id.startsWith('window:');
            return {
                id: source.id,
                name: source.name,
                isBrowser: isWindow,
            };
        });
        // On macOS, desktopCapturer misses minimized windows. Supplement with
        // CGWindowListCopyWindowInfo which includes off-screen (minimized) windows.
        if (process.platform === 'darwin') {
            const cgWindows = await getMacOSAllWindows();
            const existingIds = new Set(results.map((r) => r.id));
            for (const cg of cgWindows) {
                const sourceId = `window:${cg.id}:0`;
                if (existingIds.has(sourceId)) {
                    continue;
                }
                const nameLower = cg.name.toLowerCase();
                const ownerLower = cg.owner.toLowerCase();
                if (ownNames.has(nameLower) || ownNames.has(ownerLower)) {
                    continue;
                }
                // Skip generic system-level windows
                if (ownerLower === 'window server' || ownerLower === 'universal control') {
                    continue;
                }
                results.push({
                    id: sourceId,
                    name: cg.name || cg.owner,
                    isBrowser: true,
                });
            }
        }
        return results;
    });
    // ── Recording handlers ───────────────────────────────────────────
    electron_1.ipcMain.handle(channels_1.Channels.RECORDING_START, async (event, options) => {
        if (!isValidSender(event)) {
            throw new Error('Unauthorized IPC sender');
        }
        recordingState = { isRecording: true, isPaused: false };
        sendStateToToolbar(recordingState);
        // Forward to main window so it can start canvas-based recording
        const main = (0, main_window_1.getMainWindow)();
        if (main && !main.isDestroyed()) {
            main.webContents.send(channels_1.Channels.MAIN_RECORDING_START, options.micDeviceId);
            // Window is hidden when renderer signals MAIN_RECORDING_READY
            // (after getUserMedia has acquired the mic — hiding before that
            // causes Chromium to deliver a silent audio track)
        }
    });
    // Renderer signals that getUserMedia + MediaRecorder.start() succeeded.
    // Now it's safe to hide the window.
    electron_1.ipcMain.on(channels_1.Channels.MAIN_RECORDING_READY, (event) => {
        if (!isValidSender(event)) {
            return;
        }
        const main = (0, main_window_1.getMainWindow)();
        if (main && !main.isDestroyed()) {
            main.hide();
        }
    });
    electron_1.ipcMain.handle(channels_1.Channels.RECORDING_STOP, async (event) => {
        if (!isValidSender(event)) {
            throw new Error('Unauthorized IPC sender');
        }
        recordingState = { isRecording: false, isPaused: false };
        sendStateToToolbar(recordingState);
        // Stop the global input hook now that recording has ended
        stopUiohook();
        // Forward stop to main window — it will enter playback mode
        const main = (0, main_window_1.getMainWindow)();
        if (main && !main.isDestroyed()) {
            main.webContents.send(channels_1.Channels.MAIN_RECORDING_STOP);
            // Show the main window so the user can see the playback
            main.show();
        }
    });
    // ── Playback preparation ─────────────────────────────────────────
    // MediaRecorder produces fragmented MP4 (fMP4) which Chromium's <video>
    // element can't play smoothly from a blob URL (only keyframes display,
    // giving ~2fps). We remux the raw blob to a temp file with faststart
    // so the moov atom is at the front and the video plays normally.
    let playbackTempFile = null;
    electron_1.ipcMain.handle(channels_1.Channels.RECORDING_PREPARE_PLAYBACK, async (event, buffer) => {
        if (!isValidSender(event)) {
            throw new Error('Unauthorized IPC sender');
        }
        // Clean up any previous temp file
        if (playbackTempFile) {
            try {
                await fs_1.default.promises.unlink(playbackTempFile);
            }
            catch {
                // ignore
            }
            playbackTempFile = null;
        }
        // Detect container format from the buffer header to use correct extension.
        // WebM starts with 0x1A45DFA3 (EBML header), MP4 has 'ftyp' at offset 4.
        const headerView = new Uint8Array(buffer, 0, 12);
        const isWebM = headerView[0] === 0x1a &&
            headerView[1] === 0x45 &&
            headerView[2] === 0xdf &&
            headerView[3] === 0xa3;
        const rawExt = isWebM ? 'webm' : 'mp4';
        const rawPath = path_1.default.join(os_1.default.tmpdir(), `supahscreenrecordah-raw-${Date.now()}.${rawExt}`);
        const remuxedPath = path_1.default.join(os_1.default.tmpdir(), `supahscreenrecordah-playback-${Date.now()}.mp4`);
        await fs_1.default.promises.writeFile(rawPath, Buffer.from(buffer));
        const ffmpegPath = await (0, dependencies_1.findFfmpeg)();
        if (ffmpegPath) {
            // Probe the raw file first to understand what MediaRecorder produced
            await new Promise((resolve) => {
                const ffprobePath = ffmpegPath.replace(/ffmpeg$/, 'ffprobe');
                (0, child_process_1.execFile)(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-print_format', 'json', rawPath], { timeout: 10_000, maxBuffer: 2 * 1024 * 1024 }, (_error, _stdout) => {
                    resolve();
                });
            });
            // Re-encode the video — stream copy isn't enough because the avc3
            // stream from MediaRecorder has broken frame timing that causes
            // Chromium to only display keyframes (~2fps).
            // Use ultrafast preset for speed; this is just for preview playback.
            // For WebM inputs from captureStream(0) with manual requestFrame(),
            // timestamps may be broken — use -fflags +genpts to regenerate them
            // and -vsync cfr to force constant frame rate output.
            const result = await new Promise((resolve) => {
                (0, child_process_1.execFile)(ffmpegPath, [
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
                    '-vsync',
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
                ], FFMPEG_EXEC_OPTIONS_SHORT, (error, _stdout, stderr) => {
                    if (error) {
                        console.error('[preparePlayback] FFmpeg re-encode error:', error.message);
                    }
                    resolve({ success: !error, stderr });
                });
            });
            if (result.success) {
                try {
                    await fs_1.default.promises.unlink(rawPath);
                }
                catch {
                    // ignore
                }
                playbackTempFile = remuxedPath;
                return remuxedPath;
            }
            console.warn('[preparePlayback] FFmpeg re-encode failed, falling back to raw file');
        }
        // Fallback: use raw file directly (may still stutter but better than blob)
        try {
            await fs_1.default.promises.unlink(remuxedPath);
        }
        catch {
            // ignore
        }
        playbackTempFile = rawPath;
        return rawPath;
    });
    electron_1.ipcMain.handle(channels_1.Channels.RECORDING_CLEANUP_PLAYBACK, async (event) => {
        if (!isValidSender(event)) {
            throw new Error('Unauthorized IPC sender');
        }
        if (playbackTempFile) {
            try {
                await fs_1.default.promises.unlink(playbackTempFile);
            }
            catch {
                // ignore
            }
            playbackTempFile = null;
        }
    });
    electron_1.ipcMain.handle(channels_1.Channels.RECORDING_EXPORT, async (event) => {
        if (!isValidSender(event)) {
            throw new Error('Unauthorized IPC sender');
        }
        const result = await electron_1.dialog.showSaveDialog({
            title: 'Export Recording',
            defaultPath: `recording-${Date.now()}.mp4`,
            filters: [
                { name: 'MP4 Video', extensions: ['mp4'] },
                { name: 'WebM Video', extensions: ['webm'] },
            ],
        });
        return result.filePath ?? '';
    });
    electron_1.ipcMain.handle(channels_1.Channels.RECORDING_PAUSE, async (event) => {
        if (!isValidSender(event)) {
            throw new Error('Unauthorized IPC sender');
        }
        recordingState = { ...recordingState, isPaused: true };
        sendStateToToolbar(recordingState);
        const main = (0, main_window_1.getMainWindow)();
        if (main && !main.isDestroyed()) {
            main.webContents.send(channels_1.Channels.MAIN_RECORDING_PAUSE);
        }
    });
    electron_1.ipcMain.handle(channels_1.Channels.RECORDING_RESUME, async (event) => {
        if (!isValidSender(event)) {
            throw new Error('Unauthorized IPC sender');
        }
        recordingState = { ...recordingState, isPaused: false };
        sendStateToToolbar(recordingState);
        const main = (0, main_window_1.getMainWindow)();
        if (main && !main.isDestroyed()) {
            main.webContents.send(channels_1.Channels.MAIN_RECORDING_RESUME);
        }
    });
    // ── File handlers ────────────────────────────────────────────────
    electron_1.ipcMain.handle(channels_1.Channels.FILE_SAVE_RECORDING, async (event, { filePath, buffer }) => {
        if (!isValidSender(event)) {
            throw new Error('Unauthorized IPC sender');
        }
        // Validate the file path to prevent directory traversal attacks
        if (!(0, paths_1.isValidSavePath)(filePath, ALLOWED_SAVE_DIRS)) {
            throw new Error(`Invalid save path: ${filePath}`);
        }
        try {
            await fs_1.default.promises.writeFile(filePath, Buffer.from(buffer));
            // Post-process: remux fMP4 → standard MP4, enhance voice audio
            await postProcessRecording(filePath);
        }
        catch (err) {
            console.error('Failed to save recording:', err);
            throw err;
        }
    });
    // ── Edit modal handlers ─────────────────────────────────────────
    electron_1.ipcMain.handle(channels_1.Channels.EDIT_MODAL_OPEN, async (event) => {
        if (!isValidSender(event)) {
            throw new Error('Unauthorized IPC sender');
        }
        const existing = (0, edit_modal_window_1.getEditModalWindow)();
        if (existing && !existing.isDestroyed()) {
            existing.focus();
            return;
        }
        (0, edit_modal_window_1.createEditModalWindow)();
    });
    electron_1.ipcMain.on(channels_1.Channels.EDIT_MODAL_CLOSE, (event) => {
        if (!isValidSender(event)) {
            return;
        }
        // Revert preview to saved overlay settings
        const main = (0, main_window_1.getMainWindow)();
        if (main && !main.isDestroyed()) {
            main.webContents.send(channels_1.Channels.OVERLAY_UPDATE, (0, store_1.getConfig)().overlay);
        }
        (0, edit_modal_window_1.closeEditModalWindow)();
    });
    electron_1.ipcMain.on(channels_1.Channels.OVERLAY_PREVIEW, (event, data) => {
        if (!isValidSender(event)) {
            return;
        }
        const main = (0, main_window_1.getMainWindow)();
        if (main && !main.isDestroyed()) {
            main.webContents.send(channels_1.Channels.OVERLAY_UPDATE, data);
        }
    });
    electron_1.ipcMain.on(channels_1.Channels.CTA_TEST, (event) => {
        if (!isValidSender(event)) {
            return;
        }
        const main = (0, main_window_1.getMainWindow)();
        if (main && !main.isDestroyed()) {
            main.webContents.send(channels_1.Channels.CTA_TEST);
        }
    });
    electron_1.ipcMain.on(channels_1.Channels.EDIT_MODAL_SAVE, (event, data) => {
        if (!isValidSender(event)) {
            return;
        }
        (0, store_1.saveConfig)({ overlay: data });
        const main = (0, main_window_1.getMainWindow)();
        if (main && !main.isDestroyed()) {
            main.webContents.send(channels_1.Channels.OVERLAY_UPDATE, data);
        }
        (0, edit_modal_window_1.closeEditModalWindow)();
    });
    // ── Preview forwarding (toolbar → main window) ────────────────
    electron_1.ipcMain.on(channels_1.Channels.PREVIEW_UPDATE, (event, selection) => {
        if (!isValidSender(event)) {
            return;
        }
        lastPreviewSelection = selection;
        const main = (0, main_window_1.getMainWindow)();
        if (main && !main.isDestroyed()) {
            main.webContents.send(channels_1.Channels.PREVIEW_UPDATE, selection);
        }
    });
    // ── Config persistence ────────────────────────────────────────
    electron_1.ipcMain.handle(channels_1.Channels.CONFIG_GET, (event) => {
        if (!isValidSender(event)) {
            throw new Error('Unauthorized IPC sender');
        }
        return (0, store_1.getConfig)();
    });
    electron_1.ipcMain.on(channels_1.Channels.CONFIG_SAVE, (event, partial) => {
        if (!isValidSender(event)) {
            return;
        }
        void (0, store_1.saveConfig)(partial);
    });
    // ── App control ──────────────────────────────────────────────────
    electron_1.ipcMain.on(channels_1.Channels.APP_QUIT, (event) => {
        if (!isValidSender(event)) {
            return;
        }
        electron_1.app.quit();
    });
    electron_1.ipcMain.handle(channels_1.Channels.APP_OPEN_EXTERNAL, async (event, url) => {
        if (!isValidSender(event)) {
            throw new Error('Unauthorized IPC sender');
        }
        if (typeof url === 'string' && url.startsWith('https://')) {
            await electron_1.shell.openExternal(url);
        }
    });
    electron_1.ipcMain.handle(channels_1.Channels.APP_CHECK_UPDATE, async (event) => {
        if (!isValidSender(event)) {
            throw new Error('Unauthorized IPC sender');
        }
        try {
            const currentVersion = electron_1.app.getVersion();
            const response = await electron_1.net.fetch('https://api.github.com/repos/creativeprofit22/supahscreenrecordah/releases/latest', {
                headers: {
                    Accept: 'application/vnd.github.v3+json',
                    'User-Agent': `supahscreenrecordah/${currentVersion}`,
                },
            });
            if (!response.ok) {
                return { available: false, version: '', url: '' };
            }
            const data = (await response.json());
            const latestVersion = data.tag_name.replace(/^v/, '');
            const available = latestVersion.localeCompare(currentVersion, undefined, { numeric: true }) > 0;
            return { available, version: latestVersion, url: data.html_url };
        }
        catch (err) {
            console.warn('[update] Failed to check for updates:', err);
            return { available: false, version: '', url: '' };
        }
    });
    // ── Mouse tracking ──────────────────────────────────────────────
    electron_1.ipcMain.handle(channels_1.Channels.MOUSE_TRACKING_START, (event) => {
        if (!isValidSender(event)) {
            throw new Error('Unauthorized IPC sender');
        }
        if (mouseTrackingInterval) {
            clearInterval(mouseTrackingInterval);
        }
        mouseTrackingInterval = setInterval(() => {
            const point = electron_1.screen.getCursorScreenPoint();
            const currentDisplay = electron_1.screen.getDisplayNearestPoint(point);
            const main = (0, main_window_1.getMainWindow)();
            if (main && !main.isDestroyed()) {
                main.webContents.send(channels_1.Channels.MOUSE_POSITION, {
                    x: point.x,
                    y: point.y,
                    cursorType: 'arrow',
                    displayBounds: currentDisplay.bounds,
                    scaleFactor: currentDisplay.scaleFactor,
                });
            }
        }, 16); // ~60fps tracking
        // Start global click detection if not already running
        setupMouseClickDetection();
        return true;
    });
    electron_1.ipcMain.handle(channels_1.Channels.MOUSE_TRACKING_STOP, (event) => {
        if (!isValidSender(event)) {
            throw new Error('Unauthorized IPC sender');
        }
        if (mouseTrackingInterval) {
            clearInterval(mouseTrackingInterval);
            mouseTrackingInterval = null;
        }
        return true;
    });
    // ── Cursor hide/show (native macOS) ─────────────────────────────
    electron_1.ipcMain.handle(channels_1.Channels.CURSOR_HIDE, (event) => {
        if (!isValidSender(event)) {
            throw new Error('Unauthorized IPC sender');
        }
        return macosCursor?.setSystemCursorHidden(true) ?? false;
    });
    electron_1.ipcMain.handle(channels_1.Channels.CURSOR_SHOW, (event) => {
        if (!isValidSender(event)) {
            throw new Error('Unauthorized IPC sender');
        }
        return macosCursor?.setSystemCursorHidden(false) ?? false;
    });
    // ── Window bounds (macOS native) ────────────────────────────────
    electron_1.ipcMain.handle(channels_1.Channels.WINDOW_GET_BOUNDS, async (event, sourceId) => {
        if (!isValidSender(event)) {
            throw new Error('Unauthorized IPC sender');
        }
        if (process.platform !== 'darwin') {
            return null;
        }
        // Extract CGWindowID from source ID (format: "window:12345:0")
        const match = /^window:(\d+)/.exec(sourceId);
        if (!match) {
            return null;
        }
        const cgWindowId = match[1];
        // Use swift to query CGWindowListCopyWindowInfo for the window bounds
        const swiftCode = `
import CoreGraphics
import Foundation

let targetId = ${cgWindowId}
let windowList = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as! [[String: Any]]
for window in windowList {
    if let wid = window["kCGWindowNumber"] as? Int, wid == targetId {
        if let bounds = window["kCGWindowBounds"] as? [String: Any],
           let x = bounds["X"] as? Double,
           let y = bounds["Y"] as? Double,
           let w = bounds["Width"] as? Double,
           let h = bounds["Height"] as? Double {
            print("\\(x),\\(y),\\(w),\\(h)")
            exit(0)
        }
    }
}
exit(1)
`;
        return new Promise((resolve) => {
            (0, child_process_1.execFile)('swift', ['-e', swiftCode], { timeout: 3000 }, (error, stdout) => {
                if (error) {
                    console.warn('Failed to get window bounds:', error.message);
                    resolve(null);
                    return;
                }
                const parts = stdout.trim().split(',').map(Number);
                const [x, y, width, height] = parts;
                if (parts.length === 4 &&
                    x !== undefined &&
                    y !== undefined &&
                    width !== undefined &&
                    height !== undefined &&
                    parts.every((n) => !isNaN(n))) {
                    resolve({ x, y, width, height });
                }
                else {
                    resolve(null);
                }
            });
        });
    });
}
// ── Action tracking — keyboard, click, scroll event detection ───
/** Map uiohook keycodes to readable character names */
const KEYCODE_TO_CHAR = {};
const KEYCODE_TO_NAME = {};
// Build keycode → character map from UiohookKey
const letterKeys = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
for (const ch of letterKeys) {
    const code = uiohook_napi_1.UiohookKey[ch];
    KEYCODE_TO_CHAR[code] = ch.toLowerCase();
}
for (let d = 0; d <= 9; d++) {
    const code = uiohook_napi_1.UiohookKey[String(d)];
    KEYCODE_TO_CHAR[code] = String(d);
}
// Punctuation & symbol keys
const PUNCT_MAP = [
    ['Space', ' '],
    ['Comma', ','],
    ['Period', '.'],
    ['Slash', '/'],
    ['Backslash', '\\'],
    ['Semicolon', ';'],
    ['Quote', "'"],
    ['BracketLeft', '['],
    ['BracketRight', ']'],
    ['Minus', '-'],
    ['Equal', '='],
    ['Backquote', '`'],
];
for (const [key, ch] of PUNCT_MAP) {
    KEYCODE_TO_CHAR[uiohook_napi_1.UiohookKey[key]] = ch;
}
// Named keys (for shortcut labels)
const NAMED_KEY_MAP = [
    ['Enter', 'Enter'],
    ['Tab', 'Tab'],
    ['Backspace', 'Backspace'],
    ['Delete', 'Delete'],
    ['Escape', 'Esc'],
    ['ArrowUp', 'Up'],
    ['ArrowDown', 'Down'],
    ['ArrowLeft', 'Left'],
    ['ArrowRight', 'Right'],
    ['Home', 'Home'],
    ['End', 'End'],
    ['PageUp', 'PageUp'],
    ['PageDown', 'PageDown'],
];
for (const [key, name] of NAMED_KEY_MAP) {
    KEYCODE_TO_NAME[uiohook_napi_1.UiohookKey[key]] = name;
}
// F-keys
for (let i = 1; i <= 12; i++) {
    const fKey = `F${i}`;
    KEYCODE_TO_NAME[uiohook_napi_1.UiohookKey[fKey]] = `F${i}`;
}
// Modifier keycodes for filtering
const MODIFIER_KEYCODES = new Set([
    uiohook_napi_1.UiohookKey.Ctrl,
    uiohook_napi_1.UiohookKey.CtrlRight,
    uiohook_napi_1.UiohookKey.Alt,
    uiohook_napi_1.UiohookKey.AltRight,
    uiohook_napi_1.UiohookKey.Shift,
    uiohook_napi_1.UiohookKey.ShiftRight,
    uiohook_napi_1.UiohookKey.Meta,
    uiohook_napi_1.UiohookKey.MetaRight,
]);
// Typing buffer — accumulates keystrokes and flushes as a single "type" action
let typeBuffer = '';
let typeFlushTimer = null;
const TYPE_FLUSH_DELAY_MS = 600;
const TYPE_MAX_DISPLAY = 50; // max chars to show in action label
// Active window cache — refreshed on each action to avoid stale data
let cachedActiveWindow = '';
let activeWindowRefreshTimer = null;
/** Get the frontmost application name on macOS via osascript */
function refreshActiveWindow() {
    if (process.platform !== 'darwin') {
        return;
    }
    // Throttle: don't query more than once per 250ms
    if (activeWindowRefreshTimer) {
        return;
    }
    activeWindowRefreshTimer = setTimeout(() => {
        activeWindowRefreshTimer = null;
    }, 250);
    (0, child_process_1.execFile)('osascript', ['-e', 'tell application "System Events" to get name of first process whose frontmost is true'], { timeout: 1000 }, (error, stdout) => {
        if (!error && stdout.trim()) {
            cachedActiveWindow = stdout.trim();
        }
    });
}
/** Send an action event to the renderer */
function emitAction(event) {
    const main = (0, main_window_1.getMainWindow)();
    if (main && !main.isDestroyed()) {
        main.webContents.send(channels_1.Channels.ACTION_EVENT, event);
    }
}
/** Flush the typing buffer as a single "type" action */
function flushTypeBuffer() {
    if (typeBuffer.length === 0) {
        return;
    }
    const text = typeBuffer.length > TYPE_MAX_DISPLAY ? typeBuffer.slice(-TYPE_MAX_DISPLAY) : typeBuffer;
    typeBuffer = '';
    emitAction({
        type: 'type',
        label: text,
        detail: cachedActiveWindow,
        timestamp: Date.now(),
    });
}
/** Build a shortcut label like "⌘+C" from modifier flags + keycode */
function buildShortcutLabel(e) {
    const parts = [];
    if (e.ctrlKey) {
        parts.push('Ctrl');
    }
    if (e.altKey) {
        parts.push('⌥');
    }
    if (e.metaKey) {
        parts.push('⌘');
    }
    if (e.shiftKey) {
        parts.push('⇧');
    }
    // Get key name
    const charName = KEYCODE_TO_CHAR[e.keycode];
    const namedKey = KEYCODE_TO_NAME[e.keycode];
    if (namedKey) {
        parts.push(namedKey);
    }
    else if (charName) {
        parts.push(charName.toUpperCase());
    }
    else {
        return '';
    }
    return parts.join('+');
}
// ── Global mouse click detection via uiohook-napi ──────────────
function setupMouseClickDetection() {
    if (isUiohookStarted) {
        return;
    }
    // Check for accessibility permissions on macOS
    if (process.platform === 'darwin') {
        const isTrusted = electron_1.systemPreferences.isTrustedAccessibilityClient(true);
        if (!isTrusted) {
            console.log('Accessibility permission not granted. Click-to-zoom disabled.');
            void electron_1.dialog.showMessageBox({
                type: 'warning',
                title: 'Accessibility Permission Required',
                message: 'supahscreenrecordah needs accessibility permissions to detect mouse clicks for click-to-zoom.',
                detail: 'Please grant permission in System Settings > Privacy & Security > Accessibility, then restart the app.',
                buttons: ['OK'],
            });
            return;
        }
    }
    uiohook_napi_1.uIOhook.on('mousedown', (e) => {
        // Only trigger on left click (button 1)
        if (e.button === 1) {
            const main = (0, main_window_1.getMainWindow)();
            if (main && !main.isDestroyed()) {
                main.webContents.send(channels_1.Channels.MOUSE_CLICK, { type: 'down', x: e.x, y: e.y });
            }
            // Emit click action — flush any pending typing first
            flushTypeBuffer();
            refreshActiveWindow();
            emitAction({
                type: 'click',
                label: cachedActiveWindow || 'screen',
                detail: cachedActiveWindow,
                timestamp: Date.now(),
            });
        }
    });
    uiohook_napi_1.uIOhook.on('mouseup', (e) => {
        if (e.button === 1) {
            const main = (0, main_window_1.getMainWindow)();
            if (main && !main.isDestroyed()) {
                main.webContents.send(channels_1.Channels.MOUSE_CLICK, { type: 'up', x: e.x, y: e.y });
            }
        }
    });
    // ── Keyboard tracking ──────────────────────────────────────────
    uiohook_napi_1.uIOhook.on('keydown', (e) => {
        // Skip modifier-only presses
        if (MODIFIER_KEYCODES.has(e.keycode)) {
            return;
        }
        refreshActiveWindow();
        const hasModifier = e.metaKey || e.ctrlKey || e.altKey;
        if (hasModifier) {
            // Shortcut detected — flush typing buffer first
            flushTypeBuffer();
            const shortcutLabel = buildShortcutLabel(e);
            if (!shortcutLabel) {
                return;
            }
            const description = shortcuts_1.SHORTCUT_LABELS[shortcutLabel] ?? '';
            emitAction({
                type: 'shortcut',
                label: shortcutLabel,
                detail: description || cachedActiveWindow,
                timestamp: Date.now(),
            });
        }
        else {
            // Regular typing — accumulate into buffer
            const ch = KEYCODE_TO_CHAR[e.keycode];
            if (ch) {
                const actualChar = e.shiftKey ? ch.toUpperCase() : ch;
                typeBuffer += actualChar;
                // Reset flush timer
                if (typeFlushTimer) {
                    clearTimeout(typeFlushTimer);
                }
                typeFlushTimer = setTimeout(flushTypeBuffer, TYPE_FLUSH_DELAY_MS);
            }
            else if (KEYCODE_TO_NAME[e.keycode]) {
                // Named key pressed without modifier (Enter, Tab, etc.)
                // Flush typing buffer with this key appended
                if (typeBuffer.length > 0) {
                    flushTypeBuffer();
                }
            }
        }
    });
    // ── Scroll tracking ────────────────────────────────────────────
    let lastScrollActionTime = 0;
    const SCROLL_THROTTLE_MS = 800;
    uiohook_napi_1.uIOhook.on('wheel', (e) => {
        const now = Date.now();
        if (now - lastScrollActionTime < SCROLL_THROTTLE_MS) {
            return;
        }
        lastScrollActionTime = now;
        refreshActiveWindow();
        const direction = e.rotation > 0 ? 'down' : 'up';
        emitAction({
            type: 'scroll',
            label: direction,
            detail: cachedActiveWindow,
            timestamp: Date.now(),
        });
    });
    try {
        uiohook_napi_1.uIOhook.start();
        isUiohookStarted = true;
    }
    catch (error) {
        console.error('Failed to start uIOhook:', error);
    }
}
const activation_1 = require("./services/activation");
const onboarding_window_2 = require("./windows/onboarding-window");
function registerActivationHandlers() {
    electron_1.ipcMain.handle(channels_1.Channels.ACTIVATION_CHECK, (event) => {
        if (!isValidActivationSender(event)) {
            throw new Error('Unauthorized IPC sender');
        }
        return (0, activation_1.getActivationState)();
    });
    electron_1.ipcMain.handle(channels_1.Channels.ACTIVATION_ACTIVATE, async (event, email) => {
        if (!isValidActivationSender(event)) {
            throw new Error('Unauthorized IPC sender');
        }
        // Return success — the renderer will advance to the permissions step
        return (0, activation_1.activate)(email);
    });
    electron_1.ipcMain.handle(channels_1.Channels.ACTIVATION_DEACTIVATE, (event) => {
        if (!isValidActivationSender(event)) {
            throw new Error('Unauthorized IPC sender');
        }
        (0, activation_1.clearActivationState)();
    });
    // ── Onboarding: permissions & prerequisites ────────────────────
    electron_1.ipcMain.handle(channels_1.Channels.ONBOARDING_CHECK_PERMISSIONS, (event) => {
        if (!isValidActivationSender(event)) {
            throw new Error('Unauthorized IPC sender');
        }
        return (0, permissions_1.checkPermissionStatus)();
    });
    electron_1.ipcMain.handle(channels_1.Channels.ONBOARDING_REQUEST_PERMISSION, async (event, type) => {
        if (!isValidActivationSender(event)) {
            throw new Error('Unauthorized IPC sender');
        }
        switch (type) {
            case 'camera':
                return (0, permissions_1.requestCameraPermission)();
            case 'microphone':
                return (0, permissions_1.requestMicrophonePermission)();
            case 'screenRecording':
                return (0, permissions_1.requestScreenRecordingPermission)();
            case 'accessibility':
                return (0, permissions_1.requestAccessibilityPermission)();
            default:
                return false;
        }
    });
    electron_1.ipcMain.handle(channels_1.Channels.ONBOARDING_CHECK_DEPENDENCIES, (event) => {
        if (!isValidActivationSender(event)) {
            throw new Error('Unauthorized IPC sender');
        }
        return (0, dependencies_1.checkDependencies)();
    });
    electron_1.ipcMain.handle(channels_1.Channels.ONBOARDING_INSTALL_DEPENDENCY, async (event, name) => {
        if (!isValidActivationSender(event)) {
            throw new Error('Unauthorized IPC sender');
        }
        if (name === 'ffmpeg') {
            await (0, dependencies_1.installFfmpeg)((progress) => {
                event.sender.send(channels_1.Channels.ONBOARDING_INSTALL_PROGRESS, progress);
            });
        }
    });
    electron_1.ipcMain.on(channels_1.Channels.ONBOARDING_COMPLETE, (event) => {
        if (!isValidSender(event)) {
            return;
        }
        (0, onboarding_window_2.closeOnboardingWindow)();
        (0, main_window_1.createMainWindow)();
        (0, toolbar_window_1.createToolbarWindow)();
    });
    electron_1.ipcMain.on(channels_1.Channels.ONBOARDING_RESIZE, (event, width, height) => {
        if (!isValidSender(event)) {
            return;
        }
        const win = (0, onboarding_window_1.getOnboardingWindow)();
        if (win && !win.isDestroyed()) {
            win.setSize(width, height, true);
        }
    });
}
function isValidActivationSender(event) {
    const validWebContents = [
        (0, onboarding_window_1.getOnboardingWindow)()?.webContents,
        (0, main_window_1.getMainWindow)()?.webContents,
        (0, toolbar_window_1.getToolbarWindow)()?.webContents,
    ].filter(Boolean);
    return validWebContents.some((wc) => wc === event.sender);
}
/** Resend cached preview + overlay state to a newly created main window.
 *  The window should be created with `show: false` — this function sends
 *  the state once the page loads, waits for streams to connect, then
 *  fades the window in smoothly. */
function resendStateToMainWindow() {
    const main = (0, main_window_1.getMainWindow)();
    if (!main || main.isDestroyed()) {
        return;
    }
    main.webContents.once('did-finish-load', () => {
        // Inject CSS fade-in: start transparent, transition to opaque
        void main.webContents
            .insertCSS('body { opacity: 0; transition: opacity 0.3s ease-in-out; }')
            .then((cssKey) => {
            // Send cached state so streams start connecting
            if (lastPreviewSelection) {
                main.webContents.send(channels_1.Channels.PREVIEW_UPDATE, lastPreviewSelection);
            }
            const config = (0, store_1.getConfig)();
            if (config.overlay) {
                main.webContents.send(channels_1.Channels.OVERLAY_UPDATE, config.overlay);
            }
            // Give streams a moment to connect, then show + fade in
            setTimeout(() => {
                if (!main.isDestroyed()) {
                    main.show();
                    // Remove the injected opacity so the transition triggers
                    void main.webContents.removeInsertedCSS(cssKey);
                }
            }, 600);
        });
    });
}
/** Stop the global uIOhook listener and clean up mouse tracking. */
function stopUiohook() {
    if (typeFlushTimer) {
        clearTimeout(typeFlushTimer);
        typeFlushTimer = null;
    }
    typeBuffer = '';
    if (mouseTrackingInterval) {
        clearInterval(mouseTrackingInterval);
        mouseTrackingInterval = null;
    }
    // Always restore the system cursor when tracking stops
    macosCursor?.setSystemCursorHidden(false);
    if (isUiohookStarted) {
        try {
            uiohook_napi_1.uIOhook.stop();
        }
        catch (error) {
            console.error('Failed to stop uIOhook:', error);
        }
        uiohook_napi_1.uIOhook.removeAllListeners();
        isUiohookStarted = false;
    }
}
//# sourceMappingURL=ipc-handlers.js.map