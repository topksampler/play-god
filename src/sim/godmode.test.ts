import { describe, expect, it } from 'vitest';
import { WorldEditSchema } from '../shared/schemas';
import type { WorldEdit, WorldState } from '../shared/types';
import { timeOfDay, worldClock } from './environment';
import { observe } from './observe';
import { mulberry32 } from './rng';
import { applyCommand } from './step';
import { worldStatus } from './status';
import { createInitialWorld } from './world';

const rng = mulberry32(7);
const edit = (s: WorldState, e: WorldEdit) => applyCommand(s, { type: 'edit', edit: e, source: 'God #1' }, rng, () => 'run-x');
const lastEvent = (s: WorldState) => s.events.at(-1)!;

describe('God mode edits', () => {
  it('set_time_of_day shifts only the day/night clock', () => {
    for (const tod of ['night', 'dusk', 'dawn', 'day'] as const) {
      const s = createInitialWorld('r', 'scripted');
      const t = s.time;
      edit(s, { type: 'set_time_of_day', timeOfDay: tod });
      expect(timeOfDay(worldClock(s))).toBe(tod);
      expect(observe(s, 'a1').timeOfDay).toBe(tod);
      expect(s.time).toBe(t); // ages, TTLs and spoilage unaffected
      expect(lastEvent(s)).toMatchObject({ ok: true, text: `[God #1] time of day set to ${tod}` });
    }
  });

  it('set_weather with a duration holds until natural weather resumes', () => {
    const s = createInitialWorld('r', 'scripted');
    edit(s, { type: 'set_weather', weather: 'storm', durationSec: 120 });
    expect(s.weather).toBe('storm');
    expect(s.nextWeatherAt).toBe(s.time + 120);
  });

  it('remove_hazard removes existing hazards and visibly rejects unknown ids', () => {
    const s = createInitialWorld('r', 'scripted');
    const id = Object.keys(s.hazards)[0];
    edit(s, { type: 'remove_hazard', hazardId: id });
    expect(s.hazards[id]).toBeUndefined();
    edit(s, { type: 'remove_hazard', hazardId: 'h999' });
    expect(lastEvent(s)).toMatchObject({ ok: false, text: '[God #1] remove_hazard rejected: no h999' });
  });

  it('spawn_agents logs which agents were spawned under the command source', () => {
    const s = createInitialWorld('r', 'scripted');
    edit(s, { type: 'spawn_agents', count: 2, controller: 'scripted' });
    expect(Object.keys(s.agents)).toHaveLength(3);
    expect(lastEvent(s)).toMatchObject({ ok: true, text: '[God #1] spawned 2 agents: a2, a3' });
  });
});

describe('WorldEditSchema', () => {
  it('accepts the new variants and rejects invalid values', () => {
    expect(WorldEditSchema.safeParse({ type: 'set_time_of_day', timeOfDay: 'night' }).success).toBe(true);
    expect(WorldEditSchema.safeParse({ type: 'remove_hazard', hazardId: 'h1' }).success).toBe(true);
    expect(WorldEditSchema.safeParse({ type: 'set_weather', weather: 'rain', durationSec: 60 }).success).toBe(true);
    expect(WorldEditSchema.safeParse({ type: 'set_weather', weather: 'rain', durationSec: 5000 }).success).toBe(false);
    expect(WorldEditSchema.safeParse({ type: 'set_weather', weather: 'tornado' }).success).toBe(false);
    expect(WorldEditSchema.safeParse({ type: 'add_resource', kind: 'gold_mine', position: { x: 0, z: 0 } }).success).toBe(false);
    expect(WorldEditSchema.safeParse({ type: 'add_resource', kind: 'berry_bush', position: { x: NaN, z: 0 } }).success).toBe(false);
    expect(WorldEditSchema.safeParse({ type: 'spawn_agents', count: 11, controller: 'llm' }).success).toBe(false);
    expect(WorldEditSchema.safeParse({ type: 'delete_world' }).success).toBe(false);
  });
});

describe('worldStatus', () => {
  it('reflects actual state and stays compact and JSON-safe', () => {
    const s = createInitialWorld('r', 'scripted');
    edit(s, { type: 'set_weather', weather: 'rain' });
    edit(s, { type: 'set_time_of_day', timeOfDay: 'night' });
    const st = worldStatus(s);
    expect(st.weather).toBe('rain');
    expect(st.timeOfDay).toBe('night');
    expect(st.agents.alive).toBe(1);
    expect(st.agents.list[0]).toMatchObject({ id: 'a1', energy: Math.round(s.agents.a1.energy) });
    const units = Object.values(s.resources).filter((r) => r.kind === 'berry_bush').reduce((n, r) => n + Math.floor(r.units), 0);
    expect(st.resources.byKind.berry_bush.units).toBe(units);
    expect(st.resources.list.length).toBeLessThanOrEqual(150);
    expect(st.hazards.length).toBe(Object.keys(s.hazards).length);
    expect(JSON.stringify(st).length).toBeLessThan(24000);
  });
});

describe('worldStatus nearest lists', () => {
  it('lists the truly nearest hazard for each living agent', () => {
    const s = createInitialWorld('r', 'scripted', { seed: 1337 });
    const a = s.agents.a1;
    const truth = Object.values(s.hazards)
      .map((h) => ({ id: h.id, d: Math.hypot(h.position.x - a.position.x, h.position.z - a.position.z) - h.radius }))
      .sort((p, q) => p.d - q.d)[0];
    const st = worldStatus(s);
    expect(st.agents.list[0].nearestHazards?.[0].id).toBe(truth.id);
    expect(st.agents.list[0].nearestResources).toHaveLength(5);
  });
});

describe('worldStatus lowest vitals', () => {
  it('reports the living agent with the lowest energy, ignoring the dead', () => {
    const s = createInitialWorld('r', 'scripted');
    edit(s, { type: 'spawn_agents', count: 2, controller: 'scripted' });
    s.agents.a1.status = 'dead';
    s.agents.a1.energy = 0;
    s.agents.a2.energy = 3;
    s.agents.a3.energy = 40;
    expect(worldStatus(s).agents.lowestAmongLiving.energy).toEqual({ id: 'a2', value: 3 });
  });
});
