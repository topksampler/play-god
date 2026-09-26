import { useState, useSyncExternalStore } from 'react';
import type { WorldCommandResponse } from '../shared/schemas';
import type { WorldEdit } from '../shared/types';
import { worldStatus } from '../sim/status';
import type { SimStore } from '../sim/store';

type Exchange = {
  n: number;
  text: string;
  pending: boolean;
  reply?: string;
  model?: string;
  edits?: WorldEdit[];
  rejected?: string[];
  /** Actual simulator outcomes for this command's edits, read back from the event log. */
  outcomes?: { ok: boolean; text: string }[];
  error?: string;
};

const at = (p: { x: number; z: number }) => `(${p.x.toFixed(0)}, ${p.z.toFixed(0)})`;
const describe = (e: WorldEdit) => {
  switch (e.type) {
    case 'add_resource': return `add ${e.kind} at ${at(e.position)}`;
    case 'remove_resource': return `remove ${e.nodeId}`;
    case 'add_obstacle': return `add ${e.shape} r=${e.radius} at ${at(e.position)}`;
    case 'add_hazard': return `add ${e.kind} r=${e.radius} at ${at(e.position)}`;
    case 'remove_hazard': return `remove hazard ${e.hazardId}`;
    case 'set_weather': return `weather → ${e.weather}${e.durationSec ? ` for ${Math.round(e.durationSec)}s` : ''}`;
    case 'set_time_of_day': return `time of day → ${e.timeOfDay}`;
    case 'spawn_agents': return `spawn ${e.count}`;
  }
};

// Chat history lives outside React (survives tab switches and in-flight replies) and in localStorage (survives reloads).
const STORAGE_KEY = 'playgod.godConsole.v1';
const MAX_HISTORY = 50;
function loadHistory(): Exchange[] {
  try {
    const h = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(h) ? h.map((x: Exchange) => (x.pending ? { ...x, pending: false, error: 'interrupted (page reloaded)' } : x)) : [];
  } catch {
    return [];
  }
}
let history = loadHistory();
let counter = Math.max(0, ...history.map((x) => x.n));
const subscribers = new Set<() => void>();
function setHistory(f: (h: Exchange[]) => Exchange[]) {
  history = f(history).slice(0, MAX_HISTORY);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // storage full or unavailable: keep the in-memory history
  }
  subscribers.forEach((s) => s());
}
const subscribe = (fn: () => void) => {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
};

/**
 * Natural-language God mode (LLM on the server). Commands become allowlisted edits that the simulator validates and
 * applies; questions are answered from a snapshot of actual world state.
 */
export function GodCommand({ store, selectedId, llm }: { store: SimStore; selectedId: string | null; llm: boolean }) {
  const [text, setText] = useState('');
  const log = useSyncExternalStore(subscribe, () => history);
  const busy = log.some((x) => x.pending);
  const update = (n: number, patch: Partial<Exchange>) => setHistory((l) => l.map((x) => (x.n === n ? { ...x, ...patch } : x)));

  const submit = async () => {
    const t = text.trim();
    if (!t || busy) return;
    const n = ++counter;
    setText('');
    setHistory((l) => [{ n, text: t, pending: true }, ...l]);
    try {
      const request = async () => {
        const res = await fetch('/api/world-command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: t, world: worldStatus(store.getLiveState(), selectedId) }),
          signal: AbortSignal.timeout(25000),
        });
        return { res, body: await res.json().catch(() => ({})) };
      };
      let { res, body } = await request();
      // A 5xx with no JSON error comes from the dev proxy (API server restarting), not the model. Nothing was applied, so retry once.
      if (res.status >= 500 && !body.error) {
        await new Promise((r) => setTimeout(r, 2000));
        ({ res, body } = await request());
      }
      if (!res.ok) throw new Error(body.error ?? (res.status >= 500 ? `API server unreachable (HTTP ${res.status}) — is \`npm run dev\` running? Nothing was changed.` : `HTTP ${res.status}`));
      const out = body as WorldCommandResponse;
      const source = `God #${n} "${t.slice(0, 30)}"`;
      const before = store.getLiveState().eventSeq;
      for (const edit of out.edits) store.dispatch({ type: 'edit', edit, source });
      update(n, { pending: false, reply: out.reply, model: out.model, edits: out.edits, rejected: out.rejected });
      if (out.edits.length) {
        // Edits apply at the next simulation boundary; read their logged outcomes back.
        setTimeout(() => {
          const outcomes = store.getLiveState().events
            .filter((e) => e.seq > before && e.text.startsWith(`[${source}]`))
            .map((e) => ({ ok: e.ok, text: e.text.replace(`[${source}] `, '') }));
          update(n, { outcomes });
        }, 300);
      }
    } catch (e) {
      update(n, { pending: false, error: (e as Error).message });
    }
  };

  return (
    <div className="god">
      <div className="row">
        <input
          value={text}
          maxLength={500}
          placeholder={llm ? 'e.g. "storm for 2 minutes" · "make it night" · "how is everyone doing?"' : 'needs ANTHROPIC_API_KEY on the server'}
          disabled={!llm || busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <button disabled={!llm || busy || !text.trim()} onClick={submit}>
          {busy ? '…' : 'Send'}
        </button>
      </div>
      <div className="small">
        Can change: weather (+duration), time of day, add/remove resources and hazards, add obstacles, spawn creatures. Can answer questions about the current world.
      </div>
      {log.map((x) => (
        <div key={x.n} className="god-exchange kv">
          <div><b>you:</b> {x.text}</div>
          {x.pending && <div className="small">interpreting…</div>}
          {x.error && <div className="err">error: {x.error}</div>}
          {x.reply && <div><b>world</b> <span className="small">({x.model})</span>: {x.reply}</div>}
          {x.edits?.length === 0 && <div className="small">(no world changes applied)</div>}
          {x.edits?.map((e, i) => <div key={i} className="small">→ {describe(e)}</div>)}
          {x.outcomes?.map((o, i) => <div key={`o${i}`} className={o.ok ? 'small' : 'small err'}>{o.ok ? '✓' : '✗'} {o.text}</div>)}
          {x.rejected?.map((r, i) => <div key={`r${i}`} className="small err">✗ not applied: {r}</div>)}
        </div>
      ))}
    </div>
  );
}
