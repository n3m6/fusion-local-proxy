import type { Analysis } from '../../domain/services/analysis-schema.js';
import { analysisSchema, ANALYSIS_JSON_SCHEMA } from '../../domain/services/analysis-schema.js';
import type { PanelResult, ModelRef } from '../../domain/model/fusion-types.js';
import type { Message } from '../../domain/model/message.js';
import type { ChatModelPort } from '../../domain/ports/chat-model-port.js';
import type { LoggerPort } from '../../domain/ports/logger-port.js';
import type { ClockPort } from '../../domain/ports/clock-port.js';
import type {
  ChatRequest,
  ChatResponse,
  ResponseFormat,
  TokenUsage,
} from '../../domain/model/chat-types.js';
import { createTimeoutSignal } from '../../domain/model/chat-types.js';
import {
  buildJudgeSystemPrompt,
  buildJudgeUserPrompt,
} from '../../domain/services/judge-prompt.js';

const RAW_CONTENT_LOG_LIMIT = 1000;

export class JudgeStep {
  constructor(
    private readonly chatPort: ChatModelPort,
    private readonly judgeModel: ModelRef,
    private readonly loggerPort: LoggerPort,
    private readonly clockPort: ClockPort,
  ) {}

  async analyze(
    panelResults: PanelResult[],
    originalMessages: Message[],
    timeoutMs: number,
    requestId?: string,
  ): Promise<{ analysis: Analysis | null; usage?: TokenUsage }> {
    const judgeModel = this.judgeModel;
    this.loggerPort.logStageStart('judge');

    const startTime = this.clockPort.now();

    const systemPrompt = buildJudgeSystemPrompt();
    const userPrompt = buildJudgeUserPrompt(panelResults, originalMessages);

    const signal = createTimeoutSignal(timeoutMs);

    const responseFormat: ResponseFormat =
      judgeModel.jsonMode === 'json_object'
        ? { type: 'json_object' }
        : { type: 'json_schema', schema: ANALYSIS_JSON_SCHEMA };

    const request: ChatRequest = {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      model: judgeModel,
      options: {
        responseFormat,
        requestId,
        stage: 'judge',
        ...(signal !== undefined ? { signal } : {}),
      },
    };

    this.loggerPort.logRequest({
      requestId,
      stage: 'judge',
      provider: judgeModel.provider,
      modelId: judgeModel.model,
      panelCount: panelResults.length,
      responseFormat: responseFormat.type,
      systemPromptChars: systemPrompt.length,
      userPromptChars: userPrompt.length,
    });

    let response: ChatResponse;

    try {
      response = await this.chatPort.complete(request);
    } catch (error) {
      this.loggerPort.logError('judge', error instanceof Error ? error : new Error(String(error)), {
        requestId,
        modelId: judgeModel.model,
      });
      return { analysis: null };
    }

    // Strip markdown code fences that some models emit even when instructed not to.
    const rawContent = response.content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();

    const responseUsage = response.usage;

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawContent);
    } catch (jsonError) {
      this.loggerPort.logError('judge', jsonError as Error, {
        requestId,
        modelId: judgeModel.model,
        reason: 'invalid_json',
        contentChars: response.content.length,
        rawContent: response.content.slice(0, RAW_CONTENT_LOG_LIMIT),
      });
      return { analysis: null, usage: responseUsage };
    }

    const parsed = analysisSchema.safeParse(parsedJson);
    if (!parsed.success) {
      this.loggerPort.logError('judge', parsed.error, {
        requestId,
        modelId: judgeModel.model,
        reason: 'schema_validation_failed',
        contentChars: response.content.length,
        rawContent: response.content.slice(0, RAW_CONTENT_LOG_LIMIT),
      });
      return { analysis: null, usage: responseUsage };
    }

    const durationMs = this.clockPort.now() - startTime;
    try {
      this.loggerPort.log('debug', 'judge_analysis', {
        requestId,
        agreementsCount: parsed.data.agreements.length,
        discrepancyCount: parsed.data.discrepancies.length,
        issueCount: parsed.data.issues.length,
        gapCount: parsed.data.gaps.length,
      });
      this.loggerPort.logStageEnd('judge', durationMs, responseUsage);
    } catch {
      // logger failure must not discard the valid Analysis result
    }

    return { analysis: parsed.data, usage: responseUsage };
  }
}
