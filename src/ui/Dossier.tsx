import { useMemo, useState } from 'react';
import { CONFIG } from '../shared/config';
import type { Agent, TimelineEntry, TimelineKind } from '../shared/types';
import { Sparkline } from './charts/Sparkline';
import { KIND_STYLE, KINDS } from './kinds';

export type DossierTab = 'overview' | 'timeline' | 'memory' | 'comms' | 'actions';
const TABS: { id: DossierTab; label: string }[] = [
  { id: 'overview', label: 'Growth' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'memory', label: 'Memory' },
  { id: 'comms', label: 'Comms' },
  { id: 'actions', label: 'Actions' },
];

const f0 = (n: number) => n.toFixed(0);
const ts = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function Overview({ agent }: { agent: Agent }) {
  const g = agent.growth;
  const s = (k: keyof (typeof g)[number]) => g.map((p) => ({ t: p.t, v: p[k] as number }));
  const b = agent.baseline;
  return (
    <div>
      <h3>Baseline (at birth)</h3>
      <div className="kv">
        {b.controller}{b.controller === 'llm' ? ` / ${b.tier}` : ''} · comm {b.commMode} · traits {b.traits.join(', ') || 'none'}
        <br />
        capacity {b.capacity} · sight ×{b.senseMul} · speed ×{b.speedMul} · poison ×{b.poisonResist} · started energy {b.energy} / water {b.hydration}
      </div>
      <h3>Body (0–100)</h3>
      <div className="grid2">
        <Sparkline title="Energy" points={s('energy')} color="#eb6834" max={100} />
        <Sparkline title="Hydration" points={s('hydration')} color="#2a78d6" max={100} />
        <Sparkline title="Health" points={s('health')} color="#e34948" max={100} />
        <Sparkline title="Stamina" points={s('stamina')} color="#1baf7a" max={100} />
      </div>
      <h3>Knowledge growth</h3>
      <div className="grid2">
        <Sparkline title="Things discovered" points={s('discoveries')} color="#4a3aa7" />
        <Sparkline title="Beliefs held" points={s('beliefs')} color="#4a3aa7" max={CONFIG.maxBeliefs} />
        <Sparkline title="Places remembered" points={s('places')} color="#4a3aa7" max={CONFIG.maxPlaces} />
        <Sparkline title="Messages (sent+heard)" points={s('messages')} color="#1baf7a" />
      </div>
      <h3>Progress</h3>
      <div className="grid2">
        <Sparkline title="Meals eaten" points={s('eaten')} color="#eda100" />
        <Sparkline title="Distance walked" points={s('distance')} color="#2a78d6" unit="u" />
      </div>
      <h3>Milestones ({agent.milestones.length})</h3>
      <div className="biomes">
        {agent.biomesVisited.map((b) => (
          <span key={b} className="chip">{b}</span>
        ))}
      </div>
      <ol className="milestones">
        {[...agent.milestones].reverse().map((m) => (
          <li key={m.at + m.text}>
            <span className="small">{ts(m.at)}</span> ★ {m.text}
          </li>
        ))}
        {!agent.milestones.length && <li className="small">none yet</li>}
      </ol>
    </div>
  );
}

/** Timeline grouped into decision turns; can be frozen so it doesn't scroll away while reading. */
function Timeline({ agent, focusSeq }: { agent: Agent; focusSeq: number | null }) {
  const [on, setOn] = useState<Set<TimelineKind>>(new Set(KINDS));
  const [frozen, setFrozen] = useState<TimelineEntry[] | null>(null);
  const live = agent.timeline;
  const entries = frozen ?? live;
  const newer = frozen ? live.filter((e) => e.seq > (frozen.at(-1)?.seq ?? 0)).length : 0;
  const turns = useMemo(() => {
    const m = new Map<number, TimelineEntry[]>();
    for (const e of entries) {
      if (!on.has(e.kind)) continue;
      if (!m.has(e.turn)) m.set(e.turn, []);
      m.get(e.turn)!.push(e);
    }
    return [...m.entries()].reverse();
  }, [entries, on]);

  return (
    <div>
      <div className="row">
        {KINDS.map((k) => (
          <button
            key={k}
            className={`chip-btn ${on.has(k) ? 'on' : ''}`}
            onClick={() => setOn((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })}
          >
            <span style={{ color: KIND_STYLE[k].color }}>{KIND_STYLE[k].glyph}</span> {KIND_STYLE[k].label}
          </button>
        ))}
      </div>
      <div className="row">
        <button onClick={() => setFrozen(frozen ? null : [...live])}>{frozen ? `▶ Live${newer ? ` (+${newer} new)` : ''}` : '⏸ Freeze'}</button>
        <span className="small">{entries.length} entries · {agent.turn} turns · newest first</span>
      </div>
      <div className="turns">
        {turns.map(([turn, es]) => {
          const head = es.find((e) => e.kind === 'turn');
          return (
            <div key={turn} className="turn">
              <div className="turn-head">
                {turn === 0 ? 'Before first decision' : head ? head.text : `Turn ${turn}`}
                {head && <span className="small"> · {ts(head.at)}</span>}
              </div>
              {es.filter((e) => e.kind !== 'turn').reverse().map((e) => (
                <div key={e.seq} className={`tl ${e.ok ? '' : 'bad'} ${e.seq === focusSeq ? 'focus' : ''}`}>
                  <span className="glyph" style={{ color: KIND_STYLE[e.kind].color }}>{KIND_STYLE[e.kind].glyph}</span>
                  <span className="small">{ts(e.at)}</span> {e.text}
                </div>
              ))}
            </div>
          );
        })}
        {!turns.length && <div className="small">nothing yet</div>}
      </div>
    </div>
  );
}

function Memory({ agent }: { agent: Agent }) {
  const history = agent.timeline.filter((e) => e.kind === 'memory').reverse();
  return (
    <div>
      <p className="small">Self-authored by the agent's controller. Not verified — compare with world truth.</p>
      <h3>Intent</h3>
      <div className="kv">{agent.intent ?? '—'}</div>
      <h3>Notes</h3>
      <div className="kv notes">{agent.memory.notes || '—'}</div>
      <h3>Beliefs ({agent.memory.beliefs.length}/{CONFIG.maxBeliefs})</h3>
      <table className="tbl">
        <tbody>
          {agent.memory.beliefs.map((b) => (
            <tr key={b.appearance}>
              <td>{b.appearance}</td>
              <td><span className={`pill ${b.verdict}`}>{b.verdict === 'harmful' ? '✕ harmful' : b.verdict === 'safe' ? '✓ safe' : '? unknown'}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Places ({agent.memory.places.length}/{CONFIG.maxPlaces})</h3>
      <table className="tbl">
        <tbody>
          {agent.memory.places.map((p) => (
            <tr key={p.label}>
              <td>{p.label}</td>
              <td className="num">({f0(p.x)}, {f0(p.z)})</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Memory changes</h3>
      <div className="turns">
        {history.map((e) => (
          <div key={e.seq} className="tl"><span className="small">{ts(e.at)}</span> {e.text}</div>
        ))}
        {!history.length && <div className="small">no changes yet</div>}
      </div>
    </div>
  );
}

function Comms({ agent }: { agent: Agent }) {
  const msgs = agent.timeline.filter((e) => e.kind === 'said' || e.kind === 'heard').reverse();
  return (
    <div>
      <div className="small">sent {agent.messagesSent} · heard {agent.messagesHeard} · range {CONFIG.commRadius}u · messages expire after {CONFIG.messageTtlSec}s</div>
      <div className="chat">
        {msgs.map((m) => (
          <div key={m.seq} className={`bubble ${m.kind}`}>
            <div className="small">{m.kind === 'said' ? `${agent.id} said` : 'heard'} · {ts(m.at)}{m.kind === 'said' && !m.ok ? ' · nobody in range' : ''}</div>
            {m.text}
          </div>
        ))}
        {!msgs.length && <div className="small">No messages yet. Agents speak only when they choose to; nothing here is simulated chatter.</div>}
      </div>
    </div>
  );
}

function Actions({ agent }: { agent: Agent }) {
  const rows = Object.entries(agent.actionCounts).sort((a, b) => b[1].ok + b[1].fail - (a[1].ok + a[1].fail));
  const max = Math.max(1, ...rows.map(([, c]) => c.ok + c.fail));
  return (
    <div>
      <h3>Now</h3>
      <div className="kv">
        {agent.current ? `▶ ${agent.current.action.type}` : 'idle'}
        {agent.plan.length > 0 && ` → then ${agent.plan.map((p) => p.type).join(' → ')}`}
      </div>
      <h3>All actions (✓ succeeded / ✕ failed)</h3>
      <table className="tbl">
        <tbody>
          {rows.map(([type, c]) => (
            <tr key={type}>
              <td>{type}</td>
              <td className="barcell">
                <i style={{ width: `${(c.ok / max) * 100}%` }} className="okbar" />
                <i style={{ width: `${(c.fail / max) * 100}%` }} className="failbar" />
              </td>
              <td className="num">✓{c.ok} ✕{c.fail}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <div className="small">no actions yet</div>}
    </div>
  );
}

export function Dossier({ agent, tab, setTab, focusSeq }: { agent: Agent; tab: DossierTab; setTab: (t: DossierTab) => void; focusSeq: number | null }) {
  return (
    <div className="dossier">
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Overview agent={agent} />}
      {tab === 'timeline' && <Timeline agent={agent} focusSeq={focusSeq} />}
      {tab === 'memory' && <Memory agent={agent} />}
      {tab === 'comms' && <Comms agent={agent} />}
      {tab === 'actions' && <Actions agent={agent} />}
    </div>
  );
}
