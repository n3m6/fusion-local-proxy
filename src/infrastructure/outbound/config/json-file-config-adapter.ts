import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { ConfigPort } from '../../../domain/ports/config-port.js';
import type { ModelRef } from '../../../domain/model/fusion-types.js';

const providerSchema = z.object({
  type: z.enum(['openai', 'anthropic']),
  role: z.enum(['panel', 'judge', 'synthesizer']),
  model: z.string().min(1),
  baseURL: z.string().min(1),
  apiKeyEnv: z.string().min(1),
  jsonMode: z.enum(['json_object', 'json_schema']).optional(),
  thinkingStrength: z.enum(['off', 'low', 'medium', 'high']).optional(),
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
    };
  }
}
