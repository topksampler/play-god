import { useState } from 'react';
import { CONFIG } from '../shared/config';
import type { HealthResponse } from '../shared/schemas';
import type { AgentTier, ControllerKind, NodeKind, SimCommand } from '../shared/types';
import { timeOfDay } from '../sim/environment';
import { useSim, useWorldThrottled } from '../sim/react';
import { Sparkline } from './charts/Sparkline';
import { Dossier, type DossierTab } from './Dossier';
import { EventFeed } from './EventFeed';

const f0 = (n: number) => n.toFixed(0);
const f1 = (n: number) => n.toFixed(1);

type Mode = 'scripted' | 'llm:fast' | 'llm:smart';
const modeOf = (kind: ControllerKind, tier: AgentTier): Mode => (kind === 'llm' ? `llm:${tier}` : 'scripted');
const parseMode = (m: Mode) => (m === 'scripted' ? { controller: 'scripted' as const } : { controller: 'llm' as const, tier: m.split(':')[1] as AgentTier });

function Bar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bar">
      <span>{label}</span>
      <div><i style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} /></div>
      <b>{f0(value)}</b>
    </div>
  );
}

export function Panel({
  health, selectedId, onSelect, tab, setTab, focusSeq,
}: {
  health: HealthResponse | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  tab: DossierTab;
  setTab: (t: DossierTab) => void;
  focusSeq: number | null;
}) {
  const store = useSim();
  const world = useWorldThrottled(400);
  const [view, setView] = useState<'world' | 'agent'>('agent');
  const agents = Object.values(world.agents);
  const count = agents.length;
  const agent = selectedId ? world.agents[selectedId] : undefined;
  const llm = Boolean(health?.llmConfigured);
  const modes: Mode[] = llm ? ['llm:fast', 'llm:smart', 'scripted'] : ['scripted'];
  const modeLabel = (m: Mode) =>
    m === 'scripted' ? 'scripted baseline' : m === 'llm:fast' ? `LLM fast · ${health?.models?.fast ?? 'haiku'}` : `LLM smart · ${health?.models?.smart ?? 'sonnet'}`;
  const edit = (e: SimCommand) => store.dispatch(e);
  const near = agent?.position ?? { x: 0, z: 0 };
  const around = () => {
    const ang = Math.random() * Math.PI * 2;
    const r = 3 + Math.random() * 3;
    return { x: near.x + Math.cos(ang) * r, z: near.z + Math.sin(ang) * r };
  };
  const addNear = (kind: NodeKind) => edit({ type: 'edit', source: 'God button', edit: { type: 'add_resource', kind, position: around() } });
  const speed = store.getSpeed();
  const h = world.history;
  const series = (k: keyof (typeof h)[number]) => h.map((p) => ({ t: p.t, v: p[k] as number }));
  const showAgent = view === 'agent' && agent;

  return (
    <div className="panel">
      <div className="panel-top">
        <h1>Let's Play God</h1>
        <div className={`status ${llm ? 'ok' : 'warn'}`}>
          {health ? health.detail : 'checking server…'}
          {!llm && <div className="small">LLM unavailable — only the labelled SCRIPTED baseline can run.</div>}
        </div>
        <div className="row">
          {world.paused ? <button onClick={() => edit({ type: 'resume' })}>▶ Resume</button> : <button onClick={() => edit({ type: 'pause' })}>⏸ Pause</button>}
          <button onClick={() => edit({ type: 'reset' })}>Reset</button>
          <button onClick={() => edit({ type: 'reset', seed: Math.floor(Math.random() * 1e6) })}>New world</button>
          <span className="small">speed</span>
          {[0.25, 0.5, 1, 2].map((x) => (
            <button key={x} className={`chip-btn ${speed === x ? 'on' : ''}`} onClick={() => store.setSpeed(x)}>{x}×</button>
          ))}
        </div>
        <div className="row">
          <select value={modeOf(world.defaultController, world.defaultTier)} onChange={(e) => edit({ type: 'setDefaultController', ...parseMode(e.target.value as Mode) })}>
            {modes.map((m) => <option key={m} value={m}>new: {modeLabel(m)}</option>)}
          </select>
          {[1, 3].map((n) => (
            <button key={n} disabled={count >= CONFIG.maxAgents} onClick={() => edit({ type: 'spawnAgents', count: n, controller: world.defaultController, tier: world.defaultTier })}>
              Spawn {n}
            </button>
          ))}
          <span className="small">{count}/{CONFIG.maxAgents}</span>
        </div>
        <div className="agent-chips">
          {agents.map((a) => (
            <button key={a.id} className={`agent-chip ${a.id === selectedId ? 'on' : ''}`} onClick={() => { onSelect(a.id); setView('agent'); }}>
              <i style={{ background: a.status === 'dead' ? '#777' : a.color }} />
              {a.id}
              {a.controller.pending ? ' …' : ''}
              {a.controller.lastError ? ' ⚠' : ''}
            </button>
          ))}
          <span className="spacer" />
          <button className={`chip-btn ${view === 'world' ? 'on' : ''}`} onClick={() => setView('world')}>🌍 World</button>
        </div>
      </div>

      <div className="panel-body">
        {!showAgent && (
          <>
            <div className="small">
              {world.runId} · seed {world.seed} · {timeOfDay(world.time)} · {world.weather} · t={f0(world.time)}s
            </div>
            <h3>Ecology over time (world truth)</h3>
            <div className="grid2">
              <Sparkline title="Edible food units" points={series('food')} color="#eda100" />
              <Sparkline title="Harmful food/water" points={series('harmful')} color="#eb6834" />
              <Sparkline title="Materials (wood/stone/fiber)" points={series('materials')} color="#52514e" />
              <Sparkline title="Resource patches" points={series('patches')} color="#1baf7a" />
              <Sparkline title="Agents alive" points={series('alive')} color="#2a78d6" max={CONFIG.maxAgents} />
              <Sparkline title="Structures built" points={series('structures')} color="#4a3aa7" />
            </div>
            <h3>God mode (direct buttons, not LLM)</h3>
            <div className="row">
              {(['clear', 'rain', 'storm'] as const).map((w) => (
                <button key={w} onClick={() => edit({ type: 'edit', source: 'God button', edit: { type: 'set_weather', weather: w } })}>{w}</button>
              ))}
            </div>
            <div className="row">
              <span className="small">near {agent ? agent.id : 'centre'}:</span>
              <button onClick={() => addNear('berry_bush')}>+berries</button>
              <button onClick={() => addNear('fruit_tree')}>+fruit tree</button>
              <button onClick={() => addNear('fresh_water')}>+water</button>
              <button onClick={() => addNear('toxic_mushroom_patch')}>+toxic shrooms</button>
              <button onClick={() => edit({ type: 'edit', source: 'God button', edit: { type: 'add_hazard', kind: 'thorns', position: around(), radius: 2 } })}>+thorns</button>
            </div>
            <h3>World events</h3>
            <EventFeed />
          </>
        )}

        {showAgent && agent && (
          <div className="inspector">
            <div className="agent-head">
              <h2 style={{ color: agent.color }}>{agent.id}</h2>
              <span className={`pill ${agent.status === 'dead' ? 'harmful' : 'safe'}`}>{agent.status}</span>
              <span className="small">age {f0(world.time - agent.bornAt)}s · turn {agent.turn}</span>
            </div>
            <div className="grid2 tight">
              <Bar label="energy" value={agent.energy} color="#eb6834" />
              <Bar label="water" value={agent.hydration} color="#2a78d6" />
              <Bar label="health" value={agent.health} color="#e34948" />
              <Bar label="stamina" value={agent.stamina} color="#1baf7a" />
            </div>
            <div className="kv">
              {agent.current ? `▶ ${agent.current.action.type}` : 'idle'}
              {agent.plan.length > 0 && ` → ${agent.plan.map((p) => p.type).join(' → ')}`}
              {agent.poisonedUntil > world.time && <span className="err"> · poisoned {f0(agent.poisonedUntil - world.time)}s</span>}
              {agent.sickUntil > world.time && <span className="err"> · sick {f0(agent.sickUntil - world.time)}s</span>}
              <br />
              carrying {agent.items.length}/{agent.capacity}: {agent.items.map((i) => i.label).join(', ') || '—'}
              <span className="small"> (truth: {agent.items.map((i) => i.kind).join(', ') || '—'})</span>
              <br />
              pos ({f1(agent.position.x)}, {f1(agent.position.z)}){agent.hasTorch ? ' · 🔥 torch' : ''}
            </div>
            <div className="row">
              <select value={modeOf(agent.controller.kind, agent.controller.tier)} onChange={(e) => edit({ type: 'setController', agentId: agent.id, ...parseMode(e.target.value as Mode) })}>
                {[...new Set<Mode>([...modes, modeOf(agent.controller.kind, agent.controller.tier)])].map((m) => <option key={m} value={m}>{modeLabel(m)}</option>)}
              </select>
              <span className="small">
                {agent.controller.pending ? 'thinking…' : 'idle'}
                {agent.controller.lastLatencyMs !== null && ` · last ${agent.controller.lastLatencyMs}ms`}
              </span>
            </div>
            {agent.controller.lastError && <div className="err small">error: {agent.controller.lastError}</div>}
            <Dossier agent={agent} tab={tab} setTab={setTab} focusSeq={focusSeq} />
          </div>
        )}
        {view === 'agent' && !agent && <p className="small">Click an agent (in the world, the minimap or the chips above).</p>}
      </div>
    </div>
  );
}
