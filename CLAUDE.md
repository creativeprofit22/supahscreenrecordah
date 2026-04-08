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
│   ├── ipc/                 # IPC handlers, one file per domain
│   ├── input/               # Global input (keyboard, mouse, active window)
│   ├── services/            # Business logic
│   │   ├── ffmpeg/          # FFmpeg encoding/remux
│   │   ├── assemblyai/      # AssemblyAI transcription
│   │   ├── thumbnail/       # Thumbnail generation
│   │   ├── whisper.ts       # Whisper speech-to-text
│   │   ├── waveform.ts      # Waveform data generation
│   │   └── post-export.ts   # Post-processing after export
│   └── windows/             # Window factory functions
├── preload/                 # Context bridge scripts (one per window)
├── renderer/                # Browser-side code
│   ├── main/                # Preview window + overlay system
│   │   ├── audio/           # Audio visualization
│   │   ├── overlays/        # Visual overlays (webcam-blur, etc.)
│   │   └── review/          # Post-recording review screen
│   ├── toolbar/             # Floating recording toolbar
│   ├── edit-modal/          # Post-recording overlay settings
│   ├── onboarding/          # First-run onboarding
│   ├── thumbnail/           # Thumbnail renderer
│   ├── styles/              # CSS stylesheets
│   └── lib/                 # Shared utilities (perf monitor)
├── shared/                  # Shared types, channels, constants
└── types/                   # TypeScript type declarations
pages/                       # HTML entry points (one per window)
assets/                      # Static assets (icons, sounds)
native/                      # Native modules (macos-cursor)
tests/                       # Unit and integration tests
scripts/                     # Build and dev scripts
```

## Organization Rules

- **IPC handlers** -> `src/main/ipc/`, one file per domain
- **Services** -> `src/main/services/`, grouped by feature
- **Renderer features** -> own folder under `src/renderer/`
- **Overlays** -> `src/renderer/main/overlays/`
- **Shared code** -> `src/shared/`
- **Types** -> `src/types/` or co-located with usage
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

- Windows Electron binary at `node_modules/electron/dist/electron.exe`
- Launch from WSL: `cmd.exe /C "cd /D E:\Projects\Yaatuber && node node_modules\electron\cli.js ."`
- `session.defaultSession.clearCache()` in main/index.ts busts Chromium disk cache during dev
- Never use CSS on `<video>` with MediaStream in Electron — use canvas `drawImage` instead
