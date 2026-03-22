const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const preloads = ['main-preload', 'toolbar-preload', 'edit-modal-preload', 'onboarding-preload', 'thumbnail-preload'];
const outDir = 'dist/preload';

for (const name of preloads) {
  execSync(
    `npx tsdown src/preload/${name}.ts --format cjs --out-dir ${outDir} --no-dts --no-clean --deps.neverBundle electron`,
    { stdio: 'inherit' },
  );
}

// Rename .cjs → .js (Electron preloads must be .js)
for (const name of preloads) {
  const src = path.join(outDir, `${name}.cjs`);
  const dst = path.join(outDir, `${name}.js`);
  if (fs.existsSync(src)) fs.renameSync(src, dst);
}
