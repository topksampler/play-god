import { describe, expect, it } from 'vitest';
import { NODES } from '../shared/catalog';
import { summarizeRun } from './chronicle';
import { createMomentTracker, truthOf } from './moments';
import { mulberry32 } from './rng';
import { applyCommand } from './step';
import { createInitialWorld, logEvent, spawnAgents } from './world';

const rng = mulberry32(5);
const world = () => {
  const s = createInitialWorld('r1', 'scripted');
  spawnAgents(s, 3, 'scripted', 'fast', rng);
  return s;
};

describe('moment tracker', () => {
  it('turns recorded facts into moments, once each', () => {
    const s = world();
    const tr = createMomentTracker();
    tr.update(s); // baseline
    s.time = 20;
    logEvent(s, { kind: 'hazard', agentId: 'a1', ok: false, text: 'a1 was poisoned by red spotted mushroom (toxic_mushroom)' });
    logEvent(s, { kind: 'death', agentId: 'a2', ok: false, text: '✝ a2 died of thirst at age 20s (gen 0, 0 children)' });
    applyCommand(s, { type: 'edit', source: 'God', edit: { type: 'set_weather', weather: 'storm' } }, rng, () => 'x');
    s.utterances.push({ id: 'u1', at: 21, speaker: 'a1', channel: 'speech', content: 'avoid the red ones', hearers: ['a3'], context: [], where: { x: 0, z: 0 } });
    s.utterances.push({ id: 'u2', at: 22, speaker: 'a3', channel: 'speech', content: 'hello?', hearers: [], context: [], where: { x: 0, z: 0 } });
    s.births.push({ at: 23, child: 'a4', parents: ['a1', 'a3'] });
    s.courtships.push({ id: 'c1', at: 24, from: 'a1', to: 'a3', outcome: 'mutual' });
    const ms = tr.update(s);
    const kinds = ms.map((m) => m.kind);
    expect(kinds).toEqual(expect.arrayContaining(['poison', 'death', 'god', 'weather', 'speech', 'birth', 'courtship']));
    expect(ms.find((m) => m.kind === 'poison')!.title).toBe('a1 was poisoned by red spotted mushroom');
    expect(ms.filter((m) => m.kind === 'speech')).toHaveLength(1); // unheard speech is not a moment
    expect(ms.find((m) => m.kind === 'god')!.title).toMatch(/^You: weather set to storm/);
    const n = ms.length;
    expect(tr.update(s)).toHaveLength(n); // idempotent
  });

  it('scores belief changes against world truth, and ignores the starting beliefs', () => {
    const s = world();
    const red = NODES.toxic_mushroom_patch.appearance;
    const water = NODES.fresh_water.appearance;
    s.agents.a1.memory.beliefs = [{ appearance: water, verdict: 'safe' }];
    const tr = createMomentTracker();
    tr.update(s);
    s.agents.a1.memory = { ...s.agents.a1.memory, beliefs: [{ appearance: water, verdict: 'safe' }, { appearance: red, verdict: 'safe' }] };
    s.agents.a2.memory = { ...s.agents.a2.memory, beliefs: [{ appearance: red, verdict: 'harmful' }] };
    const ms = tr.update(s).filter((m) => m.kind === 'belief');
    expect(ms).toHaveLength(2);
    expect(ms.find((m) => m.agents[0] === 'a1')).toMatchObject({ weight: 3, title: expect.stringContaining('(wrong!)') });
    expect(ms.find((m) => m.agents[0] === 'a2')).toMatchObject({ weight: 2, title: expect.stringContaining('(correct)') });
    expect(truthOf('something the model made up')).toBeNull();
  });

  it('notices gatherings with a cooldown, and starts over on a new run', () => {
    const s = world();
    for (const a of Object.values(s.agents)) a.position = { x: 1, z: 1 };
    const tr = createMomentTracker();
    tr.update(s);
    expect(tr.list().filter((m) => m.kind === 'gathering')).toHaveLength(1);
    s.time += 10;
    tr.update(s);
    expect(tr.list().filter((m) => m.kind === 'gathering')).toHaveLength(1);
    const next = createInitialWorld('r2', 'scripted');
    expect(tr.update(next).filter((m) => m.kind !== 'gathering')).toHaveLength(0);
  });
});

describe('run summary', () => {
  it('counts outcomes from world truth', () => {
    const s = world();
    s.time = 90;
    s.agents.a2.status = 'dead';
    s.agents.a2.deathCause = 'thirst';
    s.agents.a1.memory = { ...s.agents.a1.memory, beliefs: [{ appearance: NODES.toxic_water.appearance, verdict: 'harmful' }, { appearance: NODES.fresh_water.appearance, verdict: 'harmful' }] };
    s.births.push({ at: 50, child: 'a4', parents: ['a1', 'a3'] });
    s.utterances.push({ id: 'u1', at: 21, speaker: 'a1', channel: 'speech', content: 'hi', hearers: ['a3'], context: [], where: { x: 0, z: 0 } });
    const r = summarizeRun(s, 'k', [], 4, []);
    expect(r).toMatchObject({ simTime: 90, peakAlive: 4, alive: 3, births: 1, deaths: { count: 1, causes: { thirst: 1 } }, speech: { acts: 1, heard: 1 }, beliefs: { judged: 2, correct: 1 } });
    expect(JSON.stringify(r).length).toBeLessThan(4000);
  });
});
