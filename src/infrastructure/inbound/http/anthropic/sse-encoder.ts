import { randomUUID } from 'node:crypto';
import type { FusionStreamEvent } from '../../../../domain/model/stream-types.js';
import { errorEventToFusionError } from '../shared.js';

export function encodeAnthropicSSE(
  events: AsyncIterable<FusionStreamEvent>,
  model: string,
): AsyncIterable<string> {
  const messageId = `msg_${randomUUID()}`;

  async function* generator(): AsyncGenerator<string> {
    let started = false;
    let contentBlockStarted = false;
    let contentBlockStopped = false;
    let outputTokens = 0;

    for await (const event of events) {
      switch (event.type) {
        case 'progress':
          yield ': heartbeat\n\n';
          break;

        case 'content_delta':
          if (!started) {
            yield* emitMessageStart(messageId, model);
            started = true;
          }
          if (!contentBlockStarted) {
            yield* emitContentBlockStart();
            contentBlockStarted = true;
          }
          yield* emitContentBlockDelta(event.delta);
          break;

        case 'content_stop':
          if (!started) {
            yield* emitMessageStart(messageId, model);
            started = true;
          }
          if (!contentBlockStarted) {
            yield* emitContentBlockStart();
            contentBlockStarted = true;
          }
          if (!contentBlockStopped) {
            yield* emitContentBlockStop();
            contentBlockStopped = true;
          }
          break;

        case 'done':
          if (!started) {
            yield* emitMessageStart(messageId, model);
          }
          if (!contentBlockStarted) {
            yield* emitContentBlockStart();
          }
          if (!contentBlockStopped) {
            yield* emitContentBlockStop();
          }
          outputTokens = event.usage?.completionTokens ?? 0;
          yield* emitMessageDelta(outputTokens);
          yield* emitMessageStop();
          return;

        case 'error':
          throw errorEventToFusionError(event);
      }
    }

    // Stream ended without done — emit terminal sequence
    if (!started) {
      yield* emitMessageStart(messageId, model);
    }
    if (!contentBlockStarted) {
      yield* emitContentBlockStart();
    }
    if (!contentBlockStopped) {
      yield* emitContentBlockStop();
    }
    yield* emitMessageDelta(outputTokens);
    yield* emitMessageStop();
  }

  return generator();
}

function* emitMessageStart(messageId: string, model: string): Generator<string> {
  const payload = JSON.stringify({
    type: 'message_start',
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      content: [],
      model,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  });
  yield `event: message_start\ndata: ${payload}\n\n`;
}

function* emitContentBlockStart(): Generator<string> {
  const payload = JSON.stringify({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  });
  yield `event: content_block_start\ndata: ${payload}\n\n`;
}

function* emitContentBlockDelta(text: string): Generator<string> {
  const payload = JSON.stringify({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text },
  });
  yield `event: content_block_delta\ndata: ${payload}\n\n`;
}

function* emitContentBlockStop(): Generator<string> {
  const payload = JSON.stringify({
    type: 'content_block_stop',
    index: 0,
  });
  yield `event: content_block_stop\ndata: ${payload}\n\n`;
}

function* emitMessageDelta(outputTokens: number): Generator<string> {
  const payload = JSON.stringify({
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: outputTokens },
  });
  yield `event: message_delta\ndata: ${payload}\n\n`;
}

function* emitMessageStop(): Generator<string> {
  const payload = JSON.stringify({ type: 'message_stop' });
  yield `event: message_stop\ndata: ${payload}\n\n`;
}
