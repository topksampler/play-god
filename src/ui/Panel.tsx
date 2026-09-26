import { useState } from 'react';
import { flyDriverStatus } from '../controllers/fly/driver';
import { CONFIG } from '../shared/config';
import type { HealthResponse } from '../shared/schemas';
import type { Agent, AgentTier, ControllerKind, NodeKind, SimCommand } from '../shared/types';
import { timeOfDay, worldClock } from '../sim/environment';
import { useSim, useWorldThrottled } from '../sim/react';
import { livingOfKind, populationLimit } from '../sim/world';
import { GodCommand } from './GodCommand';
import { Sparkline } from './charts/Sparkline';
import { Dossier, type DossierTab } from './Dossier';
import { EventFeed } from './EventFeed';
import { Lab } from './Lab';

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

function FlyBrainStatus() {
  const st = flyDriverStatus();
  if (st.state === 'idle') return null;
  if (st.state === 'loading') return <div className="status warn">Loading connectome circuit into brain workers…</div>;
  if (st.state === 'error') return <div className="status warn err">Fly brains unavailable: {st.error}</div>;
  const slow = st.realtimeFactor < 1;
  return (
    <div className={`status ${slow ? 'warn' : 'ok'}`}>
      {st.flies} fly brains × {st.neurons.toLocaleString()} neurons on {st.workers} workers (capacity {st.capacity}) · brain speed {st.realtimeFactor.toFixed(2)}× real time
      {slow && <div className="small">Brains are slower than real time, so the world runs in slow motion to keep every fly in step with its brain.</div>}
      {st.lastError && <div className="small err">{st.lastError}</div>}
    </div>
  );
}

function FlyInspector({ agent, now }: { agent: Agent; now: number }) {
  const f = agent.fly!;
  const r = f.readout;
  return (
    <div className="inspector">
      <div className="agent-head">
        <h2 style={{ color: agent.color }}>{agent.id}</h2>
        <span className={`pill ${agent.status === 'dead' ? 'harmful' : 'safe'}`}>{agent.status}</span>
        <span className="small">connectome fly · brain {agent.status === 'dead' ? 'stopped' : f.brainStatus} · age {f0(now - agent.bornAt)}s</span>
      </div>
      <h3>World truth (simulator)</h3>
      <div className="grid2 tight">
        <Bar label="energy" value={agent.energy} color="#eb6834" />
        <Bar label="water" value={agent.hydration} color="#2a78d6" />
        <Bar label="health" value={agent.health} color="#e34948" />
      </div>
      <div className="kv">
        pos ({f1(agent.position.x)}, {f1(agent.position.z)}) · fed {agent.stats.eaten}× · drank {agent.stats.drank}× · dist {f0(agent.stats.distance)}
        {agent.poisonedUntil > now && <span className="err"> · poisoned {f0(agent.poisonedUntil - now)}s</span>}
        <br />
        taste: {f.lastTaste && now - f.lastTaste.at < 0.3 ? `${f.lastTaste.sugar ? 'sugar/water ' : ''}${f.lastTaste.bitter ? 'bitter' : ''}` || 'neutral' : 'nothing'}
        {f.feeding && ' · proboscis extended'}
        {f.flight && now < f.flight.until && <b> · AIRBORNE ({f.flight.reason})</b>}
        {f.nibbling && <span> · nibbling {f.nibbling}'s food</span>}
        <br />
        escapes {f.escapes ?? 0} · eggs laid {f.eggsLaid ?? 0} · generation {agent.generation}{agent.parents.length ? ` (hatched from ${agent.parents[0]}'s egg)` : ''}
        {agent.deathCause && <span className="err"> · died: {agent.deathCause}</span>}
      </div>
      <h3>Brain readouts (spikes from its own connectome circuit)</h3>
      {r ? (
        <div className="kv">
          DNa02 steering L {f0(r.dna02[0])} / R {f0(r.dna02[1])} Hz · DNa01 L {f0(r.dna01[0])} / R {f0(r.dna01[1])} Hz
          <br />
          MN9 proboscis motor neuron {f0(r.mn9)} Hz {f.feeding ? '→ feeding' : ''}
          <br />
          dopamine: PAM (reward) {f1(r.pam)} Hz · PPL1 (punishment) {f1(r.ppl1)} Hz
          <br />
          learned odor valence (own KC→MBON weight change) {r.valence.toFixed(3)}
          <br />
          steering signal {f1(r.steer)} Hz → turn {f1(f.turnRate)} rad/s · brain share of turning {f0(r.brainDriven * 100)}%
          {r.gf && (
            <>
              <br />
              eyes: looming input to LC4 L {f0(r.loom?.[0] ?? 0)} / R {f0(r.loom?.[1] ?? 0)} Hz · Giant Fiber (DNp01) L {f0(r.gf[0])} / R {f0(r.gf[1])} Hz
              <br />
              ears: Johnston's organ (JO-A/B) input {f0(r.hearing ?? 0)} Hz
            </>
          )}
        </div>
      ) : (
        <div className="kv">waiting for first brain tick…</div>
      )}
      <div className="small">
        Body-level rules (not neural): walking speed, exploratory turning noise, collision side-step, hunger gain on sensory input, looming/sound geometry
        feeding the eyes and ears, escape direction and flight after a Giant Fiber spike, egg laying, and the playful buzz sounds.
      </div>
      {agent.controller.lastError && <div className="err small">brain error: {agent.controller.lastError}</div>}
      <SmiteButton agent={agent} />
    </div>
  );
}

/** God power: strike the selected creature dead (a validated world edit, logged like any other). */
function SmiteButton({ agent }: { agent: Agent }) {
  const store = useSim();
  if (agent.status === 'dead') return null;
  return (
    <div className="row">
      <button className="smite" onClick={() => store.dispatch({ type: 'edit', source: 'God button', edit: { type: 'kill_agent', agentId: agent.id } })}>
        ⚡ Strike {agent.id} down
      </button>
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
  const [view, setView] = useState<'world' | 'agent' | 'lab'>('agent');
  const agents = Object.values(world.agents);
  const flyMode = world.mode === 'flies';
  const mixed = world.mode === 'mixed';
  const agentCount = livingOfKind(world, 'agents');
  const flyCount = livingOfKind(world, 'flies');
  const agentLimit = populationLimit(world, 'agents');
  const flyLimit = populationLimit(world, 'flies');
  const setMode = (mode: 'agents' | 'mixed' | 'flies') => {
    if (world.mode === mode) return;
    edit({ type: 'reset', mode });
    onSelect(mode === 'flies' ? 'f1' : 'a1');
  };
  // The fruit-fly tab is off unless the server enables it (ENABLE_FLY_MODE); still shown if already in a fly world so you can leave it.
  const flyTab = Boolean(health?.features?.flyMode) || world.mode !== 'agents';
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
        {flyTab && (
        <div className="modes" role="tablist">
          <button className={world.mode === 'agents' ? 'on' : ''} onClick={() => setMode('agents')}>
            LLM agents
          </button>
          <button className={mixed ? 'on' : ''} onClick={() => setMode('mixed')}>
            Agents + flies
          </button>
          <button className={flyMode ? 'on' : ''} onClick={() => setMode('flies')}>
            Fruit flies
          </button>
        </div>
        )}
        {mixed ? (
          <>
            <div className="small">
              LLM agents and connectome fruit flies share one world. Flies smell the food agents carry and nibble it; their own looming-detector neurons (LC4/LPLC2)
              and ears (Johnston's organ) drive their own Giant Fiber, which triggers the escape. Agents see and hear the flies and can swat them. Flies cannot talk.
            </div>
            <div className={`status ${llm ? 'ok' : 'warn'}`}>
              {health ? health.detail : 'checking server…'}
              {!llm && <div className="small">LLM unavailable — only the labelled SCRIPTED baseline can run.</div>}
            </div>
            <FlyBrainStatus />
          </>
        ) : flyMode ? (
          <>
            <div className="small">
              Each fly runs its own spiking model of 5,966 FlyWire neurons (whole-brain model of Shiu et al., pruned to the neurons its senses reach). Odor steers it via
              DNa01/DNa02, sugar drives MN9 feeding, and dopamine-gated plasticity in its own mushroom body makes it learn from what it tastes.
            </div>
            <FlyBrainStatus />
          </>
        ) : (
          <div className={`status ${llm ? 'ok' : 'warn'}`}>
            {health ? health.detail : 'checking server…'}
            {!llm && <div className="small">LLM unavailable — only the labelled SCRIPTED baseline can run.</div>}
          </div>
        )}
        <div className="row">
          {world.paused ? <button onClick={() => edit({ type: 'resume' })}>▶ Resume</button> : <button onClick={() => edit({ type: 'pause' })}>⏸ Pause</button>}
          <button onClick={() => edit({ type: 'reset' })}>Reset</button>
          <button onClick={() => edit({ type: 'reset', seed: Math.floor(Math.random() * 1e6) })}>New world</button>
          <span className="small">speed</span>
          {[0.25, 0.5, 1, 2].map((x) => (
            <button key={x} className={`chip-btn ${speed === x ? 'on' : ''}`} onClick={() => store.setSpeed(x)}>{x}×</button>
          ))}
        </div>
        {(flyMode || mixed) && (
          <div className="row">
            {(mixed ? [1, 3] : [1, 5, 10]).map((n) => (
              <button key={n} disabled={flyCount >= flyLimit} onClick={() => edit({ type: 'spawnAgents', count: n, controller: 'fly' })}>
                Spawn {n} {n === 1 ? 'fly' : 'flies'}
              </button>
            ))}
            <span className="small">{flyCount}/{flyLimit} flies</span>
          </div>
        )}
        {flyMode ? null : (
          <div className="row">
            <select value={modeOf(world.defaultController, world.defaultTier)} onChange={(e) => edit({ type: 'setDefaultController', ...parseMode(e.target.value as Mode) })}>
              {modes.map((m) => <option key={m} value={m}>new: {modeLabel(m)}</option>)}
            </select>
            {[1, 3].map((n) => (
              <button key={n} disabled={agentCount >= agentLimit} onClick={() => edit({ type: 'spawnAgents', count: n, controller: world.defaultController, tier: world.defaultTier })}>
                Spawn {n}
              </button>
            ))}
            <span className="small">{agentCount}/{agentLimit}{mixed ? ' agents' : ''}</span>
          </div>
        )}
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
          <button className={`chip-btn ${view === 'lab' ? 'on' : ''}`} onClick={() => setView('lab')}>🧪 Lab</button>
        </div>
      </div>

      <div className="panel-body">
        {view === 'lab' && <Lab world={world} />}
        {view === 'world' && (
          <>
            <div className="small">
              {world.runId} · seed {world.seed} · {timeOfDay(worldClock(world))} · {world.weather} · t={f0(world.time)}s
            </div>
            <h3>Ecology over time (world truth)</h3>
            <div className="grid2">
              <Sparkline title="Edible food units" points={series('food')} color="#eda100" />
              <Sparkline title="Harmful food/water" points={series('harmful')} color="#eb6834" />
              <Sparkline title="Materials (wood/stone/fiber)" points={series('materials')} color="#52514e" />
              <Sparkline title="Resource patches" points={series('patches')} color="#1baf7a" />
              <Sparkline title="Agents alive" points={series('alive')} color="#2a78d6" max={CONFIG.maxPopulation} />
              <Sparkline title="Structures built" points={series('structures')} color="#4a3aa7" />
              <Sparkline title="Births (cumulative)" points={series('births')} color="#e87ba4" />
              <Sparkline title="Generations" points={series('generations')} color="#e87ba4" />
            </div>
            <h3>God mode — natural language (LLM, allowlisted edits)</h3>
            <GodCommand store={store} selectedId={selectedId} llm={llm} />
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
              <button onClick={() => addNear('mushroom_patch')}>+brown shrooms</button>
              <button onClick={() => addNear('toxic_mushroom_patch')}>+toxic shrooms</button>
              <button onClick={() => edit({ type: 'edit', source: 'God button', edit: { type: 'add_hazard', kind: 'thorns', position: around(), radius: 2 } })}>+thorns</button>
            </div>
            <h3>World events</h3>
            <EventFeed />
          </>
        )}

        {showAgent && agent?.fly && <FlyInspector agent={agent} now={world.time} />}
        {showAgent && agent && !agent.fly && (
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
            <SmiteButton agent={agent} />
            <Dossier agent={agent} tab={tab} setTab={setTab} focusSeq={focusSeq} />
          </div>
        )}
        {view === 'agent' && !agent && <p className="small">Click an agent (in the world, the minimap or the chips above).</p>}
      </div>
    </div>
  );
}
