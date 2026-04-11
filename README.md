# supahscreenrecordah

A screen + camera recorder for Windows and macOS. Built with Electron. Records your screen, your face, and makes it look good with zero fuss.

> Repo: [github.com/creativeprofit22/supahscreenrecordah](https://github.com/creativeprofit22/supahscreenrecordah)

---

## What it does

Record your screen and webcam together with a live preview. After you stop, you get a review screen where you can cut silences, trim filler words, add captions, and export a clean final video — all without leaving the app.

FFmpeg and Whisper are downloaded automatically on first run. No manual setup.

---

## Features

### Recording

- Screen capture + webcam overlay, side by side or picture-in-picture
- Aspect ratios: **16:9** (landscape), **9:16** (Shorts/vertical), **1:1** (square), **4:5** (portrait)
- Draggable screen position, swappable camera side (left / right)

### Zoom & cursor

- Click-to-zoom: the preview follows your cursor when you click
- Smart zoom: tracks click clusters, cursor velocity, and auto-zooms when your cursor stops
- Cursor trail effects + click ripple animations

### Overlays & effects

- Camera name overlay with custom fonts
- Social media handle overlay
- Webcam background blur (MediaPipe body segmentation)
- Manually placed blur regions
- Spotlight effect that follows the cursor
- Cinema filters on camera feed
- Ambient particles + mesh gradient backgrounds
- CTA popup (call-to-action banner)
- Click sounds (mouse + keyboard)
- Watermark overlay
- Action feed: shows keyboard shortcuts and live typing on screen
- Audio waveform visualizer on the camera feed

### Post-recording review

- Waveform timeline with silence and filler segment overlays
- Click to toggle segments on/off, drag trim handles with snap
- Bulk actions: auto-trim silences (2s / 3s / 5s thresholds), remove fillers, remove stutters
- Preview playback skips disabled segments in real time
- Auto-captions powered by Whisper — style presets: Clean, Bold, Viral, MrBeast, YT Shorts, TikTok
- Export via FFmpeg: trim + concat with 150ms audio crossfade and 80ms video fade at cut boundaries
- SRT caption export

---

## Requirements

- Node.js 18+
- Windows 10+ or macOS 12+
- FFmpeg — downloaded automatically by the app on first launch
- Whisper.cpp — downloaded automatically by the app on first launch

---

## Install & run from source

```bash
git clone https://github.com/creativeprofit22/supahscreenrecordah.git
cd supahscreenrecordah
npm install
```

**Run in development:**

On Windows (native):
```bash
npx electron .
```

On Windows from WSL:
```bash
cmd.exe /C "cd /D E:\Projects\supahscreenrecordah && node node_modules\electron\cli.js ."
```

On macOS:
```bash
npx electron .
```

**Build a distributable:**

| Platform | Command | Output |
|----------|---------|--------|
| Windows (unpacked) | `npm run dist:win` | Unpacked folder |
| Windows (installer) | `npm run dist:win:installer` | NSIS `.exe` installer |
| macOS (unpacked) | `npm run dist:mac` | `.app` bundle |
| macOS (installer) | `npm run dist:mac:installer` | `.dmg` image |

**Typecheck + build:**
```bash
npm run typecheck && npm run build
```

**Tests:**
```bash
npm test
```

---

## Tech stack

- **Electron 35** + **TypeScript** (strict mode)
- **tsdown** — renderer bundle (IIFE)
- **tsc** — main process + preload compilation
- **uiohook-napi** — global keyboard/mouse input
- **@mediapipe/tasks-vision** — webcam background segmentation
- **whisper.cpp** — local speech transcription (binary, auto-installed)
- **FFmpeg** — video processing and export (binary, auto-installed)
- **vitest** — unit tests

---

## Contributing

Open an issue to report a bug or request a feature. PRs are welcome — just open one against `main` and describe what you changed and why.

---

## License

MIT
