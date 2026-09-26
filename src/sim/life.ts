import { AGENT_COLORS, CONFIG } from '../shared/config';
import type { Agent, LifeStage, Trait, WorldState } from '../shared/types';
import { dist } from './geometry';
import { createAgent, logEvent, milestone, newId, type Rng, sampleFreeSpot, TRAITS, track, traitMods } from './world';

export const ageOf = (state: WorldState, a: Agent) => state.time - a.bornAt;

export function stageOf(state: WorldState, a: Agent): LifeStage {
  const age = ageOf(state, a);
  if (a.generation > 0 && age < CONFIG.childSec) return 'child';
  const life = state.experiment.lifespanSec;
  if (life > 0 && age > life * 0.8) return 'elder';
  return 'adult';
}

export const livingCount = (state: WorldState) => Object.values(state.agents).filter((a) => a.status !== 'dead').length;

export const TRAIT_LOOKS: Record<Trait, string> = { keen_eyes: 'keen-eyed', strong: 'broad and strong', swift: 'lean and quick', hardy: 'tough-skinned' };

/** Why this agent cannot currently become a parent (or null if it can). */
export function mateBlocker(state: WorldState, a: Agent): string | null {
  if (a.status === 'dead') return 'dead';
  if (stageOf(state, a) === 'child') return 'still a child';
  if (a.energy < CONFIG.mateMinEnergy) return `too hungry (energy ${a.energy.toFixed(0)} < ${CONFIG.mateMinEnergy})`;
  if (a.health < CONFIG.mateMinHealth) return `too hurt (health ${a.health.toFixed(0)} < ${CONFIG.mateMinHealth})`;
  if (state.time - a.lastBirthAt < CONFIG.birthCooldownSec) return `recovering from a recent birth (${(CONFIG.birthCooldownSec - (state.time - a.lastBirthAt)).toFixed(0)}s)`;
  return null;
}

function blendColor(a: string, b: string) {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return '#' + x.map((v, i) => Math.round((v + y[i]) / 2).toString(16).padStart(2, '0')).join('');
}

/** Two agents chose each other: create a child if both can, else record why not. */
export function tryBirth(state: WorldState, a: Agent, b: Agent, rng: Rng): { ok: boolean; detail: string; childId?: string } {
  const block = mateBlocker(state, a) ?? mateBlocker(state, b);
  if (block) return { ok: false, detail: `no offspring: ${mateBlocker(state, a) ? a.id : b.id} ${block}` };
  if (livingCount(state) >= CONFIG.maxPopulation) return { ok: false, detail: `no offspring: the land is full (${CONFIG.maxPopulation} living)` };
  const mid = { x: (a.position.x + b.position.x) / 2, z: (a.position.z + b.position.z) / 2 };
  const spot = sampleFreeSpot(state, rng, { near: mid, within: 2.5 });
  if (!spot) return { ok: false, detail: 'no offspring: no room here' };
  const child = createAgent(state, spot, a.controller.kind, rng() < 0.5 ? a.controller.tier : b.controller.tier, rng);
  // Inheritance: one parent's trait, with occasional mutation.
  if (state.experiment.traits) {
    const pool = [...a.traits, ...b.traits];
    const all = Object.keys(TRAITS) as Trait[];
    const t = rng() < CONFIG.mutationChance || !pool.length ? all[Math.floor(rng() * all.length)] : pool[Math.floor(rng() * pool.length)];
    child.traits = [t];
    const m = traitMods(child.traits);
    child.capacity = CONFIG.baseCapacity + m.extraCapacity;
    child.baseline = { ...child.baseline, traits: child.traits, capacity: child.capacity, senseMul: m.senseMul, speedMul: m.speedMul, poisonResist: m.poisonResist };
  }
  if (state.experiment.inheritance === 'beliefs') {
    const seen = new Set<string>();
    child.memory.beliefs = [...a.memory.beliefs, ...b.memory.beliefs].filter((x) => !seen.has(x.appearance) && seen.add(x.appearance)).slice(0, CONFIG.maxBeliefs);
  }
  child.generation = Math.max(a.generation, b.generation) + 1;
  child.parents = [a.id, b.id];
  child.color = blendColor(a.color, b.color) || AGENT_COLORS[0];
  child.energy = child.hydration = CONFIG.childStartVital;
  child.baseline.energy = child.baseline.hydration = CONFIG.childStartVital;
  state.agents[child.id] = child;
  for (const p of [a, b]) {
    p.energy -= CONFIG.mateEnergyCost;
    p.lastBirthAt = state.time;
    p.children.push(child.id);
    p.courting = null;
    milestone(state, p, p.children.length === 1 ? `Became a parent: ${child.id} with ${p === a ? b.id : a.id}` : `Another child: ${child.id} with ${p === a ? b.id : a.id}`);
  }
  state.births.push({ at: state.time, child: child.id, parents: [a.id, b.id] });
  track(state, child, 'milestone', `Born to ${a.id} and ${b.id} (generation ${child.generation})`);
  logEvent(state, { kind: 'spawn', agentId: child.id, ok: true, text: `👶 ${child.id} born to ${a.id} + ${b.id} (gen ${child.generation}${child.traits.length ? `, ${child.traits[0]}` : ''})` });
  return { ok: true, detail: `offspring ${child.id} born`, childId: child.id };
}

/** Per-tick life cycle: courtship expiry and death of old age. */
export function stepLife(state: WorldState) {
  for (const a of Object.values(state.agents)) {
    if (a.courting && a.courting.until <= state.time) {
      const c = [...state.courtships].reverse().find((x) => x.from === a.id && x.to === a.courting!.target && x.outcome === 'pending');
      if (c) {
        c.outcome = 'expired';
        c.endedAt = state.time;
      }
      track(state, a, 'said', `courtship of ${a.courting.target} was not returned`, false);
      a.courting = null;
    }
    const life = state.experiment.lifespanSec;
    if (life > 0 && a.status !== 'dead' && ageOf(state, a) >= life) {
      a.health = 0;
      a.deathCause = 'old age';
    }
  }
}

export function recordCourtship(state: WorldState, from: Agent, to: Agent) {
  state.courtships.push({ id: newId(state, 'c'), at: state.time, from: from.id, to: to.id, outcome: 'pending' });
  if (state.courtships.length > 1000) state.courtships.shift();
}

export const closeEnough = (a: Agent, b: Agent) => dist(a.position, b.position) <= CONFIG.courtDistance;
