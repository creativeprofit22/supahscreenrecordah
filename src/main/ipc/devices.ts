import { ipcMain, desktopCapturer } from 'electron';
import { execFile } from 'child_process';
import { Channels } from '../../shared/channels';
import { isValidSender } from './helpers';

interface CGWindow {
  id: number;
  name: string;
  owner: string;
  onScreen: boolean;
}

/**
 * Query macOS CGWindowListCopyWindowInfo for ALL windows (including minimized).
 * desktopCapturer only returns on-screen windows, so this fills the gap.
 */
function getMacOSAllWindows(): Promise<CGWindow[]> {
  if (process.platform !== 'darwin') {
    return Promise.resolve([]);
  }
  const swiftCode = `
import CoreGraphics
import Foundation

let options: CGWindowListOption = [.optionAll, .excludeDesktopElements]
guard let windowList = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
    print("[]")
    exit(0)
}

var result: [[String: Any]] = []
for w in windowList {
    guard let layer = w[kCGWindowLayer as String] as? Int, layer == 0,
          let owner = w[kCGWindowOwnerName as String] as? String,
          let windowId = w[kCGWindowNumber as String] as? Int else { continue }
    let name = (w[kCGWindowName as String] as? String) ?? owner
    let onScreen = (w[kCGWindowIsOnscreen as String] as? Bool) ?? false
    if !name.isEmpty {
        result.append(["id": windowId, "name": name, "owner": owner, "onScreen": onScreen])
    }
}
if let data = try? JSONSerialization.data(withJSONObject: result),
   let str = String(data: data, encoding: .utf8) {
    print(str)
}
`;
  return new Promise((resolve) => {
    execFile('swift', ['-e', swiftCode], { timeout: 5000 }, (error, stdout) => {
      if (error) {
        console.warn('[screens] Failed to query macOS CGWindowList:', error.message);
        resolve([]);
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim()) as CGWindow[];
        resolve(parsed);
      } catch {
        console.warn('[screens] Failed to parse CGWindowList output');
        resolve([]);
      }
    });
  });
}

interface Win32Window {
  id: number;
  name: string;
  processName: string;
}

/**
 * Query Windows processes with visible main windows via PowerShell.
 * desktopCapturer on Windows can miss windows due to style flags or DPI issues.
 */
function getWindowsAllWindows(): Promise<Win32Window[]> {
  if (process.platform !== 'win32') {
    return Promise.resolve([]);
  }
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

export function registerDeviceHandlers(): void {
  ipcMain.handle(Channels.DEVICES_GET_SCREENS, async (event) => {
    if (!isValidSender(event)) {
      throw new Error('Unauthorized IPC sender');
    }
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
    });
    const ownNames = new Set([
      'supahscreenrecordah',
      'supahscreenrecordah toolbar',
      'supahscreenrecordah — preview',
    ]);
    const results = sources
      .filter((source) => !ownNames.has(source.name.toLowerCase()))
      .map((source) => {
        const isWindow = source.id.startsWith('window:');
        return {
          id: source.id,
          name: source.name,
          isBrowser: isWindow,
        };
      });

    // On macOS, desktopCapturer misses minimized windows. Supplement with
    // CGWindowListCopyWindowInfo which includes off-screen (minimized) windows.
    if (process.platform === 'darwin') {
      const cgWindows = await getMacOSAllWindows();
      const existingIds = new Set(results.map((r) => r.id));
      for (const cg of cgWindows) {
        const sourceId = `window:${cg.id}:0`;
        if (existingIds.has(sourceId)) {
          continue;
        }
        const nameLower = cg.name.toLowerCase();
        const ownerLower = cg.owner.toLowerCase();
        if (ownNames.has(nameLower) || ownNames.has(ownerLower)) {
          continue;
        }
        // Skip generic system-level windows
        if (ownerLower === 'window server' || ownerLower === 'universal control') {
          continue;
        }
        results.push({
          id: sourceId,
          name: cg.name || cg.owner,
          isBrowser: true,
        });
      }
    }

    // On Windows, desktopCapturer can miss windows due to style flags or DPI issues.
    // Supplement with PowerShell process enumeration.
    if (process.platform === 'win32') {
      const winWindows = await getWindowsAllWindows();
      const existingNames = new Set(results.map((r) => r.name.toLowerCase()));
      for (const win of winWindows) {
        const nameLower = win.name.toLowerCase();
        const processLower = win.processName.toLowerCase();
        if (ownNames.has(nameLower) || ownNames.has(processLower)) {
          continue;
        }
        // Skip if desktopCapturer already found a source with the same name
        if (existingNames.has(nameLower)) {
          continue;
        }
        results.push({
          id: `window:${win.id}:0`,
          name: win.name,
          isBrowser: true,
        });
        existingNames.add(nameLower);
      }
    }

    return results;
  });
}
