# supahscreenrecordah (yaatuber)

macOS/Windows desktop screen + camera recorder built with Electron & TypeScript. Floating toolbar UI, overlays, and FFmpeg-based export. Currently adding a "Shorts Mode" for 9:16 short-form content.

## Current Focus
**Phase:** Post-Recording Review Screen — Chunk 0/12

## Tech Stack
- **Language:** TypeScript (strict mode)
- **Framework:** Electron 35
- **Bundler:** tsdown (renderer IIFE), tsc (main/preload)
- **Test:** vitest
- **Check:** `npm run typecheck && npm run build`

## Dev Notes
- Windows Electron binary manually installed at `node_modules/electron/dist/electron.exe` (path.txt = `electron.exe`). Linux binary backed up as `electron-linux-backup`.
- Launch from WSL: `cmd.exe /C "cd /D E:\Projects\Yaatuber && node node_modules\electron\cli.js ."`
- `session.defaultSession.clearCache()` added to `app.whenReady()` in main/index.ts to bust Chromium disk cache during dev.
- Activation system from v2 exe was reverse-engineered and bypassed (educational challenge). Patched exe at `C:\Users\SPARTAN PC\Downloads\yaatuber-win-unpacked\`.

## Last Session (2026-04-07)
- Reverse-engineered yaatuber v2.0.0 exe: extracted asar, compared v1 vs v2, patched activation (`isActivated() → return true`)
- Started building 9:16 "Shorts Mode" — clean vertical layout with NO overlays (no name, socials, waveform, CTA, borders)
- **Window resize works**: main process resizes window + sets aspect ratio lock on ratio change (overlay.ts). Fixed min-size ordering bug.
- **CSS shorts-mode class**: hides all overlays via `display: none !important`, strips borders
- **`drawShortsFrame()`** added to recording.ts: clean compositor that only draws screen (top 65%) + camera (bottom 35%) with cover-crop, supports zoom + webcam blur
- **`fitShortsLayout()`** added to preview.ts: sets screen + camera sizes via `setAttribute('style', ...)` with `!important` on every property
- **BUG: Layout not visually applying despite correct computed styles.** Logs confirm `objectFit=cover, w=434px, h=478px` but user still sees 16:9 forced layout. Tried: cssText, setAttribute, !important, transition:none. Computed styles read back correctly but visual doesn't match. Suspect CSS transitions/animations from `.screen-video` class, a stale Chromium compositor layer, or the video element's intrinsic sizing overriding object-fit in Electron's renderer.
- Stopped at: debugging why inline styles with correct computed values don't visually render

## Next Steps
1. **FIX the 9:16 preview layout bug** — computed styles are correct but visuals don't match. Try: (a) completely remove `.screen-video` class in shorts mode and re-add a minimal class, (b) use a separate `<video>` element for shorts mode, (c) wrap screen in a clipping div, (d) check if Electron's GPU compositor is caching the old layer, (e) inspect in DevTools Elements panel to see actual rendered box
2. **Webcam background blur toggle** — code exists in `src/renderer/main/overlays/webcam-blur.ts` (MediaPipe selfie segmenter), already wired in `drawShortsFrame`. Needs a UI toggle accessible in shorts mode (toolbar button or keyboard shortcut)
3. **Auto-captions** — Whisper word-level timestamps, filler removal, 1-2 word bold display between screen and camera zones. Burn in via FFmpeg ASS subtitles at export
4. **Silence/filler auto-cut** — combine Whisper word output with existing `silence.js` detection + timeline segment system to auto-remove dead air and "uh/um"
5. **Cursor-following crop** — for 9:16, instead of showing full desktop, track cursor position and crop a narrow region. Spring physics already exist in `src/shared/zoom.ts` and `src/renderer/main/zoom.ts`

## Project Structure
```
src/
├── main/               # Electron main process
│   ├── ipc/            # IPC handlers by domain
│   ├── services/       # Business logic (FFmpeg, permissions, activation)
│   ├── windows/        # Window factory functions
│   └── input/          # Global input (keyboard, mouse via uiohook)
├── preload/            # Context bridge scripts
├── renderer/           # Browser-side code
│   ├── main/           # Preview window + overlay system
│   ├── toolbar/        # Floating recording toolbar
│   ├── edit-modal/     # Post-recording overlay settings
│   └── lib/            # Shared utilities (perf monitor)
├── shared/             # Code shared between main & renderer
└── types/              # TypeScript type definitions
pages/                  # HTML entry points
```

## Code Quality
- `npm run typecheck` — zero errors
- `npm run build` — must compile cleanly
- No ESLint/Prettier — maintain consistent style manually
