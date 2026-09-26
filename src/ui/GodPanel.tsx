import { useState, useSyncExternalStore } from 'react';
import { getAccessCode, setAccessCode } from '../controllers/access';
import { observerStatus, requestObservation, subscribeObserver } from '../controllers/observer';
import type { HealthResponse } from '../shared/schemas';
import type { Agent, SimCommand, Vec2, WorldEdit, WorldState } from '../shared/types';
import type { Insight, LoggedInsight } from '../sim/chronicle';
import { timeOfDay, worldClock } from '../sim/environment';
import { MOMENT_ICON, type Moment, topMomentsAsMoments, truthOf } from '../sim/moments';
import { useChronicle, useSim, useWorldThrottled } from '../sim/react';
import { loadRunSnapshot } from '../sim/runStore';
import type { SimStore } from '../sim/store';
import { GodCommand, sendGodCommand } from './GodCommand';

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const TOD_ICON = { dawn: '🌅', day: '☀️', dusk: '🌇', night: '🌙' } as const;
const WX_ICON = { clear: '', cloudy: '☁️', rain: '🌧', storm: '⛈' } as const;

export type WatchFn = (at: number, agentId?: string) => void;

/** Where a miracle lands: the selected creature, else the middle of the living population. */
function focusPoint(world: WorldState, selectedId: string | null): Vec2 {
  const sel = selectedId ? world.agents[selectedId] : undefined;
  if (sel && sel.status !== 'dead') return sel.position;
  const alive = Object.values(world.agents).filter((a) => a.status !== 'dead');
  if (!alive.length) return { x: 0, z: 0 };
  return { x: alive.reduce((n, a) => n + a.position.x, 0) / alive.length, z: alive.reduce((n, a) => n + a.position.z, 0) / alive.length };
}
const around = (p: Vec2, r: number) => {
  const ang = Math.random() * Math.PI * 2;
  const d = r * (0.6 + Math.random() * 0.6);
  return { x: p.x + Math.cos(ang) * d, z: p.z + Math.sin(ang) * d };
};

function Pulse({ world }: { world: WorldState }) {
  const agents = Object.values(world.agents);
  const alive = agents.filter((a) => a.status !== 'dead').length;
  const tod = timeOfDay(worldClock(world));
  return (
    <div className="pulse">
      <span>{TOD_ICON[tod]} {tod}</span>
      <span>{WX_ICON[world.weather]} {world.weather}</span>
      {world.mode === 'mixed' ? (
        <>
          <span><b>{agents.filter((a) => !a.fly && a.status !== 'dead').length}</b> agents</span>
          <span><b>{agents.filter((a) => a.fly && a.status !== 'dead').length}</b> 🪰 flies</span>
        </>
      ) : (
        <span><b>{alive}</b> alive</span>
      )}
      <span><b>{world.births.length}</b> born</span>
      <span><b>{agents.length - alive}</b> ✝</span>
      <span className="pulse-t">{clock(world.time)}</span>
    </div>
  );
}

function ObserverCard({ store, selectedId, onWatch, onSelect, onFollow, momentsById }: { store: SimStore; selectedId: string | null; onWatch: WatchFn; onSelect: (id: string) => void; onFollow: (id: string) => void; momentsById: Map<string, Moment> }) {
  const chronicle = useChronicle();
  const st = useSyncExternalStore(subscribeObserver, observerStatus);
  const [msg, setMsg] = useState<string | null>(null);
  const notes = chronicle.notes();
  const note = notes[notes.length - 1];
  const runs = chronicle.previousRuns();
  const prev = runs.length;
  const curKey = chronicle.currentKey();
  const [showAll, setShowAll] = useState(true);
  // Moments are cited as "<momentId>" (this run) or "<runKey>|<momentId>" (any run, incl. this one).
  const resolve = (id: string): { run: string | null; m: Moment } | null => {
    const bar = id.indexOf('|');
    const run = bar < 0 ? curKey : id.slice(0, bar);
    const mid = bar < 0 ? id : id.slice(bar + 1);
    if (run === curKey) {
      const m = momentsById.get(mid);
      return m ? { run: null, m } : null;
    }
    const r = runs.find((x) => x.key === run);
    const m = r && ((r.moments ?? []).find((x) => x.id === mid) ?? topMomentsAsMoments(r.topMoments).find((x) => x.id === mid));
    return m ? { run, m } : null;
  };
  const runLabel = (k: string) => {
    if (k === curKey) return 'this run';
    const i = runs.findIndex((r) => r.key === k);
    return i < 0 ? 'earlier run' : i === 0 ? 'previous run' : `${i + 1} runs ago`;
  };
  const latestIds = new Set((note?.insights ?? []).map((i) => `${curKey}:${i.id}`));
  const earlier = chronicle.insights().filter((i) => !latestIds.has(i.id));
  const watch = async (i: Insight) => {
    const hits = i.momentIds.map(resolve).filter((h): h is { run: string | null; m: Moment } => Boolean(h));
    const cur = hits.filter((h) => !h.run).sort((a, b) => a.m.at - b.m.at)[0];
    if (cur) return onWatch(cur.m.at, cur.m.agents[0]);
    const old = hits.sort((a, b) => a.m.at - b.m.at)[0];
    if (!old?.run) return;
    const w = await loadRunSnapshot(old.run);
    if (!w) return setMsg("That run's recording wasn't saved (runs are recorded from now on).");
    setMsg(null);
    // Reopen the earlier run (paused): 3D, timeline and dossiers now show it; ▶ continues it, ↻ starts a new world.
    store.load({ ...w, runId: `loaded:${old.run}:${Date.now().toString(36)}` });
    const who = old.m.agents.find((a) => w.agents[a]);
    if (who) {
      onSelect(who);
      onFollow(who);
    }
  };
  const citable = (i: Insight) => i.momentIds.some((id) => resolve(id));
  const button = (i: Insight) =>
    citable(i) && (
      <button className="watch-btn" onClick={() => void watch(i)}>
        {i.momentIds.some((id) => resolve(id) && !resolve(id)!.run) ? '⏪ Watch it' : '📼 Open that run'}
      </button>
    );
  return (
    <div className="observer">
      <div className="observer-head">
        <span className="observer-title">✦ Observer</span>
        <span className="small">{note ? `${note.model} · at ${clock(note.at)}` : prev ? `remembers ${prev} earlier run${prev > 1 ? 's' : ''}` : 'AI naturalist'}</span>
        <span className="spacer" />
        <button className="chip-btn" disabled={!st.enabled || st.pending} onClick={requestObservation}>
          {st.pending ? 'thinking…' : "What's interesting?"}
        </button>
      </div>
      {!st.enabled && <div className="small">Needs the LLM (ANTHROPIC_API_KEY on the server).</div>}
      {st.error && <div className="small err">observer: {st.error}</div>}
      {msg && <div className="small err">{msg}</div>}
      {!note && st.enabled && !st.pending && <div className="small">Watching… insights appear as things happen (about every 45 sim-seconds), or ask now.</div>}
      {note?.insights.map((i) => (
        <div key={i.id} className={`insight ${i.kind}`}>
          <div className="insight-kind">{i.kind === 'comparison' ? 'vs earlier runs' : i.kind}</div>
          <div className="insight-head">{i.headline}</div>
          <div className="insight-detail">{i.detail}</div>
          {button(i)}
        </div>
      ))}
      {note?.suggestion && (
        <div className="suggestion">
          <div><b>🧪 Try:</b> “{note.suggestion.command}”</div>
          <div className="small">{note.suggestion.why}</div>
          <button className="chip-btn" onClick={() => void sendGodCommand(store, note.suggestion!.command, selectedId)}>Do it</button>
        </div>
      )}
      {earlier.length > 0 && (
        <div className="insight-log">
          <button className="link-btn" onClick={() => setShowAll((v) => !v)}>
            {showAll ? '▾' : '▸'} All insights ({earlier.length} earlier, across runs)
          </button>
          {showAll &&
            earlier.map((i: LoggedInsight) => (
              <div key={i.id} className={`insight compact ${i.kind}`}>
                <div className="insight-kind">{i.kind === 'comparison' ? 'vs earlier runs' : i.kind} · {runLabel(i.runKey)}</div>
                <div className="insight-head">{i.headline}</div>
                <div className="insight-detail">{i.detail}</div>
                {button(i)}
              </div>
            ))}
        </div>
      )}
      <div className="small observer-note">AI interpretation of recorded events: evidence, not proof.</div>
    </div>
  );
}

function MomentRow({ m, onWatch }: { m: Moment; onWatch: WatchFn }) {
  return (
    <button className={`moment w${m.weight}`} onClick={() => onWatch(m.at, m.agents[0])} title={`${m.title} — tap to watch`}>
      <span className="moment-icon">{MOMENT_ICON[m.kind]}</span>
      <span className="moment-t">{clock(m.at)}</span>
      <span className="moment-title">{m.title}</span>
      <span className="moment-go">⏪</span>
    </button>
  );
}

function Bar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="mini-bar" title={`${label} ${Math.round(value)}`}>
      <span>{label}</span>
      <div><i style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} /></div>
    </div>
  );
}

function CreatureCard({ agent, world, onFollow, onDossier }: { agent: Agent; world: WorldState; onFollow: () => void; onDossier: () => void }) {
  const known = agent.memory.beliefs.filter((b) => b.verdict !== 'unknown');
  const wrong = known.filter((b) => truthOf(b.appearance) && truthOf(b.appearance) !== b.verdict).length;
  const dead = agent.status === 'dead';
  return (
    <div className="creature" style={{ borderColor: agent.color }}>
      <div className="creature-head">
        <i className="dot" style={{ background: dead ? '#888' : agent.color }} />
        <b>{agent.id}</b>
        <span className="small">{dead ? `died: ${agent.deathCause ?? 'unknown'}` : `${agent.current ? agent.current.action.type : 'idle'}${agent.controller.pending ? ' · thinking…' : ''}`}</span>
        <span className="spacer" />
        <button className="chip-btn" onClick={onFollow}>🎥</button>
        <button className="chip-btn" onClick={onDossier}>details</button>
      </div>
      {!dead && (
        <div className="creature-bars">
          <Bar label="food" value={agent.energy} color="#eb6834" />
          <Bar label="water" value={agent.hydration} color="#2a78d6" />
          <Bar label="health" value={agent.health} color="#e34948" />
        </div>
      )}
      {agent.fly && (
        <div className="small">
          🪰 connectome fly · brain {agent.fly.brainStatus} · {agent.fly.feeding ? 'feeding (MN9 firing)' : agent.fly.flight ? 'in flight (escape)' : 'walking'} · fed {agent.stats.eaten}× · age {Math.round(world.time - agent.bornAt)}s
        </div>
      )}
      {agent.intent && <div className="creature-intent">“{agent.intent}”</div>}
      {!agent.fly && <div className="small">
        believes {plural(known.filter((b) => b.verdict === 'safe').length, 'thing')} safe, {known.filter((b) => b.verdict === 'harmful').length} harmful
        {wrong ? <span className="err"> · {wrong} wrong</span> : null} · heard {agent.messagesHeard} · age {Math.round(world.time - agent.bornAt)}s
        {agent.generation > 0 ? ` · gen ${agent.generation}` : ''}
      </div>}
    </div>
  );
}

function Miracles({ store, world, selectedId }: { store: SimStore; world: WorldState; selectedId: string | null }) {
  const edit = (e: WorldEdit) => store.dispatch({ type: 'edit', source: 'God', edit: e });
  const p = focusPoint(world, selectedId);
  const night = timeOfDay(worldClock(world)) === 'night';
  const target = selectedId && world.agents[selectedId]?.status !== 'dead' ? `near ${selectedId}` : 'near the group';
  const items: { label: string; title: string; run: () => void }[] = [
    { label: '🌧 Rain', title: 'Rain for 90 s', run: () => edit({ type: 'set_weather', weather: 'rain', durationSec: 90 }) },
    { label: '⛈ Storm', title: 'Storm for 60 s', run: () => edit({ type: 'set_weather', weather: 'storm', durationSec: 60 }) },
    { label: '☀️ Clear', title: 'Clear skies', run: () => edit({ type: 'set_weather', weather: 'clear' }) },
    night
      ? { label: '🌅 Dawn', title: 'Jump to dawn', run: () => edit({ type: 'set_time_of_day', timeOfDay: 'dawn' }) }
      : { label: '🌙 Night', title: 'Jump to night', run: () => edit({ type: 'set_time_of_day', timeOfDay: 'night' }) },
    { label: '🍓 Food drop', title: `3 berry bushes + a fruit tree ${target}`, run: () => {
      for (let i = 0; i < 3; i++) edit({ type: 'add_resource', kind: 'berry_bush', position: around(p, 4) });
      edit({ type: 'add_resource', kind: 'fruit_tree', position: around(p, 5) });
    } },
    { label: '🍄 Temptation', title: `Red spotted (toxic) mushrooms ${target}`, run: () => edit({ type: 'add_resource', kind: 'toxic_mushroom_patch', position: around(p, 3) }) },
    { label: '🐍 Danger', title: `Snakes ${target}`, run: () => edit({ type: 'add_hazard', kind: 'snakes', position: around(p, 4), radius: 2.5 }) },
    { label: '＋3 creatures', title: 'Spawn three LLM creatures', run: () => edit({ type: 'spawn_agents', count: 3, controller: world.defaultController }) },
    ...(world.mode === 'mixed' ? [{ label: '🪰 ＋3 flies', title: 'Release three connectome fruit flies', run: () => edit({ type: 'spawn_agents', count: 3, controller: 'fly' as const }) }] : []),
  ];
  return (
    <div className="miracles">
      {items.map((m) => <button key={m.label} title={m.title} onClick={m.run}>{m.label}</button>)}
    </div>
  );
}

/**
 * The God panel: Watch (what is happening: observer insights, recorded moments, creatures) and Intervene
 * (miracles and natural-language commands). Everything else lives in the Advanced drawer.
 */
export function GodPanel({
  health, selectedId, onSelect, onWatch, onFollow, onAdvanced,
}: {
  health: HealthResponse | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onWatch: WatchFn;
  onFollow: (id: string) => void;
  onAdvanced: (agentId?: string) => void;
}) {
  const store = useSim();
  const world = useWorldThrottled(400);
  const chronicle = useChronicle();
  const [all, setAll] = useState(false);
  const llm = Boolean(health?.llmConfigured);
  const edit = (e: SimCommand) => store.dispatch(e);
  const moments = chronicle.moments();
  const momentsById = new Map(moments.map((m) => [m.id, m]));
  const shown = moments.filter((m) => all || m.weight >= 2).slice(-40).reverse();
  const agents = Object.values(world.agents);
  const agent = selectedId ? world.agents[selectedId] : undefined;

  return (
    <div className="gp">
      <header className="gp-top">
        <h1>Let's Play God</h1>
        <span className="spacer" />
        {world.paused
          ? <button className="icon-btn" title="Resume" onClick={() => edit({ type: 'resume' })}>▶</button>
          : <button className="icon-btn" title="Pause" onClick={() => edit({ type: 'pause' })}>⏸</button>}
        <button className="icon-btn" title="New world" onClick={() => edit({ type: 'reset', seed: Math.floor(Math.random() * 1e6) })}>↻</button>
        <button className="icon-btn" title="Advanced: speed, models, Lab, charts, raw events" onClick={() => onAdvanced()}>⚙</button>
      </header>
      <Pulse world={world} />
      {/* TEMPORARY for the demo: remove once PLAY_GOD_ACCESS_CODE is rotated. */}
      {llm && getAccessCode() && <div className="small" style={{ padding: '2px 14px' }}>🔓 unlocked · demo password: <b>passphrase</b></div>}
      {!llm && (
        <div className="gp-warn">
          {!health
            ? 'connecting to server…'
            : health.locked
              ? 'LLM creatures are locked on this deployment: enter the access code (creatures run the labelled scripted baseline until then).'
              : 'LLM not configured: creatures run the labelled scripted baseline.'}
          {health?.locked && (
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                setAccessCode(String(new FormData(e.currentTarget).get('code') ?? '').trim());
                window.location.reload();
              }}
            >
              <input name="code" type="password" placeholder="access code" autoComplete="off" style={{ width: 150 }} />
              <button type="submit">Unlock</button>
              {/* TEMPORARY for the demo: remove once PLAY_GOD_ACCESS_CODE is rotated. */}
              <span className="small">demo password: <b>passphrase</b></span>
            </form>
          )}
        </div>
      )}

      <div className="gp-body">
        <div className="gp-section-title">👁 What's happening</div>
        {world.runId.startsWith('loaded:') && (
          <div className="reopened">📼 You're looking at an earlier run (paused). ▶ continues it · ↻ starts a new world.</div>
        )}
        <ObserverCard store={store} selectedId={selectedId} onWatch={onWatch} onSelect={onSelect} onFollow={onFollow} momentsById={momentsById} />
        <div className="moments-head">
          <span className="small">Moments · from the simulation record · tap to watch</span>
          <span className="spacer" />
          <button className="link-btn" onClick={() => setAll((v) => !v)}>{all ? 'highlights' : 'show all'}</button>
        </div>
        <div className="moments">
          {shown.length ? shown.map((m) => <MomentRow key={m.id} m={m} onWatch={onWatch} />) : <div className="small">Nothing notable yet. Try a miracle below.</div>}
        </div>

        <div className="gp-section-title">Creatures</div>
        <div className="creature-chips">
          {agents.map((a) => (
            <button key={a.id} className={`agent-chip ${a.id === selectedId ? 'on' : ''}`} onClick={() => onSelect(a.id)}>
              <i style={{ background: a.status === 'dead' ? '#888' : a.color }} />
              {a.fly ? '🪰 ' : ''}{a.id}
            </button>
          ))}
        </div>
        {agent && <CreatureCard agent={agent} world={world} onFollow={() => onFollow(agent.id)} onDossier={() => onAdvanced(agent.id)} />}
      </div>

      <footer className="gp-dock">
        <div className="gp-section-title">⚡ Intervene</div>
        <Miracles store={store} world={store.getLiveState()} selectedId={selectedId} />
        <GodCommand store={store} selectedId={selectedId} llm={llm} compact />
      </footer>
    </div>
  );
}
