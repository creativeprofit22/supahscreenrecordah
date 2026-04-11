# Cursor Tracking Bug — 16:9 Horizontal Mode

## The Problem
In 16:9 (horizontal/landscape) mode, the mouse cursor visible inside the captured screen preview freezes after a few seconds. The user is still moving their mouse, but the cursor shown in the `getDisplayMedia` stream stops updating. This is a **preview display issue** — the cursor in the captured video frames stops moving.

This does NOT affect:
- Shorts/vertical mode (9:16) — works fine
- Click-to-zoom — continues working (confirmed via logs)
- Mouse position IPC tracking — continues working (confirmed via heartbeat logs)
- uiohook click detection — continues working (confirmed via logs)

## Root Cause (confirmed)
Windows Desktop Duplication API stops compositing the cursor into the `getDisplayMedia` captured frames when the mouse cursor is positioned over the Electron window itself. This is a known Chromium/Windows behavior — the OS thinks the cursor is "consumed" by the capturing application and stops including it in the duplicated output.

## What Was Tried

### 1. Diagnostic Logging (CONFIRMED the tracking chain is healthy)
Added heartbeat logs to:
- Main process `setInterval` mouse tracking → `[mouse-track]` heartbeat every 5s — **kept firing**
- Renderer `onMousePosition` IPC handler → `[mouse-recv]` heartbeat every 5s — **kept firing**  
- Click events → `[click] down/up received` — **kept firing**
- Zoom handler → `[zoom] onMouseDown` — **kept firing, zoom values correct**

**Conclusion:** The entire tracking chain (main process → IPC → renderer → zoom) works perfectly. The issue is purely that the OS cursor disappears from the captured video frames.

### 2. Cursor Overlay (attempted, not working yet)
Added a CSS cursor overlay element to render our own cursor on the preview:

**Files modified:**
- `pages/index.html` — added `<div id="cursor-overlay" class="cursor-overlay"></div>`
- `src/renderer/styles/main.css` — added `.cursor-overlay` CSS (positioned absolutely, z-index 20, pointer-events none, arrow SVG background)
- `src/renderer/main/dom.ts` — added `cursorOverlay` DOM reference
- `src/renderer/main/zoom.ts` — added `updateCursorOverlay()` function called from `zoomRenderLoop()`, and hide on `stopZoomLoop()`

**Why it didn't work:** Unknown — possibly the overlay is rendering but not visible (wrong position, wrong z-index, CSS issue, or the SVG isn't rendering). Needs debugging:
- Check if the element is in the DOM and has `display: block`
- Check if the position values make sense (might be off-screen)
- Check if the `videoTop` calculation is wrong (the `offsetTop - videoH / 2` adjustment for `translateY(-50%)` might be incorrect)
- The SVG data URL might not be rendering — try a simple colored div instead
- The overlay might be behind other elements despite z-index 20

### 3. Things NOT tried yet
- Adding `cursor: 'always'` to `getDisplayMedia` video constraints (may not work with `setDisplayMediaRequestHandler`)
- Drawing cursor directly on a canvas overlay instead of CSS positioning
- Using `navigator.mediaDevices.getDisplayMedia({ video: { cursor: { ideal: 'always' } } })` 
- Rendering cursor on the recording canvas (for recorded output, not just preview)
- Checking if Electron has a `setCursorCaptureMode` or similar API

## Key Files
- `src/renderer/main/zoom.ts` — zoom render loop, `updateCursorOverlay()`, `getMouseRelativeToCaptured()`
- `src/renderer/main/overlays/cursor.ts` — smooth mouse interpolation
- `src/main/input/index.ts` — `startMouseTracking()` interval (sends cursor position via IPC at 60fps)
- `src/renderer/main/index.ts` — `onMousePosition` IPC listener (updates `currentMouseX/Y`)
- `src/renderer/main/preview.ts` — `startScreenPreview()` with `getDisplayMedia` call
- `src/main/index.ts` — `setDisplayMediaRequestHandler` with `desktopCapturer.getSources()`

## Other Fixes Made in This Session (working)
1. **Camera left/right overlap** — `stopShortsPreviewLoop()` was wiping camera container inline styles on every `fitScreenVideo()` call. Fixed by only clearing styles when actually leaving shorts mode.
2. **Webcam blur position override** — `startPreviewBlur()` set `container.style.position = 'relative'` which broke `position: absolute` layout. Fixed by removing the unnecessary override.
3. **Camera name not hiding** — `positionCameraName()` returned early without calling the socials callback. Fixed by calling `positionSocials()` before the early return, and adding `positionCameraName(positionSocialsOverlay)` after `fitScreenVideo()` in the camera-toggle path.
