---
name: test
description: Run tests, then spawn parallel agents to fix failures
---

Run all tests for this project, collect failures, and use the subagent tool to spawn parallel sub-agents to fix them.

## Step 1: Run Tests

Run the full test suite:

```bash
npx vitest run
```

**Options:**

- Watch mode: `npx vitest`
- Coverage: `npx vitest run --coverage`
- Filter by name: `npx vitest run -t "pattern"`
- Single file: `npx vitest run tests/unit/format.test.ts`
- Unit only: `npx vitest run tests/unit/`
- Integration only: `npx vitest run tests/integration/`

## Step 2: If Failures

For each failing test (or group of related failures), use the subagent tool to spawn a sub-agent to fix the **underlying source code issue** (not the test itself, unless the test is wrong). Include in the sub-agent prompt:
- The exact test name and file path
- The error message and stack trace
- The source file that likely needs fixing
- Instructions to run the specific test after fixing: `npx vitest run <test-file>`

## Step 3: Re-run

After all sub-agents complete, re-run the full suite to verify all fixes:

```bash
npx vitest run
```

If any tests still fail, repeat Step 2 for remaining failures.
