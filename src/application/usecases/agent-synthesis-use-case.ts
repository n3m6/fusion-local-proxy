import type { AgentService } from '../ports/agent-service.js';
import type { FusionService } from '../ports/fusion-service.js';
import type { FusionRequest } from '../../domain/model/fusion-types.js';
import type { FusionStreamEvent } from '../../domain/model/stream-types.js';
import type { LoggerPort } from '../../domain/ports/logger-port.js';
import { flattenToolMessages } from '../../domain/services/tool-conversation.js';

/**
 * AgentService wrapper that lets a single agent drive tool calls (each tool
 * fired exactly once per turn) but routes the agent's final natural-language
 * answer turn through the full fusion ensemble (panel → judge → synthesis).
 *
 * Detection strategy: first-event branching.
 * - First decisive event is tool_call_delta → tool turn: relay the agent stream
 *   verbatim (the client sees tool call chunks and executes the tool).
 * - First decisive event is content_delta, or the agent stream ends without any
 *   decisive event → answer turn: stop the agent and run fusionService instead,
 *   passing flattened messages so every panel model can handle them.
 *
 * Known trade-off: the discarded agent preflight on answer turns uses tokens
 * that are not included in the reported usage (fusion reports its own usage).
 */
export class AgentSynthesisUseCase implements AgentService {
  constructor(
    private readonly innerAgent: AgentService,
    private readonly fusionService: FusionService,
    private readonly loggerPort: LoggerPort,
  ) {}

  async *runAgent(request: FusionRequest): AsyncIterable<FusionStreamEvent> {
    const iter = this.innerAgent.runAgent(request)[Symbol.asyncIterator]();
    const buffer: FusionStreamEvent[] = [];
    let mode: 'tool' | 'synthesis' = 'synthesis';
    let iterDone = false;

    try {
      // Phase 1: peek at inner-agent stream until first decisive event.
      peekLoop: for (;;) {
        const step = await iter.next();
        if (step.done) {
          iterDone = true;
          break;
        }

        const event = step.value;

        switch (event.type) {
          case 'tool_call_delta':
            mode = 'tool';
            buffer.push(event);
            break peekLoop;

          case 'content_delta':
            // Answer turn: abandon the agent stream (cleaned up in finally).
            mode = 'synthesis';
            break peekLoop;

          case 'error':
            // Relay the error and stop; iterator considered done.
            iterDone = true;
            yield event;
            return;

          default:
            buffer.push(event);
        }
      }

      this.loggerPort.log('info', 'agent_route', { mode });

      if (mode === 'tool') {
        // Flush buffer (first entry is the decisive tool_call_delta) then
        // stream the remainder of the agent verbatim.
        for (const e of buffer) {
          yield e;
        }
        for (;;) {
          const step = await iter.next();
          if (step.done) {
            iterDone = true;
            break;
          }
          yield step.value;
        }
      } else {
        // Synthesis path: agent stream will be closed in the finally block.
        // Flatten tool messages so Anthropic and text-only panel models can
        // handle the conversation without needing structured tool support.
        yield* this.fusionService.runFusion({
          ...request,
          messages: flattenToolMessages(request.messages),
          tools: undefined,
          toolChoice: undefined,
        });
      }
    } finally {
      // Clean up the inner-agent iterator when we abandoned it early (synthesis
      // path) or if an unexpected error occurred during tool streaming.
      if (!iterDone) {
        await iter.return?.();
      }
    }
  }
}
