import { CONFIG } from '../shared/config';
import type { Agent, AgentTier, Controller, ControllerKind, WorldState } from '../shared/types';
import { observe } from '../sim/observe';
import type { SimStore } from '../sim/store';
import { getController } from './index';

type InFlight = { abort: AbortController; runId: string; seq: number };

/** Whether an agent should be asked for a new plan now (same rule the headless benchmark uses). */
export function decisionDue(s: WorldState, a: Agent): boolean {
  if (a.fly || a.status === 'dead' || a.controller.pending) return false;
  const since = s.time - (a.controller.lastDecisionAt ?? -Infinity);
  // Back off after failures (3s, 6s, 12s … capped) to avoid retry storms.
  const backoff = a.controller.errorStreak ? Math.min(30, 3 * 2 ** (a.controller.errorStreak - 1)) : 0;
  const idle = !a.current && a.plan.length === 0;
  // Instant (scripted) controllers may re-plan sooner when idle; slow ones keep the full gap.
  const gap = idle && a.controller.kind === 'scripted' ? 0.4 : CONFIG.minDecisionGapSec;
  if (since < Math.max(gap, backoff)) return false;
  // A running action is not re-planned just because time passed (interrupts still trigger urgent re-plans).
  return idle || a.controller.needsDecision || (since >= CONFIG.maxDecisionGapSec && !a.current);
}

/**
 * Issues decisions off the render loop: at most one outstanding per agent, a global concurrency limit,
 * a bounded timeout, and stale-response rejection (the store also checks runId/seq).
 * An agent is asked for a new plan when the simulator flags it (plan finished/failed, damage, message,
 * low vitals) or when its plan has run for maxDecisionGapSec.
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
      const a = s.agents[id];
      if (!a || a.controller.requestSeq > f.seq || a.status === 'dead') {
        f.abort.abort('superseded');
        inflight.delete(id);
      }
    }

    // Longest-waiting agents first, so a busy concurrency limit is shared fairly.
    // Flies are driven continuously by their connectome brains (controllers/fly/driver.ts), not by plan decisions.
    const due = Object.values(s.agents)
      .filter((a) => !inflight.has(a.id) && decisionDue(s, a))
      // Idle agents first, then longest-waiting, so a busy concurrency limit is shared fairly.
      .sort((x, y) => Number(Boolean(x.current || x.plan.length)) - Number(Boolean(y.current || y.plan.length)) || (x.controller.lastDecisionAt ?? -Infinity) - (y.controller.lastDecisionAt ?? -Infinity));

    for (const a of due) {
      if (inflight.size >= CONFIG.maxConcurrentDecisions) break;
      const controller = resolve(a.controller.kind);
      const seq = a.controller.requestSeq + 1;
      const runId = s.runId;
      const tier: AgentTier = a.controller.tier;
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort('timeout'), CONFIG.decisionTimeoutMs);
      inflight.set(a.id, { abort, runId, seq });
      const observation = observe(s, a.id);
      store.dispatch({ type: 'decisionStarted', agentId: a.id, runId, seq, observation });
      const t0 = performance.now();

      controller
        .decide({ observation, memory: a.memory, tier }, abort.signal)
        .then((decision) => {
          if (abort.signal.aborted) return;
          store.dispatch({ type: 'decisionResult', agentId: a.id, runId, seq, decision, latencyMs: Math.round(performance.now() - t0) });
        })
        .catch((e: unknown) => {
          const reason = abort.signal.reason;
          if (abort.signal.aborted && reason !== 'timeout') return; // paused/reset/superseded: silently drop
          const msg = reason === 'timeout' ? 'timed out' : e instanceof Error ? e.message : String(e);
          store.dispatch({ type: 'decisionError', agentId: a.id, runId, seq, error: msg.slice(0, 300) });
        })
        .finally(() => {
          clearTimeout(timer);
          if (inflight.get(a.id)?.seq === seq) inflight.delete(a.id);
        });
    }
  };

  const id = setInterval(poll, opts.pollMs ?? 150);
  return () => {
    clearInterval(id);
    abortAll('stopped');
  };
}
