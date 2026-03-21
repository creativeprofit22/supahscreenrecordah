// Custom 'app' protocol — replaces file:// for loading local resources.
// Registered as privileged (standard + secure) so CSP, fetch, and streaming
// work identically to https:// origins.

import { protocol, net } from 'electron';
import path from 'path';
import { pathToFileURL } from 'url';

/** The root directory from which the app serves files (project root). */
const APP_ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * Must be called **before** `app.whenReady()` — registers the 'app' scheme
 * as privileged so Chromium treats it like a standard secure origin.
 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'app',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: false,
      },
    },
  ]);
}

/**
 * Must be called **after** `app.whenReady()` — installs the request handler
 * that maps `app://./path` to local files under the project root.
 */
export function registerAppProtocolHandler(): void {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const decodedPath = decodeURIComponent(pathname);

    // Resolve the requested path relative to APP_ROOT
    const filePath = path.resolve(APP_ROOT, decodedPath.replace(/^\//, ''));

    // Security: ensure the resolved path stays within APP_ROOT
    const relativePath = path.relative(APP_ROOT, filePath);
    const isSafe =
      relativePath &&
      !relativePath.startsWith('..') &&
      !path.isAbsolute(relativePath);

    if (!isSafe) {
      return new Response('Forbidden', {
        status: 403,
        headers: { 'content-type': 'text/plain' },
      });
    }

    return net.fetch(pathToFileURL(filePath).toString());
  });
}
