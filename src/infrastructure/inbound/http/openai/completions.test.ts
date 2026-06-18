import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import type { ModelRef } from '../../../../domain/model/fusion-types.js';
import type {
  TextCompletionChunk,
  TextCompletionRequest,
  TextCompletionResponse,
} from '../../../../domain/model/text-completion-types.js';
import type { TextCompletionPort } from '../../../../domain/ports/text-completion-port.js';
import { parseTextCompletionRequest, textCompletionToResponse } from './completions-translator.js';
import { encodeTextCompletionSSE } from './completions-sse-encoder.js';
import { createCompletionsRoute } from './completions-route.js';

const MODEL_REF: ModelRef = {
  provider: 'openai',
  model: 'deepseek-coder',
  baseURL: 'http://localhost:11434/v1',
  apiKey: 'ollama',
};

function asyncIterableOf(chunks: TextCompletionChunk[]): AsyncIterable<TextCompletionChunk> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i < chunks.length) return { value: chunks[i++]!, done: false };
          return { value: undefined as never, done: true };
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// parseTextCompletionRequest
// ---------------------------------------------------------------------------

describe('parseTextCompletionRequest', () => {
  test('parses prompt and suffix', () => {
    const body = { prompt: 'def hello', suffix: '\n  pass', max_tokens: 64 };
    const req = parseTextCompletionRequest(body, MODEL_REF);
    assert.equal(req.prompt, 'def hello');
    assert.equal(req.suffix, '\n  pass');
    assert.equal(req.maxTokens, 64);
    assert.equal(req.model, MODEL_REF);
  });

  test('omits suffix when absent', () => {
    const body = { prompt: 'hello' };
    const req = parseTextCompletionRequest(body, MODEL_REF);
    assert.equal(req.suffix, undefined);
  });

  test('parses stop as array', () => {
    const body = { prompt: 'x', stop: ['\\n', '###'] };
    const req = parseTextCompletionRequest(body, MODEL_REF);
    assert.deepStrictEqual(req.stop, ['\\n', '###']);
  });

  test('parses stop as string', () => {
    const body = { prompt: 'x', stop: '\\n' };
    const req = parseTextCompletionRequest(body, MODEL_REF);
    assert.equal(req.stop, '\\n');
  });

  test('defaults prompt to empty string when missing', () => {
    const body = {};
    const req = parseTextCompletionRequest(body, MODEL_REF);
    assert.equal(req.prompt, '');
  });
});

// ---------------------------------------------------------------------------
// textCompletionToResponse
// ---------------------------------------------------------------------------

describe('textCompletionToResponse', () => {
  test('returns text_completion shaped object', () => {
    const resp = textCompletionToResponse(
      {
        text: ' world',
        model: 'deepseek-coder',
        usage: { promptTokens: 3, completionTokens: 5, totalTokens: 8 },
      },
      'deepseek-coder',
    );
    assert.equal(resp.object, 'text_completion');
    assert.ok((resp.id as string).startsWith('cmpl-'));
    const choices = resp.choices as Array<Record<string, unknown>>;
    assert.equal(choices[0].text, ' world');
    assert.equal(choices[0].finish_reason, 'stop');
    const usage = resp.usage as Record<string, unknown>;
    assert.equal(usage.prompt_tokens, 3);
    assert.equal(usage.completion_tokens, 5);
    assert.equal(usage.total_tokens, 8);
  });
});

// ---------------------------------------------------------------------------
// encodeTextCompletionSSE
// ---------------------------------------------------------------------------

describe('encodeTextCompletionSSE', () => {
  async function collect(chunks: TextCompletionChunk[]): Promise<string> {
    let out = '';
    for await (const s of encodeTextCompletionSSE(asyncIterableOf(chunks), 'my-model')) {
      out += s;
    }
    return out;
  }

  test('emits text_delta chunks as data: lines', async () => {
    const body = await collect([{ type: 'text_delta', delta: 'Hello' }, { type: 'text_stop' }]);
    assert.ok(body.includes('text_completion'), 'must contain text_completion object');
    assert.ok(body.includes('"Hello"'), 'must contain the delta text');
    assert.ok(body.includes('[DONE]'), 'must end with [DONE]');
  });

  test('text_stop chunk emits finish_reason stop', async () => {
    const body = await collect([{ type: 'text_stop' }]);
    assert.ok(body.includes('"finish_reason":"stop"'), 'must have finish_reason stop');
  });

  test('usage chunk is silently dropped', async () => {
    const body = await collect([
      { type: 'text_delta', delta: 'x' },
      { type: 'usage', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } },
      { type: 'text_stop' },
    ]);
    const lines = body.split('\n\n').filter((l) => l.startsWith('data: ') && !l.includes('[DONE]'));
    // Only text_delta + text_stop — usage not emitted
    assert.equal(lines.length, 2);
  });
});

// ---------------------------------------------------------------------------
// createCompletionsRoute — 501 when autocomplete model is not configured
// ---------------------------------------------------------------------------

describe('createCompletionsRoute — not configured', () => {
  function stubTextCompletionPort(): TextCompletionPort {
    return {
      async complete(_request: TextCompletionRequest): Promise<TextCompletionResponse> {
        return {
          text: 'ok',
          model: 'm',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      },
      async *stream(_request: TextCompletionRequest): AsyncIterable<TextCompletionChunk> {
        yield { type: 'text_delta', delta: 'ok' };
        yield { type: 'text_stop' };
      },
    };
  }

  async function postJson(app: Hono, body: unknown): Promise<Response> {
    return app.request('/v1/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  test('returns 501 when textCompletionPort is null', async () => {
    const app = new Hono();
    app.post('/v1/completions', createCompletionsRoute(null, MODEL_REF));

    const res = await postJson(app, { model: 'fusion', prompt: 'x' });
    assert.equal(res.status, 501);
    const json = (await res.json()) as Record<string, unknown>;
    const error = json.error as Record<string, unknown>;
    assert.equal(error.code, 'autocomplete_not_configured');
  });

  test('returns 501 when autocompleteModel is null', async () => {
    const app = new Hono();
    app.post('/v1/completions', createCompletionsRoute(stubTextCompletionPort(), null));

    const res = await postJson(app, { model: 'fusion', prompt: 'x' });
    assert.equal(res.status, 501);
    const json = (await res.json()) as Record<string, unknown>;
    const error = json.error as Record<string, unknown>;
    assert.equal(error.code, 'autocomplete_not_configured');
  });

  test('returns 200 when both port and model are configured', async () => {
    const app = new Hono();
    app.post('/v1/completions', createCompletionsRoute(stubTextCompletionPort(), MODEL_REF));

    const res = await postJson(app, { model: 'fusion', prompt: 'x' });
    assert.equal(res.status, 200);
    const json = (await res.json()) as Record<string, unknown>;
    assert.equal(json.object, 'text_completion');
  });
});
