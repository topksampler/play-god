import type { HealthResponse } from '../shared/schemas';
import { CONFIG } from '../shared/config';
import type { ControllerKind } from '../shared/types';
import { useSim, useWorld } from '../sim/react';

const f1 = (n: number) => n.toFixed(1);

export function Panel({ health, selectedId }: { health: HealthResponse | null; selectedId: string | null }) {
  const store = useSim();
  const world = useWorld();
  const count = Object.keys(world.agents).length;
  const agent = selectedId ? world.agents[selectedId] : undefined;
  const obs = agent?.controller.lastObservation;
  const kinds: ControllerKind[] = health?.llmConfigured ? ['llm', 'scripted'] : ['scripted'];

  return (
    <div className="panel">
      <h1>Let's Play God</h1>
      <div className={`status ${health?.llmConfigured ? 'ok' : 'warn'}`}>
        {health ? health.detail : 'checking server…'}
        {!health?.llmConfigured && <div className="small">LLM unavailable — agents run the labelled SCRIPTED baseline.</div>}
      </div>

      <div className="row">
        {world.paused ? (
          <button onClick={() => store.dispatch({ type: 'resume' })}>Resume</button>
        ) : (
          <button onClick={() => store.dispatch({ type: 'pause' })}>Pause</button>
        )}
        <button onClick={() => store.dispatch({ type: 'reset' })}>Reset</button>
        <span className="small">
          {world.runId} · t={f1(world.time)}s
        </span>
      </div>

      <div className="row">
        <select
          value={world.defaultController}
          onChange={(e) => store.dispatch({ type: 'setDefaultController', controller: e.target.value as ControllerKind })}
        >
          {kinds.map((k) => (
            <option key={k} value={k}>
              new: {k}
            </option>
          ))}
        </select>
        {[1, 3].map((n) => (
          <button
            key={n}
            disabled={count >= CONFIG.maxAgents}
            onClick={() => store.dispatch({ type: 'spawnAgents', count: n, controller: world.defaultController })}
          >
            Spawn {n}
          </button>
        ))}
        <span className="small">
          {count}/{CONFIG.maxAgents}
        </span>
      </div>

      {!agent && <p className="small">Click an agent to inspect it.</p>}
      {agent && (
        <div className="inspector">
          <h2 style={{ color: agent.color }}>{agent.id}</h2>
          <h3>World truth</h3>
          <div className="kv">
            pos ({f1(agent.position.x)}, {f1(agent.position.z)}) · energy {f1(agent.energy)} · carrying {agent.inventory}/
            {CONFIG.inventoryCapacity} · {agent.status}
            <br />
            target {agent.target ? `(${f1(agent.target.x)}, ${f1(agent.target.z)})` : 'none'} · eaten {agent.stats.eaten} · dist{' '}
            {f1(agent.stats.distance)}
          </div>
          <h3>Controller</h3>
          <div className="kv">
            <select
              value={agent.controller.kind}
              onChange={(e) =>
                store.dispatch({ type: 'setController', agentId: agent.id, controller: e.target.value as ControllerKind })
              }
            >
              {[...new Set<ControllerKind>([...kinds, agent.controller.kind])].map((k) => (
                <option key={k} value={k}>
                  {k === 'scripted' ? 'scripted (baseline)' : k}
                </option>
              ))}
            </select>{' '}
            {agent.controller.pending ? 'decision pending…' : 'idle'} · req #{agent.controller.requestSeq}
            <br />
            last action: {agent.controller.lastAction ? JSON.stringify(agent.controller.lastAction) : '—'}
            {agent.controller.lastError && <div className="err">error: {agent.controller.lastError}</div>}
          </div>
          <h3>Last observation (what it was shown)</h3>
          <div className="kv">
            {obs ? (
              <>
                food: {obs.visibleFood.map((f) => `${f.id}×${f.units}`).join(', ') || 'none'}
                <br />
                agents: {obs.visibleAgents.map((a) => a.id).join(', ') || 'none'} · obstacles:{' '}
                {obs.visibleObstacles.map((o) => o.id).join(', ') || 'none'}
                <br />
                inbox: {obs.messages.length} · outcomes: {obs.recentOutcomes.map((o) => `${o.actionType}${o.ok ? '✓' : '✗'}`).join(' ') || '—'}
              </>
            ) : (
              'none yet'
            )}
          </div>
          <h3>Agent-declared (unverified)</h3>
          <div className="kv">
            intent: {agent.intent ?? '—'}
            <br />
            memory: {agent.memory || '—'}
          </div>
          {agent.inbox.length > 0 && (
            <>
              <h3>Inbox</h3>
              <div className="kv">
                {agent.inbox.map((m) => (
                  <div key={m.id}>
                    {m.senderId} @{f1(m.sentAt)}: {m.text}
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
