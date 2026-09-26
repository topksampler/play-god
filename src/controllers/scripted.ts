import type { Action, Controller, Decision, Observation } from '../shared/types';

/**
 * SCRIPTED baseline (hand-written heuristics, not an LLM). Uses only the observation.
 * It carries a fixed "avoid" list of appearances, which LLM agents must instead learn from outcomes.
 */
const AVOID = /red-capped|red spotted|murky|rotting/;
const EDIBLE = /berries|fruit|mushroom|fish|honey|cactus/;
const FOOD_NODE = /berries|fruit|brown-capped|cactus|fish/;

export function scriptedDecide(obs: Observation, rng: () => number = Math.random): Decision {
  const { self } = obs;
  const say = (plan: Action[], intent: string): Decision => ({ plan, intent });
  const items = self.items;
  const edible = items.filter((i) => EDIBLE.test(i.label) && !AVOID.test(i.label));
  const healer = items.find((i) => /herb|moss/.test(i.label));
  const rotten = items.find((i) => !i.fresh);

  if (rotten) return say([{ type: 'drop', itemId: rotten.id }], 'drop rotten food');
  if ((self.health < 50 || self.conditions.length) && healer) return say([{ type: 'eat', itemId: healer.id }], 'heal');
  if (self.hydration < 55) {
    const water = obs.visibleResources.find((r) => /clear, cool water/.test(r.appearance));
    const cactus = items.find((i) => /cactus/.test(i.label));
    if (cactus) return say([{ type: 'eat', itemId: cactus.id }], 'quench thirst with cactus fruit');
    if (water) return say([{ type: 'drink', sourceId: water.id }], 'drink');
  }
  if (self.energy < 70 && edible.length) return say([{ type: 'eat', itemId: edible[0].id }], 'eat');
  if (self.stamina < 20 || self.health < 30) return say([{ type: 'rest' }], 'rest');

  const food = obs.visibleResources.find((r) => r.units > 0 && FOOD_NODE.test(r.appearance) && !AVOID.test(r.appearance));

  // Hand-coded CONTROL protocol (proto mode only): the alphabetically-first sound means "food here".
  // Scripted agents share this code by construction, so it calibrates the Lab's emergence metrics.
  if (obs.self.voice.mode === 'proto' && obs.self.voice.sounds.length) {
    const code = [...obs.self.voice.sounds].sort()[0];
    const justSignalled = obs.recentOutcomes.slice(-2).some((o) => o.actionType === 'signal');
    const someoneNear = obs.visibleAgents.some((a) => a.distance < 7 && a.status !== 'dead');
    if (food && food.distance < 5 && someoneNear && !justSignalled) return say([{ type: 'signal', tokens: [code] }, { type: 'gather', nodeId: food.id }], `signal "${code}" (food) then gather`);
    const heard = obs.messages.filter((m) => m.text === code && obs.observedAt - m.sentAt < 10).at(-1);
    const speaker = heard && obs.visibleAgents.find((a) => a.id === heard.senderId);
    if (speaker && !food && self.energy < 85) return say([{ type: 'follow', agentId: speaker.id }], `heard "${code}" from ${speaker.id}: go to them`);
  }
  if (food && items.length < self.capacity && edible.length < 3) {
    return say([{ type: 'gather', nodeId: food.id }], `gather from ${food.id}`);
  }
  // Explore: pick a random nearby point, away from visible hazards.
  const { min, max } = obs.bounds;
  let target = self.position;
  for (let i = 0; i < 8; i++) {
    const ang = rng() * Math.PI * 2;
    const r = 6 + rng() * 10;
    const t = {
      x: Math.max(min.x + 2, Math.min(max.x - 2, self.position.x + Math.cos(ang) * r)),
      z: Math.max(min.z + 2, Math.min(max.z - 2, self.position.z + Math.sin(ang) * r)),
    };
    const nearHazard = obs.visibleHazards.some((h) => Math.hypot(h.position.x - t.x, h.position.z - t.z) < h.radius + 1.5);
    target = t;
    if (!nearHazard) break;
  }
  return say([{ type: 'move', target }], 'explore');
}

export const scriptedController: Controller = {
  kind: 'scripted',
  async decide({ observation }) {
    return scriptedDecide(observation);
  },
};
