// One-shot: clean build → package Windows exe → launch it.
// Works from both WSL and Windows.
//
// From WSL, electron-builder's code-signing step needs wine (or we skip it),
// so we shell out to cmd.exe and let Windows' node.exe run `npm run dist:win`.
// From native Windows, we just spawn npm directly.

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const repoRoot = path.resolve(__dirname, '..');

const isWSL =
  process.platform === 'linux' &&
  fs.existsSync('/proc/version') &&
  fs.readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');

function toWindowsPath(p) {
  const m = p.match(/^\/mnt\/([a-z])\/(.*)$/);
  if (!m) return p.replace(/\//g, '\\');
  return `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}`;
}

function runBuild() {
  if (isWSL) {
    const winRoot = toWindowsPath(repoRoot);
    // Quoting the path under bash + cmd.exe chaining is a mess — `cd /D "..."`
    // survives iff no shell re-escapes it. We pass argv-array form (no shell)
    // and leave the path bare since the repo root has no spaces. If that ever
    // changes, switch to a tempfile .bat approach rather than fighting quotes.
    const cmd = `cd /D ${winRoot} && npm run dist:win`;
    console.log('> cmd.exe /C', cmd);
    const res = spawnSync('cmd.exe', ['/C', cmd], { stdio: 'inherit' });
    return res.status === 0;
  }
  if (process.platform === 'win32') {
    // Use npm.cmd on Windows — bare `npm` isn't executable on its own.
    const npm = process.env.npm_execpath || 'npm.cmd';
    const res = spawnSync(npm, ['run', 'dist:win'], { stdio: 'inherit', shell: true });
    return res.status === 0;
  }
  console.error('Unsupported platform for Windows build:', process.platform);
  return false;
}

console.log('=== Build ===');
if (!runBuild()) {
  console.error('Build failed — not launching.');
  process.exit(1);
}

console.log('=== Launch ===');
const launchScript = path.join(__dirname, 'launch-win.js');
const res = spawnSync(process.execPath, [launchScript], { stdio: 'inherit' });
process.exit(res.status ?? 1);
