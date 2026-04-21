# supahscreenrecordah (yaatuber)

macOS/Windows desktop screen + camera recorder built with Electron & TypeScript.

## Current Focus
**Phase:** Post-Recording Review Screen — Music Mixer & Timeline Polish

**Done:**
- Whisper.cpp integration (binary auto-install at startup, word-level transcription)
- Timeline with waveform + silence/filler segment overlays (canvas-based)
- Click-to-toggle segments, drag trim handles with snap
- Bulk actions (auto-trim dropdown: remove silences >2s/3s/5s, remove fillers, remove all)
- Preview playback skipping consecutive disabled segments in one jump
- Export with reviewed segments via FFmpeg trim+concat (uses remuxed file for timestamp accuracy)
- Audio crossfade (50ms) at cut boundaries
- Last-recording persistence + recovery banner on startup
- Toolbar hides during review, main window maximizes
- Trailing-ellipsis filler detection ("to...", "I'm...", etc.)
- Word duration clamping (0.9s max) to expose hidden silences
- Short speech gap bridging (<0.8s) between adjacent non-speech segments
- Smoother export cuts: 150ms audio crossfade + 80ms video fade-to-black at cut boundaries
- Stutter/repetition detection ("I'm... I'm", "to... to") flagged as fillers
- Auto-captions: toggle in review bar, style presets, Whisper words → ASS → FFmpeg burn-in
- Manual cut regions: drag on empty waveform to create custom cuts
- Undo/redo system with buttons + Ctrl+Z/Ctrl+Shift+Z shortcuts
- Timeline zoom (Ctrl+scroll) + pan (scroll) + scrollbar
- Right-click segments to dismiss (convert back to speech)
- Music mixer: post-export screen with dual-track timeline, library, volume, fade in/out, Web Audio preview

**Pending features (from original plan):**
- Caption styles: Custom user-defined style editor
- Music mixer: fix timeline interaction (drag to reposition, Shift+drag to cut — not working)
- Future: destructive timeline editing (delete removes gaps, timeline collapses, music on main timeline)

## Last Session (2026-04-13)
- Added manual cut regions (drag on empty timeline to create 'manual' type segments)
- Built complete music mixer feature (15 files: 7 new, 8 modified)
  - Architecture: `src/renderer/main/music/` (mixer controller, timeline renderer, interaction)
  - Backend: `src/main/services/music-library.ts`, `src/main/services/ffmpeg/music-mix.ts`, `src/main/ipc/music.ts`
  - Types: `src/shared/music-types.ts`, channels in `src/shared/channels.ts`
- Fixed CSP issue: `file://` URLs blocked in Electron renderer → added `readFileAsBuffer` IPC to serve local files as ArrayBuffers
- Music mixer loads the exported video (with cuts + captions) not the raw recording
- **Stopped at:** Music track loads and waveform renders, but timeline interactions don't work — user cannot drag to reposition music or create cuts. The playhead (seek) works. Issue is likely in `music-interaction.ts` hit detection or the interaction→controller wiring.

## Next Steps
1. Fix music timeline interaction — drag to reposition music track, Shift+drag to cut regions, click cuts to toggle
2. Caption styles: custom user-defined style editor
3. Future: rearchitect timeline as destructive editor (gaps collapse on delete, music integrated into main timeline)

## Tech Stack
- **Language:** TypeScript (strict mode)
- **Framework:** Electron 35
- **Bundler:** tsdown (renderer IIFE), tsc (main/preload)
- **Test:** vitest
- **Key deps:** uiohook-napi, @mediapipe/tasks-vision, whisper.cpp (binary)

## Project Structure
```
src/
├── main/                    # Electron main process
│   ├── ipc/                 # IPC handlers (one file per domain)
│   ├── input/               # Global input (keyboard, mouse, active window)
│   ├── services/            # Business logic (ffmpeg, whisper, waveform, etc.)
│   └── windows/             # Window factory functions
├── preload/                 # Context bridge scripts (one per window)
├── renderer/                # Browser-side code
│   ├── main/                # Preview window, overlays, review screen
│   │   ├── review/          # Review controller, timeline renderer, interaction
│   │   └── music/           # Music mixer controller, timeline, interaction
│   ├── toolbar/             # Floating recording toolbar
│   ├── edit-modal/          # Post-recording overlay settings
│   ├── onboarding/          # First-run onboarding
│   ├── thumbnail/           # Thumbnail renderer
│   ├── styles/              # CSS stylesheets
│   └── lib/                 # Shared utilities
├── shared/                  # Shared types, channels, constants
└── types/                   # TypeScript type declarations
pages/                       # HTML entry points (one per window)
```

## Code Quality
After editing ANY file, run:
```bash
npm run typecheck && npm run build
```
Fix ALL errors before continuing. No ESLint/Prettier — maintain consistent style manually.

## Dev Notes
- Launch dev (unpackaged, from source): `cmd.exe /C "cd /D E:\Projects\Yaatuber && node node_modules\electron\cli.js ."`
- **Build + launch packaged Windows exe: `npm run win:go`** — ALWAYS use this for
  "rebuild the extracted exe and launch on Windows" requests. It runs a clean
  build (`dist:win`) and launches the packaged exe detached via `launch-win.js`.
  Do NOT run `npx electron-builder --win --dir` directly — that skips the tsc/tsdown
  build step, so stale `dist/` files get packaged and the exe throws "JavaScript
  error" or "Windows cannot find a file" at launch.
- Build only (no launch): `npm run dist:win`
- Launch only (exe must already exist): `npm run launch:win`
- Never use CSS on `<video>` with MediaStream in Electron — use canvas `drawImage` instead
- Never use `file://` URLs in renderer — use IPC `readFileAsBuffer` to load local files as ArrayBuffers
- Whisper binary + model auto-installed at startup to `<userData>/bin/` and `<userData>/whisper/`
- Last recording saved to `<userData>/last-recording.mp4` for recovery
- Music library persisted to `<userData>/music-library.json`
- Analysis log written to `<userData>/review-analysis.log` for debugging
- Review screen uses remuxed playback file for both analysis and export (timestamp consistency)
