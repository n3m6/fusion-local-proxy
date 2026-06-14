import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatAdapterFactory } from './chat-adapter-factory.js';
import { OpenAiChatAdapter } from './openai-chat-adapter.js';
import type { ModelRef } from '../../../domain/model/fusion-types.js';

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

test('ChatAdapterFactory throws for unknown provider type', () => {
  const factory = new ChatAdapterFactory();

  const modelRef = {
    provider: 'anthropic',
    model: 'claude-3',
    baseURL: 'https://api.anthropic.com/v1',
    apiKey: 'sk-test',
  } as unknown as ModelRef;

  assert.throws(
    () => factory.create(modelRef),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok((err as Error).message.includes('Unknown provider'));
      assert.ok((err as Error).message.includes('anthropic'));
      return true;
    },
  );
});

test('ChatAdapterFactory creates adapter with correct client config', () => {
  const factory = new ChatAdapterFactory();

  const modelRef: ModelRef = {
    provider: 'openai',
    model: 'gpt-4o-mini',
    baseURL: 'http://localhost:11434/v1',
    apiKey: 'ollama',
  };

  const adapter = factory.create(modelRef);
  assert.ok(adapter instanceof OpenAiChatAdapter);

  const client = (adapter as unknown as { client: { baseURL: string; apiKey: string | null } }).client;
  assert.ok(client);
  assert.equal(client.baseURL, 'http://localhost:11434/v1');
  assert.equal(client.apiKey, 'ollama');
});
