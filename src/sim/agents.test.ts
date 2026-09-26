import { describe, expect, it } from 'vitest';
import { mergeMemory } from '../../server/anthropic';
import { scriptedDecide } from '../controllers/scripted';
import { CONFIG } from '../shared/config';
import type { Action, SimCommand, WorldState } from '../shared/types';
import { dist } from './geometry';
import { observe } from './observe';
import { clearLine, planPath } from './path';
import { mulberry32 } from './rng';
import { applyCommand, stepWorld } from './step';
import { addNode, createInitialWorld } from './world';

const rng = mulberry32(99);
let n = 1;
const apply = (s: WorldState, c: SimCommand) => applyCommand(s, c, rng, () => `run-a${++n}`);
const run = (s: WorldState, seconds: number) => {
  for (let i = 0; i < seconds * 20; i++) stepWorld(s, 0.05, rng);
};

function blank(): WorldState {
  const s = createInitialWorld('r', 'scripted');
  s.resources = {};
  s.hazards = {};
  s.obstacles = {};
  s.agents.a1.position = { x: 0, z: 0 };
  s.time = 10;
  return s;
}
function plan(s: WorldState, actions: Action[], id = 'a1') {
  const seq = s.agents[id].controller.requestSeq + 1;
  apply(s, { type: 'decisionStarted', agentId: id, runId: s.runId, seq, observation: observe(s, id) });
  apply(s, { type: 'decisionResult', agentId: id, runId: s.runId, seq, decision: { plan: actions }, latencyMs: 1 });
}

describe('path planning', () => {
  it('walks around a long cliff instead of giving up', () => {
    const s = blank();
    s.obstacles.o1 = { id: 'o1', shape: 'cliff', position: { x: 5, z: 0 }, radius: 0.9, halfLength: 7, angle: Math.PI / 2, height: 4, solid: true };
    expect(clearLine(s, { x: 0, z: 0 }, { x: 10, z: 0 })).toBe(false);
    const route = planPath(s, { x: 0, z: 0 }, { x: 10, z: 0 });
    expect(route?.length).toBeGreaterThan(1);
    plan(s, [{ type: 'move', target: { x: 10, z: 0 } }]);
    run(s, 25);
    expect(dist(s.agents.a1.position, { x: 10, z: 0 })).toBeLessThan(0.5);
    expect(s.agents.a1.recentOutcomes.some((o) => !o.ok)).toBe(false);
  });

  it('routes around a hazard patch when a detour exists', () => {
    const s = blank();
    s.hazards.h1 = { id: 'h1', kind: 'thorns', position: { x: 5, z: 0 }, radius: 2 };
    plan(s, [{ type: 'move', target: { x: 10, z: 0 } }]);
    run(s, 12);
    expect(dist(s.agents.a1.position, { x: 10, z: 0 })).toBeLessThan(0.5);
    expect(s.agents.a1.stats.damageTaken).toBe(0);
  });

  it('reports blocked for an enclosed target instead of walking forever', () => {
    const s = blank();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      s.obstacles[`o${i}`] = { id: `o${i}`, shape: 'rock', position: { x: 10 + Math.cos(a) * 3, z: Math.sin(a) * 3 }, radius: 1, height: 1, solid: true };
    }
    plan(s, [{ type: 'move', target: { x: 10, z: 0 } }]);
    run(s, 30);
    expect(s.agents.a1.recentOutcomes.at(-1)?.ok).toBe(false);
  });
});

describe('agent actions and decisions', () => {
  it('refuses to rest inside a hazard', () => {
    const s = blank();
    s.hazards.h1 = { id: 'h1', kind: 'leeches', position: { x: 0, z: 0 }, radius: 3 };
    plan(s, [{ type: 'rest' }]);
    run(s, 0.2);
    expect(s.agents.a1.recentOutcomes.some((o) => /cannot rest here/.test(o.detail))).toBe(true);
    expect(s.agents.a1.status).not.toBe('resting');
  });

  it('wait lasts its duration', () => {
    const s = blank();
    plan(s, [{ type: 'wait', seconds: 2 }]);
    run(s, 1);
    expect(s.agents.a1.current?.action.type).toBe('wait');
    run(s, 1.2);
    expect(s.agents.a1.current).toBeNull();
  });

  it('keeps a running action when the new plan starts with it', () => {
    const s = blank();
    plan(s, [{ type: 'move', target: { x: 12, z: 0 } }]);
    run(s, 1);
    const started = s.agents.a1.current?.startedAt;
    plan(s, [{ type: 'move', target: { x: 12, z: 0 } }, { type: 'wait' }]);
    expect(s.agents.a1.current?.startedAt).toBe(started);
    expect(s.agents.a1.plan).toEqual([{ type: 'wait' }]);
  });

  it('a message during a pending decision does not force a second decision; being hurt does', () => {
    const s = blank();
    const a = s.agents.a1;
    const seq = a.controller.requestSeq + 1;
    apply(s, { type: 'decisionStarted', agentId: 'a1', runId: s.runId, seq, observation: observe(s, 'a1') });
    a.controller.needsDecision = true;
    a.controller.interruptReason = 'message from a2';
    apply(s, { type: 'decisionResult', agentId: 'a1', runId: s.runId, seq, decision: { plan: [{ type: 'wait' }] }, latencyMs: 1 });
    expect(a.controller.needsDecision).toBe(false);
    const seq2 = a.controller.requestSeq + 1;
    apply(s, { type: 'decisionStarted', agentId: 'a1', runId: s.runId, seq: seq2, observation: observe(s, 'a1') });
    a.controller.needsDecision = true;
    a.controller.interruptReason = 'hurt by thorns';
    apply(s, { type: 'decisionResult', agentId: 'a1', runId: s.runId, seq: seq2, decision: { plan: [{ type: 'wait' }] }, latencyMs: 1 });
    expect(a.controller.needsDecision).toBe(true);
  });

  it('rejects a result whose request never started (controller switch race)', () => {
    const s = blank();
    const a = s.agents.a1;
    const seq = a.controller.requestSeq + 1;
    apply(s, { type: 'setController', agentId: 'a1', controller: 'scripted' }); // bumps requestSeq to seq
    apply(s, { type: 'decisionStarted', agentId: 'a1', runId: s.runId, seq, observation: observe(s, 'a1') }); // rejected: seq <= requestSeq
    apply(s, { type: 'decisionResult', agentId: 'a1', runId: s.runId, seq, decision: { plan: [{ type: 'move', target: { x: 5, z: 5 } }] }, latencyMs: 1 });
    expect(a.plan).toEqual([]);
    expect(a.current).toBeNull();
  });

  it('dead agents do not block movement', () => {
    const s = blank();
    apply(s, { type: 'spawnAgents', count: 1, controller: 'scripted' });
    const b = Object.values(s.agents).find((x) => x.id !== 'a1')!;
    b.position = { x: 3, z: 0 };
    b.status = 'dead';
    plan(s, [{ type: 'move', target: { x: 6, z: 0 } }]);
    run(s, 4);
    expect(dist(s.agents.a1.position, { x: 6, z: 0 })).toBeLessThan(0.5);
  });

  it('observation tells the agent why it is asked and how old outcomes are', () => {
    const s = blank();
    plan(s, [{ type: 'wait', seconds: 0 }]);
    run(s, 3);
    const o = observe(s, 'a1');
    expect(o.self.trigger).toBe('plan complete');
    expect(o.recentOutcomes.at(-1)?.secondsAgo).toBeGreaterThanOrEqual(2);
  });
});

describe('scripted baseline', () => {
  it('remembers water it has seen and walks back to it when thirsty', () => {
    const s = blank();
    addNode(s, 'fresh_water', { x: 4, z: 0 });
    const first = scriptedDecide(observe(s, 'a1'), rng);
    expect(first.memory?.places.some((p) => p.label === 'water')).toBe(true);
    s.agents.a1.memory = first.memory!;
    s.agents.a1.position = { x: -30, z: 0 };
    s.agents.a1.hydration = 30;
    const d = scriptedDecide(observe(s, 'a1'), rng, s.agents.a1.memory);
    expect(d.plan[0]).toMatchObject({ type: 'move', target: { x: 4, z: 0 } });
  });

  it('steps out of a hazard before anything else', () => {
    const s = blank();
    s.hazards.h1 = { id: 'h1', kind: 'thorns', position: { x: 0.5, z: 0 }, radius: 2 };
    const d = scriptedDecide(observe(s, 'a1'), rng);
    expect(d.plan[0].type).toBe('move');
    const t = (d.plan[0] as { target: { x: number; z: number } }).target;
    expect(Math.hypot(t.x - 0.5, t.z)).toBeGreaterThan(2);
  });
});

describe('LLM memory merge (server)', () => {
  it('keeps places and notes the model omitted, and updates changed beliefs', () => {
    const prev = { notes: 'old', places: [{ label: 'water', x: 1, z: 2 }], beliefs: [{ appearance: 'red mushrooms', verdict: 'unknown' as const }] };
    const m = mergeMemory(prev, { notes: '', places: [{ label: 'berries', x: 5, z: 5 }], beliefs: [{ appearance: 'red mushrooms', verdict: 'harmful' }] });
    expect(m.notes).toBe('old');
    expect(m.places.map((p) => p.label)).toEqual(['water', 'berries']);
    expect(m.beliefs).toEqual([{ appearance: 'red mushrooms', verdict: 'harmful' }]);
    const many = mergeMemory(prev, { notes: 'x', places: Array.from({ length: 20 }, (_, i) => ({ label: `p${i}`, x: i, z: i })), beliefs: [] });
    expect(many.places.length).toBe(CONFIG.maxPlaces);
  });
});
