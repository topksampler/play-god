import type { Agent, WorldState } from '../shared/types';
import { createAgent, createInitialWorld } from './world';

/** Full-state export: everything needed to re-open a run in the UI. */
export function exportRun(world: WorldState) {
  return { format: 'play-god-run/2', exportedAt: new Date().toISOString(), world };
}

/**
 * Load an export. v2 files contain the full world; older (v1) exports only have agents/utterances/events,
 * so the world is regenerated from the seed and the recorded histories are attached (positions approximate).
 */
export function importRun(data: unknown, runId: string): { world: WorldState; note: string } {
  const d = data as Record<string, unknown>;
  if (d.format === 'play-god-run/2' && d.world) {
    const w = d.world as WorldState;
    return { world: { ...w, runId }, note: `loaded full snapshot (${Object.keys(w.agents).length} agents, t=${w.time.toFixed(0)}s)` };
  }
  const exp = (d.experiment ?? {}) as WorldState['experiment'];
  const base = createInitialWorld(runId, 'llm', { seed: Number(d.seed) || undefined, experiment: exp });
  const agents: Record<string, Agent> = {};
  const site = base.biomes[4]?.site ?? { x: 0, z: 0 };
  for (const [i, raw] of ((d.agents as Partial<Agent>[]) ?? []).entries()) {
    const shell = createAgent(base, { x: site.x + (i % 4) * 2, z: site.z + Math.floor(i / 4) * 2 }, 'llm', 'fast');
    const a = { ...shell, ...raw, controller: { ...shell.controller, kind: (raw as { controller?: string }).controller as Agent['controller']['kind'] ?? 'llm', tier: (raw as { tier?: string }).tier as Agent['controller']['tier'] ?? 'fast' } } as Agent;
    a.id = raw.id ?? shell.id;
    if (a.status === 'dead') a.health = 0;
    agents[a.id] = a;
  }
  const world: WorldState = {
    ...base,
    time: Number(d.simTime) || base.time,
    agents,
    utterances: (d.utterances as WorldState['utterances']) ?? [],
    courtships: (d.courtships as WorldState['courtships']) ?? [],
    births: (d.births as WorldState['births']) ?? [],
    events: (d.events as WorldState['events']) ?? [],
    history: (d.worldHistory as WorldState['history']) ?? [],
    paused: true,
  };
  return { world, note: 'reconstructed from an older export: terrain regenerated from seed, agent positions approximate, histories exact' };
}
