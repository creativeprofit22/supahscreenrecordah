# supahscreenrecordah (yaatuber)

macOS/Windows desktop screen + camera recorder built with Electron & TypeScript.

## Tech Stack

- **Language:** TypeScript (strict mode)
- **Framework:** Electron 35
- **Bundler:** tsdown (renderer IIFE), tsc (main/preload)
- **Test:** vitest
- **Key deps:** uiohook-napi, @mediapipe/tasks-vision

## Project Structure

```
src/
├── main/                    # Electron main process
│   ├── ipc/                 # IPC handlers (one file per domain)
│   ├── input/               # Global input (keyboard, mouse, active window)
│   ├── services/            # Business logic (ffmpeg, assemblyai, thumbnail, etc.)
│   └── windows/             # Window factory functions
├── preload/                 # Context bridge scripts (one per window)
├── renderer/                # Browser-side code
│   ├── main/                # Preview window, overlays, review screen
│   ├── toolbar/             # Floating recording toolbar
│   ├── edit-modal/          # Post-recording overlay settings
│   ├── onboarding/          # First-run onboarding
│   ├── thumbnail/           # Thumbnail renderer
│   ├── styles/              # CSS stylesheets
│   └── lib/                 # Shared utilities
├── shared/                  # Shared types, channels, constants
└── types/                   # TypeScript type declarations
pages/                       # HTML entry points (one per window)
assets/                      # Static assets (sounds)
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

- Launch from WSL: `cmd.exe /C "cd /D E:\Projects\Yaatuber && node node_modules\electron\cli.js ."`
- Never use CSS on `<video>` with MediaStream in Electron — use canvas `drawImage` instead
