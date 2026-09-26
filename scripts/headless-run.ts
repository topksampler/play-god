/**
 * Headless simulation with SCRIPTED agents (no LLM, no browser) — fast checks and calibration runs.
 * Usage: npx tsx scripts/headless-run.ts [--agents 8] [--secs 300] [--seed 1337] [--comm english|proto|silent] [--food normal] [--out run.json]
 */
import { writeFileSync } from 'node:fs';
import { scriptedDecide } from '../src/controllers/scripted';
import type { CommMode, WorldState } from '../src/shared/types';
import { observe } from '../src/sim/observe';
import { mulberry32 } from '../src/sim/rng';
import { applyCommand, stepWorld } from '../src/sim/step';
import { createInitialWorld } from '../src/sim/world';

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const agents = Number(arg('agents', '8'));
const secs = Number(arg('secs', '300'));
const seed = Number(arg('seed', '1337'));
const comm = arg('comm', 'english') as CommMode;
const food = arg('food', 'normal') as WorldState['experiment']['scarcity'];
const rng = mulberry32(seed + 1);

let s = createInitialWorld('headless', 'scripted', { seed, experiment: { commMode: comm, scarcity: food } });
s = applyCommand(s, { type: 'spawnAgents', count: agents - 1, controller: 'scripted' }, rng, () => 'x');
const dt = 0.05;
const t0 = performance.now();
for (let i = 0; i < secs / dt; i++) {
  for (const a of Object.values(s.agents)) {
    const c = a.controller;
    const since = s.time - (c.lastDecisionAt ?? -Infinity);
    if (a.status === 'dead' || since < 1.5) continue;
    if (!(c.needsDecision || (!a.current && !a.plan.length) || since >= 12)) continue;
    const seq = c.requestSeq + 1;
    const observation = observe(s, a.id);
    applyCommand(s, { type: 'decisionStarted', agentId: a.id, runId: s.runId, seq, observation }, rng, () => 'x');
    applyCommand(s, { type: 'decisionResult', agentId: a.id, runId: s.runId, seq, decision: scriptedDecide(observation, rng), latencyMs: 0 }, rng, () => 'x');
  }
  stepWorld(s, dt, rng);
}
const wall = performance.now() - t0;
const A = Object.values(s.agents);
const fails: Record<string, number> = {};
let ok = 0, bad = 0;
for (const a of A) {
  for (const [k, v] of Object.entries(a.actionCounts)) { ok += v!.ok; bad += v!.fail; }
  for (const e of a.timeline) if (e.kind === 'action' && !e.ok) {
    const k = e.text.replace(/[rigak]\d+|\(.*?\)|\d+(\.\d+)?/g, '#').slice(0, 60);
    fails[k] = (fails[k] ?? 0) + 1;
  }
}
console.log(`seed ${seed} · comm ${comm} · food ${food} · ${agents} scripted agents · ${secs} sim-s in ${(wall / 1000).toFixed(1)}s wall`);
console.log(`alive ${A.filter((a) => a.status !== 'dead').length}/${A.length} · meals ${A.reduce((n, a) => n + a.stats.eaten, 0)} · drinks ${A.reduce((n, a) => n + a.stats.drank, 0)} · poisonings ${A.reduce((n, a) => n + a.stats.poisonings, 0)} · utterances ${s.utterances.length}`);
console.log(`actions ok ${ok} failed ${bad} (${((bad / Math.max(1, ok + bad)) * 100).toFixed(1)}%)`);
for (const [k, v] of Object.entries(fails).sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(String(v).padStart(5), k);
const out = arg('out', '');
if (out) writeFileSync(out, JSON.stringify({ runId: s.runId, seed, experiment: s.experiment, simTime: s.time, agents: A, utterances: s.utterances }, null, 1));
