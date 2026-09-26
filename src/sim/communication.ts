import { NODES } from '../shared/catalog';
import { CONFIG } from '../shared/config';
import type { Agent, Utterance, WorldState } from '../shared/types';
import { timeOfDay } from './environment';
import { dist } from './geometry';
import { newId } from './world';

const EDIBLE = new Set(['berry_bush', 'fruit_tree', 'mushroom_patch', 'fish_spot', 'cactus', 'honey_hive']);
const HARMFUL = new Set(['toxic_mushroom_patch', 'toxic_water']);

/**
 * The sender's actual situation when it communicated (ground truth, never shown to agents).
 * Used to test whether signals come to be associated with consistent situations.
 */
export function contextTags(state: WorldState, a: Agent): string[] {
  const tags = new Set<string>();
  for (const r of Object.values(state.resources)) {
    const d = dist(r.position, a.position);
    if (d > 5) continue;
    if (EDIBLE.has(r.kind) && r.units >= 1) tags.add('food-near');
    if (HARMFUL.has(r.kind)) tags.add('harmful-near');
    if (r.kind === 'fresh_water') tags.add('water-near');
    if (NODES[r.kind].yields && ['wood', 'stone', 'fiber'].includes(NODES[r.kind].yields!)) tags.add('material-near');
  }
  for (const h of Object.values(state.hazards)) if (dist(h.position, a.position) < h.radius + 2) tags.add('hazard-near');
  if (state.time - a.lastDamageAt < 5) tags.add('hurt');
  if (a.energy < 40) tags.add('hungry');
  if (a.hydration < 40) tags.add('thirsty');
  if (a.items.some((i) => ['berries', 'fruit', 'mushroom', 'fish', 'cooked_fish', 'cactus_fruit', 'honey', 'cooked_mushroom'].includes(i.kind))) tags.add('carrying-food');
  if (Object.values(state.agents).some((o) => o.id !== a.id && o.status !== 'dead' && dist(o.position, a.position) < 4)) tags.add('agent-close');
  if (timeOfDay(state.time) === 'night') tags.add('night');
  if (state.weather === 'storm') tags.add('storm');
  return [...tags].sort();
}

export function hearersOf(state: WorldState, a: Agent, radius = CONFIG.commRadius) {
  return Object.values(state.agents).filter((r) => r.id !== a.id && r.status !== 'dead' && dist(r.position, a.position) <= radius);
}

export function recordUtterance(state: WorldState, a: Agent, channel: Utterance['channel'], content: string, hearers: Agent[]) {
  const u: Utterance = {
    id: newId(state, 'u'), at: state.time, speaker: a.id, channel, content,
    hearers: hearers.map((h) => h.id), context: contextTags(state, a), where: { ...a.position },
  };
  state.utterances.push(u);
  if (state.utterances.length > CONFIG.utterancesMax) state.utterances.shift();
  if (hearers.length) {
    state.deliveries.push({ at: state.time, from: a.id, to: u.hearers, channel });
    if (state.deliveries.length > 40) state.deliveries.shift();
  }
  return u;
}
