import type { ObserveResponse } from '../shared/schemas';
import { apiHeaders } from './access';
import type { Chronicle } from '../sim/chronicle';
import { topMomentsAsMoments } from '../sim/moments';
import type { SimStore } from '../sim/store';

const EVERY_SIM_SEC = 40;
const MIN_NEW_MOMENTS = 3;
const MOMENTS_SENT = 60;

export type ObserverStatus = { pending: boolean; error: string | null; enabled: boolean };
let status: ObserverStatus = { pending: false, error: null, enabled: false };
const subs = new Set<() => void>();
const set = (patch: Partial<ObserverStatus>) => {
  status = { ...status, ...patch };
  subs.forEach((f) => f());
};
export const observerStatus = () => status;
export const subscribeObserver = (fn: () => void) => {
  subs.add(fn);
  return () => subs.delete(fn);
};

let runNow: (() => void) | null = null;
/** Ask the observer immediately (manual "What's interesting?"). */
export const requestObservation = () => runNow?.();

/**
 * Periodically sends recorded moments and run summaries to /api/observe and stores grounded insights in the
 * chronicle. Reads live state only; never changes the world.
 */
export function startObserver(store: SimStore, chronicle: Chronicle, llmReady: () => boolean): () => void {
  let lastAt = -Infinity;
  let lastCount = 0;
  let lastRun = '';

  const run = async () => {
    const s = store.getLiveState();
    if (status.pending || !llmReady()) return;
    const moments = chronicle.moments();
    set({ pending: true, error: null });
    lastAt = s.time;
    lastCount = moments.length;
    try {
      const { key: _k, savedAt: _s, ...current } = chronicle.current();
      const res = await fetch('/api/observe', {
        method: 'POST',
        headers: apiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          current,
          // This run's moments plus earlier runs' (ids tagged "<runKey>|<id>"), so patterns can be found across runs.
          moments: [
            ...chronicle.previousRuns().slice(0, 5).flatMap((r, k) =>
              (r.moments?.length ? r.moments.slice(-25) : topMomentsAsMoments(r.topMoments)).map((m) => ({ id: `${r.key}|${m.id}`, at: Math.round(m.at), kind: m.kind, agents: m.agents.slice(0, 16), title: `${k === 0 ? '[previous run]' : `[${k + 1} runs ago]`} ${m.title}` })),
            ),
            ...moments.slice(-MOMENTS_SENT).map((m) => ({ id: m.id, at: Math.round(m.at), kind: m.kind, agents: m.agents.slice(0, 16), title: m.title })),
          ],
          previous: chronicle.previousRuns().slice(0, 5).map(({ key, savedAt: _b, moments: _m, ...r }) => ({ runKey: key, ...r })),
        }),
        signal: AbortSignal.timeout(50000),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const out = body as ObserveResponse;
      chronicle.addNote({
        at: s.time,
        model: out.model,
        suggestion: out.suggestion,
        insights: out.insights.map((i, k) => ({ ...i, id: `${Math.round(s.time)}-${k}`, at: s.time })),
      });
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ pending: false });
    }
  };
  runNow = () => void run();

  const id = setInterval(() => {
    const s = store.getLiveState();
    const enabled = llmReady() && s.mode !== 'flies'; // agents or mixed (agents + flies)
    if (enabled !== status.enabled) set({ enabled });
    if (s.runId !== lastRun) {
      lastRun = s.runId;
      lastAt = s.time;
      lastCount = 0;
    }
    if (!enabled || s.paused) return;
    const first = lastCount === 0;
    const enough = chronicle.moments().length - lastCount >= (first ? 2 : MIN_NEW_MOMENTS) || (first && chronicle.previousRuns().length > 0);
    if (s.time - lastAt >= (first ? 20 : EVERY_SIM_SEC) && enough) void run();
  }, 3000);
  return () => {
    clearInterval(id);
    runNow = null;
  };
}
