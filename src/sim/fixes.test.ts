import { describe, expect, it } from 'vitest';
import type { Action, SimCommand, WorldState } from '../shared/types';
import { dist } from './geometry';
import { observe } from './observe';
import { mulberry32 } from './rng';
import { applyCommand, stepWorld } from './step';
import { createInitialWorld } from './world';

const rng = mulberry32(99);
let n = 1;
const apply = (s: WorldState, c: SimCommand) => applyCommand(s, c, rng, () => `run-x${++n}`);
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

describe('decision handling fixes', () => {
  it('rejects a result whose request never started (controller-switch race)', () => {
    const s = blank();
    const a = s.agents.a1;
    const seq = a.controller.requestSeq + 1;
    apply(s, { type: 'setController', agentId: 'a1', controller: 'scripted' }); // bumps requestSeq to seq
    apply(s, { type: 'decisionStarted', agentId: 'a1', runId: s.runId, seq, observation: observe(s, 'a1') }); // rejected
    apply(s, { type: 'decisionResult', agentId: 'a1', runId: s.runId, seq, decision: { plan: [{ type: 'move', target: { x: 5, z: 5 } }] }, latencyMs: 1 });
    expect(a.plan).toEqual([]);
    expect(a.current).toBeNull();
  });

  it('a message during a pending decision does not force another decision; being hurt does', () => {
    const s = blank();
    const a = s.agents.a1;
    for (const [reason, expected] of [['message from a2', false], ['hurt by thorns', true]] as const) {
      const seq = a.controller.requestSeq + 1;
      apply(s, { type: 'decisionStarted', agentId: 'a1', runId: s.runId, seq, observation: observe(s, 'a1') });
      a.controller.needsDecision = true;
      a.controller.interruptReason = reason;
      apply(s, { type: 'decisionResult', agentId: 'a1', runId: s.runId, seq, decision: { plan: [{ type: 'wait' }] }, latencyMs: 1 });
      expect(a.controller.needsDecision).toBe(expected);
    }
  });

  it('keeps a running action when the new plan starts with it', () => {
    const s = blank();
    plan(s, [{ type: 'move', target: { x: 12, z: 0 } }]);
    run(s, 1);
    const started = s.agents.a1.current?.startedAt;
    plan(s, [{ type: 'move', target: { x: 12, z: 0 } }, { type: 'rest' }]);
    expect(s.agents.a1.current?.startedAt).toBe(started);
    expect(s.agents.a1.plan).toEqual([{ type: 'rest' }]);
  });
});

describe('movement and body fixes', () => {
  it('refuses to rest inside a hazard', () => {
    const s = blank();
    s.hazards.h1 = { id: 'h1', kind: 'leeches', position: { x: 0, z: 0 }, radius: 3 };
    plan(s, [{ type: 'rest' }]);
    run(s, 0.2);
    expect(s.agents.a1.recentOutcomes.some((o) => /cannot rest here/.test(o.detail))).toBe(true);
    expect(s.agents.a1.status).not.toBe('resting');
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
});

describe('God power: kill_agent', () => {
  const kill = (s: WorldState, agentId: string) => apply(s, { type: 'edit', source: 'test', edit: { type: 'kill_agent', agentId } });

  it('strikes a creature dead immediately, even while paused, and logs it', () => {
    const s = blank();
    apply(s, { type: 'pause' });
    kill(s, 'a1');
    const a = s.agents.a1;
    expect(a.status).toBe('dead');
    expect(a.health).toBe(0);
    expect(a.deathCause).toBe('struck down by God');
    expect(s.events.some((e) => e.kind === 'death' && e.text.includes('struck down by God'))).toBe(true);
  });

  it('discards a decision that was in flight for the killed agent', () => {
    const s = blank();
    const seq = s.agents.a1.controller.requestSeq + 1;
    apply(s, { type: 'decisionStarted', agentId: 'a1', runId: s.runId, seq, observation: observe(s, 'a1') });
    kill(s, 'a1');
    apply(s, { type: 'decisionResult', agentId: 'a1', runId: s.runId, seq, decision: { plan: [{ type: 'move', target: { x: 5, z: 5 } }] }, latencyMs: 1 });
    expect(s.agents.a1.plan).toEqual([]);
    run(s, 1);
    expect(s.agents.a1.position).toEqual({ x: 0, z: 0 });
  });

  it('rejects unknown or already-dead targets', () => {
    const s = blank();
    kill(s, 'a99');
    expect(s.events.at(-1)?.text).toMatch(/no creature a99/);
    kill(s, 'a1');
    kill(s, 'a1');
    expect(s.events.at(-1)?.text).toMatch(/already dead/);
  });

  it('works on connectome flies too', () => {
    const s = createInitialWorld('r', 'scripted', { mode: 'flies' });
    kill(s, 'f1');
    expect(s.agents.f1.status).toBe('dead');
    expect(s.agents.f1.fly?.speed).toBe(0);
  });
});
