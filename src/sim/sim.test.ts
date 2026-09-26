import { describe, expect, it } from 'vitest';
import { scriptedDecide } from '../controllers/scripted';
import { startScheduler } from '../controllers/scheduler';
import { CONFIG } from '../shared/config';
import type { Controller, Decision, WorldState } from '../shared/types';
import { observe } from './observe';
import { applyCommand, stepWorld } from './step';
import { createSimStore } from './store';
import { createInitialWorld } from './world';

let seed = 42;
const rng = () => {
  // mulberry32
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
let runN = 1;
const next = () => `run-t${++runN}`;
const apply = (s: WorldState, c: Parameters<typeof applyCommand>[1]) => applyCommand(s, c, rng, next);

function decide(s: WorldState, agentId: string, decision: Decision) {
  const seq = s.agents[agentId].controller.requestSeq + 1;
  apply(s, { type: 'decisionStarted', agentId, runId: s.runId, seq, observation: observe(s, agentId) });
  return apply(s, { type: 'decisionResult', agentId, runId: s.runId, seq, decision });
}

describe('food rules', () => {
  it('cannot collect the last unit twice', () => {
    const s = createInitialWorld('r', 'scripted');
    s.food.f1.units = 1;
    apply(s, { type: 'spawnAgents', count: 1, controller: 'scripted' });
    const [a, b] = Object.keys(s.agents);
    s.agents[a].position = { x: 4, z: -2 };
    s.agents[b].position = { x: 4, z: -4 };
    decide(s, a, { action: { type: 'take', foodId: 'f1' } });
    decide(s, b, { action: { type: 'take', foodId: 'f1' } });
    expect(s.agents[a].inventory + s.agents[b].inventory).toBe(1);
    expect(s.food.f1).toBeUndefined();
    expect(s.agents[b].recentOutcomes.at(-1)?.ok).toBe(false);
  });

  it('rejects out-of-range and guessed IDs', () => {
    const s = createInitialWorld('r', 'scripted');
    const a = 'a1';
    decide(s, a, { action: { type: 'take', foodId: 'f3' } }); // far away
    decide(s, a, { action: { type: 'take', foodId: 'nope' } });
    expect(s.agents[a].inventory).toBe(0);
    expect(s.food.f3.units).toBe(5);
  });

  it('eat restores energy, clamped to max', () => {
    const s = createInitialWorld('r', 'scripted');
    const a = s.agents.a1;
    a.position = { x: 4, z: -3 };
    a.energy = 90;
    decide(s, 'a1', { action: { type: 'take', foodId: 'f1' } });
    decide(s, 'a1', { action: { type: 'eat' } });
    expect(a.energy).toBe(CONFIG.maxEnergy);
    expect(a.inventory).toBe(0);
    decide(s, 'a1', { action: { type: 'eat' } });
    expect(a.recentOutcomes.at(-1)).toMatchObject({ actionType: 'eat', ok: false });
  });

  it('energy never goes negative; agent becomes exhausted', () => {
    const s = createInitialWorld('r', 'scripted');
    s.agents.a1.energy = 0.01;
    for (let i = 0; i < 10; i++) stepWorld(s, 0.05);
    expect(s.agents.a1.energy).toBe(0);
    expect(s.agents.a1.status).toBe('exhausted');
  });
});

describe('movement', () => {
  it('stays in bounds and out of obstacles', () => {
    const s = createInitialWorld('r', 'scripted');
    decide(s, 'a1', { action: { type: 'move', target: { x: 0, z: 4 } } }); // obstacle o1 center
    for (let i = 0; i < 200; i++) stepWorld(s, 0.05);
    const p = s.agents.a1.position;
    expect(Math.hypot(p.x - 0, p.z - 4)).toBeGreaterThanOrEqual(1.5 + CONFIG.agentRadius - 1e-6);
    decide(s, 'a1', { action: { type: 'move', target: { x: 999, z: -999 } } });
    for (let i = 0; i < 600; i++) stepWorld(s, 0.05);
    expect(s.agents.a1.position.x).toBeLessThanOrEqual(15);
    expect(s.agents.a1.position.z).toBeGreaterThanOrEqual(-15);
  });

  it('scripted controller reaches, takes and eats food (labelled baseline)', () => {
    const s = createInitialWorld('r', 'scripted');
    s.agents.a1.energy = 50;
    for (let t = 0; t < 40; t++) {
      decide(s, 'a1', scriptedDecide(observe(s, 'a1'), rng));
      for (let i = 0; i < 20; i++) stepWorld(s, 0.05);
      if (s.agents.a1.stats.eaten > 0) break;
    }
    expect(s.agents.a1.stats.eaten).toBeGreaterThan(0);
    expect(s.food.f1.units).toBeLessThan(5);
  });
});

describe('agent isolation and staleness', () => {
  it('spawned agents have independent state and cap at max', () => {
    const s = createInitialWorld('r', 'scripted');
    apply(s, { type: 'spawnAgents', count: 10, controller: 'scripted' });
    const agents = Object.values(s.agents);
    expect(agents.length).toBe(CONFIG.maxAgents);
    expect(new Set(agents.map((a) => a.id)).size).toBe(agents.length);
    agents[0].inbox.push({ id: 'x', senderId: 'z', text: 'hi', sentAt: 0 });
    agents[0].memory = 'secret';
    expect(agents[1].inbox.length).toBe(0);
    expect(agents[1].memory).toBe('');
    expect(agents[0].controller).not.toBe(agents[1].controller);
  });

  it('rejects results from old runs and superseded requests', () => {
    const s = createInitialWorld('r', 'scripted');
    apply(s, { type: 'decisionStarted', agentId: 'a1', runId: 'r', seq: 1, observation: observe(s, 'a1') });
    const s2 = apply(s, { type: 'reset' });
    apply(s2, { type: 'decisionResult', agentId: 'a1', runId: 'r', seq: 1, decision: { action: { type: 'move', target: { x: 5, z: 5 } } } });
    expect(s2.agents.a1.target).toBeNull();

    const s3 = createInitialWorld('q', 'scripted');
    apply(s3, { type: 'decisionStarted', agentId: 'a1', runId: 'q', seq: 1, observation: observe(s3, 'a1') });
    apply(s3, { type: 'pause' });
    apply(s3, { type: 'decisionResult', agentId: 'a1', runId: 'q', seq: 1, decision: { action: { type: 'move', target: { x: 5, z: 5 } } } });
    expect(s3.agents.a1.target).toBeNull();
  });
});

describe('messaging', () => {
  it('delivers only within comm radius and expires by TTL', () => {
    const s = createInitialWorld('r', 'scripted');
    apply(s, { type: 'spawnAgents', count: 2, controller: 'scripted' });
    const [a, b, c] = Object.keys(s.agents);
    s.agents[a].position = { x: 0, z: -10 };
    s.agents[b].position = { x: 3, z: -10 };
    s.agents[c].position = { x: 12, z: -10 };
    decide(s, a, { action: { type: 'say', text: 'food at f1' } });
    expect(s.agents[b].inbox.length).toBe(1);
    expect(s.agents[c].inbox.length).toBe(0);
    for (let i = 0; i < (CONFIG.messageTtlSec + 1) * 20; i++) stepWorld(s, 0.05);
    expect(s.agents[b].inbox.length).toBe(0);
  });
});

describe('scheduler', () => {
  it('reset during an in-flight request discards the stale response', async () => {
    const store = createSimStore({ rng });
    let release!: (d: Decision) => void;
    const slow: Controller = {
      kind: 'llm',
      decide: () => new Promise<Decision>((r) => (release = r)),
    };
    const stop = startScheduler(store, { resolve: () => slow, pollMs: 5 });
    for (let i = 0; i < 10 && !release; i++) {
      store.tick(0.5);
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(release).toBeTypeOf('function');
    store.dispatch({ type: 'reset' });
    store.tick(0.05);
    release({ action: { type: 'move', target: { x: 10, z: 10 } } });
    await new Promise((r) => setTimeout(r, 10));
    store.tick(0.05);
    expect(store.getState().agents.a1.target).toBeNull();
    stop();
  });

  it('timeout-free API failure yields visible error and wait, without throwing', async () => {
    const store = createSimStore({ rng });
    const failing: Controller = { kind: 'llm', decide: async () => { throw new Error('boom'); } };
    const stop = startScheduler(store, { resolve: () => failing, pollMs: 5 });
    for (let i = 0; i < 20 && !store.getState().agents.a1.controller.lastError; i++) {
      store.tick(0.5);
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(store.getState().agents.a1.controller.lastError).toBe('boom');
    expect(store.getState().agents.a1.controller.lastAction).toEqual({ type: 'wait' });
    stop();
  });
});
