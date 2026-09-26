import { CONFIG } from '../shared/config';
import type { Vec2, WorldState } from '../shared/types';

export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

export function clampToBounds(p: Vec2, bounds: WorldState['bounds'], margin = 0): Vec2 {
  return {
    x: Math.min(bounds.max.x - margin, Math.max(bounds.min.x + margin, p.x)),
    z: Math.min(bounds.max.z - margin, Math.max(bounds.min.z + margin, p.z)),
  };
}

export function inBounds(p: Vec2, bounds: WorldState['bounds'], margin = 0): boolean {
  return (
    p.x >= bounds.min.x + margin && p.x <= bounds.max.x - margin &&
    p.z >= bounds.min.z + margin && p.z <= bounds.max.z - margin
  );
}

/** True if a circle at p would overlap an obstacle, another agent, or leave the bounds. Obstacles are circles in P0. */
export function blocked(state: WorldState, p: Vec2, radius: number = CONFIG.agentRadius, ignoreAgentId?: string): boolean {
  if (!inBounds(p, state.bounds, radius)) return true;
  for (const o of Object.values(state.obstacles)) {
    if (dist(p, o.position) < o.radius + radius) return true;
  }
  for (const a of Object.values(state.agents)) {
    if (a.id === ignoreAgentId) continue;
    if (dist(p, a.position) < radius + CONFIG.agentRadius) return true;
  }
  return false;
}
