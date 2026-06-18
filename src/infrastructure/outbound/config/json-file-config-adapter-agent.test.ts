import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonFileConfigAdapter } from './json-file-config-adapter.js';

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'fusion-config-agent-test-'));
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
// getAgentModel — dedicated agent role
// ---------------------------------------------------------------------------

describe('getAgentModel — dedicated agent role', () => {
  test('returns the dedicated agent provider as-is', () => {
    withTempDir((dir) => {
      const path = writeConfig(dir, {
        providers: [
          {
            type: 'openai',
            role: 'panel',
            model: 'panel-model',
            baseURL: 'http://localhost:11434/v1',
            apiKeyEnv: 'PANEL_KEY',
          },
          {
            type: 'openai',
            role: 'agent',
            model: 'agent-model',
            baseURL: 'https://api.openai.com/v1',
            apiKeyEnv: 'AGENT_KEY',
          },
          {
            type: 'openai',
            role: 'synthesizer',
            model: 'synth',
            baseURL: 'https://api.openai.com/v1',
            apiKeyEnv: 'SYNTH_KEY',
          },
        ],
      });

      process.env.PANEL_KEY = 'pk';
      process.env.AGENT_KEY = 'ak';
      process.env.SYNTH_KEY = 'sk';
      try {
        const adapter = new JsonFileConfigAdapter(path);
        const model = adapter.getAgentModel();
        assert.ok(model, 'must resolve an agent model');
        assert.equal(model.model, 'agent-model');
        assert.equal(model.provider, 'openai');
      } finally {
        delete process.env.PANEL_KEY;
        delete process.env.AGENT_KEY;
        delete process.env.SYNTH_KEY;
      }
    });
  });

  test('dedicated agent provider preserves explicit thinkingStrength', () => {
    withTempDir((dir) => {
      const path = writeConfig(dir, {
        providers: [
          {
            type: 'openai',
            role: 'agent',
            model: 'agent-model',
            baseURL: 'https://api.openai.com/v1',
            apiKeyEnv: 'AGENT_KEY',
            thinkingStrength: 'high',
          },
          {
            type: 'openai',
            role: 'synthesizer',
            model: 'synth',
            baseURL: 'https://api.openai.com/v1',
            apiKeyEnv: 'SYNTH_KEY',
          },
        ],
      });

      process.env.AGENT_KEY = 'ak';
      process.env.SYNTH_KEY = 'sk';
      try {
        const adapter = new JsonFileConfigAdapter(path);
        const model = adapter.getAgentModel();
        assert.ok(model);
        assert.equal(model.thinkingStrength, 'high');
      } finally {
        delete process.env.AGENT_KEY;
        delete process.env.SYNTH_KEY;
      }
    });
  });
});

// ---------------------------------------------------------------------------
// getAgentModel — fallback to first panel
// ---------------------------------------------------------------------------

describe('getAgentModel — first panel fallback', () => {
  test('falls back to first openai panel, stripping thinkingMode and thinkingStrength', () => {
    withTempDir((dir) => {
      const path = writeConfig(dir, {
        providers: [
          {
            type: 'openai',
            role: 'panel',
            model: 'panel-openai',
            baseURL: 'http://localhost:11434/v1',
            apiKeyEnv: 'PANEL_KEY',
            thinkingMode: 'lateral',
            thinkingStrength: 'medium',
          },
          {
            type: 'openai',
            role: 'synthesizer',
            model: 'synth',
            baseURL: 'https://api.openai.com/v1',
            apiKeyEnv: 'SYNTH_KEY',
          },
        ],
      });

      process.env.PANEL_KEY = 'pk';
      process.env.SYNTH_KEY = 'sk';
      try {
        const adapter = new JsonFileConfigAdapter(path);
        const model = adapter.getAgentModel();
        assert.ok(model, 'must resolve agent model via panel fallback');
        assert.equal(model.model, 'panel-openai');
        assert.equal(model.thinkingMode, undefined, 'thinkingMode must be stripped');
        assert.equal(model.thinkingStrength, undefined, 'thinkingStrength must be stripped');
      } finally {
        delete process.env.PANEL_KEY;
        delete process.env.SYNTH_KEY;
      }
    });
  });

  test('returns null when first panel is anthropic', () => {
    withTempDir((dir) => {
      const path = writeConfig(dir, {
        providers: [
          {
            type: 'anthropic',
            role: 'panel',
            model: 'claude-haiku',
            baseURL: 'https://api.anthropic.com/v1',
            apiKeyEnv: 'ANT_KEY',
          },
          {
            type: 'anthropic',
            role: 'synthesizer',
            model: 'claude-synth',
            baseURL: 'https://api.anthropic.com/v1',
            apiKeyEnv: 'ANT_KEY',
          },
        ],
      });

      process.env.ANT_KEY = 'ant';
      try {
        const adapter = new JsonFileConfigAdapter(path);
        assert.equal(adapter.getAgentModel(), null);
      } finally {
        delete process.env.ANT_KEY;
      }
    });
  });

  test('returns null when no panel models configured', () => {
    withTempDir((dir) => {
      const path = writeConfig(dir, {
        providers: [
          {
            type: 'openai',
            role: 'synthesizer',
            model: 'synth',
            baseURL: 'https://api.openai.com/v1',
            apiKeyEnv: 'SYNTH_KEY',
          },
        ],
      });

      process.env.SYNTH_KEY = 'sk';
      try {
        const adapter = new JsonFileConfigAdapter(path);
        assert.equal(adapter.getAgentModel(), null);
      } finally {
        delete process.env.SYNTH_KEY;
      }
    });
  });
});

// ---------------------------------------------------------------------------
// getAutocompleteModel — same resolution logic as getAgentModel
// ---------------------------------------------------------------------------

describe('getAutocompleteModel', () => {
  test('returns dedicated autocomplete provider', () => {
    withTempDir((dir) => {
      const path = writeConfig(dir, {
        providers: [
          {
            type: 'openai',
            role: 'autocomplete',
            model: 'autocomplete-model',
            baseURL: 'http://localhost:11434/v1',
            apiKeyEnv: 'AC_KEY',
          },
          {
            type: 'openai',
            role: 'synthesizer',
            model: 'synth',
            baseURL: 'https://api.openai.com/v1',
            apiKeyEnv: 'SYNTH_KEY',
          },
        ],
      });

      process.env.AC_KEY = 'ack';
      process.env.SYNTH_KEY = 'sk';
      try {
        const adapter = new JsonFileConfigAdapter(path);
        const model = adapter.getAutocompleteModel();
        assert.ok(model);
        assert.equal(model.model, 'autocomplete-model');
      } finally {
        delete process.env.AC_KEY;
        delete process.env.SYNTH_KEY;
      }
    });
  });

  test('falls back to first openai panel, strips thinkingMode and thinkingStrength', () => {
    withTempDir((dir) => {
      const path = writeConfig(dir, {
        providers: [
          {
            type: 'openai',
            role: 'panel',
            model: 'panel-model',
            baseURL: 'http://localhost:11434/v1',
            apiKeyEnv: 'PANEL_KEY',
            thinkingMode: 'divergent',
            thinkingStrength: 'xhigh',
          },
          {
            type: 'openai',
            role: 'synthesizer',
            model: 'synth',
            baseURL: 'https://api.openai.com/v1',
            apiKeyEnv: 'SYNTH_KEY',
          },
        ],
      });

      process.env.PANEL_KEY = 'pk';
      process.env.SYNTH_KEY = 'sk';
      try {
        const adapter = new JsonFileConfigAdapter(path);
        const model = adapter.getAutocompleteModel();
        assert.ok(model);
        assert.equal(model.model, 'panel-model');
        assert.equal(model.thinkingMode, undefined);
        assert.equal(model.thinkingStrength, undefined);
      } finally {
        delete process.env.PANEL_KEY;
        delete process.env.SYNTH_KEY;
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Validation — agent/autocomplete must be openai type
// ---------------------------------------------------------------------------

describe('validation — agent and autocomplete must be type openai', () => {
  test('throws when agent role has type anthropic', () => {
    withTempDir((dir) => {
      const path = writeConfig(dir, {
        providers: [
          {
            type: 'anthropic',
            role: 'agent',
            model: 'claude',
            baseURL: 'https://api.anthropic.com/v1',
            apiKeyEnv: 'ANT_KEY',
          },
          {
            type: 'openai',
            role: 'synthesizer',
            model: 'synth',
            baseURL: 'https://api.openai.com/v1',
            apiKeyEnv: 'SYNTH_KEY',
          },
        ],
      });

      process.env.ANT_KEY = 'ant';
      process.env.SYNTH_KEY = 'sk';
      try {
        assert.throws(
          () => new JsonFileConfigAdapter(path),
          (err: unknown) => {
            assert.ok(err instanceof Error);
            assert.ok(err.message.includes('agent'), `unexpected message: ${err.message}`);
            return true;
          },
        );
      } finally {
        delete process.env.ANT_KEY;
        delete process.env.SYNTH_KEY;
      }
    });
  });

  test('throws when autocomplete role has type anthropic', () => {
    withTempDir((dir) => {
      const path = writeConfig(dir, {
        providers: [
          {
            type: 'anthropic',
            role: 'autocomplete',
            model: 'claude',
            baseURL: 'https://api.anthropic.com/v1',
            apiKeyEnv: 'ANT_KEY',
          },
          {
            type: 'openai',
            role: 'synthesizer',
            model: 'synth',
            baseURL: 'https://api.openai.com/v1',
            apiKeyEnv: 'SYNTH_KEY',
          },
        ],
      });

      process.env.ANT_KEY = 'ant';
      process.env.SYNTH_KEY = 'sk';
      try {
        assert.throws(
          () => new JsonFileConfigAdapter(path),
          (err: unknown) => {
            assert.ok(err instanceof Error);
            assert.ok(err.message.includes('autocomplete'), `unexpected message: ${err.message}`);
            return true;
          },
        );
      } finally {
        delete process.env.ANT_KEY;
        delete process.env.SYNTH_KEY;
      }
    });
  });
});
