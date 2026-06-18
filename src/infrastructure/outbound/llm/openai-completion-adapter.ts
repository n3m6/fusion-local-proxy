import OpenAI from 'openai';
import type { TextCompletionPort } from '../../../domain/ports/text-completion-port.js';
import type {
  TextCompletionRequest,
  TextCompletionResponse,
  TextCompletionChunk,
} from '../../../domain/model/text-completion-types.js';
import type { LoggerPort } from '../../../domain/ports/logger-port.js';
import type { AdapterConfig } from './adapter-support.js';
import type { TokenUsage } from '../../../domain/model/chat-types.js';

export { AdapterConfig };

export function createOpenAiCompletionClient(config: AdapterConfig): OpenAI {
  return new OpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  });
}

export class OpenAiCompletionAdapter implements TextCompletionPort {
  constructor(
    private readonly client: OpenAI,
    private readonly adapterConfig: AdapterConfig,
    private readonly logger?: LoggerPort,
  ) {}

  async complete(request: TextCompletionRequest): Promise<TextCompletionResponse> {
    this.logger?.log('info', 'openai_completion_request', {
      modelId: request.model.model,
      baseURL: request.model.baseURL,
      promptChars: request.prompt.length,
      hasSuffix: request.suffix !== undefined,
    });

    const response = await this.client.completions.create({
      model: request.model.model,
      prompt: request.prompt,
      ...(request.suffix !== undefined ? { suffix: request.suffix } : {}),
      ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.stop !== undefined ? { stop: request.stop } : {}),
      stream: false,
    });

    const text = response.choices[0]?.text ?? '';
    const usage: TokenUsage = {
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
    };

    this.logger?.log('info', 'openai_completion_response', {
      modelId: response.model,
      textChars: text.length,
      tokens: { prompt: usage.promptTokens, completion: usage.completionTokens },
    });

    return { text, model: response.model, usage };
  }

  async *stream(request: TextCompletionRequest): AsyncIterable<TextCompletionChunk> {
    this.logger?.log('info', 'openai_completion_stream_request', {
      modelId: request.model.model,
      promptChars: request.prompt.length,
      hasSuffix: request.suffix !== undefined,
    });

    const stream = await this.client.completions.create({
      model: request.model.model,
      prompt: request.prompt,
      ...(request.suffix !== undefined ? { suffix: request.suffix } : {}),
      ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.stop !== undefined ? { stop: request.stop } : {}),
      stream: true,
    });

    let stopYielded = false;

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (choice?.text) {
        yield { type: 'text_delta', delta: choice.text };
      }
      if (choice?.finish_reason) {
        yield { type: 'text_stop' };
        stopYielded = true;
      }
    }

    if (!stopYielded) {
      yield { type: 'text_stop' };
    }
  }
}
