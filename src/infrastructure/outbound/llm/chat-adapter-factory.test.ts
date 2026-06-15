import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ChatAdapterFactory } from './chat-adapter-factory.js';
import { OpenAiChatAdapter } from './openai-chat-adapter.js';
import { AnthropicChatAdapter } from './anthropic-chat-adapter.js';
import { JsonFileConfigAdapter } from '../config/json-file-config-adapter.js';
import type { ModelRef } from '../../../domain/model/fusion-types.js';

// ---------------------------------------------------------------------------
// Helpers for config tests
// ---------------------------------------------------------------------------

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'fusion-factory-test-'));
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
// Factory — OpenAI
// ---------------------------------------------------------------------------

test('ChatAdapterFactory creates OpenAiChatAdapter for openai provider', () => {
  const factory = new ChatAdapterFactory();

  const modelRef: ModelRef = {
    provider: 'openai',
    model: 'gpt-4o',
    baseURL: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
  };

  const adapter = factory.create(modelRef);
  assert.ok(adapter instanceof OpenAiChatAdapter);
});

test('ChatAdapterFactory creates adapter with correct client config for openai', () => {
  const factory = new ChatAdapterFactory();

  const modelRef: ModelRef = {
    provider: 'openai',
    model: 'gpt-4o-mini',
    baseURL: 'http://localhost:11434/v1',
    apiKey: 'ollama',
  };

  const adapter = factory.create(modelRef);
  assert.ok(adapter instanceof OpenAiChatAdapter);

  const config = adapter.config;
  assert.ok(config);
  assert.equal(config.baseURL, 'http://localhost:11434/v1');
  assert.equal(config.apiKey, 'ollama');
});

// ---------------------------------------------------------------------------
// Factory — Anthropic
// ---------------------------------------------------------------------------

test('ChatAdapterFactory creates AnthropicChatAdapter for anthropic provider', () => {
  const factory = new ChatAdapterFactory();

  const modelRef: ModelRef = {
    provider: 'anthropic',
    model: 'claude-3',
    baseURL: 'https://api.anthropic.com',
    apiKey: 'sk-test',
  };

  const adapter = factory.create(modelRef);
  assert.ok(adapter instanceof AnthropicChatAdapter);
});

test('ChatAdapterFactory configures Anthropic client with baseURL and apiKey', () => {
  const factory = new ChatAdapterFactory();

  const modelRef: ModelRef = {
    provider: 'anthropic',
    model: 'claude-3',
    baseURL: 'https://custom.example.com',
    apiKey: 'my-key',
  };

  const adapter = factory.create(modelRef);
  assert.ok(adapter instanceof AnthropicChatAdapter);

  const config = adapter.config;
  assert.ok(config);
  assert.equal(config.baseURL, 'https://custom.example.com');
  assert.equal(config.apiKey, 'my-key');
});

// ---------------------------------------------------------------------------
// Factory — Unknown provider
// ---------------------------------------------------------------------------

test('ChatAdapterFactory throws for unknown provider type', () => {
  const factory = new ChatAdapterFactory();

  const modelRef = {
    provider: 'cohere',
    model: 'command-r',
    baseURL: 'https://api.cohere.com/v1',
    apiKey: 'sk-test',
  } as unknown as ModelRef;

  assert.throws(
    () => factory.create(modelRef),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok((err as Error).message.includes('Unknown provider'));
      assert.ok((err as Error).message.includes('cohere'));
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// Config schema validation tests
// ---------------------------------------------------------------------------

test('Config schema accepts anthropic provider type', () => {
  withTempDir((dir) => {
    const path = writeConfig(dir, {
      providers: [
        {
          type: 'anthropic',
          role: 'panel',
          model: 'claude-3',
          baseURL: 'https://api.anthropic.com',
          apiKeyEnv: 'ANTHROPIC_KEY',
        },
        {
          type: 'openai',
          role: 'synthesizer',
          model: 'gpt-4o',
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_KEY',
        },
      ],
      timeoutMs: 30000,
    });

    process.env.ANTHROPIC_KEY = 'sk-ant-test';
    process.env.OPENAI_KEY = 'sk-openai-test';
    try {
      const adapter = new JsonFileConfigAdapter(path);
      const panel = adapter.getPanelModels();
      assert.equal(panel.length, 1);
      assert.equal(panel[0].provider, 'anthropic');
      assert.equal(panel[0].model, 'claude-3');
      assert.equal(panel[0].baseURL, 'https://api.anthropic.com');
      assert.equal(panel[0].apiKey, 'sk-ant-test');
    } finally {
      delete process.env.ANTHROPIC_KEY;
      delete process.env.OPENAI_KEY;
    }
  });
});

test('Config schema still accepts openai provider type', () => {
  withTempDir((dir) => {
    const path = writeConfig(dir, {
      providers: [
        {
          type: 'openai',
          role: 'panel',
          model: 'gpt-4o',
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_KEY',
        },
        {
          type: 'openai',
          role: 'synthesizer',
          model: 'gpt-4o',
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_KEY',
        },
      ],
      timeoutMs: 30000,
    });

    process.env.OPENAI_KEY = 'sk-openai-test';
    try {
      const adapter = new JsonFileConfigAdapter(path);
      const panel = adapter.getPanelModels();
      assert.equal(panel.length, 1);
      assert.equal(panel[0].provider, 'openai');
    } finally {
      delete process.env.OPENAI_KEY;
    }
  });
});

test('Config schema rejects unknown provider type', () => {
  withTempDir((dir) => {
    const path = writeConfig(dir, {
      providers: [
        {
          type: 'unknown-provider',
          role: 'panel',
          model: 'some-model',
          baseURL: 'https://example.com',
          apiKeyEnv: 'SOME_KEY',
        },
        {
          type: 'openai',
          role: 'synthesizer',
          model: 'gpt-4o',
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_KEY',
        },
      ],
      timeoutMs: 30000,
    });

    assert.throws(
      () => new JsonFileConfigAdapter(path),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        const msg = (err as Error).message;
        assert.ok(
          msg.includes('type') || msg.includes('Invalid') || msg.includes('enum'),
          `expected validation error about invalid type, got: ${msg}`,
        );
        return true;
      },
    );
  });
});
