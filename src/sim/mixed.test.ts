import { describe, expect, it } from 'vitest';
import { looming, soundAt } from '../controllers/fly/sensing';
import { CONFIG } from '../shared/config';
import { ActionSchema } from '../shared/schemas';
import type { Action, FlyReadout, SimCommand, WorldState } from '../shared/types';
import { blocked } from './geometry';
import { observe } from './observe';
import { mulberry32 } from './rng';
import { applyCommand, stepWorld } from './step';
import { createInitialWorld } from './world';

const rng = mulberry32(11);
let n = 1;
const apply = (s: WorldState, c: SimCommand) => applyCommand(s, c, rng, () => `run-m${++n}`);
const readout: FlyReadout = { dna02: [0, 0], dna01: [0, 0], mn9: 0, pam: 0, ppl1: 0, steer: 0, valence: 0, brainDriven: 0 };
const motor = (s: WorldState, agentId: string, m: Partial<{ turnRate: number; speed: number; feeding: boolean; escape: boolean }>) =>
  apply(s, { type: 'flyMotors', runId: s.runId, motors: [{ agentId, turnRate: 0, speed: 0, feeding: false, readout, ...m }] });
const run = (s: WorldState, seconds: number, each?: () => void) => {
  for (let i = 0; i < seconds * 20; i++) {
    each?.();
    stepWorld(s, 0.05, rng);
  }
};
const plan = (s: WorldState, id: string, actions: Action[]) => {
  const a = s.agents[id];
  a.plan = actions;
  a.current = null;
};

/** Mixed world with the terrain cleared: a1, a2 and flies f1..f3 at known spots. */
function mixedWorld(): WorldState {
  const s = createInitialWorld('r-mix', 'scripted', { mode: 'mixed' });
  s.resources = {};
  s.hazards = {};
  s.obstacles = {};
  s.groundItems = {};
  s.time = 10;
  s.agents.a1.position = { x: 0, z: 0 };
  s.agents.a2.position = { x: 20, z: 20 };
  s.agents.f1.position = { x: 3, z: 0 };
  s.agents.f2.position = { x: -20, z: -20 };
  s.agents.f3.position = { x: -25, z: 20 };
  for (const a of Object.values(s.agents)) a.plan = [];
  return s;
}

describe('mixed world: agents and connectome flies together', () => {
  it('starts with 2 plan agents and 3 flies and spawns both kinds under separate caps', () => {
    const s = createInitialWorld('r-mix0', 'scripted', { mode: 'mixed' });
    const kinds = Object.values(s.agents).map((a) => a.controller.kind);
    expect(kinds.filter((k) => k === 'fly')).toHaveLength(CONFIG.mixedStartFlies);
    expect(kinds.filter((k) => k !== 'fly')).toHaveLength(CONFIG.mixedStartAgents);
    expect(s.flyEggs).toEqual([]);
    apply(s, { type: 'flyCapacity', capacity: 5 });
    apply(s, { type: 'spawnAgents', count: 10, controller: 'fly' });
    expect(Object.values(s.agents).filter((a) => a.fly)).toHaveLength(5);
    apply(s, { type: 'spawnAgents', count: 3, controller: 'scripted' });
    expect(Object.values(s.agents).filter((a) => !a.fly)).toHaveLength(5);
  });

  it('keeps agent-only worlds free of flies', () => {
    const s = createInitialWorld('r-ag', 'scripted', { mode: 'agents' });
    apply(s, { type: 'spawnAgents', count: 2, controller: 'fly' });
    expect(Object.values(s.agents).some((a) => a.fly)).toBe(false);
    expect('visibleFlies' in observe(s, 'a1')).toBe(false);
  });

  it('God edits spawn either kind in a mixed world and can strike a fly down', () => {
    const s = mixedWorld();
    apply(s, { type: 'edit', source: 'test', edit: { type: 'spawn_agents', count: 2, controller: 'fly' } });
    apply(s, { type: 'edit', source: 'test', edit: { type: 'spawn_agents', count: 1, controller: 'scripted' } });
    expect(Object.values(s.agents).filter((a) => a.fly)).toHaveLength(5);
    expect(Object.values(s.agents).filter((a) => !a.fly)).toHaveLength(3);
    apply(s, { type: 'edit', source: 'test', edit: { type: 'kill_agent', agentId: 'f2' } });
    expect(s.agents.f2.status).toBe('dead');
    expect(s.agents.f2.deathCause).toBe('struck down by God');
  });

  it('agents perceive flies separately from agents: sight range, what they do, which way they face', () => {
    const s = mixedWorld();
    s.agents.f1.heading = Math.PI; // facing a1 (to its west)
    const o = observe(s, 'a1');
    expect(o.visibleAgents.map((a) => a.id)).not.toContain('f1');
    expect(o.visibleFlies?.map((f) => f.id)).toEqual(['f1']);
    expect(o.visibleFlies?.[0]).toMatchObject({ distance: 3, bearing: 'E', doing: 'still', facing: 'toward you' });
    s.agents.f1.heading = 0;
    expect(observe(s, 'a1').visibleFlies?.[0].facing).toBe('away from you');
  });

  it('flies cannot be courted or given things, and do not receive speech in their inbox', () => {
    const s = mixedWorld();
    s.agents.a1.items.push({ id: 'i-b', kind: 'berries', label: 'dark blue berries', spoilsAt: null });
    plan(s, 'a1', [{ type: 'court', agentId: 'f1' }]);
    run(s, 0.2);
    expect(s.agents.a1.recentOutcomes.at(-1)?.detail).toMatch(/fruit fly, not one of your kind/);
    plan(s, 'a1', [{ type: 'give', recipientId: 'f1', itemId: 'i-b' }]);
    run(s, 0.2);
    expect(s.agents.a1.recentOutcomes.at(-1)?.detail).toMatch(/cannot take things/);
    plan(s, 'a1', [{ type: 'say', text: 'shoo, fly' }]);
    run(s, 0.2);
    expect(s.agents.f1.inbox).toHaveLength(0);
  });

  it('flies do not block plan agents, but agents block flies', () => {
    const s = mixedWorld();
    expect(blocked(s, { x: 3.2, z: 0 }, CONFIG.agentRadius, 'a1')).toBe(false);
    expect(blocked(s, { x: 0.3, z: 0 }, CONFIG.flyRadius, 'f1')).toBe(true);
  });

  it('swat from behind (the fly cannot see it) kills the fly', () => {
    const s = mixedWorld();
    s.agents.f1.heading = 0; // faces east, away from a1: a1 sits in its rear blind spot
    plan(s, 'a1', [{ type: 'swat', flyId: 'f1' }]);
    run(s, 3);
    expect(s.agents.f1.status).toBe('dead');
    expect(s.agents.f1.deathCause).toBe('swatted by a1');
    expect(s.agents.a1.recentOutcomes.at(-1)).toMatchObject({ actionType: 'swat', ok: true });
  });

  it('a Giant Fiber escape command during the strike makes the swat miss', () => {
    const s = mixedWorld();
    plan(s, 'a1', [{ type: 'swat', flyId: 'f1' }]);
    let sent = false;
    run(s, 3, () => {
      const t = s.agents.f1.fly?.threat;
      if (t && !sent && s.time > t.start) {
        motor(s, 'f1', { escape: true });
        sent = true;
      }
    });
    expect(sent).toBe(true);
    expect(s.agents.f1.status).not.toBe('dead');
    expect(s.agents.f1.fly?.escapes).toBe(1);
    expect(s.agents.a1.recentOutcomes.some((o) => o.actionType === 'swat' && !o.ok && /took off/.test(o.detail))).toBe(true);
    expect(s.flySounds?.some((x) => x.flyId === 'f1')).toBe(true);
  });

  it('an escape flight carries the fly away from the threat and lands it again', () => {
    const s = mixedWorld();
    s.agents.a1.position = { x: 1, z: 0 };
    motor(s, 'f1', { escape: true });
    const f = s.agents.f1.fly!;
    expect(f.flight).toBeTruthy();
    run(s, CONFIG.flyFlightMaxSec + 0.6);
    expect(f.flight ?? null).toBeNull();
    expect(s.agents.f1.position.x).toBeGreaterThan(5);
  });

  it('a fly feeding on carried food takes nibbles: the food rots sooner and the carrier notices', () => {
    const s = mixedWorld();
    s.agents.a1.items.push({ id: 'i-f', kind: 'fruit', label: 'round yellow fruit', spoilsAt: s.time + 500 });
    s.agents.f1.position = { x: 0.85, z: 0 };
    s.agents.f1.energy = 40;
    run(s, CONFIG.flyNibbleSec + 0.5, () => motor(s, 'f1', { feeding: true }));
    const item = s.agents.a1.items[0];
    expect(item.spoilsAt).toBeLessThan(s.time + CONFIG.flyNibbleSpoilSec + 1);
    expect(s.agents.f1.energy).toBeGreaterThan(40);
    expect(s.agents.a1.recentOutcomes.at(-1)?.detail).toMatch(/fruit fly \(f1\) landed on your round yellow fruit/);
    expect(s.agents.a1.controller.needsDecision).toBe(true);
    const o = observe(s, 'a1');
    expect(o.visibleFlies?.find((x) => x.id === 'f1')?.onYou).toBe(true);
  });

  it('well-fed flies lay eggs on sweet food that hatch into new naive flies', () => {
    const s = mixedWorld();
    s.agents.a1.items.push({ id: 'i-f', kind: 'fruit', label: 'round yellow fruit', spoilsAt: null });
    s.agents.f1.position = { x: 0.85, z: 0 };
    s.agents.f1.energy = 100;
    const rnd = Math.random;
    Math.random = () => 0.01;
    try {
      run(s, CONFIG.flyNibbleSec + 0.5, () => motor(s, 'f1', { feeding: true }));
    } finally {
      Math.random = rnd;
    }
    expect(s.flyEggs).toHaveLength(1);
    expect(s.agents.f1.fly?.eggsLaid).toBe(1);
    const egg = s.flyEggs![0];
    s.agents.a1.position = { x: 10, z: 10 };
    s.agents.f1.position = { x: 5, z: 5 };
    s.time = egg.hatchAt + 0.01;
    run(s, 0.1);
    const child = Object.values(s.agents).find((a) => a.parents[0] === 'f1');
    expect(child?.fly).toBeTruthy();
    expect(child?.generation).toBe(1);
    expect(s.flyEggs).toHaveLength(0);
  });

  it('agents hear fly buzzing nearby', () => {
    const s = mixedWorld();
    s.flySounds = [{ at: s.time, flyId: 'f1', text: 'suiii~', where: { x: 3, z: 0 } }];
    expect(observe(s, 'a1').heardBuzzing).toEqual([{ flyId: 'f1', sound: 'suiii~', distance: 3, bearing: 'E' }]);
  });

  it('eyes: an approaching creature looms on the correct eye, the rear blind spot sees nothing, a swat hand looms hard', () => {
    const s = mixedWorld();
    const f1 = s.agents.f1;
    f1.heading = -Math.PI / 2; // faces north; a1 is to its west = left side
    const vel = new Map([['a1', { x: 2.2, z: 0 }]]);
    let l = looming(s, f1, vel);
    expect(l.rate[0]).toBeGreaterThan(0.1);
    expect(l.rate[1]).toBe(0);
    f1.heading = 0; // faces east, a1 directly behind
    l = looming(s, f1, vel);
    expect(l.rate).toEqual([0, 0]);
    f1.heading = Math.PI; // facing a1, still for the body
    f1.fly = { ...f1.fly!, threat: { by: 'a1', from: { x: 1.7, z: 0 }, start: s.time, end: s.time + CONFIG.swatStrikeSec } };
    s.time += CONFIG.swatStrikeSec * 0.5;
    l = looming(s, f1, new Map());
    expect(Math.min(...l.rate)).toBeGreaterThan(2);
  });

  it('ears: recent speech nearby is loud, far speech is not heard', () => {
    const s = mixedWorld();
    s.utterances.push({ id: 'u1', at: s.time, speaker: 'a1', channel: 'speech', content: 'hey', hearers: [], context: [], where: { x: 2, z: 0 } });
    const near = soundAt(s, s.agents.f1);
    expect(near[0] + near[1]).toBeGreaterThan(0.5);
    s.agents.f1.position = { x: 15, z: 0 };
    expect(soundAt(s, s.agents.f1)).toEqual([0, 0]);
  });

  it('swat is a valid action in the shared schema', () => {
    expect(ActionSchema.safeParse({ type: 'swat', flyId: 'f1' }).success).toBe(true);
    expect(ActionSchema.safeParse({ type: 'swat' }).success).toBe(false);
  });
});
