import { execFile } from 'child_process';

// Active window cache — refreshed on each action to avoid stale data
let cachedActiveWindow = '';
let activeWindowRefreshTimer: ReturnType<typeof setTimeout> | null = null;

/** Get the frontmost application name on macOS via osascript */
export function refreshActiveWindow(): void {
  if (process.platform !== 'darwin') {
    return;
  }
  // Throttle: don't query more than once per 250ms
  if (activeWindowRefreshTimer) {
    return;
  }
  activeWindowRefreshTimer = setTimeout(() => {
    activeWindowRefreshTimer = null;
  }, 250);
  execFile(
    'osascript',
    ['-e', 'tell application "System Events" to get name of first process whose frontmost is true'],
    { timeout: 1000 },
    (error, stdout) => {
      if (!error && stdout.trim()) {
        cachedActiveWindow = stdout.trim();
      }
    },
  );
}

/** Return the cached active window name */
export function getCachedActiveWindow(): string {
  return cachedActiveWindow;
}
