# Window Source List: Chrome Missing + Irrelevant Processes

## Problems

### 1. Chrome windows not appearing in the dropdown
**Root cause:** `desktopCapturer.getSources()` on Windows can miss certain windows (known Electron issue with some GPU/rendering configurations). The PowerShell fallback (`Get-Process`) is supposed to supplement this, but has issues:

- **ID mismatch:** PowerShell entries use `window:${processId}:0` as the source ID, but `desktopCapturer` uses `window:${windowHandle}:0`. When the user selects a PowerShell-supplemented source, `setDisplayMediaRequestHandler` tries to find it by ID in `desktopCapturer.getSources()` — it won't match. The name fallback (`pendingScreenSourceName`) only works if the window title matches exactly.
  
- **Window title mismatch:** Chrome window titles change constantly (they include the active tab title, e.g. "Google - Google Chrome"). The PowerShell `MainWindowTitle` is captured at enumeration time, but by the time `setDisplayMediaRequestHandler` queries `desktopCapturer.getSources()`, the title may have changed if the user switched tabs.

- **PowerShell `MainWindowHandle` limitation:** `Get-Process` returns the process's main window handle, but Chrome has a single browser process with the main window and many renderer/GPU/utility processes. Only the main Chrome process has `MainWindowHandle -ne 0`, and its `MainWindowTitle` reflects whatever the current tab is. Multiple Chrome windows (separate browser windows) share the same process tree, so only one may appear.

### 2. Irrelevant processes in the list
The PowerShell fallback includes ANY process with a visible main window. This means system utilities, background apps with hidden-but-technically-visible windows, service host UIs, etc. all end up in the dropdown. There's no filtering for:
- System tray apps that have a main window handle
- Background processes (e.g. `SearchHost`, `TextInputHost`, `ShellExperienceHost`)
- Apps the user wouldn't want to record

`desktopCapturer.getSources()` already has reasonable filtering (it returns user-visible windows), so the noise comes from the PowerShell supplement.

## Proposed Fix

### File: `src/main/ipc/devices.ts`

#### A. Improve the PowerShell query (lines 75-107)

Replace the basic `Get-Process` approach with a more targeted query that:
1. Uses window enumeration instead of process enumeration to catch all Chrome windows
2. Filters out background/system windows that users wouldn't want to record

**New PowerShell approach:** Use `Get-Process` but filter out known system/background processes:

```typescript
const WINDOWS_PROCESS_BLOCKLIST = new Set([
  // Windows system UI processes
  'searchhost',
  'textinputhost', 
  'shellexperiencehost',
  'startmenuexperiencehost',
  'lockapp',
  'systemsettings',
  'windowsterminal',       // if already captured by desktopCapturer
  'applicationframehost',
  'gamebar',
  'gamebarftserver',
  'widgets',
  'widgetservice',
  'securityhealthtray',
  'runtimebroker',
  'dwm',                   // Desktop Window Manager
  'taskhostw',
  'ctfmon',
  'smartscreen',
  'msedgewebview2',       // WebView2 background
  'crashpad_handler',
  'conhost',
  'dllhost',
  // Our own app
  'supahscreenrecordah',
  'electron',
]);
```

#### B. Fix ID matching for supplemental windows (lines 96-120 in `src/main/index.ts`)

The `setDisplayMediaRequestHandler` already has a name fallback (lines 109-111), but it does an exact match. For Chrome, the title changes with each tab. Improve the matching:

1. Try exact ID match first (existing)
2. Try exact name match (existing)  
3. Try **partial/fuzzy name match** — if the source name contains the selected name, or vice versa (e.g. "Google Chrome" appears in "Some Page - Google Chrome")
4. Try matching by **app name suffix** — e.g. match anything ending in "- Google Chrome"

```typescript
// Fuzzy name match: check if either contains the other, or if they share
// a common app suffix like "- Google Chrome"
if (!target && pendingScreenSourceName) {
  const pending = pendingScreenSourceName.toLowerCase();
  target = sources.find((s) => {
    const name = s.name.toLowerCase();
    return name.includes(pending) || pending.includes(name);
  });
}
```

#### C. Better deduplication between desktopCapturer and PowerShell results

Currently deduplication is by exact name match (line 173). This misses cases where desktopCapturer returns "Some Page - Google Chrome" and PowerShell returns "Another Page - Google Chrome" (same window, title changed between queries). 

Improve by also checking for app-name suffix matches:
```typescript
// Extract app suffix (e.g. "- Google Chrome" from "Tab Title - Google Chrome")
function extractAppSuffix(title: string): string | null {
  const dashIdx = title.lastIndexOf(' - ');
  return dashIdx >= 0 ? title.substring(dashIdx) : null;
}
```

## Implementation Order

1. **Add process blocklist** to `src/main/ipc/devices.ts` — filter out system processes from the PowerShell supplement (fixes irrelevant entries)
2. **Add app-suffix dedup** in the PowerShell supplement loop — prevent duplicate Chrome entries  
3. **Improve name matching** in `src/main/index.ts` `setDisplayMediaRequestHandler` — so supplemental sources can still be captured even when titles change
4. Build + typecheck

## Files Changed
- `src/main/ipc/devices.ts` — blocklist filtering + better dedup
- `src/main/index.ts` — fuzzy name matching in setDisplayMediaRequestHandler

## Risks
- Over-aggressive blocklist could hide windows users want to record
- Fuzzy matching could match the wrong window if multiple similar-titled windows exist
- Process names differ across Windows versions/locales

## Verification
- `npm run typecheck` passes
- `npm run build` passes  
- Manual test: Chrome appears in dropdown, system processes don't appear, selecting Chrome actually captures it
