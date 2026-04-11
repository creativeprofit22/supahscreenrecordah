const fs = require('fs');

const requiredFiles = [
  'dist/main/index.js',
  'dist/preload/main-preload.js',
  'dist/preload/toolbar-preload.js',
  'dist/preload/edit-modal-preload.js',
  'dist/preload/onboarding-preload.js',
  'dist/preload/thumbnail-preload.js',
  'dist/preload/splash-preload.js',
  'dist/renderer/main/index.js',
  'dist/renderer/toolbar/index.js',
  'dist/renderer/edit-modal/index.js',
  'dist/renderer/onboarding/index.js',
  'dist/renderer/styles/main.css',
];

const missing = [];
const empty = [];

for (const file of requiredFiles) {
  if (!fs.existsSync(file)) {
    missing.push(file);
  } else if (fs.statSync(file).size === 0) {
    empty.push(file);
  }
}

if (missing.length > 0 || empty.length > 0) {
  if (missing.length > 0) console.error('Missing build outputs:', missing.join(', '));
  if (empty.length > 0) console.error('Empty build outputs:', empty.join(', '));
  process.exit(1);
}

console.log(`Build verified: ${requiredFiles.length} expected files present`);
