# Codebase Audit: supahscreenrecordah vs Real-World Electron Patterns

## Summary

The codebase follows Electron best practices well overall. Security fundamentals are solid: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, IPC sender validation, navigation blocking, window-open prevention, and a custom secure protocol. The architecture (domain-split IPC, per-window preloads, process separation) aligns with production Electron apps.

Below are findings backed by Grep MCP evidence across multiple repos.

---

## Findings

### [DIVERGENT] `src/main/index.ts`:156-158 — Security restrictions applied per-window instead of globally via `web-contents-created`

**Wrote:** Navigation prevention (`will-navigate`) and window-open handler (`setWindowOpenHandler`) are set individually on each `BrowserWindow` in `main-window.ts`, `toolbar-window.ts`, etc.

**Real-world:** Production Electron apps (AFFiNE, VSCode, lx-music-desktop, sqlectron, Actual Budget, StarRailCopilot) consistently use `app.on('web-contents-created')` to apply security restrictions globally to ALL webContents, including any that might be dynamically created. This ensures no window can ever bypass restrictions.

**Evidence:** Grep MCP — `app.on('web-contents-created'...will-navigate...setWindowOpenHandler` pattern seen in 10/10 security-focused repos searched (AFFiNE, VSCode, lx-music-desktop, sqlectron, enso, StarRailCopilot, etc.)

**Risk:** If a new window type is added and the developer forgets to add navigation guards, it would be unprotected. A single global handler is both safer and less code.

---

### [DIVERGENT] `src/main/store.ts`:101-111 — Config writes not atomic (corruption risk on crash)

**Wrote:** `fs.promises.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8')` — direct write to the config file.

**Real-world:** Production Electron apps use either:
1. `electron-store` (which uses `atomically` under the hood) — seen in ente, Folo/RSS, LobeHub, CherryStudio, Chatbox, Kap, upscayl, and many more (10+ repos)
2. Manual atomic writes via temp file + `rename` — seen in takt, MagiCode, yuvalsuede/memory-mcp
3. `write-file-atomic` package — seen in Jest, Cypress, coder/mux

**Evidence:** Grep MCP — `electron-store` with `new Store` pattern found in 10/10 repos searched. Manual atomic write (temp + rename) in 3/3 repos implementing custom stores. Direct `writeFile` to config without atomicity: 0 mature repos.

**Risk:** If the app crashes or is force-quit during a write, the config file can be left empty or corrupted (partial JSON). On next launch, `loadConfig` would fail and reset to defaults, losing all user settings.

---

### [MISSING] `src/main/windows/main-window.ts` — No `will-attach-webview` prevention

**Wrote:** The app blocks navigation and new windows but does not block webview attachment.

**Real-world:** Security-conscious Electron apps add `will-attach-webview` event prevention on webContents to block `<webview>` tag usage entirely when it's not needed:
- AFFiNE: blocks in security-restrictions.ts
- lx-music-desktop: strips preload scripts from webviews
- enso: blocks with `event.preventDefault()`
- Gravitational Teleport: blocks and logs
- floating/frame: `contents.on('will-attach-webview', (e) => e.preventDefault())`

**Evidence:** Grep MCP — `will-attach-webview` prevention seen in 6/8 security-hardened Electron apps searched.

**Risk:** Low in practice since `webviewTag` defaults to `false` in modern Electron, but defense-in-depth recommends explicitly blocking it — especially since this app handles screen recordings (sensitive content).

---

### [DIVERGENT] `src/main/windows/main-window.ts`:42-47 — Crash recovery auto-reloads without delay or limit

**Wrote:** `mainWindow?.reload()` is called immediately on `render-process-gone`.

**Real-world:** Production apps that auto-reload add a delay and/or a retry limit:
- RunMaestro/Maestro: `setTimeout(() => { mainWindow.webContents.reload(); }, 1000)` with logging + Sentry reporting
- liupan1890/aliyunpan: Shows error dialog, gives user a choice ("Close" / "Reload" / "Keep Open")
- Foundry376/Mailspring: Dialog-based recovery with crash reason analysis
- VSCode: Dispatches to a `WindowError` handler with sophisticated recovery logic

**Evidence:** Grep MCP — Immediate `reload()` without delay: 1/8 repos (ente). Delayed/guarded reload: 4/8 repos. Dialog-based: 3/8 repos.

**Risk:** If the renderer keeps crashing (e.g., bad GPU driver, corrupted cache), immediate unconditional reload creates an infinite crash loop with no user feedback.

---

### [MISSING] `src/preload/main-preload.ts` — `removeAllListeners` before `on` can break multi-subscriber scenarios

**Wrote:** Pattern like:
```ts
ipcRenderer.removeAllListeners(Channels.PREVIEW_UPDATE);
ipcRenderer.on(Channels.PREVIEW_UPDATE, handler);
```

**Real-world:** This pattern IS used by several apps (ente, electron/fiddle, feishin) — it's a known way to prevent listener leaks when re-registering callbacks. However, this codebase applies it inconsistently:
- Main preload: uses `removeAllListeners` + `on` ✓
- Toolbar preload: uses only `on` without `removeAllListeners` ✗

**Evidence:** Grep MCP — `removeAllListeners` before `on` pattern seen in ente (6 instances), electron/fiddle, feishin. The approach is valid but this codebase uses it inconsistently.

**Risk:** The toolbar preload's `onStateUpdate` and `onCaptionProgress` (lines 16-26) use `ipcRenderer.on` without removing previous listeners. If those callbacks are ever re-registered (e.g., component remount), listeners will accumulate.

---

### [ALIGNED] Security fundamentals

The following patterns align well with real-world best practices:

| Pattern | This App | Real-World Match |
|---------|----------|-----------------|
| `contextIsolation: true` | ✅ All windows | 10/10 repos |
| `nodeIntegration: false` | ✅ All windows | 10/10 repos |
| `sandbox: true` | ✅ All windows | 8/10 repos |
| Custom protocol with path traversal check | ✅ `protocol.ts` | Matches AFFiNE, Teleport, Vencord, Vesktop |
| `net.fetch(pathToFileURL(...))` for serving | ✅ `protocol.ts` | 10/10 repos using `protocol.handle` |
| IPC sender validation | ✅ `isValidSender` | Uncommon but excellent security practice |
| `setContentProtection(true)` on toolbar | ✅ toolbar-window.ts | Matches interview-coder, Signal, UI-TARS |
| `setWindowOpenHandler(() => ({ action: 'deny' }))` | ✅ All windows | 10/10 repos |
| `will-navigate` → `preventDefault()` | ✅ All windows | 10/10 repos |
| Domain-split IPC handlers | ✅ `src/main/ipc/` | Matches well-structured Electron apps |
| Typed channel constants | ✅ `shared/channels.ts` | Matches responsively-app, Actual Budget |
| `setDisplayMediaRequestHandler` with source selection | ✅ | Matches Signal, UI-TARS, bananas, aigcpanel |
| `registerSchemesAsPrivileged` before `app.whenReady()` | ✅ | 10/10 repos using custom protocols |

---

## Recommended Actions (Priority Order)

1. **Atomic config writes** (Medium risk) — Either use `electron-store`, or implement temp-file + rename in `saveConfig()`.
2. **Global security via `web-contents-created`** (Low risk) — Move `will-navigate`, `setWindowOpenHandler`, and add `will-attach-webview` to a single `app.on('web-contents-created')` handler.
3. **Crash recovery guard** (Low risk) — Add a 1-second delay and max-retry counter (e.g., 3 reloads) before giving up and showing an error dialog.
4. **Consistent listener cleanup in toolbar preload** (Low risk) — Add `removeAllListeners` before `on` in toolbar-preload.ts to match main-preload.ts pattern.
