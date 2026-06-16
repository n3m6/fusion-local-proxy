import type { Context } from 'hono';
import type { ConfigPort } from '../../../domain/ports/config-port.js';

export function createModelsRoute(configPort: ConfigPort) {
  return (c: Context) => {
    const ids = new Set<string>();

    for (const panel of configPort.getPanelModels()) {
      ids.add(panel.model);
    }

    const judge = configPort.getJudgeModel();
    if (judge !== null) {
      ids.add(judge.model);
    }

    ids.add(configPort.getSynthesizerModel().model);

    const data = Array.from(ids).map((id) => ({ id, object: 'model' }));

    return c.json({ object: 'list', data });
  };
}
