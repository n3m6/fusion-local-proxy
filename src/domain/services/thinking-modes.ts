import type { ThinkingMode } from '../model/fusion-types.js';
import type { Message } from '../model/message.js';

const THINKING_MODE_PROMPTS: Readonly<Record<ThinkingMode, string>> = {
  lateral:
    'Approach this problem using lateral thinking: challenge assumptions, seek unexpected angles, make distant associations, and generate novel solutions that conventional reasoning might miss. Avoid the obvious path.',
  vertical:
    'Approach this problem using vertical thinking: follow logic step by step, build on established facts, eliminate incorrect options systematically, and converge on the most rigorously defensible answer.',
  systems:
    'Approach this problem using systems thinking: identify the components and their interdependencies, trace feedback loops and emergent effects, consider second- and third-order consequences, and reason about the whole rather than isolated parts.',
  divergent:
    'Approach this problem using divergent thinking: generate a wide range of ideas without premature judgement, explore multiple framings simultaneously, and surface trade-offs and alternatives before settling on any single direction.',
};

export function buildThinkingModePrompt(mode: ThinkingMode): string {
  return THINKING_MODE_PROMPTS[mode];
}

export function applyThinkingMode(messages: Message[], mode: ThinkingMode | undefined): Message[] {
  if (mode === undefined) {
    return messages;
  }
  return [{ role: 'system', content: buildThinkingModePrompt(mode) }, ...messages];
}
