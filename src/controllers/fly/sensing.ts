import { CONFIG } from '../../shared/config';
import type { Agent, WorldState } from '../../shared/types';
import { FLY_ODOR } from '../../sim/fly';
import type { FlySensors } from './body';

/** Antenna geometry in world units, relative to the fly's position and heading. */
export const ANTENNA = { forward: 0.3, side: 0.5 };

/** Taste contact persists this long after the simulator last reported it. */
const TASTE_HOLD_SEC = 0.15;

/**
 * Odor concentration at a point: a sum of Gaussian plumes from food nodes that currently hold food.
 * Radius-only: odor is not blocked by obstacles and there is no wind (a stated limitation).
 */
export function odorAt(state: WorldState, odor: 'A' | 'B', x: number, z: number): number {
  const sigma = CONFIG.flyOdorSigma;
  const s2 = 2 * sigma * sigma;
  const cutoff = 3.5 * sigma;
  let c = 0;
  for (const r of Object.values(state.resources)) {
    if (FLY_ODOR[r.kind] !== odor || r.units < 1) continue;
    const dx = x - r.position.x;
    const dz = z - r.position.z;
    if (Math.abs(dx) > cutoff || Math.abs(dz) > cutoff) continue;
    const strength = 0.4 + 0.6 * Math.min(1, r.units / r.maxUnits);
    c += strength * Math.exp(-(dx * dx + dz * dz) / s2);
  }
  return c;
}

/** What one fly's sense organs receive this tick. Uses only the fly's local surroundings, never global state. */
export function flySensors(state: WorldState, a: Agent, lastSentAt: number): FlySensors {
  const h = a.heading;
  const ax = a.position.x + ANTENNA.forward * Math.cos(h);
  const az = a.position.z + ANTENNA.forward * Math.sin(h);
  const rx = Math.cos(h + Math.PI / 2) * ANTENNA.side;
  const rz = Math.sin(h + Math.PI / 2) * ANTENNA.side;
  const taste = a.fly?.lastTaste;
  const touching = taste && state.time - taste.at <= TASTE_HOLD_SEC;
  return {
    odorA: [odorAt(state, 'A', ax - rx, az - rz), odorAt(state, 'A', ax + rx, az + rz)],
    odorB: [odorAt(state, 'B', ax - rx, az - rz), odorAt(state, 'B', ax + rx, az + rz)],
    sugarContact: Boolean(touching && taste.sugar),
    bitterContact: Boolean(touching && taste.bitter),
    energy: a.energy,
    ateThisTick: Boolean(taste?.ate && taste.at > lastSentAt),
  };
}
