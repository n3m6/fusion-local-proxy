import type { FusionStreamEvent } from '../../../../domain/model/stream-types.js';

export function encodeOpenAiSSE(
  events: AsyncIterable<FusionStreamEvent>,
  model: string,
): AsyncIterable<string> {
  const id = `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  async function* generator(): AsyncGenerator<string> {
    for await (const event of events) {
      switch (event.type) {
        case 'progress':
          if (event.stage === 'panel') {
            yield ': panel running\n\n';
          } else if (event.stage === 'judge') {
            yield ': judging\n\n';
          } else {
            yield `: ${event.stage} ${event.message}\n\n`;
          }
          break;
        case 'content_delta':
          yield `data: ${JSON.stringify({
            id,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{ index: 0, delta: { content: event.delta } }],
          })}\n\n`;
          break;
        case 'content_stop':
          yield `data: ${JSON.stringify({
            id,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          })}\n\n`;
          break;
        case 'done':
          yield 'data: [DONE]\n\n';
          return;
        case 'error':
          yield `data: ${JSON.stringify({
            error: { code: event.code, message: event.message },
          })}\n\n`;
          return;
      }
    }
    yield 'data: [DONE]\n\n';
  }

  return generator();
}
