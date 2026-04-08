# Build System Improvements

Comprehensive audit of the build pipeline — scripts, config, packaging, dev workflow, and output hygiene.

---

## 1. No `clean` step — stale artifacts persist in `dist/`

**Problem:** There's no `clean` or `prebuild` script. `dist/` accumulates stale files across builds:
- `dist/main/ipc-handlers.js` (51KB) + `.js.map` + `.d.ts.map` — the original monolithic file from before the IPC split. No source file exists at `src/main/ipc-handlers.ts` and nothing imports it, but it ships in the asar.
- `dist/main/services/activation.js` was deleted but `activation.d.ts`, `activation.d.ts.map`, and `activation.js.map` remain as orphans.
- `dist/main/ipc/activation.d.ts`, `activation.d.ts.map`, `activation.js.map` — same issue (source removed per earlier task).

**Fix:** Add a `clean` script and wire it into `build`:
```json
"clean": "node -e \"const fs=require('fs');fs.rmSync('dist',{recursive:true,force:true})\"",
"build": "npm run clean && npm run build:main && npm run build:preload && npm run build:renderer"
```

**Impact:** Prevents ~60KB+ of dead code shipping in the asar. Eliminates confusion when debugging.

---

## 2. Source maps and declarations ship in production asar

**Problem:** `tsc` generates `.js.map`, `.d.ts`, and `.d.ts.map` for every main-process and shared file. These all get packed into `app.asar` via the `"files": ["dist/**/*"]` pattern. In the current `dist/main/` tree alone there are ~40 `.map` files and ~40 `.d.ts` files — pure bloat for an end-user build.

Source maps also expose the full original TypeScript source to anyone who extracts the asar.

**Fix options (pick one):**
- **A) Exclude from electron-builder** — add to the `build.files` pattern:
  ```json
  "files": [
    "dist/**/*",
    "!dist/**/*.d.ts",
    "!dist/**/*.d.ts.map",
    "!dist/**/*.js.map",
    "pages/**/*",
    "assets/**/*",
    "node_modules/**/*",
    "native/**/*"
  ]
  ```
- **B) Stop generating them** — remove `"declaration": true`, `"declarationMap": true`, `"sourceMap": true` from `tsconfig.main.json` (or override them). Declarations are only useful if this were a library. Source maps are useful for debugging — consider generating them in dev only.
- **Recommended:** Option A (keep maps for local debugging, exclude from package).

---

## 3. `build:preload` is an unreadable one-liner

**Problem:** The `build:preload` script in `package.json` is a single ~600-character line that:
1. Runs tsdown 4 times (once per preload file)
2. Runs an inline Node.js script to rename `.cjs` → `.js`

This is fragile, hard to read, and impossible to maintain.

**Fix:** Extract into `scripts/build-preload.js`:
```js
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const preloads = ['main-preload', 'toolbar-preload', 'edit-modal-preload', 'onboarding-preload'];
const outDir = 'dist/preload';

for (const name of preloads) {
  execSync(`npx tsdown src/preload/${name}.ts --format cjs --out-dir ${outDir} --no-dts --no-clean --external electron`, { stdio: 'inherit' });
}

// Rename .cjs → .js (Electron preloads must be .js)
for (const name of preloads) {
  const src = path.join(outDir, `${name}.cjs`);
  const dst = path.join(outDir, `${name}.js`);
  if (fs.existsSync(src)) fs.renameSync(src, dst);
}
```

Then: `"build:preload": "node scripts/build-preload.js"`

**Same applies to `build:renderer`** and `build:css` — both are long inline scripts.

---

## 4. `build:renderer` is similarly an unreadable one-liner

**Problem:** Same issue as preload — 4 sequential tsdown invocations + inline rename script, all on one line.

**Fix:** Extract into `scripts/build-renderer.js`:
```js
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

// Bundle renderers
const renderers = ['main', 'toolbar', 'edit-modal', 'onboarding'];
for (const name of renderers) {
  execSync(`npx tsdown src/renderer/${name}/index.ts --format iife --out-dir dist/renderer/${name} --no-dts`, { stdio: 'inherit' });
}

// Rename .iife.js → .js
for (const name of renderers) {
  const src = path.join('dist/renderer', name, 'index.iife.js');
  const dst = path.join('dist/renderer', name, 'index.js');
  if (fs.existsSync(src)) fs.renameSync(src, dst);
}
```

Then:
```json
"build:renderer": "node scripts/build-renderer.js",
"build:css": "(handled inside build-renderer.js)"
```

---

## 5. No dev watch mode — full rebuild required for every change

**Problem:** `npm run dev` just runs `electron .` on whatever's in `dist/`. Any source change requires manually running `npm run build` then restarting. For a project with 53 source files, this kills iteration speed.

**Fix:** Add a `dev` script that watches and rebuilds:
```json
"dev": "npm run build && node scripts/dev.js"
```

Where `scripts/dev.js`:
1. Spawns `tsc -p tsconfig.main.json --watch --preserveWatchOutput` for main process
2. Spawns tsdown watchers for preload + renderer (tsdown supports `--watch`)
3. Spawns `electron .` 
4. Optionally: uses `chokidar` or fs.watch to restart Electron when main process files change

**Lighter alternative** (no new deps): Add individual watch scripts:
```json
"watch:main": "tsc -p tsconfig.main.json --watch",
"watch:renderer": "tsdown src/renderer/main/index.ts --format iife --out-dir dist/renderer/main --no-dts --watch",
"dev": "npm run build && electron ."
```
Developer runs `watch:main` and `watch:renderer` in separate terminals.

---

## 6. Missing app icon in `assets/`

**Problem:** `src/main/windows/main-window.ts:13` and `src/main/index.ts:47` both reference `assets/icon_1024x1024.png`, but this file doesn't exist in `assets/` (only `notif.mp3` and `pep.mp3` are there). The code handles this gracefully (`icon.isEmpty()` check), but the window has no icon.

**Fix:** Add the app icon file to `assets/`. For Windows, also add `assets/icon.ico` (256x256 minimum) and reference it in `electron-builder`:
```json
"win": {
  "target": "dir",
  "icon": "assets/icon.ico"
}
```

---

## 7. No macOS or Linux build targets

**Problem:** Only `dist:win` exists. The app description says "macOS/Windows desktop screen + camera recorder" and the code has extensive macOS-specific logic (CGWindowList, dock icon, permissions), but there's no `dist:mac` script.

**Fix:**
```json
"dist:mac": "npm run build && npx electron-builder --mac --dir",
"dist:linux": "npm run build && npx electron-builder --linux --dir",
"dist:all": "npm run build && npx electron-builder --mac --win --linux --dir"
```

And add mac/linux config to the `build` section:
```json
"mac": {
  "target": "dir",
  "category": "public.app-category.video"
},
"linux": {
  "target": "dir"
}
```

---

## 8. No installer target — only unpacked directory

**Problem:** `"win": { "target": "dir" }` produces an unpacked folder, not an installer. End users need an `.exe` installer (NSIS) or at minimum a portable `.zip`.

**Fix:** Change win target or add both:
```json
"win": {
  "target": ["nsis", "dir"]
}
```

For macOS: `"target": ["dmg", "dir"]`

---

## 9. `native/macos-cursor/` ships with `build/` directory

**Problem:** `"files": ["native/**/*"]` includes `native/macos-cursor/build/` (node-gyp intermediate artifacts — `.o` files, Makefiles, etc.) and `native/macos-cursor/bin/` (prebuilt `.node` binary). Only the `.node` binary is needed at runtime.

**Fix:** Narrow the pattern:
```json
"files": [
  "native/**/bin/**",
  "native/**/index.js",
  "native/**/package.json"
]
```

Or add excludes: `"!native/**/build", "!native/**/src"`

---

## 10. `node_modules/**/*` in files includes everything

**Problem:** `"files": ["node_modules/**/*"]` tells electron-builder to include ALL of `node_modules`. While electron-builder does prune devDependencies, the explicit glob can override smart filtering and include unnecessary files (docs, tests, READMEs, etc.).

**Fix:** Remove the explicit `node_modules` pattern — electron-builder handles it automatically:
```json
"files": [
  "dist/**/*",
  "!dist/**/*.d.ts",
  "!dist/**/*.d.ts.map",
  "!dist/**/*.js.map",
  "pages/**/*",
  "assets/**/*",
  "native/**/bin/**",
  "native/**/index.js",
  "native/**/package.json"
]
```

---

## 11. `package.json` description says "macOS desktop app"

**Problem:** Line 4: `"description": "macOS desktop app for screen + camera recording with a floating toolbar UI"` — but the app also targets Windows.

**Fix:** `"description": "macOS/Windows desktop app for screen + camera recording with a floating toolbar UI"`

---

## 12. No `asarUnpack` config for native modules

**Problem:** `uiohook-napi` (which has native `.node` binaries) gets auto-unpacked by electron-builder because it detects native modules. But this is implicit — if it ever fails, the app silently breaks. The `native/macos-cursor` addon also needs unpacking.

**Fix:** Make it explicit:
```json
"asarUnpack": [
  "node_modules/uiohook-napi/**",
  "native/**"
]
```

---

## 13. CSP allows `'unsafe-inline'` for styles

**Problem:** All 4 HTML files have `style-src 'self' 'unsafe-inline'` in the CSP. This weakens the security policy — inline styles can be used for CSS-based exfiltration attacks.

**Fix:** Remove `'unsafe-inline'` if possible. The app uses external CSS files (`dist/renderer/styles/*.css`), so inline styles shouldn't be needed unless JS dynamically sets `element.style`. If it does, consider using CSS classes or a nonce-based approach instead.

**Risk:** Some dynamic styling in the renderer (canvas overlays, positioning) may rely on inline styles. Audit before removing.

---

## 14. `GrantFileProtocolExtraPrivileges` fuse left enabled

**Problem:** `scripts/afterPack.js` line 52-53 notes that `GrantFileProtocolExtraPrivileges` is intentionally left enabled because "the app currently loads HTML via file:// protocol." But the app actually uses the `app://` custom protocol now (see `protocol.ts`). All window `loadURL` calls use `app://./pages/...`.

**Fix:** Disable this fuse since the app no longer uses `file://`:
```js
[FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
```

This prevents `file://` URLs from having elevated privileges, reducing attack surface.

---

## 15. Renderer bundle is large (110KB unminified)

**Problem:** `dist/renderer/main/index.js` is 110KB. tsdown's IIFE output doesn't appear to be minified.

**Fix:** Add `--minify` to the tsdown renderer builds:
```
tsdown src/renderer/main/index.ts --format iife --out-dir dist/renderer/main --no-dts --minify
```

This could reduce the bundle to ~40-50KB, improving load time.

---

## 16. No build verification / smoke test in CI

**Problem:** No `postbuild` check or CI pipeline. It's easy to ship a broken build — the preload bundling issue from the earlier plan is proof.

**Fix:** Add a basic post-build verification:
```json
"postbuild": "node -e \"const fs=require('fs');const files=['dist/main/index.js','dist/preload/main-preload.js','dist/preload/toolbar-preload.js','dist/renderer/main/index.js','dist/renderer/styles/main.css'];for(const f of files){if(!fs.existsSync(f))throw new Error('Missing: '+f)}\""
```

Or better, extract to `scripts/verify-build.js` that checks all expected output files exist and are non-empty.

---

## Summary — Priority Order

| # | Improvement | Effort | Impact |
|---|-----------|--------|--------|
| 1 | Add `clean` step | 5 min | High — removes stale dead code from builds |
| 2 | Exclude `.d.ts` / `.map` from asar | 5 min | High — smaller package, no source leak |
| 14 | Disable `GrantFileProtocolExtraPrivileges` fuse | 2 min | High — security hardening (free win) |
| 11 | Fix description | 1 min | Low — correctness |
| 15 | Minify renderer bundles | 2 min | Medium — ~60% size reduction |
| 3+4 | Extract build scripts to files | 20 min | Medium — maintainability |
| 9+10 | Tighten electron-builder file patterns | 10 min | Medium — smaller package |
| 12 | Explicit `asarUnpack` | 2 min | Low — prevents future breakage |
| 6 | Add app icon | 5 min | Medium — polish |
| 8 | Add installer targets (NSIS/DMG) | 10 min | High — distribution readiness |
| 7 | Add mac/linux dist scripts | 5 min | Medium — cross-platform |
| 5 | Dev watch mode | 30 min | High — DX improvement |
| 16 | Post-build verification | 15 min | Medium — prevents shipping broken builds |
| 13 | Remove unsafe-inline CSP | 30 min | Low — security (needs audit) |
