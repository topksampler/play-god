import { CONFIG } from '../shared/config';
import type { Action, AgentMemory, Controller, Decision, Observation, Vec2 } from '../shared/types';

/**
 * SCRIPTED baseline (hand-written heuristics, not an LLM). Uses only the observation and its own memory.
 * It carries a fixed "avoid" list of appearances, which LLM agents must instead learn from outcomes.
 */
const AVOID = /red-capped|red spotted|murky|rotting/;
const EDIBLE = /berries|fruit|mushroom|fish|honey|cactus/;
const FOOD_NODE = /berries|fruit|brown-capped|cactus|fish/;
const WATER = /clear, cool water/;
const HEALER = /herb|moss/;

const d = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

type Notes = { last?: string; avoid: string[] };
const readNotes = (m: AgentMemory): Notes => {
  try {
    const n = JSON.parse(m.notes || '{}');
    return { last: n.last, avoid: Array.isArray(n.avoid) ? n.avoid : [] };
  } catch {
    return { avoid: [] };
  }
};

export function scriptedDecide(obs: Observation, rng: () => number = Math.random, memory: AgentMemory = { notes: '', places: [], beliefs: [] }): Decision {
  const { self } = obs;
  const notes = readNotes(memory);
  // A failed gather/drink leaves that id on a short avoid list, so the agent does not retry the same blocked target.
  const lastOutcome = obs.recentOutcomes.at(-1);
  if (lastOutcome && !lastOutcome.ok && lastOutcome.secondsAgo < 5 && notes.last) notes.avoid = [...notes.avoid.filter((x) => x !== notes.last), notes.last].slice(-6);
  const places = [...memory.places];
  const remember = (label: string, p: Vec2) => {
    const i = places.findIndex((x) => x.label === label && d(x, p) < 3);
    if (i >= 0) places.splice(i, 1);
    places.push({ label, x: p.x, z: p.z });
    while (places.length > CONFIG.maxPlaces) places.shift();
  };
  for (const r of obs.visibleResources) {
    if (WATER.test(r.appearance)) remember('water', r.position);
    else if (FOOD_NODE.test(r.appearance) && !AVOID.test(r.appearance) && r.units > 0) remember('food', r.position);
  }
  const say = (plan: Action[], intent: string, target?: string): Decision => ({
    plan,
    intent,
    memory: { notes: JSON.stringify({ last: target, avoid: notes.avoid }).slice(0, CONFIG.notesMaxChars), places, beliefs: memory.beliefs },
  });
  const usable = (id: string) => !notes.avoid.includes(id);

  const items = self.items;
  const edible = items.filter((i) => EDIBLE.test(i.label) && !AVOID.test(i.label) && i.fresh);
  const healer = items.find((i) => HEALER.test(i.label));
  const rotten = items.find((i) => !i.fresh);
  const hazardHere = obs.visibleHazards.find((h) => h.distance === 0);
  const nearest = (label: string) => places.filter((p) => p.label === label).sort((a, b) => d(a, self.position) - d(b, self.position))[0];

  if (rotten) return say([{ type: 'drop', itemId: rotten.id }], 'drop rotten food');
  if (hazardHere) {
    const away = Math.atan2(self.position.z - hazardHere.position.z, self.position.x - hazardHere.position.x);
    const r = hazardHere.radius + 1.5;
    const target = clamp({ x: hazardHere.position.x + Math.cos(away) * r, z: hazardHere.position.z + Math.sin(away) * r }, obs);
    return say([{ type: 'move', target, sprint: self.stamina > 30 }], `get out of ${hazardHere.appearance}`);
  }
  if ((self.conditions.includes('poisoned') || self.conditions.includes('sick') || self.health < 50) && healer) return say([{ type: 'eat', itemId: healer.id }], 'heal');
  if (self.stamina < 20 || self.health < 30) return say([{ type: 'rest' }], 'rest');

  const water = obs.visibleResources.filter((r) => WATER.test(r.appearance) && usable(r.id)).sort((a, b) => a.distance - b.distance)[0];
  if (self.hydration < 60) {
    const cactus = items.find((i) => /cactus/.test(i.label));
    if (cactus) return say([{ type: 'eat', itemId: cactus.id }], 'quench thirst with cactus fruit');
    if (water) return say([{ type: 'drink', sourceId: water.id }], 'drink', water.id);
    const known = nearest('water');
    if (known && d(known, self.position) > 2) return say([{ type: 'move', target: { x: known.x, z: known.z }, sprint: self.hydration < 25 && self.stamina > 30 }], 'walk to remembered water');
  }
  if (self.energy < 70 && edible.length) return say([{ type: 'eat', itemId: edible[0].id }], 'eat');
  if (self.hydration < 85 && water && water.distance < 5) return say([{ type: 'drink', sourceId: water.id }], 'top up water nearby', water.id);
  if (self.health < 60) return say([{ type: 'rest' }], 'recover health');

  const room = items.length < self.capacity;
  const herb = obs.visibleResources.find((r) => HEALER.test(r.appearance) && r.units > 0 && usable(r.id));
  if (self.health < 80 && !healer && herb && room) return say([{ type: 'gather', nodeId: herb.id }], 'gather a healing herb', herb.id);
  const food = obs.visibleResources.find((r) => r.units > 0 && FOOD_NODE.test(r.appearance) && !AVOID.test(r.appearance) && usable(r.id));
  if (food && room && edible.length < 3) return say([{ type: 'gather', nodeId: food.id }], `gather from ${food.id}`, food.id);
  const knownFood = nearest('food');
  if (self.energy < 50 && !edible.length && knownFood && d(knownFood, self.position) > 3) return say([{ type: 'move', target: { x: knownFood.x, z: knownFood.z } }], 'walk to remembered food');

  // Explore: sample a few nearby points and pick one clear of visible obstacles/hazards and far from where it has been.
  let best: Vec2 = self.position;
  let bestScore = -Infinity;
  for (let i = 0; i < 10; i++) {
    const ang = rng() * Math.PI * 2;
    const r = 6 + rng() * 10;
    const t = clamp({ x: self.position.x + Math.cos(ang) * r, z: self.position.z + Math.sin(ang) * r }, obs);
    const bad =
      obs.visibleHazards.some((h) => d(h.position, t) < h.radius + 1.5) ||
      obs.visibleObstacles.some((o) => o.solid && d(o.position, t) < (o.halfLength ?? o.radius) + 0.8);
    const novelty = Math.min(...places.map((p) => d(p, t)), 30);
    const score = (bad ? -100 : 0) + novelty + rng();
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return say([{ type: 'move', target: best }], 'explore');
}

function clamp(p: Vec2, obs: Observation): Vec2 {
  const { min, max } = obs.bounds;
  return { x: Math.max(min.x + 2, Math.min(max.x - 2, p.x)), z: Math.max(min.z + 2, Math.min(max.z - 2, p.z)) };
}

export const scriptedController: Controller = {
  kind: 'scripted',
  async decide({ observation, memory }) {
    return scriptedDecide(observation, Math.random, memory);
  },
};
