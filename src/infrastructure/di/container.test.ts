import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Hono } from 'hono';
import { createApp } from './container.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'fusion-container-test-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeConfig(dir: string, content: unknown): string {
  const path = join(dir, 'fusion.config.json');
  writeFileSync(path, JSON.stringify(content), 'utf-8');
  return path;
}

function setEnv(key: string, value: string): void {
  process.env[key] = value;
}

function clearEnv(key: string): void {
  delete process.env[key];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('createApp returns a Hono app that can handle requests', () => {
  withTempDir((dir) => {
    const configPath = writeConfig(dir, {
      providers: [
        {
          type: 'openai',
          role: 'synthesizer',
          model: 'gpt-4o',
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
        },
      ],
      timeoutMs: 30000,
    });

    setEnv('OPENAI_API_KEY', 'sk-test');
    try {
      const oldConfigPath = process.env.FUSION_CONFIG_PATH;
      process.env.FUSION_CONFIG_PATH = configPath;

      try {
        const { app } = createApp();
        assert.ok(app instanceof Hono);
        // Verify app has fetch method for serving
        assert.ok(typeof app.fetch === 'function');
      } finally {
        if (oldConfigPath !== undefined) {
          process.env.FUSION_CONFIG_PATH = oldConfigPath;
        } else {
          delete process.env.FUSION_CONFIG_PATH;
        }
      }
    } finally {
      clearEnv('OPENAI_API_KEY');
    }
  });
});

test('createApp returns configPort and fusionService', () => {
  withTempDir((dir) => {
    const configPath = writeConfig(dir, {
      providers: [
        {
          type: 'openai',
          role: 'synthesizer',
          model: 'gpt-4o',
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
        },
      ],
      timeoutMs: 30000,
    });

    setEnv('OPENAI_API_KEY', 'sk-test');
    try {
      const oldConfigPath = process.env.FUSION_CONFIG_PATH;
      process.env.FUSION_CONFIG_PATH = configPath;

      try {
        const { configPort, fusionService } = createApp();

        assert.ok(configPort, 'configPort must exist');
        assert.ok(typeof configPort.getSynthesizerModel === 'function');
        assert.ok(typeof configPort.getPanelModels === 'function');
        assert.ok(typeof configPort.getJudgeModel === 'function');
        assert.ok(typeof configPort.getTimeoutMs === 'function');

        assert.ok(fusionService, 'fusionService must exist');
        assert.ok(typeof fusionService.runFusion === 'function');

        // Verify synthesizer model is resolved
        const synth = configPort.getSynthesizerModel();
        assert.equal(synth.model, 'gpt-4o');
        assert.equal(synth.provider, 'openai');
        assert.equal(synth.baseURL, 'https://api.openai.com/v1');
        assert.equal(synth.apiKey, 'sk-test');
      } finally {
        if (oldConfigPath !== undefined) {
          process.env.FUSION_CONFIG_PATH = oldConfigPath;
        } else {
          delete process.env.FUSION_CONFIG_PATH;
        }
      }
    } finally {
      clearEnv('OPENAI_API_KEY');
    }
  });
});

test('createApp throws on missing config file', () => {
  const oldConfigPath = process.env.FUSION_CONFIG_PATH;
  process.env.FUSION_CONFIG_PATH = '/nonexistent/path/fusion.config.json';

  try {
    assert.throws(
      () => createApp(),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        const msg = (err as Error).message;
        assert.ok(msg.includes('not found'), `expected 'not found' message, got: ${msg}`);
        return true;
      },
    );
  } finally {
    if (oldConfigPath !== undefined) {
      process.env.FUSION_CONFIG_PATH = oldConfigPath;
    } else {
      delete process.env.FUSION_CONFIG_PATH;
    }
  }
});

test('createApp throws on missing synthesizer', () => {
  withTempDir((dir) => {
    const configPath = writeConfig(dir, {
      providers: [
        {
          type: 'openai',
          role: 'panel',
          model: 'gpt-4o',
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
        },
      ],
      timeoutMs: 30000,
    });

    const oldConfigPath = process.env.FUSION_CONFIG_PATH;
    setEnv('OPENAI_API_KEY', 'sk-test');
    process.env.FUSION_CONFIG_PATH = configPath;

    try {
      assert.throws(
        () => createApp(),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          const msg = (err as Error).message;
          assert.ok(msg.includes('synthesizer'), `expected message to mention synthesizer, got: ${msg}`);
          return true;
        },
      );
    } finally {
      clearEnv('OPENAI_API_KEY');
      if (oldConfigPath !== undefined) {
        process.env.FUSION_CONFIG_PATH = oldConfigPath;
      } else {
        delete process.env.FUSION_CONFIG_PATH;
      }
    }
  });
});

test('createApp throws on missing env var', () => {
  withTempDir((dir) => {
    const configPath = writeConfig(dir, {
      providers: [
        {
          type: 'openai',
          role: 'synthesizer',
          model: 'gpt-4o',
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'MISSING_API_KEY_VAR',
        },
      ],
      timeoutMs: 30000,
    });

    const oldConfigPath = process.env.FUSION_CONFIG_PATH;
    // Ensure the env var is not set
    delete process.env.MISSING_API_KEY_VAR;
    process.env.FUSION_CONFIG_PATH = configPath;

    try {
      assert.throws(
        () => createApp(),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          const msg = (err as Error).message;
          assert.ok(msg.includes('MISSING_API_KEY_VAR'), `expected env var name in message, got: ${msg}`);
          return true;
        },
      );
    } finally {
      delete process.env.MISSING_API_KEY_VAR;
      if (oldConfigPath !== undefined) {
        process.env.FUSION_CONFIG_PATH = oldConfigPath;
      } else {
        delete process.env.FUSION_CONFIG_PATH;
      }
    }
  });
});

test('createApp uses FUSION_CONFIG_PATH env var to resolve config', () => {
  withTempDir((dir) => {
    const configPath = writeConfig(dir, {
      providers: [
        {
          type: 'openai',
          role: 'synthesizer',
          model: 'gpt-4o-mini',
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
        },
      ],
      timeoutMs: 15000,
    });

    const oldConfigPath = process.env.FUSION_CONFIG_PATH;
    setEnv('OPENAI_API_KEY', 'sk-custom');
    process.env.FUSION_CONFIG_PATH = configPath;

    try {
      const { configPort } = createApp();
      const synth = configPort.getSynthesizerModel();
      assert.equal(synth.model, 'gpt-4o-mini');
      assert.equal(configPort.getTimeoutMs(), 15000);
    } finally {
      clearEnv('OPENAI_API_KEY');
      if (oldConfigPath !== undefined) {
        process.env.FUSION_CONFIG_PATH = oldConfigPath;
      } else {
        delete process.env.FUSION_CONFIG_PATH;
      }
    }
  });
});
