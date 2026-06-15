/**
 * Static architectural guardrail tests.
 *
 * These tests enforce import-boundary invariants at audit time via grep-based
 * static analysis of the `src/` tree. Their "observable behaviour" is the
 * absence of forbidden imports; a passing suite confirms no violations were
 * detected in the current codebase snapshot.
 *
 * NFR-2 (Hono confinement) and NFR-3 (SDK confinement) share this single test
 * file because both criteria test import-boundary invariants using the same
 * grep-based static-analysis technique against the same `src/` tree. Keeping
 * them together avoids duplicating the grep helper, the root resolution, and
 * the test-file exclusion logic.
 *
 * ## Known limitations of grep-based detection
 *
 * 1. **Multi-line imports.** Grep operates on individual lines and cannot
 *    detect an import statement split across lines:
 *    ```
 *    import {
 *      Hono
 *    } from 'hono';
 *    ```
 * 2. **Dynamic `import()` calls.** Expressions such as
 *    `await import('hono')` use a run-time syntax that grep will miss.
 * 3. **`require()` patterns.** CommonJS-style `require('hono')` or
 *    `require('@hono/node-server')` calls are invisible to the regex used
 *    below, which only matches ES `import … from …` statements.
 *
 * These limitations are acceptable because the project convention is to use
 * single-line ESM `import` statements exclusively.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

function findMatchingLines(dir: string, pattern: RegExp): string[] {
  const { stdout, error, status } = spawnSync(
    'grep',
    ['-r', '-n', '-E', '--include=*.ts', pattern.source, dir],
    { encoding: 'utf-8', cwd: ROOT },
  );
  if (error !== undefined || (status !== null && status > 1)) {
    const detail = error ? `spawn error: ${error.message}` : `grep exit status ${status}`;
    throw new Error(`grep failed (${detail})`);
  }
  return stdout.trim().split('\n').filter(Boolean);
}

function filePath(line: string): string {
  return line.replace(/:\d+:.*$/, '');
}

function isTestFile(f: string): boolean {
  return f.includes('.test.ts') || f.includes('.spec.ts');
}

// ---------------------------------------------------------------------------
// [boundary] NFR-2: Hono framework confinement
// Hono-family imports (hono, @hono/node-server, etc.) must appear ONLY in
// src/infrastructure/inbound/http/.
// ---------------------------------------------------------------------------

describe('[boundary] NFR-2: Hono framework confinement', () => {
  const honoPattern = /from\s+['"]hono['"]|from\s+['"]@hono\//;

  const honoAllowed = 'src/infrastructure/inbound/http/';

  test('no hono-family imports outside src/infrastructure/inbound/http/', () => {
    const lines = findMatchingLines('src', honoPattern);

    const violations = lines.filter((l) => {
      const fp = filePath(l);
      if (isTestFile(fp)) return false;
      if (fp.startsWith(honoAllowed)) return false;
      return true;
    });

    assert.deepStrictEqual(
      violations,
      [],
      `Hono imports found outside ${honoAllowed}:\n${violations.join('\n')}`,
    );
  });
});

// ---------------------------------------------------------------------------
// [boundary] NFR-3: SDK confinement
// `openai` SDK imports must appear ONLY in
// src/infrastructure/outbound/llm/openai-chat-adapter.ts.
// `@anthropic-ai/sdk` imports must appear ONLY in
// src/infrastructure/outbound/llm/anthropic-chat-adapter.ts.
// The factory importing either SDK IS a violation.
// ---------------------------------------------------------------------------

describe('[boundary] NFR-3: SDK confinement', () => {
  const openaiPattern = /from\s+['"]openai['"]/;
  const anthropicPattern = /from\s+['"]@anthropic-ai\/sdk['"]/;

  const openaiAllowed = 'src/infrastructure/outbound/llm/openai-chat-adapter.ts';
  const anthropicAllowed = 'src/infrastructure/outbound/llm/anthropic-chat-adapter.ts';

  test('openai SDK used only in openai-chat-adapter.ts', () => {
    const lines = findMatchingLines('src', openaiPattern);

    const violations = lines.filter((l) => {
      const fp = filePath(l);
      if (isTestFile(fp)) return false;
      if (fp === openaiAllowed) return false;
      return true;
    });

    assert.deepStrictEqual(
      violations,
      [],
      `openai SDK imports found outside ${openaiAllowed}:\n${violations.join('\n')}`,
    );
  });

  test('@anthropic-ai/sdk used only in anthropic-chat-adapter.ts', () => {
    const lines = findMatchingLines('src', anthropicPattern);

    const violations = lines.filter((l) => {
      const fp = filePath(l);
      if (isTestFile(fp)) return false;
      if (fp === anthropicAllowed) return false;
      return true;
    });

    assert.deepStrictEqual(
      violations,
      [],
      `@anthropic-ai/sdk imports found outside ${anthropicAllowed}:\n${violations.join('\n')}`,
    );
  });
});
