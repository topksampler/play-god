import { CONFIG } from '../shared/config';
import type { Controller, Decision, Observation } from '../shared/types';

const d = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * SCRIPTED baseline (not an LLM): eat when hungry and carrying, approach nearest visible food, take, otherwise explore.
 */
export function scriptedDecide(obs: Observation, rng: () => number = Math.random): Decision {
  const { self } = obs;
  if (self.inventory > 0 && self.energy <= CONFIG.maxEnergy - CONFIG.eatEnergy) {
    return { action: { type: 'eat' }, intent: 'eat carried food' };
  }
  const food = [...obs.visibleFood].sort((a, b) => d(a.position, self.position) - d(b.position, self.position))[0];
  if (food && self.inventory < CONFIG.inventoryCapacity) {
    if (d(food.position, self.position) <= CONFIG.interactDistance * 0.9) {
      return { action: { type: 'take', foodId: food.id }, intent: `take from ${food.id}` };
    }
    return { action: { type: 'move', target: food.position }, intent: `go to ${food.id}` };
  }
  const { min, max } = obs.bounds;
  const target = { x: min.x + 2 + rng() * (max.x - min.x - 4), z: min.z + 2 + rng() * (max.z - min.z - 4) };
  return { action: { type: 'move', target }, intent: 'explore' };
}

export const scriptedController: Controller = {
  kind: 'scripted',
  async decide({ observation }) {
    return scriptedDecide(observation);
  },
};
