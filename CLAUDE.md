# supahscreenrecordah

macOS/Windows desktop screen + camera recorder built with Electron & TypeScript. Floating toolbar UI, overlays (name tags, waveforms, action feed), and FFmpeg-based export.

## Project Structure

```
src/
├── main/               # Electron main process
│   ├── ipc/            # IPC handlers by domain (recording, devices, config…)
│   ├── services/       # Business logic (activation, FFmpeg, permissions)
│   ├── windows/        # Window factory functions
│   └── input/          # Global input detection (keyboard, mouse via uiohook)
├── preload/            # Context bridge scripts per window
├── renderer/           # Browser-side code
│   ├── main/           # Preview window + overlay system
│   ├── toolbar/        # Floating recording toolbar
│   ├── edit-modal/     # Post-recording overlay settings
│   ├── onboarding/     # Setup wizard (permissions & dependencies)
│   └── lib/            # Shared utilities (audio FX, perf monitor)
├── shared/             # Code shared between main & renderer
└── types/              # TypeScript type definitions
pages/                  # HTML entry points (index, toolbar, edit-modal, onboarding)
assets/                 # Audio assets (notification sounds)
native/macos-cursor/    # Native C++/Obj-C addon for macOS cursor tracking
dist/                   # Compiled output
release/                # Packaged application
```

## Tech Stack

- **Language:** TypeScript (strict mode)
- **Framework:** Electron 35
- **Bundler:** tsup (renderer), tsc (main/preload)
- **Packaging:** electron-builder
- **Native:** node-addon-api, node-gyp (macOS cursor module)
- **Runtime dep:** uiohook-napi (global input hooking)

## Commands

```bash
npm run dev              # Start Electron in dev mode
npm run build            # Build all (main + preload + renderer)
npm run build:main       # Compile main process
npm run build:preload    # Compile preload scripts
npm run build:renderer   # Bundle renderer processes with tsup
npm run typecheck        # Type-check without emitting
npm run dist:win         # Build & package for Windows
```

## Code Quality Checks

Run before every commit:

```bash
npm run typecheck        # Zero TypeScript errors allowed
npm run build            # Must compile cleanly
```

No ESLint or Prettier configured — maintain consistent style manually.

## Organization Rules

- **One file per component/handler** — no monolith files.
- **Single responsibility** — each IPC handler, service, and renderer module does one thing.
- **Electron process separation** — never import main-process code in renderer or vice versa; use preload bridges.
- **Domain-split IPC** — add new IPC handlers in `src/main/ipc/` as separate files by feature.
- **Shared types** go in `src/shared/` or `src/types/`.
- **No dead code** — delete unused imports, functions, and files.
