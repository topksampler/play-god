import { DecisionSchema, type HealthResponse } from '../shared/schemas';
import type { Controller } from '../shared/types';
import { apiHeaders } from './access';

/** Real LLM controller: calls the server's /api/decide. Keys never reach the browser. */
export const llmController: Controller = {
  kind: 'llm',
  async decide({ observation, memory, tier }, signal) {
    const res = await fetch('/api/decide', {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ tier, observation, memory }),
      signal,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
    const parsed = DecisionSchema.safeParse(body);
    if (!parsed.success) throw new Error('malformed decision from server');
    return parsed.data;
  },
};

export async function fetchHealth(): Promise<HealthResponse> {
  try {
    const res = await fetch('/api/health', { headers: apiHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as HealthResponse;
  } catch (e) {
    return { llmConfigured: false, models: null, detail: `server unreachable (${(e as Error).message})` };
  }
}
