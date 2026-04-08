# Fix Windows Screen/App Detection

## Problem

The toolbar's screen selector dropdown doesn't show all open apps (e.g. Chrome, Discord) on Windows. 

`desktopCapturer.getSources({ types: ['screen', 'window'] })` in `src/main/ipc/devices.ts` (line 70) is the sole source of window data on Windows. The macOS path already has supplementation via `CGWindowListCopyWindowInfo` (lines 90-115), but there's no equivalent for Windows.

Electron's `desktopCapturer` on Windows can miss windows due to:
- Windows with certain styles (layered, tool windows)
- Race conditions during enumeration  
- DPI awareness mismatches
- Chromium's internal window enumeration limitations

## Fix: Add Windows window supplementation

Similar to the macOS `getMacOSAllWindows()` pattern already in the file, add a `getWindowsAllWindows()` function that uses PowerShell to enumerate all visible windows via `Get-Process`.

### File: `src/main/ipc/devices.ts`

#### 1. Add `getWindowsAllWindows()` function (after `getMacOSAllWindows`, ~line 63)

```typescript
interface Win32Window {
  id: number;
  name: string;
  processName: string;
}

function getWindowsAllWindows(): Promise<Win32Window[]> {
  if (process.platform !== 'win32') {
    return Promise.resolve([]);
  }
  // Get-Process returns all processes; filter to those with a visible main window.
  // MainWindowHandle != 0 means the process has a visible top-level window.
  const psCmd = `Get-Process | Where-Object {$_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne ''} | Select-Object Id, MainWindowTitle, ProcessName | ConvertTo-Json -Compress`;
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-Command', psCmd], { timeout: 5000 }, (error, stdout) => {
      if (error) {
        console.warn('[screens] Failed to query Windows process list:', error.message);
        resolve([]);
        return;
      }
      try {
        const trimmed = stdout.trim();
        if (!trimmed) {
          resolve([]);
          return;
        }
        // PowerShell returns a single object (not array) when there's only one result
        const parsed = JSON.parse(trimmed);
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        resolve(arr.map((p: { Id: number; MainWindowTitle: string; ProcessName: string }) => ({
          id: p.Id,
          name: p.MainWindowTitle,
          processName: p.ProcessName,
        })));
      } catch {
        console.warn('[screens] Failed to parse Windows process list output');
        resolve([]);
      }
    });
  });
}
```

#### 2. Add Windows supplementation block (after the macOS block, ~line 115)

After the existing `if (process.platform === 'darwin')` block, add:

```typescript
if (process.platform === 'win32') {
  const winWindows = await getWindowsAllWindows();
  // desktopCapturer window IDs look like "window:123:0" — extract numeric part
  const existingNames = new Set(results.map((r) => r.name.toLowerCase()));
  for (const win of winWindows) {
    const nameLower = win.name.toLowerCase();
    const processLower = win.processName.toLowerCase();
    if (ownNames.has(nameLower) || ownNames.has(processLower)) {
      continue;
    }
    // Skip if we already have a source with the same name (desktopCapturer already found it)
    if (existingNames.has(nameLower)) {
      continue;
    }
    // Use process ID as window identifier — this won't work with desktopCapturer's
    // setDisplayMediaRequestHandler, but allows listing. The user can still select
    // the "Entire Screen" source to capture these apps.
    results.push({
      id: `window:${win.id}:0`,
      name: win.name,
      isBrowser: true,
    });
    existingNames.add(nameLower);
  }
}
```

**Important caveat:** Windows discovered via PowerShell use process IDs, not the window handles that `desktopCapturer` uses. This means they'll show up in the dropdown but won't be capturable as individual windows through `setDisplayMediaRequestHandler` (which calls `desktopCapturer.getSources()` again and won't find them by that ID). This is the same limitation the macOS supplementation has.

**Alternative approach if needed:** Instead of supplementing with PowerShell, we could simply increase the reliability of `desktopCapturer` by:
1. Adding a retry mechanism
2. Calling `desktopCapturer.getSources()` with `fetchWindowIcons: true` which sometimes returns more windows
3. Using `thumbnailSize: { width: 0, height: 0 }` to skip thumbnails (faster, possibly more reliable)

### Better alternative: Match by name in setDisplayMediaRequestHandler

The `setDisplayMediaRequestHandler` in `src/main/index.ts` (line 88-114) currently finds sources by exact ID match. If we supplemented with PowerShell-sourced windows, the ID won't match. We should add a name-based fallback:

In `src/main/index.ts` line 94-97, change:
```typescript
const target =
  (pendingScreenSourceId
    ? sources.find((s) => s.id === pendingScreenSourceId)
    : undefined) ?? sources[0];
```

To also try matching by name if ID match fails:
```typescript
let target = pendingScreenSourceId
  ? sources.find((s) => s.id === pendingScreenSourceId)
  : undefined;
// If ID match failed (e.g. supplemental window from OS enumeration),
// try matching by window title stored alongside the ID
if (!target && pendingScreenSourceId) {
  const pendingName = pendingScreenSourceName; // need to pass name too
  if (pendingName) {
    target = sources.find((s) => s.name === pendingName);
  }
}
target = target ?? sources[0];
```

This requires also passing the window name alongside the ID, which means changing the `selectScreenSource` IPC to accept both `id` and `name`.

## Recommended approach

Start with the simpler PowerShell supplementation + name-based matching. This covers the case where `desktopCapturer` does eventually see the window but assigns it a different ID format than our PowerShell-generated one.

## Verification

1. `npm run build` — must compile cleanly
2. `npm run dist:win` — package
3. Run the packaged app with Chrome and Discord open
4. Check the screen selector dropdown — both should appear
5. Test selecting Chrome/Discord and verifying the preview shows them

## Risk

- PowerShell invocation adds ~200-500ms latency to the screen list
- Window name matching could match wrong window if multiple windows share the same title  
- Some windows may still not be capturable even if listed (OS-level restrictions)
