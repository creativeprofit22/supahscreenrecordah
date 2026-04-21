// Launches the packaged Windows exe, detached, from either WSL or Windows.
// Used by `npm run launch:win`.
//
// NOTE: Building the exe from WSL fails at electron-builder's code-signing
// step (wine required). So `win:go` invokes the whole build through cmd.exe
// rather than the local WSL npm. See scripts/build-and-launch-win.js.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const exePath = path.resolve(__dirname, '..', 'release', 'win-unpacked', 'supahscreenrecordah.exe');

const isWSL =
  process.platform === 'linux' &&
  fs.existsSync('/proc/version') &&
  fs.readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');

if (!isWSL && process.platform !== 'win32') {
  console.error('launch-win: only supported on Windows or WSL.');
  process.exit(1);
}

function toWindowsPath(p) {
  const m = p.match(/^\/mnt\/([a-z])\/(.*)$/);
  if (!m) return p.replace(/\//g, '\\');
  return `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}`;
}

const winExe = isWSL ? toWindowsPath(exePath) : exePath;
const winDir = path.dirname(winExe);
const exeName = path.basename(winExe);

if (!fs.existsSync(exePath)) {
  console.error('Packaged exe not found at:', exePath);
  console.error('Run `npm run dist:win` first (or `npm run win:go` to build + launch).');
  process.exit(1);
}

// `start "" /D <dir> <exe>` — the empty "" is the required title placeholder.
// Without it, `start` consumes the path as a title and "Windows cannot find
// the file" fires.
const child = spawn(
  'cmd.exe',
  ['/C', 'start', '', '/D', winDir, exeName],
  { stdio: 'inherit', detached: true, windowsHide: false },
);
child.unref();

console.log('Launched:', winExe);
