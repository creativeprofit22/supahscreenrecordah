---
name: fix
description: Run typechecking and linting, then spawn parallel agents to fix all issues
---

Run all typechecking and build checks, collect errors, group them by domain, and use the subagent tool to spawn parallel sub-agents to fix them.

## Step 1: Run Checks

Run these commands and capture their full output (don't stop on failure — collect all errors):

```bash
npm run typecheck 2>&1 || true
npm run build 2>&1 || true
```

## Step 2: Collect and Group Errors

Parse the output from Step 1. Group errors into these domains:

- **Type errors**: TypeScript type mismatches, missing properties, incorrect generics, `TS####` errors from `tsc`
- **Import/module errors**: Missing modules, unresolved imports, circular dependencies
- **Build errors**: Compilation failures from `build:main`, `build:preload`, or `build:renderer` (tsup)

If there are zero errors across all domains, report success and stop.

## Step 3: Spawn Parallel Agents

For each domain that has errors, use the `subagent` tool to spawn a sub-agent with a detailed prompt containing:
- The exact error messages for that domain
- The file paths involved
- Instructions to fix all errors in that domain while following the project conventions in CLAUDE.md

Spawn all domain agents in parallel (don't wait for one to finish before starting the next).

## Step 4: Verify

After all agents complete, re-run all checks:

```bash
npm run typecheck 2>&1
npm run build 2>&1
```

If errors remain, fix them directly (don't spawn more agents). Repeat until clean or report what's left.
