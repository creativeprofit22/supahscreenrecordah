# supahscreenrecordah — Modular Project Structure Plan

## Current State

The project has compiled JS output from the original TypeScript source (extracted from the v1.0.8 installer). Everything lives under `dist/` with flat HTML files at root. We need to reconstruct the TypeScript source in a clean, modular structure.

## Proposed Folder Structure

```
supahscreenrecordah/
├── package.json                    # Full dev deps (electron, typescript, electron-builder, etc.)
├── tsconfig.json                   # Base TS config
├── tsconfig.main.json              # Main process config (Node target)
├── tsconfig.preload.json           # Preload config (Node + DOM)
├── tsconfig.renderer.json          # Renderer config (DOM target)
├── electron-builder.yml            # Build/packaging config
├── .gitignore
├── .eslintrc.cjs                   # Linting config
├── README.md
│
├── assets/                         # Static assets (audio, icons)
│   ├── notif.mp3
│   ├── pep.mp3
│   └── icons/                      # App icons for all platforms
│
├── native/                         # Native addons (macOS cursor)
│   └── macos-cursor/
│       ├── binding.gyp
│       ├── package.json
│       ├── index.js
│       └── src/
│           └── macos_cursor.mm
│
├── src/
│   ├── main/                       # Main (Node) process
│   │   ├── index.ts                # App entry — lifecycle, session, permissions
│   │   ├── store.ts                # Config persistence (JSON file store)
│   │   │
│   │   ├── ipc/                    # IPC handlers — split by domain
│   │   │   ├── index.ts            # Re-exports registerAllHandlers()
│   │   │   ├── recording.ts        # Start/stop/pause/resume/export handlers
│   │   │   ├── devices.ts          # Screen source enumeration (+ macOS CGWindowList)
│   │   │   ├── playback.ts         # Prepare/cleanup playback temp files
│   │   │   ├── file.ts             # Save recording + post-processing trigger
│   │   │   ├── overlay.ts          # Edit modal open/close/save/preview, CTA forwarding
│   │   │   ├── mouse.ts            # Mouse tracking start/stop, position forwarding
│   │   │   ├── config.ts           # Config get/save handlers
│   │   │   ├── app-control.ts      # Quit, open-external, check-update
│   │   │   ├── activation.ts       # Activation check/activate/deactivate handlers
│   │   │   ├── onboarding.ts       # Permission checks, dependency install, complete
│   │   │   └── helpers.ts          # isValidSender(), sendStateToToolbar()
│   │   │
│   │   ├── services/               # Business logic services
│   │   │   ├── activation.ts       # License activation (HMAC, device fingerprint, remote API)
│   │   │   ├── dependencies.ts     # FFmpeg finder/installer
│   │   │   ├── permissions.ts      # macOS permission checks/requests
│   │   │   └── ffmpeg/             # FFmpeg processing pipeline
│   │   │       ├── index.ts        # Re-exports
│   │   │       ├── post-process.ts # Two-pass loudnorm, voice enhancement, fallback
│   │   │       ├── filters.ts      # VOICE_ENHANCE_FILTER_BASE, loudnorm constants
│   │   │       └── encode.ts       # VIDEO_ENCODE_FLAGS, H.264 settings
│   │   │
│   │   ├── windows/                # Window factory functions
│   │   │   ├── main-window.ts      # 1280×720, 16:9 aspect, preview window
│   │   │   ├── toolbar-window.ts   # Always-on-top floating toolbar
│   │   │   ├── edit-modal-window.ts# Overlay settings modal
│   │   │   └── onboarding-window.ts# Activation/permissions wizard
│   │   │
│   │   └── input/                  # Global input detection (uiohook)
│   │       ├── index.ts            # Setup/teardown uiohook, export stopUiohook()
│   │       ├── keyboard.ts         # Keycode maps, shortcut detection, typing buffer
│   │       ├── mouse.ts            # Click detection, scroll tracking
│   │       └── active-window.ts    # macOS frontmost app detection via osascript
│   │
│   ├── preload/                    # Context-bridge preload scripts
│   │   ├── main-preload.ts         # mainAPI — preview, recording, mouse, cursor, actions
│   │   ├── toolbar-preload.ts      # toolbarAPI — screens, recording, config, updates
│   │   ├── edit-modal-preload.ts   # editModalAPI — close, save, preview, CTA test
│   │   └── onboarding-preload.ts   # onboardingAPI — activate, permissions, deps
│   │
│   ├── renderer/                   # Browser-side renderer scripts
│   │   ├── main/                   # Main preview window renderer
│   │   │   ├── index.ts            # Entry — DOM refs, init, event wiring
│   │   │   ├── preview.ts          # Screen + camera stream management
│   │   │   ├── recording.ts        # Canvas-based MediaRecorder, frame loop
│   │   │   ├── playback.ts         # Post-recording playback UI
│   │   │   ├── overlays/           # Visual overlay modules
│   │   │   │   ├── camera-name.ts  # Name badge below camera
│   │   │   │   ├── socials.ts      # Social icons strip
│   │   │   │   ├── cta-popup.ts    # Periodic call-to-action popup with animation
│   │   │   │   ├── waveform.ts     # Audio waveform visualizer canvas
│   │   │   │   ├── action-feed.ts  # Keyboard/mouse action feed canvas
│   │   │   │   ├── background.ts   # Background canvas (ambient particles)
│   │   │   │   ├── cinema-filter.ts# Cinema filter application (CSS + canvas)
│   │   │   │   └── cursor.ts       # Custom cursor rendering on canvas
│   │   │   ├── zoom.ts             # Click-to-zoom with spring physics
│   │   │   └── idle-state.ts       # Idle state UI
│   │   │
│   │   ├── toolbar/                # Toolbar window renderer
│   │   │   └── index.ts            # Device enumeration, recording UI, timer
│   │   │
│   │   ├── edit-modal/             # Edit modal renderer
│   │   │   └── index.ts            # Overlay settings form, live preview
│   │   │
│   │   ├── onboarding/             # Onboarding wizard renderer
│   │   │   └── index.ts            # Step navigation, activation, permissions, deps
│   │   │
│   │   ├── lib/                    # Shared renderer utilities
│   │   │   ├── pep.ts              # Global button click sound effect
│   │   │   └── perf-monitor.ts     # Performance overlay (Cmd+Shift+P)
│   │   │
│   │   └── styles/                 # CSS (stays as CSS, not processed)
│   │       ├── main.css
│   │       ├── toolbar.css
│   │       ├── edit-modal.css
│   │       └── onboarding.css
│   │
│   └── shared/                     # Shared types & utils (main + renderer)
│       ├── channels.ts             # IPC channel name constants
│       ├── types.ts                # All shared interfaces & types
│       │                           #   - AppConfig, OverlayConfig
│       │                           #   - PreviewSelection, RecordingState
│       │                           #   - MousePosition, MouseClickEvent
│       │                           #   - ActionEvent, PermissionStatus
│       │                           #   - DependencyStatus, InstallProgress
│       │                           #   - ActivationState, ActivationResult
│       │                           #   - CameraEnhancement, CinemaFilter
│       │                           #   - UpdateCheckResult
│       ├── filters.ts              # Cinema filter definitions + CSS/canvas builders
│       ├── format.ts               # formatTime() utility
│       ├── paths.ts                # isValidSavePath() security helper
│       ├── shortcuts.ts            # Keyboard shortcut label map
│       └── zoom.ts                 # Spring physics (createSpringState, stepSpring, etc.)
│
├── pages/                          # HTML entry points (loaded by BrowserWindow)
│   ├── index.html                  # Main preview window
│   ├── toolbar.html                # Floating toolbar
│   ├── edit-modal.html             # Overlay editor modal
│   └── onboarding.html             # Activation/setup wizard
│
└── dist/                           # Compiled output (gitignored after TS setup)
    ├── main/
    ├── preload/
    ├── renderer/
    └── shared/
```

## Key Design Decisions

### 1. Split the monolithic `ipc-handlers.ts` (1,295 lines → ~12 files)
The biggest win. Currently one file handles recording, devices, file I/O, overlays, mouse tracking, keyboard tracking, config, app control, activation, and onboarding. Each domain gets its own file under `src/main/ipc/`.

### 2. Extract input tracking into `src/main/input/`
The uiohook keyboard/mouse/scroll detection + keycode maps + typing buffer + active window detection is ~350 lines embedded in ipc-handlers. This becomes its own module.

### 3. Extract FFmpeg pipeline into `src/main/services/ffmpeg/`
The voice enhancement filter chain, two-pass loudnorm, H.264 encoding flags, and fallback logic is ~260 lines. Splitting into filters/encode/post-process makes each piece testable.

### 4. Split the main renderer (3,057 lines → ~12 files)
`renderer/main.js` handles preview streams, recording, playback, CTA popup, waveform, action feed, background particles, cinema filters, cursor rendering, zoom, and idle state. Each overlay/feature becomes a module under `renderer/main/overlays/`.

### 5. Move HTML to `pages/` directory
Cleaner root — HTML files out of the project root into a dedicated folder.

### 6. Remove the CommonJS shim hack
The original uses a `shim.js` + `_snap()` pattern to fake CommonJS `require()` in the renderer (because CSP blocks inline scripts). With a proper build setup (esbuild or tsup), renderer scripts will be bundled properly — no shim needed.

### 7. Proper TypeScript reconstruction
- All compiled `.js` files get reverse-engineered back to clean `.ts` with proper types
- Types extracted from runtime shapes (e.g., `AppConfig`, `OverlayConfig`, `PreviewSelection`) go into `shared/types.ts`
- The `d.ts.map` files tell us the original source paths, confirming our structure

## Build Configuration

### `package.json` additions
```json
{
  "scripts": {
    "dev": "electron .",
    "build": "tsc -p tsconfig.main.json && tsc -p tsconfig.preload.json && tsup src/renderer/**/index.ts",
    "package": "electron-builder",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "electron": "^35.x",
    "electron-builder": "^26.x",
    "typescript": "^5.x",
    "tsup": "^8.x",
    "eslint": "^9.x"
  }
}
```

### Build strategy
- **Main process**: `tsc` → CommonJS (Node target)
- **Preload scripts**: `tsc` → CommonJS (Node + DOM)  
- **Renderer scripts**: `tsup` or `esbuild` → bundled IIFE per page (no shim needed)

## Implementation Order

1. **Scaffold** — Create folder structure, tsconfig files, package.json with dev deps
2. **Shared types** — `src/shared/types.ts` with all interfaces (extracted from runtime shapes)
3. **Shared modules** — Migrate `channels.ts`, `filters.ts`, `format.ts`, `paths.ts`, `shortcuts.ts`, `zoom.ts`
4. **Main services** — `activation.ts`, `dependencies.ts`, `permissions.ts`, `ffmpeg/`
5. **Main windows** — 4 window factory files (straightforward port)
6. **Main input** — Extract uiohook setup, keycode maps, typing buffer, active window
7. **Main IPC** — Split ipc-handlers into 12 domain files
8. **Main entry** — `src/main/index.ts` (app lifecycle, session setup)
9. **Store** — `src/main/store.ts`
10. **Preloads** — 4 preload scripts (clean port, remove inlined Channels)
11. **Renderer shared** — `pep.ts`, `perf-monitor.ts`
12. **Renderer main** — Split 3,057-line main.js into preview, recording, playback, overlays, zoom
13. **Renderer toolbar** — Port toolbar.js
14. **Renderer edit-modal** — Port edit-modal.js
15. **Renderer onboarding** — Port onboarding.js
16. **HTML pages** — Move to `pages/`, update script/CSS paths
17. **CSS** — Move to `src/renderer/styles/`
18. **Build config** — tsconfig files, tsup config, electron-builder.yml
19. **Verify** — Build, lint, typecheck passes

## Risks

- **Renderer bundling**: The current setup uses `<script>` tags + a CommonJS shim. Moving to bundled output requires updating HTML `<script>` tags to point to single bundled files per page.
- **Source map-less reconstruction**: No `sourcesContent` in maps, so types must be inferred from runtime shapes in the compiled JS. The code is well-commented though, making this feasible.
- **Native addon**: The macOS cursor addon has prebuilt binaries. We keep it as-is in `native/` and only build from source when needed.
