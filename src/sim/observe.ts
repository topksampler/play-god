import { CONFIG } from '../shared/config';
import type { Observation, WorldState } from '../shared/types';
import { dist } from './geometry';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Radius-only perception (no occlusion in P0). Never exposes full world state. */
export function observe(state: WorldState, agentId: string): Observation {
  const self = state.agents[agentId];
  if (!self) throw new Error(`No agent ${agentId}`);
  const near = (p: { x: number; z: number }) => dist(p, self.position) <= CONFIG.senseRadius;
  const pos = (p: { x: number; z: number }) => ({ x: r2(p.x), z: r2(p.z) });
  return {
    runId: state.runId,
    observedAt: r2(state.time),
    self: { id: self.id, position: pos(self.position), energy: r2(self.energy), inventory: self.inventory },
    bounds: state.bounds,
    visibleFood: Object.values(state.food)
      .filter((f) => f.units > 0 && near(f.position))
      .map((f) => ({ id: f.id, position: pos(f.position), units: f.units })),
    visibleAgents: Object.values(state.agents)
      .filter((a) => a.id !== self.id && near(a.position))
      .map((a) => ({ id: a.id, position: pos(a.position) })),
    visibleObstacles: Object.values(state.obstacles)
      .filter((o) => dist(o.position, self.position) - o.radius <= CONFIG.senseRadius)
      .map((o) => ({ id: o.id, position: pos(o.position), radius: o.radius })),
    messages: self.inbox.map((m) => ({ ...m })),
    recentOutcomes: self.recentOutcomes.map(({ actionType, ok, detail }) => ({ actionType, ok, detail })),
  };
}
