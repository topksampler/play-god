import { apiHeaders } from '../controllers/access';
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
    case 'kill_agent': return `strike down ${e.agentId}`;
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
 * Sends a natural-language God request (also used by observer suggestions). Commands become allowlisted edits that
 * the simulator validates and applies to the live world; questions are answered from a snapshot of the live world.
 */
export async function sendGodCommand(store: SimStore, text: string, selectedId: string | null): Promise<void> {
  const t = text.trim();
  if (!t || history.some((x) => x.pending)) return;
  const n = ++counter;
  setHistory((l) => [{ n, text: t, pending: true }, ...l]);
  const update = (patch: Partial<Exchange>) => setHistory((l) => l.map((x) => (x.n === n ? { ...x, ...patch } : x)));
  try {
    const request = async () => {
      const res = await fetch('/api/world-command', {
        method: 'POST',
        headers: apiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ text: t, world: worldStatus(store.getLiveState(), selectedId) }),
        signal: AbortSignal.timeout(45000),
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
    update({ pending: false, reply: out.reply, model: out.model, edits: out.edits, rejected: out.rejected });
    if (out.edits.length) {
      // Edits apply at the next simulation boundary; read their logged outcomes back.
      setTimeout(() => {
        const outcomes = store.getLiveState().events
          .filter((e) => e.seq > before && e.text.startsWith(`[${source}]`))
          .map((e) => ({ ok: e.ok, text: e.text.replace(`[${source}] `, '') }));
        update({ outcomes });
      }, 300);
    }
  } catch (e) {
    update({ pending: false, error: (e as Error).message });
  }
}

function ExchangeView({ x }: { x: Exchange }) {
  return (
    <div className="god-exchange">
      <div className="god-you">{x.text}</div>
      {x.pending && <div className="small">interpreting…</div>}
      {x.error && <div className="err small">{x.error}</div>}
      {x.reply && <div className="god-reply">{x.reply}</div>}
      {x.edits?.length === 0 && x.reply && <div className="small">no world changes</div>}
      {x.outcomes
        ? x.outcomes.map((o, i) => <div key={`o${i}`} className={o.ok ? 'god-ok' : 'god-bad'}>{o.ok ? '✓' : '✗'} {o.text}</div>)
        : x.edits?.map((e, i) => <div key={i} className="small">→ {describe(e)}</div>)}
      {x.rejected?.map((r, i) => <div key={`r${i}`} className="god-bad">✗ not applied: {r}</div>)}
    </div>
  );
}

/** Natural-language God input. `compact` shows only the latest exchange, with the rest behind a toggle. */
export function GodCommand({ store, selectedId, llm, compact = false }: { store: SimStore; selectedId: string | null; llm: boolean; compact?: boolean }) {
  const [text, setText] = useState('');
  const [all, setAll] = useState(!compact);
  const log = useSyncExternalStore(subscribe, () => history);
  const busy = log.some((x) => x.pending);
  const submit = () => {
    if (!text.trim() || busy) return;
    void sendGodCommand(store, text, selectedId);
    setText('');
  };
  const shown = all ? log : log.slice(0, 1);

  return (
    <div className="god">
      <div className="god-input-row">
        <input
          value={text}
          maxLength={500}
          placeholder={llm ? 'Ask the world, or command it…' : 'needs ANTHROPIC_API_KEY on the server'}
          disabled={!llm || busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <button className="god-send" disabled={!llm || busy || !text.trim()} onClick={submit} aria-label="Send">
          {busy ? '…' : '➤'}
        </button>
      </div>
      {shown.map((x) => <ExchangeView key={x.n} x={x} />)}
      {compact && log.length > 1 && (
        <button className="link-btn" onClick={() => setAll((v) => !v)}>{all ? 'hide history' : `history (${log.length - 1} more)`}</button>
      )}
    </div>
  );
}
