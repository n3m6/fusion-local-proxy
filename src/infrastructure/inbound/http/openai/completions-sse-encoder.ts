import { randomUUID } from 'node:crypto';
import type { TextCompletionChunk } from '../../../../domain/model/text-completion-types.js';

export function encodeTextCompletionSSE(
  chunks: AsyncIterable<TextCompletionChunk>,
  model: string,
): AsyncIterable<string> {
  const id = `cmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  async function* generator(): AsyncGenerator<string> {
    for await (const chunk of chunks) {
      switch (chunk.type) {
        case 'text_delta':
          yield `data: ${JSON.stringify({
            id,
            object: 'text_completion',
            created,
            model,
            choices: [{ text: chunk.delta, index: 0, logprobs: null, finish_reason: null }],
          })}\n\n`;
          break;
        case 'text_stop':
          yield `data: ${JSON.stringify({
            id,
            object: 'text_completion',
            created,
            model,
            choices: [{ text: '', index: 0, logprobs: null, finish_reason: 'stop' }],
          })}\n\n`;
          break;
        case 'usage':
          break;
      }
    }
    yield 'data: [DONE]\n\n';
  }

  return generator();
}
