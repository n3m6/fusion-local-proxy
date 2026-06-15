import type { Analysis } from '../../domain/services/analysis-schema.js';
import { analysisSchema } from '../../domain/services/analysis-schema.js';
import type { PanelResult, ModelRef } from '../../domain/model/fusion-types.js';
import type { Message } from '../../domain/model/message.js';
import type { ChatModelPort } from '../../domain/ports/chat-model-port.js';
import type { LoggerPort } from '../../domain/ports/logger-port.js';
import type { ClockPort } from '../../domain/ports/clock-port.js';
import type { ChatRequest, ChatResponse, ResponseFormat } from '../../domain/model/chat-types.js';
import {
  buildJudgeSystemPrompt,
  buildJudgeUserPrompt,
} from '../../domain/services/judge-prompt.js';

const ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    consensus: {
      type: 'array',
      items: { type: 'string' },
    },
    contradictions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          topic: { type: 'string' },
          perspectives: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['topic', 'perspectives'],
        additionalProperties: false,
      },
    },
    unique_insights: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          insight: { type: 'string' },
        },
        required: ['model', 'insight'],
        additionalProperties: false,
      },
    },
    blind_spots: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['consensus', 'contradictions', 'unique_insights', 'blind_spots'],
  additionalProperties: false,
};

export class JudgeStep {
  constructor(
    private readonly chatPort: ChatModelPort,
    private readonly loggerPort: LoggerPort,
    private readonly clockPort: ClockPort,
  ) {}

  async analyze(
    panelResults: PanelResult[],
    originalMessages: Message[],
    judgeModel: ModelRef,
    timeoutMs: number,
  ): Promise<Analysis | null> {
    this.loggerPort.logStageStart('judge');

    const startTime = this.clockPort.now();

    const systemPrompt = buildJudgeSystemPrompt();
    const userPrompt = buildJudgeUserPrompt(panelResults, originalMessages);

    let controller: AbortController | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (timeoutMs > 0) {
      controller = new AbortController();
      timeoutId = setTimeout(() => controller!.abort(), timeoutMs);
    }

    const responseFormat: ResponseFormat =
      judgeModel.jsonMode === 'json_object'
        ? { type: 'json_object' }
        : { type: 'json_schema', schema: ANALYSIS_JSON_SCHEMA as Record<string, unknown> };

    const request: ChatRequest = {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      model: judgeModel,
      options: {
        responseFormat,
        ...(controller ? { signal: controller.signal } : {}),
      },
    };

    let response: ChatResponse;

    try {
      response = await this.chatPort.complete(request);
    } catch (error) {
      this.loggerPort.logError('judge', error instanceof Error ? error : new Error(String(error)));
      return null;
    } finally {
      clearTimeout(timeoutId);
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(response.content);
    } catch (jsonError) {
      this.loggerPort.logError('judge', jsonError as Error);
      return null;
    }

    const parsed = analysisSchema.safeParse(parsedJson);
    if (!parsed.success) {
      this.loggerPort.logError('judge', parsed.error);
      return null;
    }

    const durationMs = this.clockPort.now() - startTime;
    try {
      this.loggerPort.logStageEnd('judge', durationMs, response.usage);
    } catch {
      // logger failure must not discard the valid Analysis result
    }

    return parsed.data;
  }
}
