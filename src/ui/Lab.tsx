import { useMemo, useState } from 'react';
import type { CommMode, Utterance, WorldState } from '../shared/types';
import { TRAITS } from '../sim/world';
import { useSim } from '../sim/react';
import { Sparkline } from './charts/Sparkline';

const CONTEXTS = ['food-near', 'water-near', 'harmful-near', 'hazard-near', 'material-near', 'hurt', 'hungry', 'thirsty', 'carrying-food', 'agent-close', 'night', 'storm'];
const STOP = new Set(['the', 'a', 'an', 'is', 'are', 'i', 'you', 'to', 'of', 'and', 'here', 'it', 'this', 'there', 'at', 'in', 'on', 'for', 'with', 'me', 'my', 'we']);

type Response = 'replied' | 'approached' | 'other' | 'no decision';

/** How each hearer reacted: their next decision within 20s of hearing/seeing the act. */
function responses(world: WorldState, u: Utterance): Response[] {
  return u.hearers.map((h) => {
    const agent = world.agents[h];
    const turn = agent?.timeline.find((e) => e.kind === 'turn' && e.at >= u.at && e.at <= u.at + 20);
    if (!turn?.plan) return 'no decision';
    if (turn.plan.some((a) => a.type === 'say' || a.type === 'signal' || a.type === 'gesture')) return 'replied';
    const approached = turn.plan.some(
      (a) => (a.type === 'follow' && a.agentId === u.speaker) || (a.type === 'move' && Math.hypot(a.target.x - u.where.x, a.target.z - u.where.z) < 5),
    );
    return approached ? 'approached' : 'other';
  });
}

function download(world: WorldState) {
  const data = {
    exportedAt: new Date().toISOString(),
    runId: world.runId,
    seed: world.seed,
    experiment: world.experiment,
    simTime: world.time,
    agents: Object.values(world.agents).map((a) => ({
      id: a.id, controller: a.controller.kind, tier: a.controller.tier, status: a.status, baseline: a.baseline,
      stats: a.stats, actionCounts: a.actionCounts, memory: a.memory, milestones: a.milestones, timeline: a.timeline, growth: a.growth,
    })),
    utterances: world.utterances,
    worldHistory: world.history,
    events: world.events,
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  const el = document.createElement('a');
  el.href = url;
  el.download = `play-god-${world.runId}-seed${world.seed}-${world.experiment.commMode}.json`;
  el.click();
  URL.revokeObjectURL(url);
}

export function Lab({ world }: { world: WorldState }) {
  const store = useSim();
  const [mode, setMode] = useState<CommMode>(world.experiment.commMode);
  const [traits, setTraits] = useState(world.experiment.traits);
  const [seed, setSeed] = useState(String(world.seed));
  const us = world.utterances;

  const stats = useMemo(() => {
    const byChannel = new Map<string, { n: number; delivered: number }>();
    for (const u of us) {
      const c = byChannel.get(u.channel) ?? { n: 0, delivered: 0 };
      c.n++;
      if (u.hearers.length) c.delivered++;
      byChannel.set(u.channel, c);
    }
    // Symbol → context table. Proto: per sound; English: per content word.
    const unit = (u: Utterance) =>
      u.channel === 'signal' || u.channel === 'mark' ? u.content.split(/\s+/)
        : u.channel === 'speech' ? u.content.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).slice(0, 6)
          : [u.content.split(' ')[0]];
    const table = new Map<string, { n: number; ctx: Map<string, number>; speakers: Map<string, Map<string, number>> }>();
    const base = new Map<string, number>();
    for (const u of us) {
      for (const c of u.context) base.set(c, (base.get(c) ?? 0) + 1);
      for (const w of new Set(unit(u))) {
        const row = table.get(w) ?? { n: 0, ctx: new Map(), speakers: new Map() };
        row.n++;
        const sp = row.speakers.get(u.speaker) ?? new Map<string, number>();
        for (const c of u.context) {
          row.ctx.set(c, (row.ctx.get(c) ?? 0) + 1);
          sp.set(c, (sp.get(c) ?? 0) + 1);
        }
        row.speakers.set(u.speaker, sp);
        table.set(w, row);
      }
    }
    const rows = [...table.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 14);
    const resp = new Map<string, Record<Response, number>>();
    for (const u of us) {
      if (!u.hearers.length) continue;
      const r = resp.get(u.channel) ?? { replied: 0, approached: 0, other: 0, 'no decision': 0 };
      for (const x of responses(world, u)) r[x]++;
      resp.set(u.channel, r);
    }
    // Per-minute communicative acts over time.
    const perMin: { t: number; v: number }[] = [];
    const end = Math.floor(world.time / 30);
    for (let b = 0; b <= end; b++) perMin.push({ t: b * 30, v: us.filter((u) => Math.floor(u.at / 30) === b).length * 2 });
    const agents = Object.values(world.agents);
    const social = {
      gives: agents.reduce((n, a) => n + (a.actionCounts.give?.ok ?? 0), 0),
      follows: agents.reduce((n, a) => n + (a.actionCounts.follow?.ok ?? 0), 0),
      deposits: agents.reduce((n, a) => n + (a.actionCounts.deposit?.ok ?? 0) + (a.actionCounts.withdraw?.ok ?? 0), 0),
      structures: Object.keys(world.structures).length,
    };
    return { byChannel, rows, base, total: us.length, resp, perMin, social };
  }, [us, us.length, world]);

  const lift = (row: { n: number; ctx: Map<string, number> }, c: string) => {
    const p = (row.ctx.get(c) ?? 0) / row.n;
    const q = (stats.base.get(c) ?? 0) / Math.max(1, stats.total);
    return q > 0 ? p / q : 0;
  };

  return (
    <div>
      <h3>Experiment conditions</h3>
      <div className="row">
        <label className="small">communication</label>
        <select value={mode} onChange={(e) => setMode(e.target.value as CommMode)}>
          <option value="english">English words</option>
          <option value="proto">proto-language (meaningless sounds only)</option>
          <option value="silent">silent (gestures, marks, observation only)</option>
        </select>
      </div>
      <div className="row">
        <label className="small"><input type="checkbox" checked={traits} onChange={(e) => setTraits(e.target.checked)} /> heterogeneous traits</label>
        <label className="small">seed <input className="seed" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ''))} /></label>
        <button
          onClick={() => store.dispatch({ type: 'reset', seed: Number(seed) || world.seed, experiment: { commMode: mode, traits } })}
        >
          ▶ Start new run
        </button>
      </div>
      <div className="kv small">
        running: <b>{world.experiment.commMode}</b> · traits {world.experiment.traits ? 'on' : 'off'} · seed {world.seed}
        {world.experiment.commMode !== 'english' && <> · sound inventory: {world.experiment.lexicon.join(' ')}</>}
        {world.experiment.traits && (
          <>
            <br />
            traits: {Object.entries(TRAITS).map(([k, t]) => `${t.label} (${t.effect})`).join(' · ')}
          </>
        )}
      </div>
      <p className="small">
        Same model + same prompt for every agent means shared priors (Schelling points) can look like convention. Compare repeated runs and conditions before
        calling anything emergent. Contexts below are the speaker's actual situation (world truth), never shown to agents.
      </p>

      <h3>Communicative acts</h3>
      <div className="grid2">
        <Sparkline title="Acts per minute" points={stats.perMin} color="#1baf7a" />
        <div className="kv">
          {[...stats.byChannel.entries()].map(([c, v]) => (
            <div key={c}>{c}: {v.n} ({v.delivered} reached someone)</div>
          ))}
          {!stats.total && <div className="small">none yet</div>}
          <div className="small">gives {stats.social.gives} · follows {stats.social.follows} · cache use {stats.social.deposits} · structures {stats.social.structures}</div>
        </div>
      </div>

      <h3>Symbol × situation ({world.experiment.commMode === 'english' ? 'content words' : 'sounds & marks'})</h3>
      <p className="small">Cell = times the symbol was used in that situation. Shaded when used there ≥1.5× more than the base rate (n ≥ 3).</p>
      <div className="matrix-wrap">
        <table className="matrix">
          <thead>
            <tr>
              <th>symbol</th>
              <th>n</th>
              <th>users</th>
              {CONTEXTS.map((c) => <th key={c} title={c}><span>{c}</span></th>)}
            </tr>
          </thead>
          <tbody>
            {stats.rows.map(([w, row]) => (
              <tr key={w}>
                <td className="sym">{w}</td>
                <td className="num">{row.n}</td>
                <td className="num">{row.speakers.size}</td>
                {CONTEXTS.map((c) => {
                  const n = row.ctx.get(c) ?? 0;
                  const l = lift(row, c);
                  const strong = row.n >= 3 && l >= 1.5 && n >= 2;
                  return (
                    <td key={c} className={`cell ${strong ? 'hot' : ''}`} style={strong ? { background: `rgba(42,120,214,${Math.min(0.85, 0.2 + (l - 1.5) * 0.25)})` } : undefined} title={`${w} in ${c}: ${n} (lift ${l.toFixed(1)}×)`}>
                      {n || ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {!stats.rows.length && <div className="small">no symbols used yet</div>}
      </div>

      <h3>How listeners responded (next decision within 20s)</h3>
      <table className="tbl">
        <tbody>
          {[...stats.resp.entries()].map(([c, r]) => {
            const n = Object.values(r).reduce((a, b) => a + b, 0) || 1;
            return (
              <tr key={c}>
                <td>{c}</td>
                <td className="num">replied {Math.round((r.replied / n) * 100)}%</td>
                <td className="num">approached {Math.round((r.approached / n) * 100)}%</td>
                <td className="num">other {Math.round((r.other / n) * 100)}%</td>
                <td className="num">no decision {Math.round((r['no decision'] / n) * 100)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!stats.resp.size && <div className="small">no deliveries yet</div>}

      <div className="row">
        <button onClick={() => download(world)}>⬇ Export run (JSON)</button>
        <span className="small">timelines, utterances + contexts, growth, memory, events</span>
      </div>
    </div>
  );
}
