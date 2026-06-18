import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { ConfigPort } from '../../../domain/ports/config-port.js';
import type { ModelRef } from '../../../domain/model/fusion-types.js';

const providerSchema = z.object({
  type: z.enum(['openai', 'anthropic']),
  role: z.enum(['panel', 'judge', 'synthesizer', 'autocomplete', 'agent']),
  model: z.string().min(1),
  baseURL: z.string().min(1),
  apiKeyEnv: z.string().min(1),
  jsonMode: z.enum(['json_object', 'json_schema']).optional(),
  thinkingStrength: z.enum(['off', 'low', 'medium', 'high', 'xhigh']).optional(),
  thinkingMode: z.enum(['lateral', 'vertical', 'systems', 'divergent']).optional(),
});

const configSchema = z.object({
  providers: z.array(providerSchema).nonempty(),
  timeoutMs: z.number().int().positive().optional().default(30000),
});

type ProviderEntry = z.infer<typeof providerSchema>;
type FusionConfig = z.infer<typeof configSchema>;

export class JsonFileConfigAdapter implements ConfigPort {
  private readonly config: FusionConfig;

  constructor(configPath: string) {
    let raw: string;
    try {
      raw = readFileSync(configPath, 'utf-8');
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        throw new Error(`Configuration file not found: ${configPath}`, { cause: err });
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `Failed to parse configuration file: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }

    const result = configSchema.safeParse(parsed);
    if (!result.success) {
      const messages = result.error.issues
        .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
        .join('\n');
      throw new Error(`Invalid configuration:\n${messages}`);
    }

    this.config = result.data;

    const hasSynthesizer = this.config.providers.some((p) => p.role === 'synthesizer');
    if (!hasSynthesizer) {
      throw new Error('Invalid configuration: at least one provider must have role "synthesizer"');
    }

    const nonPanelWithThinkingMode = this.config.providers.find(
      (p) => p.role !== 'panel' && p.thinkingMode !== undefined,
    );
    if (nonPanelWithThinkingMode !== undefined) {
      throw new Error(
        'Invalid configuration: thinkingMode is only valid on providers with role "panel"',
      );
    }

    const nonOpenAiAgentOrAutocomplete = this.config.providers.find(
      (p) => (p.role === 'agent' || p.role === 'autocomplete') && p.type !== 'openai',
    );
    if (nonOpenAiAgentOrAutocomplete !== undefined) {
      throw new Error(
        'Invalid configuration: providers with role "agent" or "autocomplete" must have type "openai"',
      );
    }
  }

  getPanelModels(): ModelRef[] {
    return this.config.providers.filter((p) => p.role === 'panel').map((p) => this.toModelRef(p));
  }

  getJudgeModel(): ModelRef | null {
    const entry = this.config.providers.find((p) => p.role === 'judge');
    return entry ? this.toModelRef(entry) : null;
  }

  getSynthesizerModel(): ModelRef {
    const entry = this.config.providers.find((p) => p.role === 'synthesizer')!;
    return this.toModelRef(entry);
  }

  getTimeoutMs(): number {
    return this.config.timeoutMs;
  }

  getAgentModel(): ModelRef | null {
    const dedicated = this.config.providers.find((p) => p.role === 'agent');
    if (dedicated) return this.toModelRef(dedicated);
    const firstPanel = this.config.providers.find((p) => p.role === 'panel');
    if (!firstPanel || firstPanel.type !== 'openai') return null;
    return this.toRawModelRef(firstPanel);
  }

  getAutocompleteModel(): ModelRef | null {
    const dedicated = this.config.providers.find((p) => p.role === 'autocomplete');
    if (dedicated) return this.toModelRef(dedicated);
    const firstPanel = this.config.providers.find((p) => p.role === 'panel');
    if (!firstPanel || firstPanel.type !== 'openai') return null;
    return this.toRawModelRef(firstPanel);
  }

  private toModelRef(entry: ProviderEntry): ModelRef {
    const apiKey = process.env[entry.apiKeyEnv];
    if (apiKey === undefined || apiKey === '') {
      throw new Error(
        `Environment variable ${entry.apiKeyEnv} is not set (required for provider model "${entry.model}")`,
      );
    }
    return {
      provider: entry.type,
      model: entry.model,
      baseURL: entry.baseURL,
      apiKey,
      ...(entry.jsonMode !== undefined ? { jsonMode: entry.jsonMode } : {}),
      ...(entry.thinkingStrength !== undefined ? { thinkingStrength: entry.thinkingStrength } : {}),
      ...(entry.thinkingMode !== undefined ? { thinkingMode: entry.thinkingMode } : {}),
    };
  }

  /** Like toModelRef but strips thinkingMode and thinkingStrength for raw pass-through routing. */
  private toRawModelRef(entry: ProviderEntry): ModelRef {
    const apiKey = process.env[entry.apiKeyEnv];
    if (apiKey === undefined || apiKey === '') {
      throw new Error(
        `Environment variable ${entry.apiKeyEnv} is not set (required for provider model "${entry.model}")`,
      );
    }
    return {
      provider: entry.type,
      model: entry.model,
      baseURL: entry.baseURL,
      apiKey,
    };
  }
}
