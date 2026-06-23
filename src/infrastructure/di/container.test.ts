import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Hono } from 'hono';
import { createApp } from './container.js';
import { ChatAdapterFactory } from '../outbound/llm/chat-adapter-factory.js';
import { OpenAiChatAdapter } from '../outbound/llm/openai-chat-adapter.js';
import { AnthropicChatAdapter } from '../outbound/llm/anthropic-chat-adapter.js';
import type { ModelRef } from '../../domain/model/fusion-types.js';

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

test('createApp returns a loggerPort for bootstrap logging', () => {
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
        const { loggerPort } = createApp();
        assert.ok(loggerPort, 'loggerPort must exist');
        assert.ok(typeof loggerPort.log === 'function');
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
          assert.ok(
            msg.includes('synthesizer'),
            `expected message to mention synthesizer, got: ${msg}`,
          );
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
          assert.ok(
            msg.includes('MISSING_API_KEY_VAR'),
            `expected env var name in message, got: ${msg}`,
          );
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

// ---------------------------------------------------------------------------
// Ensemble wiring helper — set env vars + FUSION_CONFIG_PATH, run, then restore.
// ---------------------------------------------------------------------------

function withConfigAndEnv(
  configContent: unknown,
  env: Record<string, string>,
  fn: () => void,
): void {
  withTempDir((dir) => {
    const configPath = writeConfig(dir, configContent);
    const saved: Record<string, string | undefined> = {};
    const oldConfigPath = process.env.FUSION_CONFIG_PATH;
    process.env.FUSION_CONFIG_PATH = configPath;
    for (const [key, value] of Object.entries(env)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
    try {
      fn();
    } finally {
      for (const [key, prev] of Object.entries(saved)) {
        if (prev !== undefined) {
          process.env[key] = prev;
        } else {
          delete process.env[key];
        }
      }
      if (oldConfigPath !== undefined) {
        process.env.FUSION_CONFIG_PATH = oldConfigPath;
      } else {
        delete process.env.FUSION_CONFIG_PATH;
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Ensemble wiring — all roles
// ---------------------------------------------------------------------------

test('createApp wires ensemble with panel, judge, and synthesizer (all roles)', () => {
  withConfigAndEnv(
    {
      providers: [
        {
          type: 'openai',
          role: 'panel',
          model: 'llama3:8b',
          baseURL: 'http://localhost:11434/v1',
          apiKeyEnv: 'OLLAMA_API_KEY',
        },
        {
          type: 'openai',
          role: 'judge',
          model: 'gpt-4o',
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
        },
        {
          type: 'anthropic',
          role: 'synthesizer',
          model: 'claude-sonnet-4-20250514',
          baseURL: 'https://api.anthropic.com/v1',
          apiKeyEnv: 'ANTHROPIC_API_KEY',
        },
      ],
      timeoutMs: 30000,
    },
    { OLLAMA_API_KEY: 'ollama', OPENAI_API_KEY: 'sk-openai', ANTHROPIC_API_KEY: 'sk-ant' },
    () => {
      const { app, configPort, fusionService } = createApp();

      assert.ok(app instanceof Hono);
      assert.ok(configPort);
      assert.ok(typeof fusionService.runFusion === 'function');

      assert.equal(configPort.getPanelModels().length, 1);
      const judge = configPort.getJudgeModel();
      assert.ok(judge);
      assert.equal(judge!.model, 'gpt-4o');
      const synth = configPort.getSynthesizerModel();
      assert.equal(synth.provider, 'anthropic');
      assert.equal(synth.model, 'claude-sonnet-4-20250514');
    },
  );
});

// ---------------------------------------------------------------------------
// Ensemble wiring — judge absent (graceful degradation / no-op stub)
// ---------------------------------------------------------------------------

test('createApp wires ensemble when judge is absent (no-op stub path)', () => {
  withConfigAndEnv(
    {
      providers: [
        {
          type: 'openai',
          role: 'panel',
          model: 'llama3:8b',
          baseURL: 'http://localhost:11434/v1',
          apiKeyEnv: 'OLLAMA_API_KEY',
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
    },
    { OLLAMA_API_KEY: 'ollama', OPENAI_API_KEY: 'sk-openai' },
    () => {
      const { fusionService, configPort } = createApp();
      assert.equal(configPort.getJudgeModel(), null);
      assert.ok(typeof fusionService.runFusion === 'function');
    },
  );
});

// ---------------------------------------------------------------------------
// Ensemble wiring — anthropic providers in every role
// ---------------------------------------------------------------------------

test('createApp resolves anthropic providers in all roles without throwing', () => {
  withConfigAndEnv(
    {
      providers: [
        {
          type: 'anthropic',
          role: 'panel',
          model: 'claude-haiku',
          baseURL: 'https://api.anthropic.com/v1',
          apiKeyEnv: 'ANTHROPIC_API_KEY',
        },
        {
          type: 'anthropic',
          role: 'judge',
          model: 'claude-opus',
          baseURL: 'https://api.anthropic.com/v1',
          apiKeyEnv: 'ANTHROPIC_API_KEY',
        },
        {
          type: 'anthropic',
          role: 'synthesizer',
          model: 'claude-sonnet',
          baseURL: 'https://api.anthropic.com/v1',
          apiKeyEnv: 'ANTHROPIC_API_KEY',
        },
      ],
      timeoutMs: 30000,
    },
    { ANTHROPIC_API_KEY: 'sk-ant' },
    () => {
      const { app, fusionService } = createApp();
      assert.ok(app instanceof Hono);
      assert.ok(typeof fusionService.runFusion === 'function');
    },
  );
});

// ---------------------------------------------------------------------------
// Panel array paths — 0, 1, and multiple panel models
// ---------------------------------------------------------------------------

test('createApp wires zero panel models without throwing', () => {
  withConfigAndEnv(
    {
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
    },
    { OPENAI_API_KEY: 'sk-openai' },
    () => {
      const { configPort, fusionService } = createApp();
      assert.equal(configPort.getPanelModels().length, 0);
      assert.ok(typeof fusionService.runFusion === 'function');
    },
  );
});

test('createApp wires a single panel model without throwing', () => {
  withConfigAndEnv(
    {
      providers: [
        {
          type: 'openai',
          role: 'panel',
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
      timeoutMs: 30000,
    },
    { OPENAI_API_KEY: 'sk-openai' },
    () => {
      const { configPort } = createApp();
      assert.equal(configPort.getPanelModels().length, 1);
    },
  );
});

test('createApp wires multiple panel models without throwing', () => {
  withConfigAndEnv(
    {
      providers: [
        {
          type: 'openai',
          role: 'panel',
          model: 'llama3:8b',
          baseURL: 'http://localhost:11434/v1',
          apiKeyEnv: 'OLLAMA_API_KEY',
        },
        {
          type: 'openai',
          role: 'panel',
          model: 'openai/gpt-4.1-mini',
          baseURL: 'https://openrouter.ai/api/v1',
          apiKeyEnv: 'OPENROUTER_API_KEY',
        },
        {
          type: 'anthropic',
          role: 'panel',
          model: 'claude-haiku',
          baseURL: 'https://api.anthropic.com/v1',
          apiKeyEnv: 'ANTHROPIC_API_KEY',
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
    },
    {
      OLLAMA_API_KEY: 'ollama',
      OPENROUTER_API_KEY: 'sk-or',
      ANTHROPIC_API_KEY: 'sk-ant',
      OPENAI_API_KEY: 'sk-openai',
    },
    () => {
      const { configPort, fusionService } = createApp();
      assert.equal(configPort.getPanelModels().length, 3);
      assert.ok(typeof fusionService.runFusion === 'function');
    },
  );
});

// ---------------------------------------------------------------------------
// Factory routing — openai vs anthropic ModelRef
// ---------------------------------------------------------------------------

test('ChatAdapterFactory routes openai and anthropic ModelRefs to correct adapters', () => {
  const factory = new ChatAdapterFactory();

  const openaiRef: ModelRef = {
    provider: 'openai',
    model: 'gpt-4o',
    baseURL: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
  };
  const anthropicRef: ModelRef = {
    provider: 'anthropic',
    model: 'claude-sonnet',
    baseURL: 'https://api.anthropic.com/v1',
    apiKey: 'sk-test',
  };

  assert.ok(factory.create(openaiRef) instanceof OpenAiChatAdapter);
  assert.ok(factory.create(anthropicRef) instanceof AnthropicChatAdapter);
});

// ---------------------------------------------------------------------------
// Agent service wiring
// ---------------------------------------------------------------------------

test('createApp returns non-null agentService when dedicated agent role is configured', () => {
  withConfigAndEnv(
    {
      providers: [
        {
          type: 'openai',
          role: 'agent',
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
    },
    { OPENAI_API_KEY: 'sk-test' },
    () => {
      const { agentService } = createApp();
      assert.ok(
        agentService !== null,
        'agentService must be non-null when agent role is configured',
      );
    },
  );
});

test('createApp returns non-null agentService when first panel is openai type', () => {
  withConfigAndEnv(
    {
      providers: [
        {
          type: 'openai',
          role: 'panel',
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
      timeoutMs: 30000,
    },
    { OPENAI_API_KEY: 'sk-test' },
    () => {
      const { agentService } = createApp();
      assert.ok(agentService !== null, 'agentService must be non-null when first panel is openai');
    },
  );
});

test('createApp returns null agentService when all panels are anthropic', () => {
  withConfigAndEnv(
    {
      providers: [
        {
          type: 'anthropic',
          role: 'panel',
          model: 'claude-haiku',
          baseURL: 'https://api.anthropic.com/v1',
          apiKeyEnv: 'ANTHROPIC_API_KEY',
        },
        {
          type: 'anthropic',
          role: 'synthesizer',
          model: 'claude-sonnet',
          baseURL: 'https://api.anthropic.com/v1',
          apiKeyEnv: 'ANTHROPIC_API_KEY',
        },
      ],
      timeoutMs: 30000,
    },
    { ANTHROPIC_API_KEY: 'sk-ant' },
    () => {
      const { agentService } = createApp();
      assert.equal(
        agentService,
        null,
        'agentService must be null when no openai provider available',
      );
    },
  );
});

// ---------------------------------------------------------------------------
// Autocomplete wiring — tested via HTTP server response to POST /v1/completions
// ---------------------------------------------------------------------------

test('createApp server responds 200 to POST /v1/completions when openai panel is configured', async () => {
  await new Promise<void>((resolve) => {
    withConfigAndEnv(
      {
        providers: [
          {
            type: 'openai',
            role: 'panel',
            model: 'deepseek-coder',
            baseURL: 'http://localhost:11434/v1',
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
      },
      { OPENAI_API_KEY: 'sk-test' },
      () => {
        const { app } = createApp();
        // Direct app.request to avoid real network
        Promise.resolve(
          app.request('/v1/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: 'hello', model: 'deepseek-coder' }),
          }),
        )
          .then((res) => {
            // The port can't call the LLM so may fail, but it should NOT return 501 (not configured)
            assert.notEqual(res.status, 501, 'status must not be 501 when autocomplete is wired');
            resolve();
          })
          .catch(resolve);
      },
    );
  });
});

test('createApp server responds 501 to POST /v1/completions when only anthropic providers are configured', async () => {
  await new Promise<void>((resolve) => {
    withConfigAndEnv(
      {
        providers: [
          {
            type: 'anthropic',
            role: 'panel',
            model: 'claude-haiku',
            baseURL: 'https://api.anthropic.com/v1',
            apiKeyEnv: 'ANTHROPIC_API_KEY',
          },
          {
            type: 'anthropic',
            role: 'synthesizer',
            model: 'claude-sonnet',
            baseURL: 'https://api.anthropic.com/v1',
            apiKeyEnv: 'ANTHROPIC_API_KEY',
          },
        ],
        timeoutMs: 30000,
      },
      { ANTHROPIC_API_KEY: 'sk-ant' },
      () => {
        const { app } = createApp();
        Promise.resolve(
          app.request('/v1/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: 'hello' }),
          }),
        )
          .then(async (res) => {
            assert.equal(res.status, 501, 'expected 501 when autocomplete not wired');
            const json = (await res.json()) as Record<string, unknown>;
            const error = json.error as Record<string, unknown>;
            assert.equal(error.code, 'autocomplete_not_configured');
            resolve();
          })
          .catch(resolve);
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Warn log emission for not-wired services
// ---------------------------------------------------------------------------

test('createApp emits agent_not_wired warn log when no openai provider available', () => {
  const warnLogs: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnLogs.push(String(args[0]));
  };

  try {
    withConfigAndEnv(
      {
        providers: [
          {
            type: 'anthropic',
            role: 'synthesizer',
            model: 'claude-sonnet',
            baseURL: 'https://api.anthropic.com/v1',
            apiKeyEnv: 'ANTHROPIC_API_KEY',
          },
        ],
        timeoutMs: 30000,
      },
      { ANTHROPIC_API_KEY: 'sk-ant' },
      () => {
        createApp();
      },
    );

    const agentWarnLogged = warnLogs.some((l) => l.includes('agent_not_wired'));
    assert.ok(agentWarnLogged, 'must emit agent_not_wired warn log');
  } finally {
    console.warn = origWarn;
  }
});

test('createApp emits autocomplete_not_wired warn log when no openai provider available', () => {
  const warnLogs: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnLogs.push(String(args[0]));
  };

  try {
    withConfigAndEnv(
      {
        providers: [
          {
            type: 'anthropic',
            role: 'synthesizer',
            model: 'claude-sonnet',
            baseURL: 'https://api.anthropic.com/v1',
            apiKeyEnv: 'ANTHROPIC_API_KEY',
          },
        ],
        timeoutMs: 30000,
      },
      { ANTHROPIC_API_KEY: 'sk-ant' },
      () => {
        createApp();
      },
    );

    const autocompleteWarnLogged = warnLogs.some((l) => l.includes('autocomplete_not_wired'));
    assert.ok(autocompleteWarnLogged, 'must emit autocomplete_not_wired warn log');
  } finally {
    console.warn = origWarn;
  }
});
