import { CONFIG } from '../shared/config';
import type { HealthResponse } from '../shared/schemas';
import type { Action, AgentTier, ControllerKind, NodeKind } from '../shared/types';
import { timeOfDay } from '../sim/environment';
import { useSim, useWorldThrottled } from '../sim/react';

const f0 = (n: number) => n.toFixed(0);
const f1 = (n: number) => n.toFixed(1);

type Mode = 'scripted' | 'llm:fast' | 'llm:smart';
const modeOf = (kind: ControllerKind, tier: AgentTier): Mode => (kind === 'llm' ? `llm:${tier}` : 'scripted');
const parseMode = (m: Mode) => (m === 'scripted' ? { controller: 'scripted' as const } : { controller: 'llm' as const, tier: m.split(':')[1] as AgentTier });

function describe(a: Action): string {
  const { type, ...rest } = a as Action & Record<string, unknown>;
  const args = Object.entries(rest)
    .map(([k, v]) => (typeof v === 'object' && v ? `${k}=(${f1((v as { x: number }).x)},${f1((v as { z: number }).z)})` : `${k}=${v}`))
    .join(' ');
  return `${type}${args ? ' ' + args : ''}`;
}

function Bar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bar">
      <span>{label}</span>
      <div>
        <i style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
      </div>
      <b>{f0(value)}</b>
    </div>
  );
}

export function Panel({ health, selectedId }: { health: HealthResponse | null; selectedId: string | null }) {
  const store = useSim();
  const world = useWorldThrottled(250);
  const agents = Object.values(world.agents);
  const count = agents.length;
  const agent = selectedId ? world.agents[selectedId] : undefined;
  const obs = agent?.controller.lastObservation;
  const llm = Boolean(health?.llmConfigured);
  const modes: Mode[] = llm ? ['llm:fast', 'llm:smart', 'scripted'] : ['scripted'];
  const modeLabel = (m: Mode) =>
    m === 'scripted' ? 'scripted baseline' : m === 'llm:fast' ? `LLM fast (${health?.models?.fast ?? 'haiku'})` : `LLM smart (${health?.models?.smart ?? 'sonnet'})`;
  const totals = agents.reduce(
    (t, a) => ({ eaten: t.eaten + a.stats.eaten, drank: t.drank + a.stats.drank, poison: t.poison + a.stats.poisonings, built: t.built + a.stats.built, dead: t.dead + (a.status === 'dead' ? 1 : 0) }),
    { eaten: 0, drank: 0, poison: 0, built: 0, dead: 0 },
  );
  const edit = (e: Parameters<typeof store.dispatch>[0]) => store.dispatch(e);
  const near = agent?.position ?? { x: 0, z: 0 };
  // Scatter God-placed things around the selected agent so repeated clicks don't stack.
  const around = () => {
    const ang = Math.random() * Math.PI * 2;
    const r = 3 + Math.random() * 3;
    return { x: near.x + Math.cos(ang) * r, z: near.z + Math.sin(ang) * r };
  };
  const addNear = (kind: NodeKind) => edit({ type: 'edit', source: 'God button', edit: { type: 'add_resource', kind, position: around() } });
  const byKind = Object.values(world.resources).reduce<Record<string, [number, number]>>((m, r) => {
    const [n, u] = m[r.kind] ?? [0, 0];
    m[r.kind] = [n + 1, u + Math.floor(r.units)];
    return m;
  }, {});
  const now = world.time;

  return (
    <div className="panel">
      <h1>Let's Play God</h1>
      <div className={`status ${llm ? 'ok' : 'warn'}`}>
        {health ? health.detail : 'checking server…'}
        {!llm && <div className="small">LLM unavailable — only the labelled SCRIPTED baseline can run.</div>}
      </div>

      <div className="row">
        {world.paused ? <button onClick={() => edit({ type: 'resume' })}>Resume</button> : <button onClick={() => edit({ type: 'pause' })}>Pause</button>}
        <button onClick={() => edit({ type: 'reset' })}>Reset</button>
        <button onClick={() => edit({ type: 'reset', seed: Math.floor(Math.random() * 1e6) })}>New world</button>
      </div>
      <div className="small">
        {world.runId} · seed {world.seed} · t={f0(now)}s · {timeOfDay(now)} · {world.weather}
      </div>

      <div className="row">
        <select
          value={modeOf(world.defaultController, world.defaultTier)}
          onChange={(e) => edit({ type: 'setDefaultController', ...parseMode(e.target.value as Mode) })}
        >
          {modes.map((m) => (
            <option key={m} value={m}>
              new: {modeLabel(m)}
            </option>
          ))}
        </select>
        {[1, 3].map((n) => (
          <button key={n} disabled={count >= CONFIG.maxAgents} onClick={() => edit({ type: 'spawnAgents', count: n, controller: world.defaultController, tier: world.defaultTier })}>
            Spawn {n}
          </button>
        ))}
        <span className="small">
          {count}/{CONFIG.maxAgents}
        </span>
      </div>

      <details>
        <summary>God mode (direct buttons, not LLM)</summary>
        <div className="row">
          {(['clear', 'rain', 'storm'] as const).map((w) => (
            <button key={w} onClick={() => edit({ type: 'edit', source: 'God button', edit: { type: 'set_weather', weather: w } })}>
              {w}
            </button>
          ))}
        </div>
        <div className="row">
          <span className="small">near {agent ? agent.id : 'centre'}:</span>
          <button onClick={() => addNear('berry_bush')}>+berries</button>
          <button onClick={() => addNear('fresh_water')}>+water</button>
          <button onClick={() => addNear('toxic_mushroom_patch')}>+toxic shrooms</button>
          <button onClick={() => edit({ type: 'edit', source: 'God button', edit: { type: 'add_hazard', kind: 'thorns', position: around(), radius: 2 } })}>
            +thorns
          </button>
        </div>
      </details>

      <div className="small">
        measured: eaten {totals.eaten} · drinks {totals.drank} · poisonings {totals.poison} · built {totals.built} · dead {totals.dead}
      </div>

      <details>
        <summary>Ecology (world truth: patches / units available)</summary>
        <div className="kv">
          {Object.entries(byKind)
            .sort()
            .map(([k, [n, u]]) => `${k.replace(/_/g, ' ')} ${n}/${u}`)
            .join(' · ')}
        </div>
      </details>

      {!agent && <p className="small">Click an agent (or its dot on the minimap) to inspect it.</p>}
      {agent && (
        <div className="inspector">
          <h2 style={{ color: agent.color }}>
            {agent.id} <span className="small">{agent.status}</span>
          </h2>

          <h3>World truth (simulator)</h3>
          <Bar label="energy" value={agent.energy} color="#f4a261" />
          <Bar label="water" value={agent.hydration} color="#4dabf7" />
          <Bar label="health" value={agent.health} color="#e63946" />
          <Bar label="stamina" value={agent.stamina} color="#90be6d" />
          <div className="kv">
            pos ({f1(agent.position.x)}, {f1(agent.position.z)})
            {agent.poisonedUntil > now && <span className="err"> · poisoned {f0(agent.poisonedUntil - now)}s</span>}
            {agent.sickUntil > now && <span className="err"> · sick {f0(agent.sickUntil - now)}s</span>}
            <br />
            items {agent.items.length}/{agent.capacity}: {agent.items.map((i) => `${i.id}:${i.kind}`).join(', ') || '—'}
            {agent.hasTorch && ' · torch'}
            <br />
            now: {agent.current ? describe(agent.current.action) : 'idle'}
            {agent.plan.length > 0 && ` → then ${agent.plan.map(describe).join(' → ')}`}
            <br />
            eaten {agent.stats.eaten} · drank {agent.stats.drank} · poisoned {agent.stats.poisonings}× · built {agent.stats.built} · dist {f0(agent.stats.distance)}
          </div>

          <h3>Controller</h3>
          <div className="kv">
            <select
              value={modeOf(agent.controller.kind, agent.controller.tier)}
              onChange={(e) => edit({ type: 'setController', agentId: agent.id, ...parseMode(e.target.value as Mode) })}
            >
              {[...new Set<Mode>([...modes, modeOf(agent.controller.kind, agent.controller.tier)])].map((m) => (
                <option key={m} value={m}>
                  {modeLabel(m)}
                </option>
              ))}
            </select>{' '}
            {agent.controller.pending ? 'thinking…' : 'idle'} · req #{agent.controller.requestSeq}
            {agent.controller.lastLatencyMs !== null && ` · ${agent.controller.lastLatencyMs}ms`}
            <br />
            last trigger: {agent.controller.interruptReason ?? '—'}
            <br />
            last plan: {agent.controller.lastPlan?.map(describe).join(' → ') ?? '—'}
            {agent.controller.lastError && <div className="err">error: {agent.controller.lastError}</div>}
          </div>

          <h3>Last observation (what it was shown)</h3>
          <div className="kv">
            {obs ? (
              <>
                {obs.self.biome} · {obs.timeOfDay} · {obs.weather} · sees {obs.self.senseRadius}u
                <br />
                resources: {obs.visibleResources.map((r) => `${r.id} ${r.appearance} ×${r.units}`).join('; ') || 'none'}
                <br />
                hazards: {obs.visibleHazards.map((h) => `${h.id} ${h.appearance}`).join('; ') || 'none'}
                <br />
                agents: {obs.visibleAgents.map((a) => a.id).join(', ') || 'none'} · structures: {obs.visibleStructures.map((s) => `${s.id} ${s.kind}`).join(', ') || 'none'}
                <br />
                outcomes: {obs.recentOutcomes.map((o) => `${o.actionType}${o.ok ? '✓' : '✗'} ${o.detail}`).join(' | ') || '—'}
              </>
            ) : (
              'none yet'
            )}
          </div>

          <h3>Agent-declared (unverified)</h3>
          <div className="kv">
            intent: {agent.intent ?? '—'}
            <br />
            notes: {agent.memory.notes || '—'}
            <br />
            places: {agent.memory.places.map((p) => `${p.label} (${f0(p.x)},${f0(p.z)})`).join('; ') || '—'}
            <br />
            beliefs: {agent.memory.beliefs.map((b) => `${b.appearance} → ${b.verdict}`).join('; ') || '—'}
          </div>

          {agent.inbox.length > 0 && (
            <>
              <h3>Inbox</h3>
              <div className="kv">
                {agent.inbox.map((m) => (
                  <div key={m.id}>
                    {m.senderId} @{f0(m.sentAt)}s: {m.text}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
