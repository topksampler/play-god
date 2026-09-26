import type { WorldState } from '../shared/types';
import { createMomentTracker, type Moment, truthOf } from './moments';
import { saveRunSnapshot } from './runStore';
import type { SimStore } from './store';

/** Compact, factual summary of one run, kept across page loads so later runs can be compared with it. */
export type RunSummary = {
  key: string;
  runId: string;
  seed: number;
  savedAt: string;
  simTime: number;
  mode: WorldState['mode'];
  conditions: string;
  controllers: string;
  peakAlive: number;
  alive: number;
  births: number;
  deaths: { count: number; causes: Record<string, number> };
  courtships: { attempts: number; mutual: number };
  speech: { acts: number; heard: number };
  beliefs: { judged: number; correct: number };
  topMoments: string[];
  insights: string[];
  /** Notable moments of that run (weight ≥ 2), so later observers can cite them and the UI can reopen them. */
  moments?: Moment[];
};

export type Insight = {
  id: string;
  at: number;
  headline: string;
  detail: string;
  kind: 'pattern' | 'comparison' | 'question';
  momentIds: string[];
};
/** An insight kept across runs and reloads; momentIds are absolute ("<runKey>|<momentId>"). */
export type LoggedInsight = Insight & { runKey: string; model: string; loggedAt: string };
export type ObserverNote = { at: number; insights: Insight[]; suggestion: { command: string; why: string } | null; model: string };

const RUNS_KEY = 'playgod.runs.v1';
const INSIGHTS_KEY = 'playgod.insights.v1';
const MAX_INSIGHTS = 60;
const MAX_RUNS = 12;
const SAVE_EVERY_MS = 30000;

const storage = () => (typeof localStorage === 'undefined' ? null : localStorage);
function loadRuns(): RunSummary[] {
  try {
    const r = JSON.parse(storage()?.getItem(RUNS_KEY) ?? '[]');
    return Array.isArray(r) ? r : [];
  } catch {
    return [];
  }
}

function loadInsights(): LoggedInsight[] {
  try {
    const r = JSON.parse(storage()?.getItem(INSIGHTS_KEY) ?? '[]');
    return Array.isArray(r) ? r : [];
  } catch {
    return [];
  }
}

export function summarizeRun(state: WorldState, key: string, moments: Moment[], peakAlive: number, notes: ObserverNote[]): RunSummary {
  const agents = Object.values(state.agents);
  const causes: Record<string, number> = {};
  for (const a of agents) if (a.status === 'dead') causes[a.deathCause ?? 'unknown'] = (causes[a.deathCause ?? 'unknown'] ?? 0) + 1;
  let judged = 0;
  let correct = 0;
  for (const a of agents)
    for (const b of a.memory.beliefs) {
      const t = b.verdict === 'unknown' ? null : truthOf(b.appearance);
      if (!t) continue;
      judged++;
      if (t === b.verdict) correct++;
    }
  const ctl: Record<string, number> = {};
  for (const a of agents) {
    const k = a.controller.kind === 'llm' ? `llm/${a.controller.tier}` : a.controller.kind;
    ctl[k] = (ctl[k] ?? 0) + 1;
  }
  const e = state.experiment;
  const speech = state.utterances.filter((u) => u.channel !== 'gesture');
  return {
    key,
    runId: state.runId,
    seed: state.seed,
    savedAt: new Date().toISOString(),
    simTime: Math.round(state.time),
    mode: state.mode,
    conditions: `${e.commMode} · food ${e.scarcity} · traits ${e.traits ? 'on' : 'off'} · lifespan ${Math.round(e.lifespanSec)}s · inherit ${e.inheritance}`,
    controllers: Object.entries(ctl).map(([k, v]) => `${v}× ${k}`).join(', '),
    peakAlive,
    alive: agents.filter((a) => a.status !== 'dead').length,
    births: state.births.length,
    deaths: { count: Object.values(causes).reduce((x, y) => x + y, 0), causes },
    courtships: { attempts: state.courtships.length, mutual: state.courtships.filter((c) => c.outcome === 'mutual' || c.outcome === 'birth').length },
    speech: { acts: speech.length, heard: speech.filter((u) => u.hearers.length > 0).length },
    beliefs: { judged, correct },
    topMoments: moments.filter((m) => m.weight === 3).slice(-8).map((m) => `${Math.round(m.at)}s ${m.title}`),
    insights: notes.flatMap((n) => n.insights.map((i) => i.headline)).slice(-6),
    moments: moments.filter((m) => m.weight >= 2).slice(-60),
  };
}

export type Chronicle = {
  moments(): Moment[];
  /** Earlier runs (not the current one), newest first. */
  previousRuns(): RunSummary[];
  current(): RunSummary;
  notes(): ObserverNote[];
  addNote(n: ObserverNote): void;
  /** Every observer insight so far (all runs), newest first. */
  insights(): LoggedInsight[];
  /** Key of the current run (prefix of absolute moment ids). */
  currentKey(): string;
  subscribe(fn: () => void): () => void;
  /** Version counter for useSyncExternalStore. */
  version(): number;
};

/** Watches the live world (read-only) for moments, and persists run summaries for cross-run comparison. */
export function createChronicle(store: SimStore, opts: { now?: () => number } = {}): Chronicle {
  const now = opts.now ?? (() => Date.now());
  const tracker = createMomentTracker();
  const session = now().toString(36);
  let runs = loadRuns();
  let insightLog = loadInsights();
  let runId = '';
  let peak = 0;
  let notes: ObserverNote[] = [];
  let lastScan = 0;
  let lastState: WorldState | null = null;
  let lastSave = now();
  let version = 0;
  const subs = new Set<() => void>();
  const key = () => `${session}:${runId}`;
  const notify = () => {
    version++;
    subs.forEach((f) => f());
  };

  const save = (s: WorldState) => {
    if (s.time < 5 || s.runId.startsWith('loaded:')) return; // nothing worth remembering yet / a reopened old run
    const summary = summarizeRun(s, key(), tracker.list(), peak, notes);
    runs = [summary, ...runs.filter((r) => r.key !== summary.key)].slice(0, MAX_RUNS);
    try {
      storage()?.setItem(RUNS_KEY, JSON.stringify(runs));
    } catch {
      // storage unavailable: keep in memory
    }
    void saveRunSnapshot(summary.key, s, runs.map((r) => r.key));
  };

  store.subscribe(() => {
    const t = now();
    if (t - lastScan < 500) return;
    lastScan = t;
    const s = store.getLiveState();
    if (s.runId !== runId) {
      if (runId && lastState) save(lastState); // the run that just ended
      // Keep the observer's notes when an earlier run is reopened from one of its insights.
      if (!s.runId.startsWith('loaded:')) notes = [];
      runId = s.runId;
      peak = 0;
    }
    lastState = s;
    peak = Math.max(peak, Object.values(s.agents).filter((a) => a.status !== 'dead').length);
    const before = tracker.list().length;
    tracker.update(s);
    if (t - lastSave > SAVE_EVERY_MS) {
      lastSave = t;
      save(s);
    }
    if (tracker.list().length !== before) notify();
  });

  return {
    moments: () => tracker.list(),
    previousRuns: () => runs.filter((r) => r.key !== key()),
    current: () => summarizeRun(store.getLiveState(), key(), tracker.list(), peak, notes),
    notes: () => notes,
    addNote(n) {
      notes = [...notes, n].slice(-8);
      const k = key();
      const logged = n.insights.map((i) => ({
        ...i,
        id: `${k}:${i.id}`,
        runKey: k,
        model: n.model,
        loggedAt: new Date().toISOString(),
        momentIds: i.momentIds.map((id) => (id.includes('|') ? id : `${k}|${id}`)),
      }));
      insightLog = [...logged, ...insightLog].slice(0, MAX_INSIGHTS);
      try {
        storage()?.setItem(INSIGHTS_KEY, JSON.stringify(insightLog));
      } catch {
        // storage unavailable: keep in memory
      }
      notify();
    },
    insights: () => insightLog,
    currentKey: key,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    version: () => version,
  };
}
