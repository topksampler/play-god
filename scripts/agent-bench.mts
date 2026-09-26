// Headless survival benchmark for plan-based agents, using the real simulator and scheduler gating.
// Usage: npx tsx scripts/agent-bench.mts [seeds=1,2,3,4,5] [seconds=300] [agents=5] [latencySec=0]
// latencySec > 0 marks agents as LLM and delays each scripted decision to emulate model latency.
import { decisionDue } from '../src/controllers/scheduler';
import { scriptedDecide } from '../src/controllers/scripted';
import { CONFIG } from '../src/shared/config';
import type { SimCommand, WorldState } from '../src/shared/types';
import { dist } from '../src/sim/geometry';
import { observe } from '../src/sim/observe';
import { mulberry32 } from '../src/sim/rng';
import { applyCommand, stepWorld } from '../src/sim/step';
import { createInitialWorld } from '../src/sim/world';

const seeds = (process.argv[2] ?? '1,2,3,4,5').split(',').map(Number);
const SECONDS = Number(process.argv[3] ?? 300);
const N = Number(process.argv[4] ?? 5);
const LAT = Number(process.argv[5] ?? 0);
const dt = 1 / CONFIG.tickHz;
const t: Record<string, number> = {};
const add = (k: string, v: number) => (t[k] = (t[k] ?? 0) + v);
const fails: Record<string, number> = {};

for (const seed of seeds) {
  const rng = mulberry32(seed * 7919);
  let run = 1;
  let s: WorldState = createInitialWorld('run-1', 'scripted', { seed });
  const apply = (c: SimCommand) => (s = applyCommand(s, c, rng, () => `run-${++run}`));
  apply({ type: 'spawnAgents', count: N - 1, controller: 'scripted' });
  if (LAT > 0) for (const id of Object.keys(s.agents)) apply({ type: 'setController', agentId: id, controller: 'llm', tier: 'fast' });
  const delayed: { at: number; cmd: SimCommand }[] = [];
  const idle: Record<string, number> = {};
  const alive: Record<string, number> = {};
  let lastEvent = s.eventSeq;
  for (let tick = 0; tick < SECONDS * CONFIG.tickHz; tick++) {
    for (let i = delayed.length - 1; i >= 0; i--) if (delayed[i].at <= s.time) apply(delayed.splice(i, 1)[0].cmd);
    if (tick % 3 === 0) {
      let inflight = delayed.length;
      for (const a of Object.values(s.agents)) {
        if (inflight >= CONFIG.maxConcurrentDecisions) break;
        if (delayed.some((d) => (d.cmd as { agentId?: string }).agentId === a.id)) continue;
        if (!decisionDue(s, a)) continue;
        const seq = a.controller.requestSeq + 1;
        const obs = observe(s, a.id);
        apply({ type: 'decisionStarted', agentId: a.id, runId: s.runId, seq, observation: obs });
        const cmd: SimCommand = { type: 'decisionResult', agentId: a.id, runId: s.runId, seq, decision: scriptedDecide(obs, rng, a.memory), latencyMs: LAT * 1000 };
        if (LAT > 0) {
          delayed.push({ at: s.time + LAT, cmd });
          inflight++;
        } else apply(cmd);
      }
    }
    stepWorld(s, dt, rng);
    for (const a of Object.values(s.agents)) {
      if (a.status === 'dead') continue;
      alive[a.id] = (alive[a.id] ?? 0) + dt;
      if (!a.current && a.plan.length === 0) idle[a.id] = (idle[a.id] ?? 0) + dt;
      if (Object.values(s.hazards).some((h) => dist(h.position, a.position) < h.radius)) add('hazardTime', dt);
    }
    for (const e of s.events) {
      if (e.seq <= lastEvent) continue;
      if (e.kind === 'action' && !e.ok) {
        const k = e.text.replace(/^a\d+ /, '').replace(/[\d.\-]+/g, '#').replace(/r#|i#|h#/g, 'id');
        fails[k] = (fails[k] ?? 0) + 1;
      }
    }
    lastEvent = s.eventSeq;
  }
  const agents = Object.values(s.agents);
  for (const a of agents) {
    add('agents', 1);
    add('dead', a.status === 'dead' ? 1 : 0);
    add('lifetime', alive[a.id] ?? 0);
    add('idle', idle[a.id] ?? 0);
    add('eaten', a.stats.eaten);
    add('drank', a.stats.drank);
    add('damage', a.stats.damageTaken);
  }
  console.log(`seed ${seed}: dead ${agents.filter((a) => a.status === 'dead').length}/${N}, eaten ${agents.map((a) => a.stats.eaten).join(',')}, drank ${agents.map((a) => a.stats.drank).join(',')}`);
}
const A = t.agents;
console.log(`\n=== ${seeds.length} seeds x ${SECONDS}s x ${N} agents, latency ${LAT}s ===`);
console.log(`deaths ${t.dead}/${A} (${((100 * t.dead) / A).toFixed(0)}%), avg lifetime ${(t.lifetime / A).toFixed(0)}s`);
console.log(`eaten/agent ${(t.eaten / A).toFixed(1)}, drinks/agent ${(t.drank / A).toFixed(1)}, damage/agent ${(t.damage / A).toFixed(0)}`);
console.log(`idle ${((100 * t.idle) / t.lifetime).toFixed(1)}%, in hazards ${((100 * (t.hazardTime ?? 0)) / t.lifetime).toFixed(1)}%`);
console.log('top failures:');
for (const [k, v] of Object.entries(fails).sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${v}  ${k}`);
