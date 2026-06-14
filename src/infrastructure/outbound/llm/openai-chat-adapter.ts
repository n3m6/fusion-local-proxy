import type OpenAI from 'openai';
import type { ChatModelPort } from '../../../domain/ports/chat-model-port.js';
import type { ChatRequest, ChatResponse, TokenUsage } from '../../../domain/model/chat-types.js';

export class OpenAiChatAdapter implements ChatModelPort {
  constructor(private readonly client: OpenAI) {}

  async complete(request: ChatRequest): Promise<ChatResponse> {
    const params: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
      model: request.model.model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      temperature: request.options?.temperature,
      max_tokens: request.options?.maxTokens,
    };

    if (request.options?.responseFormat) {
      const rf = request.options.responseFormat;
      const format: Record<string, unknown> = { type: rf.type };
      if (rf.jsonSchema) {
        format.json_schema = rf.jsonSchema;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      params.response_format = format as any;
    }

    const response = await this.client.chat.completions.create(params);

    const choice = response.choices[0];
    const content = choice?.message?.content ?? '';

    const usage: TokenUsage = {
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
    };

    return {
      content,
      usage,
      model: response.model,
    };
  }
}
