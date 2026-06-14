import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

function projectFile(relPath: string): string {
  return path.join(ROOT, relPath);
}

// ---------------------------------------------------------------------------
// Project scaffold files
// ---------------------------------------------------------------------------

describe('Project scaffold files', () => {
  const expectedFiles = ['package.json', 'tsconfig.json', '.env.example'];

  for (const f of expectedFiles) {
    test(`${f} exists with non-zero content`, () => {
      const p = projectFile(f);
      assert.ok(existsSync(p), `${f} must exist`);
      const content = readFileSync(p, 'utf-8').trim();
      assert.ok(content.length > 0, `${f} must have non-zero content`);
    });
  }
});

// ---------------------------------------------------------------------------
// package.json contents
// ---------------------------------------------------------------------------

describe('package.json', () => {
  let pkg: Record<string, unknown>;

  test('loads as JSON', () => {
    pkg = readJson(projectFile('package.json')) as Record<string, unknown>;
  });

  test('sets "type": "module"', () => {
    assert.equal(pkg.type, 'module');
  });

  test('has engines requiring node >= 20.0.0', () => {
    const engines = pkg.engines as Record<string, string>;
    assert.ok(engines, 'engines block must exist');
    assert.ok(engines.node, 'engines.node must exist');
    // The version string should satisfy >=20.0.0
    assert.ok(
      engines.node.includes('20') || engines.node.includes('>=20') || engines.node === '>=20.0.0',
      `engines.node should require >=20.0.0, got: ${engines.node}`
    );
  });

  test('has "dev" script running tsx src/main.ts', () => {
    const scripts = pkg.scripts as Record<string, string>;
    assert.ok(scripts, 'scripts block must exist');
    assert.ok(scripts.dev, '"dev" script must exist');
    assert.ok(scripts.dev.includes('tsx'), '"dev" script must use tsx');
    assert.ok(scripts.dev.includes('src/main.ts'), '"dev" script must reference src/main.ts');
  });

  test('dependencies include hono, @hono/node-server, openai, zod', () => {
    const deps = pkg.dependencies as Record<string, string>;
    assert.ok(deps, 'dependencies block must exist');
    assert.ok(deps.hono, 'hono must be in dependencies');
    assert.ok(deps['@hono/node-server'], '@hono/node-server must be in dependencies');
    assert.ok(deps.openai, 'openai must be in dependencies');
    assert.ok(deps.zod, 'zod must be in dependencies');
  });

  test('devDependencies include tsx, typescript, @types/node', () => {
    const devDeps = pkg.devDependencies as Record<string, string>;
    assert.ok(devDeps, 'devDependencies block must exist');
    assert.ok(devDeps.tsx, 'tsx must be in devDependencies');
    assert.ok(devDeps.typescript, 'typescript must be in devDependencies');
    assert.ok(devDeps['@types/node'], '@types/node must be in devDependencies');
  });
});

// ---------------------------------------------------------------------------
// tsconfig.json contents
// ---------------------------------------------------------------------------

describe('tsconfig.json', () => {
  let cfg: Record<string, unknown>;

  test('loads as JSON', () => {
    cfg = readJson(projectFile('tsconfig.json')) as Record<string, unknown>;
  });

  test('compilerOptions.strict is true', () => {
    const co = cfg.compilerOptions as Record<string, unknown>;
    assert.strictEqual(co.strict, true);
  });

  test('compilerOptions.target is ES2023', () => {
    const co = cfg.compilerOptions as Record<string, unknown>;
    assert.strictEqual(co.target, 'ES2023');
  });

  test('compilerOptions.module is NodeNext', () => {
    const co = cfg.compilerOptions as Record<string, unknown>;
    assert.strictEqual(co.module, 'NodeNext');
  });

  test('compilerOptions.moduleResolution is NodeNext', () => {
    const co = cfg.compilerOptions as Record<string, unknown>;
    assert.strictEqual(co.moduleResolution, 'NodeNext');
  });

  test('compilerOptions.resolveJsonModule is true', () => {
    const co = cfg.compilerOptions as Record<string, unknown>;
    assert.strictEqual(co.resolveJsonModule, true);
  });

  test('include contains src/**/*.ts', () => {
    const include = cfg.include as string[];
    assert.ok(Array.isArray(include), 'include must be an array');
    assert.ok(include.includes('src/**/*.ts'), 'include must contain src/**/*.ts');
  });

  test('does not set rootDir', () => {
    const co = cfg.compilerOptions as Record<string, unknown>;
    assert.strictEqual(co.rootDir, undefined, 'rootDir must not be set');
  });
});

// ---------------------------------------------------------------------------
// .env.example contents
// ---------------------------------------------------------------------------

describe('.env.example', () => {
  test('contains OPENAI_API_KEY', () => {
    const content = readFileSync(projectFile('.env.example'), 'utf-8');
    assert.ok(content.includes('OPENAI_API_KEY'), '.env.example must mention OPENAI_API_KEY');
  });

  test('contains ANTHROPIC_API_KEY', () => {
    const content = readFileSync(projectFile('.env.example'), 'utf-8');
    assert.ok(content.includes('ANTHROPIC_API_KEY'), '.env.example must mention ANTHROPIC_API_KEY');
  });
});

// ---------------------------------------------------------------------------
// Domain model file existence
// ---------------------------------------------------------------------------

describe('Domain model files', () => {
  const modelFiles = [
    'src/domain/model/message.ts',
    'src/domain/model/chat-types.ts',
    'src/domain/model/fusion-types.ts',
    'src/domain/model/stream-types.ts',
  ];

  for (const f of modelFiles) {
    test(`${f} exists with non-zero content`, () => {
      const p = projectFile(f);
      assert.ok(existsSync(p), `${f} must exist`);
      const content = readFileSync(p, 'utf-8').trim();
      assert.ok(content.length > 0, `${f} must have non-zero content`);
    });
  }
});

// ---------------------------------------------------------------------------
// Domain purity — no forbidden imports
// ---------------------------------------------------------------------------

describe('Domain purity', () => {
  const forbiddenPatterns: Array<[string, RegExp]> = [
    ['SDK: openai', /from\s+['"]openai['"]/],
    ['SDK: @anthropic-ai/sdk', /from\s+['"]@anthropic-ai\/sdk['"]/],
    ['SDK: hono', /from\s+['"]hono['"]/],
    ['SDK: zod', /from\s+['"]zod['"]/],
    ['application layer', /from\s+['"].*application.*['"]/],
    ['infrastructure layer', /from\s+['"].*infrastructure.*['"]/],
  ];

  const domainDir = projectFile('src/domain');

  for (const [label, pattern] of forbiddenPatterns) {
    test(`no ${label} imports in src/domain/`, () => {
      const { status, stdout, stderr } = spawnSync(
        'grep',
        ['-r', '--include=*.ts', pattern.source, domainDir],
        { encoding: 'utf-8', cwd: ROOT }
      );
      const output = stdout.trim();
      assert.equal(
        output,
        '',
        `Forbidden ${label} imports found:\n${output}`
      );
    });
  }
});

// ---------------------------------------------------------------------------
// FusionStreamEvent variants
// ---------------------------------------------------------------------------

describe('FusionStreamEvent discriminated union', () => {
  test('FusionStreamEvent type is declared in source with all five variants', () => {
    const source = readFileSync(projectFile('src/domain/model/stream-types.ts'), 'utf-8');
    // Count the | variants in the type definition
    assert.ok(source.includes('FusionStreamEvent'), 'FusionStreamEvent must be declared');
    assert.ok(source.includes("type: 'progress'"), 'must have progress variant');
    assert.ok(source.includes("type: 'content_delta'"), 'must have content_delta variant');
    assert.ok(source.includes("type: 'content_stop'"), 'must have content_stop variant');
    assert.ok(source.includes("type: 'done'"), 'must have done variant');
    assert.ok(source.includes("type: 'error'"), 'must have error variant');

    // Verify exactly 5 variants: count the '|' at top level of the union
    // The type is a union of 5 object types, so there should be 4 | separators
    // between them. We count the pipe characters in the type definition.
    const typeDefStart = source.indexOf('export type FusionStreamEvent');
    const typeDefEnd = source.indexOf('export interface FailedModelInfo');
    const typeDef = source.slice(typeDefStart, typeDefEnd >= 0 ? typeDefEnd : undefined);

    // Count lines that begin with "  |" (the union members)
    const variantLines = typeDef.split('\n').filter(line => line.trim().startsWith('|'));
    assert.equal(variantLines.length, 5, `Expected 5 variants, found ${variantLines.length}`);
  });

  test('FailedModelInfo is declared', () => {
    const source = readFileSync(projectFile('src/domain/model/stream-types.ts'), 'utf-8');
    assert.ok(source.includes('FailedModelInfo'), 'FailedModelInfo must be declared');
    assert.ok(source.includes('modelId'), 'FailedModelInfo must have modelId');
    assert.ok(source.includes('errorCode'), 'FailedModelInfo must have errorCode');
    assert.ok(source.includes('errorMessage'), 'FailedModelInfo must have errorMessage');
  });
});

// ---------------------------------------------------------------------------
// TypeScript compilation — domain model files only
// ---------------------------------------------------------------------------

describe('TypeScript compilation', () => {
  test('domain model files compile with no errors', () => {
    const domainFiles = [
      'src/domain/model/message.ts',
      'src/domain/model/fusion-types.ts',
      'src/domain/model/chat-types.ts',
      'src/domain/model/stream-types.ts',
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
        ...domainFiles,
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
