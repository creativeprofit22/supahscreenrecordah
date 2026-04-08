/**
 * Device filtering helpers — blocklists and dedup utilities for
 * window source enumeration on Windows.
 */

/** Windows system/background processes that should not appear in the source list. */
export const WINDOWS_PROCESS_BLOCKLIST = new Set([
  'searchhost',
  'textinputhost',
  'shellexperiencehost',
  'startmenuexperiencehost',
  'lockapp',
  'systemsettings',
  'applicationframehost',
  'gamebar',
  'gamebarftserver',
  'widgets',
  'widgetservice',
  'securityhealthtray',
  'runtimebroker',
  'dwm',
  'taskhostw',
  'ctfmon',
  'smartscreen',
  'msedgewebview2',
  'crashpad_handler',
  'conhost',
  'dllhost',
  'supahscreenrecordah',
  'electron',
]);

/**
 * Extract the app-name suffix from a window title (e.g. " - Google Chrome"
 * from "Some Page - Google Chrome"). Returns null if there's no dash separator.
 */
export function extractAppSuffix(title: string): string | null {
  const dashIdx = title.lastIndexOf(' - ');
  return dashIdx >= 0 ? title.substring(dashIdx) : null;
}
