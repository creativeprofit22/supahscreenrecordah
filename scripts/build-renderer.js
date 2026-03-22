const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Copy CSS
const cssDir = 'src/renderer/styles';
const cssDst = 'dist/renderer/styles';
fs.mkdirSync(cssDst, { recursive: true });
for (const f of fs.readdirSync(cssDir).filter(f => f.endsWith('.css'))) {
  fs.copyFileSync(path.join(cssDir, f), path.join(cssDst, f));
}

// Bundle renderers (minified)
const renderers = ['main', 'toolbar', 'edit-modal', 'onboarding', 'thumbnail'];
for (const name of renderers) {
  execSync(
    `npx tsdown src/renderer/${name}/index.ts --format iife --out-dir dist/renderer/${name} --no-dts --minify`,
    { stdio: 'inherit' },
  );
}

// Rename .iife.js → .js
for (const name of renderers) {
  const src = path.join('dist/renderer', name, 'index.iife.js');
  const dst = path.join('dist/renderer', name, 'index.js');
  if (fs.existsSync(src)) fs.renameSync(src, dst);
}
