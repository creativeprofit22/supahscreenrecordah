# Fix Packaged Build — Blank Blue Screen

## Root Cause

**The preload scripts crash on startup** because all windows use `sandbox: true`, but the preload scripts (compiled with plain `tsc`) use `require("../shared/channels")` to import a local module. In Electron's sandboxed preload environment, `require()` only works for `electron` and a few Node.js builtins — **local file requires are forbidden**.

This means:
1. Preload crashes → `window.mainAPI` / `window.toolbarAPI` never exposed
2. Renderer JS calls `window.mainAPI.onMousePosition(...)` → `TypeError: Cannot read properties of undefined`
3. Script dies → only bare HTML/CSS renders (blue background from `.preview-container`)

### Secondary issue (already fixed)
The preload paths in all 4 window files used `path.join(__dirname, '..', 'preload', ...)` which resolves to `dist/main/preload/` but preload files are at `dist/preload/`. Fixed to `'..', '..', 'preload'`.

### Tertiary issue (already fixed)
Google Fonts `<link>` tags were render-blocking with no internet. Removed from all 4 HTML files.

## Fix: Bundle Preload Scripts

Change `build:preload` from plain `tsc` to `tsdown` (already a project dependency), which will **inline** the `require("../shared/channels")` dependency into each preload file as a self-contained bundle.

### Files to Change

#### 1. `package.json` — Update `build:preload` script

Replace:
```json
"build:preload": "tsc -p tsconfig.preload.json"
```

With (bundle each preload with tsdown, similar to how renderers are built):
```json
"build:preload": "tsdown src/preload/main-preload.ts --format cjs --out-dir dist/preload --no-dts --external electron && tsdown src/preload/toolbar-preload.ts --format cjs --out-dir dist/preload --no-dts --external electron && tsdown src/preload/edit-modal-preload.ts --format cjs --out-dir dist/preload --no-dts --external electron && tsdown src/preload/onboarding-preload.ts --format cjs --out-dir dist/preload --no-dts --external electron"
```

Key flags:
- `--format cjs` — preloads must be CommonJS (Electron requirement)
- `--external electron` — don't bundle `electron` module (must use Electron's runtime version)
- `--no-dts` — no type declarations needed for preload bundles

**Note:** tsdown output might produce `main-preload.cjs` filenames. Need to verify and potentially rename or update the window preload paths. May need a rename step like the renderer build has.

#### 2. Verify preload output filenames

After building, check if tsdown outputs `main-preload.cjs` or `main-preload.js`. If `.cjs`:
- Either add a rename step in the build script
- Or update all 4 window files to reference `.cjs` extension

#### 3. Preload path fix (already done)

All 4 window files in `src/main/windows/` already fixed:
- `main-window.ts` — line 23: `'..', '..', 'preload'`
- `toolbar-window.ts` — line 30: `'..', '..', 'preload'`
- `edit-modal-window.ts` — line 29: `'..', '..', 'preload'`
- `onboarding-window.ts` — line 28: `'..', '..', 'preload'`

#### 4. Google Fonts removal (already done)

All 4 HTML files in `pages/` already cleaned up.

## Verification

1. `npm run build` — must compile cleanly
2. `npm run dist:win` — package for Windows
3. Run `E:\Projects\Yaatuber\release\win-unpacked\supahscreenrecordah.exe`
4. Expect: toolbar visible at bottom of screen, main window shows preview with screen/camera options
5. Open DevTools (Ctrl+Shift+I) to check for console errors if still broken

## Risk

- tsdown CJS output filename might differ from what the window preload paths expect (`.cjs` vs `.js`)
- If tsdown doesn't handle the `electron` external correctly, the preload could still fail
- Fallback: remove `sandbox: true` from all windows (less secure but eliminates the require restriction entirely)
