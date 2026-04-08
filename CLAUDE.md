# supahscreenrecordah (yaatuber)

macOS/Windows desktop screen + camera recorder built with Electron & TypeScript. Floating toolbar UI, overlays, and FFmpeg-based export with 9:16 Shorts Mode.

## Tech Stack

- **Language:** TypeScript (strict mode)
- **Framework:** Electron 35
- **Bundler:** tsdown (renderer IIFE), tsc (main/preload)
- **Test:** vitest
- **Dependencies:** uiohook-napi (global input), @mediapipe/tasks-vision (webcam blur)

## Project Structure

```
src/
├── main/                    # Electron main process
│   ├── ipc/                 # IPC handlers by domain
│   ├── input/               # Global input (keyboard, mouse via uiohook)
│   ├── services/            # Business logic
│   │   ├── ffmpeg/          # FFmpeg encoding/remux
│   │   ├── assemblyai/      # Transcription service
│   │   └── thumbnail/       # Thumbnail generation
│   └── windows/             # Window factory functions
├── preload/                 # Context bridge scripts
├── renderer/                # Browser-side code
│   ├── main/                # Preview window + overlay system
│   │   ├── audio/           # Audio visualization
│   │   └── overlays/        # Visual overlays (webcam-blur, etc.)
│   ├── toolbar/             # Floating recording toolbar
│   ├── edit-modal/          # Post-recording overlay settings
│   ├── onboarding/          # First-run onboarding
│   ├── thumbnail/           # Thumbnail renderer
│   ├── styles/              # CSS stylesheets
│   └── lib/                 # Shared utilities (perf monitor)
├── shared/                  # Code shared between main & renderer
└── types/                   # TypeScript type definitions
pages/                       # HTML entry points
assets/                      # Static assets (icons, images)
native/                      # Native binaries (FFmpeg, etc.)
```

## Organization Rules

- **IPC handlers** go in `src/main/ipc/`, one file per domain
- **Services** go in `src/main/services/`, grouped by feature
- **Renderer features** get their own folder under `src/renderer/`
- **Overlays** go in `src/renderer/main/overlays/`
- **Shared code** between main/renderer goes in `src/shared/`
- **Types** go in `src/types/` or co-located with usage
- Single responsibility per file, clear descriptive names

## Code Quality

After editing ANY file, run:

```bash
npm run typecheck && npm run build
```

Fix ALL errors before continuing. Zero tolerance — no skipping warnings.

- No ESLint/Prettier — maintain consistent style manually
- Run tests: `npm test`

## Dev Notes

- Windows Electron binary at `node_modules/electron/dist/electron.exe` (path.txt = `electron.exe`)
- Launch from WSL: `cmd.exe /C "cd /D E:\Projects\Yaatuber && node node_modules\electron\cli.js ."`
- `session.defaultSession.clearCache()` in main/index.ts busts Chromium disk cache during dev
- Never use CSS on `<video>` with MediaStream in Electron — use canvas `drawImage` instead

## Current Focus

**Phase:** Post-Recording Review Screen — Chunk 0/12
