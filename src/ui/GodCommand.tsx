import { useState } from 'react';
import type { WorldCommandRequest, WorldCommandResponse } from '../shared/schemas';
import type { WorldEdit, WorldState } from '../shared/types';
import type { SimStore } from '../sim/store';

function summarize(world: WorldState, selectedId: string | null): WorldCommandRequest['world'] {
  const sel = selectedId ? world.agents[selectedId] : undefined;
  return {
    mode: world.mode,
    population: Object.keys(world.agents).length,
    selected: sel ? { id: sel.id, x: Math.round(sel.position.x), z: Math.round(sel.position.z) } : null,
    biomes: world.biomes.map((b) => ({ kind: b.kind, x: Math.round(b.site.x), z: Math.round(b.site.z) })),
    resources: Object.values(world.resources)
      .slice(0, 200)
      .map((r) => ({ id: r.id, kind: r.kind, x: Math.round(r.position.x), z: Math.round(r.position.z) })),
    agents: Object.values(world.agents)
      .slice(0, 100)
      .map((a) => ({ id: a.id, x: Math.round(a.position.x), z: Math.round(a.position.z), status: a.status })),
  };
}

const describe = (e: WorldEdit) => {
  switch (e.type) {
    case 'add_resource': return `add ${e.kind} at (${e.position.x.toFixed(0)}, ${e.position.z.toFixed(0)})`;
    case 'remove_resource': return `remove ${e.nodeId}`;
    case 'add_obstacle': return `add ${e.shape} r=${e.radius} at (${e.position.x.toFixed(0)}, ${e.position.z.toFixed(0)})`;
    case 'add_hazard': return `add ${e.kind} r=${e.radius} at (${e.position.x.toFixed(0)}, ${e.position.z.toFixed(0)})`;
    case 'set_weather': return `weather → ${e.weather}`;
    case 'spawn_agents': return `spawn ${e.count}`;
    case 'kill_agent': return `strike down ${e.agentId}`;
  }
};

/** Natural-language God mode (LLM on the server). The model proposes allowlisted edits; the simulator validates and applies them. */
export function GodCommand({ store, selectedId, llm }: { store: SimStore; selectedId: string | null; llm: boolean }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; lines: string[] } | null>(null);

  const submit = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/world-command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: t, world: summarize(store.getState(), selectedId) } satisfies WorldCommandRequest),
        signal: AbortSignal.timeout(25000),
      });
      const body = (await res.json().catch(() => null)) as (WorldCommandResponse & { error?: string }) | null;
      if (!res.ok || !body) throw new Error(body?.error ?? `HTTP ${res.status}`);
      for (const edit of body.edits) store.dispatch({ type: 'edit', edit, source: `God LLM: "${t.slice(0, 40)}"` });
      setResult({
        ok: body.edits.length > 0,
        lines: [
          body.reply,
          ...body.edits.map((e) => `→ ${describe(e)}`),
          ...body.rejected.map((r) => `✗ rejected ${r}`),
          body.edits.length ? 'Outcome of each edit is in the event feed.' : '',
        ].filter(Boolean),
      });
      if (body.edits.length) setText('');
    } catch (e) {
      setResult({ ok: false, lines: [`error: ${(e as Error).message}`] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="god">
      <div className="row">
        <input
          value={text}
          maxLength={300}
          placeholder={llm ? 'e.g. "put fruit trees in the northeast corner"' : 'needs ANTHROPIC_API_KEY on the server'}
          disabled={!llm || busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <button disabled={!llm || busy || !text.trim()} onClick={submit}>
          {busy ? '…' : 'Command'}
        </button>
      </div>
      {result && (
        <div className={`kv ${result.ok ? '' : 'err'}`}>
          {result.lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}
