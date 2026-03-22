// Patch @mediapipe/tasks-vision package.json exports map.
// The published package has a broken "exports" field that mixes condition keys
// (import/require/default/types) with subpath entries (./vision_wasm_*.js/wasm)
// at the same level, AND those subpath files don't exist.  This causes rolldown
// (used by tsdown) to reject the entire package with "Invalid package configuration".
//
// Fix: restructure the exports so the "." entry uses a proper conditions object.

const fs = require('fs');
const path = require('path');

const pkgPath = path.join(
  __dirname,
  '..',
  'node_modules',
  '@mediapipe',
  'tasks-vision',
  'package.json',
);

if (!fs.existsSync(pkgPath)) {
  // Package not installed (yet) — nothing to patch.
  process.exit(0);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

// Only patch if the exports map is in the broken flat format.
if (pkg.exports && !pkg.exports['.']) {
  pkg.exports = {
    '.': {
      types: './vision.d.ts',
      import: './vision_bundle.mjs',
      require: './vision_bundle.cjs',
      default: './vision_bundle.mjs',
    },
  };
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log('[patch-mediapipe] Fixed @mediapipe/tasks-vision exports map');
} else {
  console.log('[patch-mediapipe] @mediapipe/tasks-vision exports map already OK');
}
