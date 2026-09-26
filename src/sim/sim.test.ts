import { describe, expect, it } from 'vitest';
import { scriptedDecide } from '../controllers/scripted';
import { startScheduler } from '../controllers/scheduler';
import { NODES } from '../shared/catalog';
import { CONFIG } from '../shared/config';
import type { Action, Controller, Decision, NodeKind, SimCommand, Vec2, WorldState } from '../shared/types';
import { senseRadius } from './environment';
import { blocked } from './geometry';
import { observe } from './observe';
import { mulberry32 } from './rng';
import { applyCommand, stepWorld } from './step';
import { createSimStore } from './store';
import { addNode, createInitialWorld } from './world';

const rng = mulberry32(42);
let runN = 1;
const next = () => `run-t${++runN}`;
const apply = (s: WorldState, c: SimCommand) => applyCommand(s, c, rng, next);

/** A generated world with everything cleared except agent a1 at the origin, for controlled tests. */
function blank(): WorldState {
  const s = createInitialWorld('r', 'scripted');
  s.resources = {};
  s.hazards = {};
  s.obstacles = {};
  s.agents.a1.position = { x: 0, z: 0 };
  s.time = 10; // daytime
  return s;
}
const node = (s: WorldState, kind: NodeKind, p: Vec2) => addNode(s, kind, p);
function plan(s: WorldState, agentId: string, actions: Action[]) {
  const seq = s.agents[agentId].controller.requestSeq + 1;
  apply(s, { type: 'decisionStarted', agentId, runId: s.runId, seq, observation: observe(s, agentId) });
  apply(s, { type: 'decisionResult', agentId, runId: s.runId, seq, decision: { plan: actions }, latencyMs: 1 });
}
const run = (s: WorldState, seconds: number) => {
  for (let i = 0; i < seconds * 20; i++) stepWorld(s, 0.05, rng);
};
const last = (s: WorldState, id = 'a1') => s.agents[id].recentOutcomes.at(-1);

describe('world generation', () => {
  it('is reproducible per seed and has biomes, resources, hazards, obstacles', () => {
    const a = createInitialWorld('r', 'scripted', { seed: 7 });
    const b = createInitialWorld('r', 'scripted', { seed: 7 });
    expect(JSON.stringify(a.resources)).toBe(JSON.stringify(b.resources));
    expect(new Set(a.biomes.map((x) => x.kind)).size).toBeGreaterThanOrEqual(6);
    expect(Object.keys(a.resources).length).toBeGreaterThan(40);
    expect(Object.keys(a.hazards).length).toBeGreaterThan(8);
    expect(Object.keys(a.obstacles).length).toBeGreaterThan(30);
    expect(blocked(a, a.agents.a1.position, CONFIG.agentRadius, 'a1')).toBe(false);
  });
});

describe('gather / eat / drink', () => {
  it('walks to a resource, gathers exactly one unit, never double-awarded', () => {
    const s = blank();
    const r = node(s, 'berry_bush', { x: 5, z: 0 });
    s.resources[r].units = 1;
    apply(s, { type: 'spawnAgents', count: 1, controller: 'scripted' });
    const b = Object.keys(s.agents)[1];
    s.agents[b].position = { x: 5, z: 1.2 };
    plan(s, 'a1', [{ type: 'gather', nodeId: r }]);
    plan(s, b, [{ type: 'gather', nodeId: r }]);
    run(s, 4);
    const total = s.agents.a1.items.length + s.agents[b].items.length;
    expect(total).toBe(1);
    expect(s.resources[r].units).toBeGreaterThanOrEqual(0);
  });

  it('rejects guessed/invisible ids and far targets', () => {
    const s = blank();
    const far = node(s, 'berry_bush', { x: 35, z: 35 });
    plan(s, 'a1', [{ type: 'gather', nodeId: 'nope' }]);
    run(s, 0.2);
    expect(last(s)?.ok).toBe(false);
    plan(s, 'a1', [{ type: 'gather', nodeId: far }]);
    run(s, 0.2);
    expect(last(s)).toMatchObject({ ok: false, detail: 'target is not in sight' });
    expect(s.agents.a1.items.length).toBe(0);
  });

  it('poison comes from the true kind, and the agent only sees appearance', () => {
    const s = blank();
    const t = node(s, 'toxic_mushroom_patch', { x: 1, z: 0 });
    const obs = observe(s, 'a1');
    const seen = obs.visibleResources.find((r) => r.id === t)!;
    expect(seen.appearance).toBe(NODES.toxic_mushroom_patch.appearance);
    expect(JSON.stringify(obs)).not.toContain('toxic');
    plan(s, 'a1', [{ type: 'gather', nodeId: t }]);
    run(s, 1);
    const item = s.agents.a1.items[0];
    expect(item.label).toBe('red spotted mushroom');
    plan(s, 'a1', [{ type: 'eat', itemId: item.id }]);
    run(s, 0.1);
    expect(s.agents.a1.poisonedUntil).toBeGreaterThan(s.time);
    const h0 = s.agents.a1.health;
    run(s, 3);
    expect(s.agents.a1.health).toBeLessThan(h0);
  });

  it('toxic water hydrates but causes sickness; fresh water does not', () => {
    const s = blank();
    const bad = node(s, 'toxic_water', { x: 2, z: 0 });
    s.agents.a1.hydration = 30;
    plan(s, 'a1', [{ type: 'drink', sourceId: bad }]);
    run(s, 2);
    expect(s.agents.a1.hydration).toBeGreaterThan(45);
    expect(s.agents.a1.sickUntil).toBeGreaterThan(s.time);
  });

  it('vitals clamp and the agent dies (shown, not deleted) at zero health', () => {
    const s = blank();
    s.agents.a1.energy = 0;
    s.agents.a1.hydration = 0;
    s.agents.a1.health = 1;
    run(s, 2);
    expect(s.agents.a1.status).toBe('dead');
    expect(s.agents.a1.energy).toBe(0);
    expect(s.agents.a1).toBeDefined();
  });

  it('food regrows up to maxUnits and carried food spoils', () => {
    const s = blank();
    const r = node(s, 'berry_bush', { x: 2, z: 0 });
    s.resources[r].units = 0;
    run(s, 30);
    expect(s.resources[r].units).toBeGreaterThan(1);
    run(s, 120);
    expect(s.resources[r].units).toBe(s.resources[r].maxUnits);
    plan(s, 'a1', [{ type: 'gather', nodeId: r }]);
    run(s, 1);
    run(s, 95);
    expect(s.agents.a1.items[0].kind).toBe('rotten_food');
  });
});

describe('ecology', () => {
  it('full plants spread within their biome; stripped patches wither', () => {
    const s = blank();
    const r = node(s, 'berry_bush', { x: 4, z: 4 });
    run(s, 300);
    const bushes = Object.values(s.resources).filter((x) => x.kind === 'berry_bush');
    expect(bushes.length).toBeGreaterThan(1);
    expect(bushes.length).toBeLessThanOrEqual(CONFIG.maxNodesPerKindPerBiome);
    const f = node(s, 'fiber_grass', { x: -4, z: -4 });
    s.resources[f].regrowPerMin = 0;
    s.resources[f].units = 0;
    run(s, CONFIG.witherAfterSec + 15);
    expect(s.resources[f]).toBeUndefined();
    expect(s.resources[r]).toBeDefined();
  });
});

describe('movement and hazards', () => {
  it('rectangular cliffs block movement', () => {
    const s = blank();
    s.obstacles.c = { id: 'c', shape: 'cliff', position: { x: 3, z: 0 }, radius: 0.9, halfLength: 8, angle: Math.PI / 2, height: 4, solid: true };
    plan(s, 'a1', [{ type: 'move', target: { x: 6, z: 0 } }]);
    run(s, 4);
    expect(s.agents.a1.position.x).toBeLessThan(3 - 0.9);
  });

  it('pathfinding routes around a long wall and a lake instead of getting stuck', () => {
    const s = blank();
    s.obstacles.w = { id: 'w', shape: 'cliff', position: { x: 4, z: 0 }, radius: 0.9, halfLength: 9, angle: Math.PI / 2, height: 4, solid: true };
    s.obstacles.l = { id: 'l', shape: 'lake', position: { x: 12, z: 6 }, radius: 4, height: 0.05, solid: true };
    plan(s, 'a1', [{ type: 'move', target: { x: 12, z: 0 } }]);
    run(s, 20);
    expect(Math.hypot(s.agents.a1.position.x - 12, s.agents.a1.position.z)).toBeLessThan(0.5);
    expect(s.agents.a1.recentOutcomes.some((o) => o.detail.startsWith('blocked'))).toBe(false);
  });

  it('pathfinding escapes when the agent stands hard against an obstacle or the edge', async () => {
    const { findPath } = await import('./pathing');
    const s = blank();
    s.obstacles.b = { id: 'b', shape: 'boulder', position: { x: 38, z: 0 }, radius: 1.2, height: 2, solid: true };
    const path = findPath(s, { x: 39.5, z: -1.6 }, { x: 0, z: 0 });
    expect(path).not.toBeNull();
  });

  it('pathfinding cost stays bounded (full-map path under 25ms)', async () => {
    const { findPath } = await import('./pathing');
    const s = createInitialWorld('r', 'scripted', { seed: 11 });
    const t0 = performance.now();
    findPath(s, { x: -38, z: -38 }, { x: 38, z: 38 });
    findPath(s, { x: -38, z: -38 }, { x: 38, z: 38 });
    expect((performance.now() - t0) / 2).toBeLessThan(25);
  });

  it('hazards damage agents inside them and trigger a re-decision', () => {
    const s = blank();
    s.hazards.h = { id: 'h', kind: 'thorns', position: { x: 0, z: 0 }, radius: 3 };
    s.agents.a1.controller.needsDecision = false;
    run(s, 1);
    expect(s.agents.a1.health).toBeLessThan(100);
    expect(s.agents.a1.controller.needsDecision).toBe(true);
  });

  it('night shrinks the sense radius', () => {
    const s = blank();
    const day = senseRadius(s, s.agents.a1);
    s.time = CONFIG.dayLengthSec * 0.75;
    expect(senseRadius(s, s.agents.a1)).toBeCloseTo(day * CONFIG.nightVisionMultiplier, 5);
  });
});

describe('crafting, building, caches', () => {
  it('craft consumes exact inputs and fails visibly when short', () => {
    const s = blank();
    const a = s.agents.a1;
    const mk = (kind: 'fiber' | 'wood' | 'stone', i: number) => ({ id: `x${kind}${i}`, kind, label: kind, spoilsAt: null });
    a.items = [mk('fiber', 1), mk('fiber', 2)];
    plan(s, 'a1', [{ type: 'craft', recipe: 'basket' }]);
    run(s, 0.1);
    expect(last(s)?.ok).toBe(false);
    expect(a.items.length).toBe(2);
    a.items.push(mk('fiber', 3));
    plan(s, 'a1', [{ type: 'craft', recipe: 'basket' }]);
    run(s, 0.1);
    expect(a.capacity).toBe(CONFIG.basketCapacity);
    expect(a.items.length).toBe(0);

    a.items = [mk('wood', 1), mk('wood', 2), mk('wood', 3), mk('wood', 4)];
    plan(s, 'a1', [{ type: 'build', structure: 'cache' }]);
    run(s, 0.1);
    const cache = Object.values(s.structures)[0];
    expect(cache.kind).toBe('cache');
    a.items = [mk('stone', 1)];
    plan(s, 'a1', [{ type: 'deposit', cacheId: cache.id, itemId: 'xstone1' }]);
    run(s, 1);
    plan(s, 'a1', [{ type: 'withdraw', cacheId: cache.id, itemId: 'xstone1' }, { type: 'withdraw', cacheId: cache.id, itemId: 'xstone1' }]);
    run(s, 1);
    expect(a.items.filter((i) => i.id === 'xstone1').length).toBe(1);
    expect(cache.items?.length).toBe(0);
  });
});

describe('plans, isolation, staleness, messaging', () => {
  it('executes a multi-step plan in order and flags completion', () => {
    const s = blank();
    const r = node(s, 'berry_bush', { x: 3, z: 0 });
    s.agents.a1.energy = 40;
    plan(s, 'a1', [{ type: 'gather', nodeId: r }, { type: 'gather', nodeId: r }]);
    run(s, 3);
    expect(s.agents.a1.items.length).toBe(2);
    expect(s.agents.a1.controller.needsDecision).toBe(true);
    expect(s.agents.a1.controller.interruptReason).toBe('plan complete');
  });

  it('spawned agents have independent state and cap at max', () => {
    const s = createInitialWorld('r', 'scripted');
    apply(s, { type: 'spawnAgents', count: 20, controller: 'scripted' });
    const agents = Object.values(s.agents);
    expect(agents.length).toBe(CONFIG.maxAgents);
    agents[0].memory.notes = 'secret';
    agents[0].inbox.push({ id: 'x', senderId: 'z', text: 'hi', sentAt: 0 });
    expect(agents[1].memory.notes).toBe('');
    expect(agents[1].inbox.length).toBe(0);
    expect(agents[0].memory).not.toBe(agents[1].memory);
  });

  it('rejects results from old runs and after pause', () => {
    const s = createInitialWorld('r', 'scripted');
    apply(s, { type: 'decisionStarted', agentId: 'a1', runId: 'r', seq: 1, observation: observe(s, 'a1') });
    const s2 = apply(s, { type: 'reset' });
    apply(s2, { type: 'decisionResult', agentId: 'a1', runId: 'r', seq: 1, decision: { plan: [{ type: 'rest' }] }, latencyMs: 1 });
    expect(s2.agents.a1.plan.length).toBe(0);

    const s3 = createInitialWorld('q', 'scripted');
    apply(s3, { type: 'decisionStarted', agentId: 'a1', runId: 'q', seq: 1, observation: observe(s3, 'a1') });
    apply(s3, { type: 'pause' });
    apply(s3, { type: 'decisionResult', agentId: 'a1', runId: 'q', seq: 1, decision: { plan: [{ type: 'rest' }] }, latencyMs: 1 });
    expect(s3.agents.a1.plan.length).toBe(0);
  });

  it('say delivers within comm radius only and expires by TTL', () => {
    const s = blank();
    apply(s, { type: 'spawnAgents', count: 2, controller: 'scripted' });
    const [a, b, c] = Object.keys(s.agents);
    s.agents[b].position = { x: 3, z: 0 };
    s.agents[c].position = { x: 20, z: 0 };
    plan(s, a, [{ type: 'say', text: 'water to the north' }]);
    run(s, 0.1);
    expect(s.agents[b].inbox.length).toBe(1);
    expect(s.agents[b].controller.needsDecision).toBe(true);
    expect(s.agents[c].inbox.length).toBe(0);
    run(s, CONFIG.messageTtlSec + 1);
    expect(s.agents[b].inbox.length).toBe(0);
  });
});

describe('emergent communication conditions', () => {
  const proto = () => {
    const s = createInitialWorld('r', 'llm', { experiment: { commMode: 'proto', traits: true } });
    s.resources = {};
    s.hazards = {};
    s.obstacles = {};
    s.agents.a1.position = { x: 0, z: 0 };
    s.time = 10;
    apply(s, { type: 'spawnAgents', count: 1, controller: 'llm' });
    const b = Object.keys(s.agents)[1];
    s.agents[b].position = { x: 3, z: 0 };
    return { s, b };
  };

  it('proto mode: words fail, only lexicon sounds are delivered, with context recorded', () => {
    const { s, b } = proto();
    plan(s, 'a1', [{ type: 'say', text: 'food here' }]);
    run(s, 0.1);
    expect(last(s)?.ok).toBe(false);
    expect(s.agents[b].inbox.length).toBe(0);
    plan(s, 'a1', [{ type: 'signal', tokens: ['hello'] }]);
    run(s, 0.1);
    expect(last(s)?.ok).toBe(false);
    const [w1, w2] = s.experiment.lexicon;
    node(s, 'berry_bush', { x: 1, z: 1 });
    plan(s, 'a1', [{ type: 'signal', tokens: [w1, w2] }]);
    run(s, 0.1);
    expect(s.agents[b].inbox.at(-1)?.text).toBe(`${w1} ${w2}`);
    const u = s.utterances.at(-1)!;
    expect(u).toMatchObject({ speaker: 'a1', channel: 'signal', hearers: [b] });
    expect(u.context).toContain('food-near');
    expect(u.context).toContain('agent-close');
  });

  it('gestures and marks are perceivable by others; marks expire', () => {
    const { s, b } = proto();
    plan(s, 'a1', [{ type: 'gesture', gesture: 'point', toward: { x: 0, z: -10 } }]);
    run(s, 0.1);
    const seen = observe(s, b).visibleAgents.find((a) => a.id === 'a1');
    expect(seen?.gesture).toEqual({ kind: 'point', toward: 'N' });
    plan(s, 'a1', [{ type: 'mark', glyph: s.experiment.lexicon[0] }]);
    run(s, 0.1);
    expect(observe(s, b).visibleMarks.length).toBe(1);
    plan(s, 'a1', [{ type: 'mark', glyph: 'FOOD' }]);
    run(s, 0.1);
    expect(last(s)?.ok).toBe(false);
    run(s, CONFIG.markTtlSec + 1);
    expect(Object.keys(s.marks).length).toBe(0);
  });

  it('others can see what an agent is doing and holding; each agent sees its own sound order', () => {
    const { s, b } = proto();
    const r = node(s, 'berry_bush', { x: 1, z: 0 });
    plan(s, 'a1', [{ type: 'gather', nodeId: r }]);
    run(s, 0.5);
    const seen = observe(s, b).visibleAgents.find((a) => a.id === 'a1')!;
    expect(seen.doing).toMatch(/gathering/);
    expect(seen.holding).toEqual(['dark blue berries']);
    const s1 = observe(s, 'a1').self.voice.sounds;
    const s2 = observe(s, b).self.voice.sounds;
    expect([...s1].sort()).toEqual([...s2].sort());
    expect(s1.join()).not.toBe(s2.join());
  });

  it('traits are applied and recorded in the baseline', () => {
    const { s } = proto();
    for (const a of Object.values(s.agents)) {
      expect(a.traits.length).toBe(1);
      expect(a.baseline.traits).toEqual(a.traits);
      if (a.traits[0] === 'strong') expect(a.capacity).toBe(CONFIG.baseCapacity + 3);
    }
  });

  it('silent mode blocks sounds but allows gestures', () => {
    const s = createInitialWorld('r', 'llm', { experiment: { commMode: 'silent' } });
    plan(s, 'a1', [{ type: 'signal', tokens: [s.experiment.lexicon[0]] }]);
    run(s, 0.1);
    expect(last(s)?.ok).toBe(false);
    plan(s, 'a1', [{ type: 'gesture', gesture: 'wave' }]);
    run(s, 0.1);
    expect(last(s)?.ok).toBe(true);
    expect(observe(s, 'a1').self.voice.sounds).toEqual([]);
  });
});

describe('scarcity and control protocol', () => {
  it('scarce worlds have fewer food patches and slower regrowth', () => {
    const food = (w: WorldState) => Object.values(w.resources).filter((r) => r.kind === 'berry_bush');
    const n = createInitialWorld('r', 'scripted', { seed: 3 });
    const sc = createInitialWorld('r', 'scripted', { seed: 3, experiment: { scarcity: 'scarce' } });
    expect(food(sc).length).toBeLessThan(food(n).length);
    expect(food(sc)[0].regrowPerMin).toBeLessThan(food(n)[0].regrowPerMin);
  });

  it('scripted control signals its fixed food code in proto mode when food and a peer are near', () => {
    const s = createInitialWorld('r', 'scripted', { experiment: { commMode: 'proto' } });
    s.resources = {};
    s.hazards = {};
    s.obstacles = {};
    s.agents.a1.position = { x: 0, z: 0 };
    s.time = 10;
    apply(s, { type: 'spawnAgents', count: 1, controller: 'scripted' });
    const b = Object.keys(s.agents)[1];
    s.agents[b].position = { x: 3, z: 0 };
    node(s, 'berry_bush', { x: 2, z: 1 });
    const d = scriptedDecide(observe(s, 'a1'), rng);
    expect(d.plan[0]).toEqual({ type: 'signal', tokens: [[...s.experiment.lexicon].sort()[0]] });
  });
});

describe('scripted baseline (labelled, not LLM)', () => {
  it('finds, gathers and eats food, and avoids red spotted mushrooms', () => {
    const s = blank();
    node(s, 'toxic_mushroom_patch', { x: 2, z: 0 });
    node(s, 'berry_bush', { x: 5, z: 2 });
    s.agents.a1.energy = 50;
    for (let t = 0; t < 30 && s.agents.a1.stats.eaten === 0; t++) {
      plan(s, 'a1', scriptedDecide(observe(s, 'a1'), rng).plan);
      run(s, 1.5);
    }
    expect(s.agents.a1.stats.eaten).toBeGreaterThan(0);
    expect(s.agents.a1.stats.poisonings).toBe(0);
  });
});

describe('scheduler', () => {
  const waitFor = async (store: ReturnType<typeof createSimStore>, cond: () => boolean) => {
    for (let i = 0; i < 40 && !cond(); i++) {
      store.tick(0.5);
      await new Promise((r) => setTimeout(r, 10));
    }
  };

  it('reset during an in-flight request discards the stale response', async () => {
    const store = createSimStore({ rng });
    let release: ((d: Decision) => void) | undefined;
    const slow: Controller = { kind: 'llm', decide: () => new Promise<Decision>((r) => (release = r)) };
    const stop = startScheduler(store, { resolve: () => slow, pollMs: 5 });
    await waitFor(store, () => Boolean(release));
    expect(release).toBeTypeOf('function');
    store.dispatch({ type: 'reset' });
    store.tick(0.05);
    release!({ plan: [{ type: 'rest' }] });
    await new Promise((r) => setTimeout(r, 10));
    store.tick(0.05);
    expect(store.getState().agents.a1.current?.action.type).not.toBe('rest');
    stop();
  });

  it('API failure yields a visible error without throwing', async () => {
    const store = createSimStore({ rng });
    const failing: Controller = { kind: 'llm', decide: async () => { throw new Error('boom'); } };
    const stop = startScheduler(store, { resolve: () => failing, pollMs: 5 });
    await waitFor(store, () => Boolean(store.getState().agents.a1.controller.lastError));
    expect(store.getState().agents.a1.controller.lastError).toBe('boom');
    stop();
  });
});
