import { randomUUID } from 'node:crypto';
import type { AgentService } from '../ports/agent-service.js';
import type { FusionService } from '../ports/fusion-service.js';
import type { FusionRequest } from '../../domain/model/fusion-types.js';
import type { FusionStreamEvent } from '../../domain/model/stream-types.js';
import type { LoggerPort } from '../../domain/ports/logger-port.js';
import {
  flattenToolMessages,
  withNoToolsDirective,
} from '../../domain/services/tool-conversation.js';

/**
 * AgentService wrapper that lets a single agent drive tool calls (each tool
 * fired exactly once per turn) but routes the agent's final natural-language
 * answer turn through the full fusion ensemble (panel → judge → synthesis).
 *
 * Detection strategy: end-of-turn branching.
 * - First tool_call_delta → tool turn: flush the buffered preamble and relay
 *   the remainder of the agent stream verbatim. A content preamble before the
 *   tool call is buffered and relayed so the client sees it too.
 * - content_stop / done / stream end with no tool_call_delta → answer turn:
 *   stop the agent and run fusionService instead, passing flattened messages
 *   with a no-tools directive so panel models do not narrate tool-call syntax.
 *
 * Known trade-off: on answer turns the proxy waits for the agent's full first
 * turn (until content_stop/done) before synthesis starts. The agent's preflight
 * tokens are not included in the reported usage (fusion reports its own).
 */
export class AgentSynthesisUseCase implements AgentService {
  constructor(
    private readonly innerAgent: AgentService,
    private readonly fusionService: FusionService,
    private readonly loggerPort: LoggerPort,
  ) {}

  async *runAgent(
    request: FusionRequest,
    requestId: string = randomUUID(),
  ): AsyncIterable<FusionStreamEvent> {
    // Honor a caller-supplied correlation id (falling back to a fresh one) so the
    // routing decision (agent_route) and the inner agent run (agent_run_start/end)
    // all log under the same requestId, correlated across wrapping layers.
    const iter = this.innerAgent.runAgent(request, requestId)[Symbol.asyncIterator]();
    const buffer: FusionStreamEvent[] = [];
    let mode: 'tool' | 'synthesis' = 'synthesis';
    let iterDone = false;

    try {
      // Phase 1: consume inner-agent stream until a decisive boundary.
      // content_delta / progress → buffer; tool_call_delta → tool turn immediately.
      // content_stop / done / stream end without a tool call → synthesis turn.
      decideLoop: for (;;) {
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
            break decideLoop;

          case 'content_stop':
          case 'done':
            mode = 'synthesis';
            break decideLoop;

          case 'error':
            // Relay the error and stop; iterator considered done.
            iterDone = true;
            yield event;
            return;

          default: // content_delta, progress → buffer, keep consuming
            buffer.push(event);
        }
      }

      this.loggerPort.log('info', 'agent_route', { requestId, mode });

      if (mode === 'tool') {
        // Flush buffer (any content preamble followed by the decisive
        // tool_call_delta) then stream the remainder of the agent verbatim.
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
        // Synthesis path: close the agent preflight stream now (rather than in
        // the finally below) so its agent_run_end marker is logged before the
        // ensemble run begins, keeping the trace ordered and self-contained.
        if (!iterDone) {
          iterDone = true;
          await iter.return?.();
        }
        // Flatten tool messages and inject a no-tools directive so panel and
        // synthesizer models do not narrate tool-call syntax.
        yield* this.fusionService.runFusion({
          ...request,
          messages: withNoToolsDirective(flattenToolMessages(request.messages)),
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
