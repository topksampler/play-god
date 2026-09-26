import { CONFIG } from '../shared/config';
import type { Controller, ControllerKind } from '../shared/types';
import { observe } from '../sim/observe';
import type { SimStore } from '../sim/store';
import { getController } from './index';

type InFlight = { abort: AbortController; runId: string; seq: number };

/**
 * Issues decisions off the render loop: at most one outstanding per agent, a global concurrency limit,
 * a bounded timeout, and stale-response rejection (the store also checks runId/seq).
 */
export function startScheduler(
  store: SimStore,
  opts: { resolve?: (kind: ControllerKind) => Controller; pollMs?: number } = {},
) {
  const resolve = opts.resolve ?? getController;
  const inflight = new Map<string, InFlight>();
  let lastRunId = store.getState().runId;
  let lastPaused = store.getState().paused;

  const abortAll = (reason: string) => {
    for (const f of inflight.values()) f.abort.abort(reason);
    inflight.clear();
  };

  const poll = () => {
    const s = store.getState();
    if (s.runId !== lastRunId) {
      abortAll('reset');
      lastRunId = s.runId;
    }
    if (s.paused && !lastPaused) abortAll('paused');
    lastPaused = s.paused;
    if (s.paused) return;

    for (const [id, f] of inflight) {
      // Drop agents that were removed or had their request superseded (e.g. controller switch).
      const a = s.agents[id];
      if (!a || a.controller.requestSeq > f.seq) {
        f.abort.abort('superseded');
        inflight.delete(id);
      }
    }

    for (const a of Object.values(s.agents)) {
      if (inflight.size >= CONFIG.maxConcurrentDecisions) break;
      if (inflight.has(a.id)) continue;
      if (a.controller.pending) continue;
      const last = a.controller.lastDecisionAt ?? -Infinity;
      if (s.time - last < CONFIG.decisionIntervalSec) continue;

      const controller = resolve(a.controller.kind);
      const seq = a.controller.requestSeq + 1;
      const runId = s.runId;
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort('timeout'), CONFIG.decisionTimeoutMs);
      inflight.set(a.id, { abort, runId, seq });
      const observation = observe(s, a.id);
      store.dispatch({ type: 'decisionStarted', agentId: a.id, runId, seq, observation });

      controller
        .decide({ observation, memory: a.memory }, abort.signal)
        .then((decision) => {
          if (abort.signal.aborted) return;
          store.dispatch({ type: 'decisionResult', agentId: a.id, runId, seq, decision });
        })
        .catch((e: unknown) => {
          const reason = abort.signal.reason;
          if (abort.signal.aborted && reason !== 'timeout') return; // paused/reset/superseded: silently drop
          const msg = reason === 'timeout' ? 'timed out' : e instanceof Error ? e.message : String(e);
          store.dispatch({ type: 'decisionError', agentId: a.id, runId, seq, error: msg.slice(0, 200) });
        })
        .finally(() => {
          clearTimeout(timer);
          if (inflight.get(a.id)?.seq === seq) inflight.delete(a.id);
        });
    }
  };

  const id = setInterval(poll, opts.pollMs ?? 200);
  return () => {
    clearInterval(id);
    abortAll('stopped');
  };
}
