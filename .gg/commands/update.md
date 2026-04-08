---
name: update
description: Update dependencies, fix deprecations and warnings
---

## Step 1: Check for Updates

Run `npm outdated` to see which dependencies have newer versions available. Review the output — note Current, Wanted, and Latest columns.

## Step 2: Update Dependencies

Run `npm update` to update all packages within their semver ranges.

Then run `npm audit` to check for security vulnerabilities. If issues are found, run `npm audit fix` to auto-fix what's possible. For remaining issues, run `npm audit fix --force` only after reviewing what breaking changes it would introduce.

For packages that need major version bumps beyond their semver range, update them individually in package.json and run `npm install`.

## Step 3: Check for Deprecations & Warnings

Run `npm install 2>&1` and read ALL output carefully. Look for:
- Deprecation warnings (e.g. "npm warn deprecated")
- Security vulnerabilities
- Peer dependency warnings
- Breaking changes
- Engine compatibility warnings

Also run `npx electron-builder --help 2>&1 | head -5` to check electron-builder is working without deprecation notices.

## Step 4: Fix Issues

For each warning/deprecation:
1. Research the recommended replacement or fix (use web_fetch on the package's npm page or changelog)
2. Update code/dependencies accordingly — check if `overrides` in package.json needs updating
3. Re-run `npm install`
4. Verify no warnings remain

Pay special attention to:
- `uiohook-napi` native module compatibility with the current Electron version
- Electron major version compatibility with electron-builder
- Any deprecated Node.js APIs used in source code under `src/`

## Step 5: Run Quality Checks

Run these commands and fix all errors before completing:

```
npm run typecheck
npm run build
```

The typecheck uses `tsc --noEmit -p tsconfig.json`. The build compiles main, preload, and renderer TypeScript.

Fix all type errors and build failures that arise from dependency updates.

## Step 6: Verify Clean Install

Delete dependency folders and caches, then do a fresh install:

```
rm -rf node_modules package-lock.json
npm install
```

Verify the install completes with ZERO warnings and ZERO vulnerabilities. If warnings remain, go back to Step 4 and fix them. Repeat until the install is completely clean.

Then re-run the full build to confirm everything still works:

```
npm run build
```
