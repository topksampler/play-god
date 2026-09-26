import { CONFIG } from '../shared/config';
import type { Obstacle, Vec2, WorldState } from '../shared/types';

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

/** Distance from p to the obstacle's surface (negative = inside). Circles or oriented rectangles. */
export function obstacleDistance(o: Obstacle, p: Vec2): number {
  if (o.halfLength === undefined) return dist(p, o.position) - o.radius;
  const a = o.angle ?? 0;
  const dx = p.x - o.position.x;
  const dz = p.z - o.position.z;
  // Rotate into the rectangle's local frame (long axis = local x).
  const lx = dx * Math.cos(a) + dz * Math.sin(a);
  const lz = -dx * Math.sin(a) + dz * Math.cos(a);
  const qx = Math.abs(lx) - o.halfLength;
  const qz = Math.abs(lz) - o.radius;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qz, 0));
  return outside + Math.min(Math.max(qx, qz), 0);
}

/** True if a circle at p would overlap a solid obstacle, another agent, or leave the bounds. */
export function blocked(state: WorldState, p: Vec2, radius: number = CONFIG.agentRadius, ignoreAgentId?: string): boolean {
  if (!inBounds(p, state.bounds, radius)) return true;
  for (const o of Object.values(state.obstacles)) {
    if (o.solid && obstacleDistance(o, p) < radius) return true;
  }
  for (const a of Object.values(state.agents)) {
    if (a.id === ignoreAgentId || a.status === 'dead') continue;
    if (dist(p, a.position) < radius + CONFIG.agentRadius) return true;
  }
  return false;
}

const DIRS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
/** Compass bearing from a to b. North is -z, east is +x. */
export function bearing(a: Vec2, b: Vec2): string {
  const ang = Math.atan2(b.z - a.z, b.x - a.x); // 0 = east, +pi/2 = south (+z)
  const idx = Math.round(ang / (Math.PI / 4));
  return DIRS[(idx + 8) % 8];
}
