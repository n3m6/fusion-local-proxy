import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonFileConfigAdapter } from './json-file-config-adapter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'fusion-config-test-'));
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

// ---------------------------------------------------------------------------
// Construction / validation — valid configs
// ---------------------------------------------------------------------------

test('JsonFileConfigAdapter loads valid config', () => {
  withTempDir((dir) => {
    const path = writeConfig(dir, {
      providers: [
        {
          type: 'openai',
          role: 'panel',
          model: 'gpt-4o',
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
        },
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

    process.env.OPENAI_API_KEY = 'sk-test-value';
    try {
      const adapter = new JsonFileConfigAdapter(path);

      const panel = adapter.getPanelModels();
      assert.equal(panel.length, 1);
      assert.equal(panel[0].provider, 'openai');
      assert.equal(panel[0].model, 'gpt-4o');
      assert.equal(panel[0].baseURL, 'https://api.openai.com/v1');
      assert.equal(panel[0].apiKey, 'sk-test-value');

      assert.equal(adapter.getJudgeModel(), null);

      const synthesizer = adapter.getSynthesizerModel();
      assert.ok(synthesizer !== null);
      assert.equal(synthesizer.provider, 'openai');
      assert.equal(synthesizer.model, 'gpt-4o');
      assert.equal(synthesizer.apiKey, 'sk-test-value');

      assert.equal(adapter.getTimeoutMs(), 30000);
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });
});

test('JsonFileConfigAdapter uses default timeoutMs when omitted', () => {
  withTempDir((dir) => {
    const path = writeConfig(dir, {
      providers: [
        {
          type: 'openai',
          role: 'panel',
          model: 'gpt-4o',
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
        },
        {
          type: 'openai',
          role: 'synthesizer',
          model: 'gpt-4o',
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
        },
      ],
    });

    process.env.OPENAI_API_KEY = 'sk-test-value';
    try {
      const adapter = new JsonFileConfigAdapter(path);
      assert.equal(adapter.getTimeoutMs(), 30000);
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });
});

test('JsonFileConfigAdapter returns empty panel array when only synthesizer configured', () => {
  withTempDir((dir) => {
    const path = writeConfig(dir, {
      providers: [
        {
          type: 'openai',
          role: 'synthesizer',
          model: 'gpt-4o',
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
        },
      ],
      timeoutMs: 10000,
    });

    process.env.OPENAI_API_KEY = 'sk-test-value';
    try {
      const adapter = new JsonFileConfigAdapter(path);

      assert.deepEqual(adapter.getPanelModels(), []);
      assert.equal(adapter.getJudgeModel(), null);
      assert.ok(adapter.getSynthesizerModel() !== null);
      assert.equal(adapter.getTimeoutMs(), 10000);
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });
});

test('JsonFileConfigAdapter returns judge model when role judge configured', () => {
  withTempDir((dir) => {
    const path = writeConfig(dir, {
      providers: [
        {
          type: 'openai',
          role: 'panel',
          model: 'gpt-4o',
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
        },
        {
          type: 'openai',
          role: 'judge',
          model: 'gpt-4o-mini',
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
        },
        {
          type: 'openai',
          role: 'synthesizer',
          model: 'gpt-4o',
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
        },
      ],
    });

    process.env.OPENAI_API_KEY = 'sk-test-value';
    try {
      const adapter = new JsonFileConfigAdapter(path);
      const judge = adapter.getJudgeModel();
      assert.ok(judge !== null);
      assert.equal(judge!.model, 'gpt-4o-mini');

      const synthesizer = adapter.getSynthesizerModel();
      assert.ok(synthesizer !== null);
      assert.equal(synthesizer.model, 'gpt-4o');
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });
});

test('JsonFileConfigAdapter constructor throws when no synthesizer configured', () => {
  withTempDir((dir) => {
    const path = writeConfig(dir, {
      providers: [
        {
          type: 'openai',
          role: 'panel',
          model: 'gpt-4o',
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
        },
      ],
    });

    process.env.OPENAI_API_KEY = 'sk-test-value';
    try {
      assert.throws(
        () => new JsonFileConfigAdapter(path),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          const msg = (err as Error).message;
          assert.ok(msg.includes('synthesizer'), `expected message to mention synthesizer, got: ${msg}`);
          return true;
        },
      );
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });
});

// ---------------------------------------------------------------------------
// Validation: missing required fields
// ---------------------------------------------------------------------------

test('JsonFileConfigAdapter throws on missing model field', () => {
  withTempDir((dir) => {
    const path = writeConfig(dir, {
      providers: [
        {
          type: 'openai',
          role: 'panel',
          // model missing
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
        },
        {
          type: 'openai',
          role: 'synthesizer',
          model: 'gpt-4o',
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
        },
      ],
    });

    assert.throws(
      () => new JsonFileConfigAdapter(path),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        const msg = (err as Error).message;
        assert.ok(msg.includes('model') || msg.includes('Required'), `expected message to mention model, got: ${msg}`);
        return true;
      },
    );
  });
});

test('JsonFileConfigAdapter throws on missing type field', () => {
  withTempDir((dir) => {
    const path = writeConfig(dir, {
      providers: [
        {
          role: 'panel',
          model: 'gpt-4o',
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
        },
        {
          type: 'openai',
          role: 'synthesizer',
          model: 'gpt-4o',
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
        },
      ],
    });

    assert.throws(
      () => new JsonFileConfigAdapter(path),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        const msg = (err as Error).message;
        assert.ok(msg.includes('type') || msg.includes('Required'), `expected message to mention type, got: ${msg}`);
        return true;
      },
    );
  });
});

test('JsonFileConfigAdapter throws on missing role field', () => {
  withTempDir((dir) => {
    const path = writeConfig(dir, {
      providers: [
        {
          type: 'openai',
          model: 'gpt-4o',
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
        },
        {
          type: 'openai',
          role: 'synthesizer',
          model: 'gpt-4o',
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
        },
      ],
    });

    assert.throws(
      () => new JsonFileConfigAdapter(path),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        const msg = (err as Error).message;
        assert.ok(msg.includes('role') || msg.includes('Required'), `expected message to mention role, got: ${msg}`);
        return true;
      },
    );
  });
});

test('JsonFileConfigAdapter throws on missing baseURL field', () => {
  withTempDir((dir) => {
    const path = writeConfig(dir, {
      providers: [
        {
          type: 'openai',
          role: 'panel',
          model: 'gpt-4o',
          apiKeyEnv: 'OPENAI_API_KEY',
        },
        {
          type: 'openai',
          role: 'synthesizer',
          model: 'gpt-4o',
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
        },
      ],
    });

    assert.throws(
      () => new JsonFileConfigAdapter(path),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        const msg = (err as Error).message;
        assert.ok(msg.includes('baseURL') || msg.includes('Required'), `expected message to mention baseURL, got: ${msg}`);
        return true;
      },
    );
  });
});

test('JsonFileConfigAdapter throws on invalid role value', () => {
  withTempDir((dir) => {
    const path = writeConfig(dir, {
      providers: [
        {
          type: 'openai',
          role: 'unknown-role',
          model: 'gpt-4o',
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
        },
        {
          type: 'openai',
          role: 'synthesizer',
          model: 'gpt-4o',
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
        },
      ],
    });

    assert.throws(
      () => new JsonFileConfigAdapter(path),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        const msg = (err as Error).message;
        assert.ok(msg.includes('role') || msg.includes('Invalid') || msg.includes('enum'), `expected message about invalid role, got: ${msg}`);
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// File not found
// ---------------------------------------------------------------------------

test('JsonFileConfigAdapter throws on non-existent config file', () => {
  assert.throws(
    () => new JsonFileConfigAdapter('/nonexistent/path/fusion.config.json'),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      const msg = (err as Error).message;
      assert.ok(msg.includes('not found:') || msg.includes('not found'), `expected file not found message, got: ${msg}`);
      return true;
    },
  );
});

test('JsonFileConfigAdapter throws on malformed JSON', () => {
  withTempDir((dir) => {
    const path = join(dir, 'fusion.config.json');
    writeFileSync(path, 'not valid json {{{', 'utf-8');

    assert.throws(
      () => new JsonFileConfigAdapter(path),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        const msg = (err as Error).message;
        assert.ok(msg.includes('Failed to parse') || msg.includes('JSON'), `expected parse error, got: ${msg}`);
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Environment variable validation
// ---------------------------------------------------------------------------

test('JsonFileConfigAdapter.getPanelModels throws when env var is not set', () => {
  withTempDir((dir) => {
    const path = writeConfig(dir, {
      providers: [
        {
          type: 'openai',
          role: 'panel',
          model: 'gpt-4o',
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'MISSING_ENV_VAR_XYZ',
        },
        {
          type: 'openai',
          role: 'synthesizer',
          model: 'gpt-4o',
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
        },
      ],
    });

    process.env.OPENAI_API_KEY = 'sk-synth';
    // ensure the panel env var is not set
    delete process.env.MISSING_ENV_VAR_XYZ;

    try {
      const adapter = new JsonFileConfigAdapter(path);

      assert.throws(
        () => adapter.getPanelModels(),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          const msg = (err as Error).message;
          assert.ok(msg.includes('MISSING_ENV_VAR_XYZ'), `expected env var name in message, got: ${msg}`);
          assert.ok(msg.includes('not set') || msg.includes('Environment'), `expected 'not set' message, got: ${msg}`);
          return true;
        },
      );
    } finally {
      delete process.env.OPENAI_API_KEY;
      delete process.env.MISSING_ENV_VAR_XYZ;
    }
  });
});

test('JsonFileConfigAdapter.getPanelModels succeeds when env var is set', () => {
  withTempDir((dir) => {
    const path = writeConfig(dir, {
      providers: [
        {
          type: 'openai',
          role: 'panel',
          model: 'gpt-4o',
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'MY_CUSTOM_KEY',
        },
        {
          type: 'openai',
          role: 'synthesizer',
          model: 'gpt-4o',
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
        },
      ],
    });

    process.env.MY_CUSTOM_KEY = 'my-secret';
    process.env.OPENAI_API_KEY = 'sk-synth';
    try {
      const adapter = new JsonFileConfigAdapter(path);
      const models = adapter.getPanelModels();
      assert.equal(models.length, 1);
      assert.equal(models[0].apiKey, 'my-secret');
    } finally {
      delete process.env.MY_CUSTOM_KEY;
      delete process.env.OPENAI_API_KEY;
    }
  });
});

test('JsonFileConfigAdapter constructor throws on empty providers array', () => {
  withTempDir((dir) => {
    const path = writeConfig(dir, {
      providers: [],
    });

    assert.throws(
      () => new JsonFileConfigAdapter(path),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        const msg = (err as Error).message;
        assert.ok(msg.includes('providers') || msg.includes('Array'), `expected message about empty providers, got: ${msg}`);
        return true;
      },
    );
  });
});

test('JsonFileConfigAdapter throws on empty model string', () => {
  withTempDir((dir) => {
    const path = writeConfig(dir, {
      providers: [
        {
          type: 'openai',
          role: 'panel',
          model: '',
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
        },
        {
          type: 'openai',
          role: 'synthesizer',
          model: 'gpt-4o',
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
        },
      ],
    });

    assert.throws(
      () => new JsonFileConfigAdapter(path),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        const msg = (err as Error).message;
        assert.ok(msg.includes('model') || msg.includes('String'), `expected message about empty model, got: ${msg}`);
        return true;
      },
    );
  });
});

test('JsonFileConfigAdapter throws on empty env var value', () => {
  withTempDir((dir) => {
    const path = writeConfig(dir, {
      providers: [
        {
          type: 'openai',
          role: 'panel',
          model: 'gpt-4o',
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'EMPTY_KEY_VAR',
        },
        {
          type: 'openai',
          role: 'synthesizer',
          model: 'gpt-4o',
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
        },
      ],
    });

    process.env.OPENAI_API_KEY = 'sk-synth';
    process.env.EMPTY_KEY_VAR = '';
    try {
      const adapter = new JsonFileConfigAdapter(path);
      assert.throws(
        () => adapter.getPanelModels(),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          const msg = (err as Error).message;
          assert.ok(msg.includes('EMPTY_KEY_VAR'), `expected env var name in message, got: ${msg}`);
          return true;
        },
      );
    } finally {
      delete process.env.OPENAI_API_KEY;
      delete process.env.EMPTY_KEY_VAR;
    }
  });
});
