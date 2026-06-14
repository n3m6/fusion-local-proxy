import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { ConfigPort } from '../../../domain/ports/config-port.js';
import type { ModelRef } from '../../../domain/model/fusion-types.js';

const providerSchema = z.object({
  type: z.enum(['openai']),
  role: z.enum(['panel', 'judge', 'synthesizer']),
  model: z.string(),
  baseURL: z.string(),
  apiKeyEnv: z.string(),
});

const configSchema = z.object({
  providers: z.array(providerSchema),
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
        throw new Error(`Configuration file not found: ${configPath}`);
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `Failed to parse configuration file: ${err instanceof Error ? err.message : String(err)}`,
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
  }

  getPanelModels(): ModelRef[] {
    return this.config.providers
      .filter((p) => p.role === 'panel')
      .map((p) => this.toModelRef(p));
  }

  getJudgeModel(): ModelRef | null {
    const entry = this.config.providers.find((p) => p.role === 'judge');
    return entry ? this.toModelRef(entry) : null;
  }

  getSynthesizerModel(): ModelRef | null {
    const entry = this.config.providers.find((p) => p.role === 'synthesizer');
    return entry ? this.toModelRef(entry) : null;
  }

  getTimeoutMs(): number {
    return this.config.timeoutMs;
  }

  private toModelRef(entry: ProviderEntry): ModelRef {
    const apiKey = process.env[entry.apiKeyEnv];
    if (apiKey === undefined) {
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
