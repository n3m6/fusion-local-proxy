import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

function projectFile(relPath: string): string {
  return path.join(ROOT, relPath);
}

function grepForbidden(dir: string, pattern: RegExp): string {
  const { stdout } = spawnSync(
    'grep',
    ['-r', '--include=*.ts', pattern.source, dir],
    { encoding: 'utf-8', cwd: ROOT }
  );
  return stdout.trim();
}

// ---------------------------------------------------------------------------
// Port file existence
// ---------------------------------------------------------------------------

describe('Domain port files exist', () => {
  const portFiles = [
    'src/domain/ports/chat-model-port.ts',
    'src/domain/ports/config-port.ts',
    'src/domain/ports/logger-port.ts',
    'src/domain/ports/clock-port.ts',
  ];

  for (const f of portFiles) {
    test(`${f} exists with non-zero content`, () => {
      const p = projectFile(f);
      assert.ok(existsSync(p), `${f} must exist`);
      const content = readFileSync(p, 'utf-8').trim();
      assert.ok(content.length > 0, `${f} must have non-zero content`);
    });
  }
});

// ---------------------------------------------------------------------------
// Dependency rule — no SDK imports
// ---------------------------------------------------------------------------

describe('Port dependency purity — no SDK/framework imports', () => {
  const forbiddenPatterns: Array<[string, RegExp]> = [
    ['SDK: openai', /from\s+['"]openai['"]/],
    ['SDK: @anthropic-ai/sdk', /from\s+['"]@anthropic-ai\/sdk['"]/],
    ['SDK: hono', /from\s+['"]hono['"]/],
    ['SDK: zod', /from\s+['"]zod['"]/],
    ['application layer', /from\s+['"].*application.*['"]/],
    ['infrastructure layer', /from\s+['"].*infrastructure.*['"]/],
  ];

  const portsDir = projectFile('src/domain/ports');

  for (const [label, pattern] of forbiddenPatterns) {
    test(`no ${label} imports in src/domain/ports/`, () => {
      const output = grepForbidden(portsDir, pattern);
      assert.equal(output, '', `Forbidden ${label} imports found:\n${output}`);
    });
  }
});

// ---------------------------------------------------------------------------
// Port files contain only interface/type exports, no executable code
// ---------------------------------------------------------------------------

describe('Port files are pure interfaces — no executable code', () => {
  const portFiles = [
    'src/domain/ports/chat-model-port.ts',
    'src/domain/ports/config-port.ts',
    'src/domain/ports/logger-port.ts',
    'src/domain/ports/clock-port.ts',
  ];

  for (const f of portFiles) {
    test(`${f} contains only export interface/type declarations`, () => {
      const source = readFileSync(projectFile(f), 'utf-8');
      // No class, no function, no const with runtime value, no new, no =
      // Clock port is the exception — it has no imports so no import statement either
      const hasClass = /\bclass\b/.test(source);
      const hasFunction = /\bfunction\b/.test(source);
      const hasConstAssignment = /\bconst\s+\w+\s*=/.test(source);

      assert.ok(!hasClass, `${f} must not contain class declarations`);
      assert.ok(!hasFunction, `${f} must not contain function declarations`);
      assert.ok(!hasConstAssignment, `${f} must not contain const assignments`);
    });
  }
});

// ---------------------------------------------------------------------------
// TypeScript compilation — port files only
// ---------------------------------------------------------------------------

describe('TypeScript compilation', () => {
  test('domain port files compile with no errors (strict, NodeNext)', () => {
    const portFiles = [
      'src/domain/ports/chat-model-port.ts',
      'src/domain/ports/config-port.ts',
      'src/domain/ports/logger-port.ts',
      'src/domain/ports/clock-port.ts',
    ];

    const { status, stdout, stderr } = spawnSync(
      'npx',
      [
        'tsc',
        '--noEmit',
        '--strict',
        '--target', 'ES2023',
        '--module', 'NodeNext',
        '--moduleResolution', 'NodeNext',
        '--esModuleInterop',
        '--skipLibCheck',
        '--resolveJsonModule',
        '--isolatedModules',
        ...portFiles,
      ],
      { encoding: 'utf-8', cwd: ROOT }
    );

    assert.equal(
      status,
      0,
      `tsc failed with exit ${status}\nstdout: ${stdout}\nstderr: ${stderr}`
    );
    assert.equal(stderr.trim(), '', `tsc produced stderr: ${stderr}`);
  });
});

// ---------------------------------------------------------------------------
// ChatModelPort contract
// ---------------------------------------------------------------------------

describe('ChatModelPort contract', () => {
  const sourceFile = 'src/domain/ports/chat-model-port.ts';

  test('exports ChatModelPort interface', () => {
    const source = readFileSync(projectFile(sourceFile), 'utf-8');
    assert.ok(source.includes('export interface ChatModelPort'), 'must export ChatModelPort');
  });

  test('imports only ChatRequest and ChatResponse from ../model/chat-types.js', () => {
    const source = readFileSync(projectFile(sourceFile), 'utf-8');
    const importLines = source.split('\n').filter(line => line.startsWith('import'));
    assert.equal(importLines.length, 1, 'must have exactly one import line');
    assert.ok(
      importLines[0].includes("from '../model/chat-types.js'"),
      `import must be from ../model/chat-types.js, got: ${importLines[0]}`
    );
    assert.ok(importLines[0].includes('ChatRequest'), 'must import ChatRequest');
    assert.ok(importLines[0].includes('ChatResponse'), 'must import ChatResponse');
  });

  test('declares complete method with signature (request: ChatRequest): Promise<ChatResponse>', () => {
    const source = readFileSync(projectFile(sourceFile), 'utf-8');
    assert.ok(
      /complete\s*\(\s*request\s*:\s*ChatRequest\s*\)\s*:\s*Promise\s*<\s*ChatResponse\s*>/.test(source),
      'must have complete(request: ChatRequest): Promise<ChatResponse>'
    );
  });

  test('does NOT declare a stream method', () => {
    const source = readFileSync(projectFile(sourceFile), 'utf-8');
    assert.ok(!source.includes('stream('), 'must not have a stream method');
    assert.ok(!source.includes('stream ('), 'must not have a stream method');
  });
});

// ---------------------------------------------------------------------------
// ConfigPort contract
// ---------------------------------------------------------------------------

describe('ConfigPort contract', () => {
  const sourceFile = 'src/domain/ports/config-port.ts';

  test('exports ConfigPort interface', () => {
    const source = readFileSync(projectFile(sourceFile), 'utf-8');
    assert.ok(source.includes('export interface ConfigPort'), 'must export ConfigPort');
  });

  test('imports only ModelRef from ../model/fusion-types.js', () => {
    const source = readFileSync(projectFile(sourceFile), 'utf-8');
    const importLines = source.split('\n').filter(line => line.startsWith('import'));
    assert.equal(importLines.length, 1, 'must have exactly one import line');
    assert.ok(
      importLines[0].includes("from '../model/fusion-types.js'"),
      `import must be from ../model/fusion-types.js, got: ${importLines[0]}`
    );
    assert.ok(importLines[0].includes('ModelRef'), 'must import ModelRef');
  });

  test('getPanelModels() returns ModelRef[]', () => {
    const source = readFileSync(projectFile(sourceFile), 'utf-8');
    assert.ok(
      /getPanelModels\s*\(\s*\)\s*:\s*ModelRef\s*\[\s*\]/.test(source),
      'getPanelModels must return ModelRef[]'
    );
  });

  test('getJudgeModel() returns ModelRef | null (optional judge)', () => {
    const source = readFileSync(projectFile(sourceFile), 'utf-8');
    // Must have | null in the return type
    assert.ok(
      /getJudgeModel\s*\(\s*\)\s*:\s*ModelRef\s*\|\s*null/.test(source),
      'getJudgeModel must return ModelRef | null'
    );
  });

  test('getSynthesizerModel() returns ModelRef (not null — mandatory synthesizer)', () => {
    const source = readFileSync(projectFile(sourceFile), 'utf-8');
    // Must return ModelRef without | null
    const methodMatch = source.match(/getSynthesizerModel\s*\(\s*\)\s*:\s*(ModelRef[^;]*);/);
    assert.ok(methodMatch, 'getSynthesizerModel must be declared');
    const returnType = methodMatch![1];
    assert.ok(
      !returnType.includes('null'),
      `getSynthesizerModel must not return null, got: ${returnType}`
    );
  });

  test('getTimeoutMs() returns number', () => {
    const source = readFileSync(projectFile(sourceFile), 'utf-8');
    assert.ok(
      /getTimeoutMs\s*\(\s*\)\s*:\s*number\s*;/.test(source),
      'getTimeoutMs must return number'
    );
  });
});

// ---------------------------------------------------------------------------
// LoggerPort contract
// ---------------------------------------------------------------------------

describe('LoggerPort contract', () => {
  const sourceFile = 'src/domain/ports/logger-port.ts';

  test('exports LoggerPort interface', () => {
    const source = readFileSync(projectFile(sourceFile), 'utf-8');
    assert.ok(source.includes('export interface LoggerPort'), 'must export LoggerPort');
  });

  test('imports TokenUsage from ../model/chat-types.js and FailedModelInfo from ../model/stream-types.js', () => {
    const source = readFileSync(projectFile(sourceFile), 'utf-8');
    const importLines = source.split('\n').filter(line => line.startsWith('import'));
    assert.equal(importLines.length, 2, 'must have exactly two import lines');
    const hasChatTypes = importLines.some(
      l => l.includes("from '../model/chat-types.js'") && l.includes('TokenUsage')
    );
    const hasStreamTypes = importLines.some(
      l => l.includes("from '../model/stream-types.js'") && l.includes('FailedModelInfo')
    );
    assert.ok(hasChatTypes, 'must import TokenUsage from ../model/chat-types.js');
    assert.ok(hasStreamTypes, 'must import FailedModelInfo from ../model/stream-types.js');
  });

  test('declares logStageStart(stage: string): void', () => {
    const source = readFileSync(projectFile(sourceFile), 'utf-8');
    assert.ok(
      /logStageStart\s*\(\s*stage\s*:\s*string\s*\)\s*:\s*void/.test(source),
      'must have logStageStart(stage: string): void'
    );
  });

  test('declares logStageEnd(stage: string, durationMs: number, usage?: TokenUsage): void', () => {
    const source = readFileSync(projectFile(sourceFile), 'utf-8');
    assert.ok(
      /logStageEnd\s*\(\s*stage\s*:\s*string\s*,\s*durationMs\s*:\s*number\s*,\s*usage\?\s*:\s*TokenUsage\s*\)\s*:\s*void/.test(source),
      'must have logStageEnd(stage: string, durationMs: number, usage?: TokenUsage): void'
    );
  });

  test('declares logFailedModels(models: FailedModelInfo[]): void', () => {
    const source = readFileSync(projectFile(sourceFile), 'utf-8');
    assert.ok(
      /logFailedModels\s*\(\s*models\s*:\s*FailedModelInfo\s*\[\s*\]\s*\)\s*:\s*void/.test(source),
      'must have logFailedModels(models: FailedModelInfo[]): void'
    );
  });

  test('declares logError(stage: string, error: Error): void', () => {
    const source = readFileSync(projectFile(sourceFile), 'utf-8');
    assert.ok(
      /logError\s*\(\s*stage\s*:\s*string\s*,\s*error\s*:\s*Error\s*\)\s*:\s*void/.test(source),
      'must have logError(stage: string, error: Error): void'
    );
  });

  test('all four methods return void', () => {
    const source = readFileSync(projectFile(sourceFile), 'utf-8');
    // Count void occurrences after method signatures within the interface
    const interfaceStart = source.indexOf('export interface LoggerPort');
    const interfaceBody = source.slice(interfaceStart);
    const voidMatches = interfaceBody.match(/:\s*void/g);
    assert.ok(voidMatches && voidMatches.length === 4, `Expected 4 void returns, found ${voidMatches?.length ?? 0}`);
  });
});

// ---------------------------------------------------------------------------
// ClockPort contract
// ---------------------------------------------------------------------------

describe('ClockPort contract', () => {
  const sourceFile = 'src/domain/ports/clock-port.ts';

  test('exports ClockPort interface', () => {
    const source = readFileSync(projectFile(sourceFile), 'utf-8');
    assert.ok(source.includes('export interface ClockPort'), 'must export ClockPort');
  });

  test('has zero imports', () => {
    const source = readFileSync(projectFile(sourceFile), 'utf-8');
    const importLines = source.split('\n').filter(line => line.startsWith('import'));
    assert.equal(importLines.length, 0, 'ClockPort must have no imports');
  });

  test('declares now() with no arguments and returns number', () => {
    const source = readFileSync(projectFile(sourceFile), 'utf-8');
    assert.ok(
      /now\s*\(\s*\)\s*:\s*number/.test(source),
      'must have now(): number'
    );
  });

  test('now() accepts no arguments', () => {
    const source = readFileSync(projectFile(sourceFile), 'utf-8');
    assert.ok(
      /now\s*\(\s*\)\s*:\s*number\s*;/.test(source),
      'now() must have empty parameter list and return number'
    );
  });
});
