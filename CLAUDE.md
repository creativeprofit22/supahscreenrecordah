# supahscreenrecordah (yaatuber)

macOS/Windows desktop screen + camera recorder built with Electron & TypeScript.

## Current Focus
**Phase:** Post-Recording Review Screen — Polish & Remaining Features

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

**Pending polish:**
- Smoother export transitions (longer crossfade, possible video dissolve)
- Stutter/repetition detection ("I'm... I'm", "to... to")

**Pending features (from original plan):**
- Auto-captions (Whisper word-level timestamps, burn in via FFmpeg ASS subtitles)
- Caption styles: YouTube Shorts, TikTok, MrBeast, Clean, Custom

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
│   │   └── review/          # Review controller, timeline renderer, interaction
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
- Launch from WSL: `cmd.exe /C "cd /D E:\Projects\Yaatuber && node node_modules\electron\cli.js ."`
- Never use CSS on `<video>` with MediaStream in Electron — use canvas `drawImage` instead
- Whisper binary + model auto-installed at startup to `<userData>/bin/` and `<userData>/whisper/`
- Last recording saved to `<userData>/last-recording.mp4` for recovery
- Analysis log written to `<userData>/review-analysis.log` for debugging
- Review screen uses remuxed playback file for both analysis and export (timestamp consistency)
