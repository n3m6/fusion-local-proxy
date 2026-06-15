import type { Context } from 'hono';
import type { ConfigPort } from '../../../domain/ports/config-port.js';

export function createModelsRoute(configPort: ConfigPort) {
  return (c: Context) => {
    const entries: Array<{ id: string; object: string }> = [];

    for (const panel of configPort.getPanelModels()) {
      entries.push({ id: panel.model, object: 'model' });
    }

    const judge = configPort.getJudgeModel();
    if (judge !== null) {
      entries.push({ id: judge.model, object: 'model' });
    }

    const synthesizer = configPort.getSynthesizerModel();
    if (synthesizer !== null) {
      entries.push({ id: synthesizer.model, object: 'model' });
    }

    return c.json({
      object: 'list',
      data: entries,
    });
  };
}
