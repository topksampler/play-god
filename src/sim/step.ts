import { BIOMES, HAZARDS, ITEMS } from '../shared/catalog';
import { CONFIG } from '../shared/config';
import type { Agent, AgentMemory, Decision, SimCommand, Vec2, Weather, WorldEdit, WorldState } from '../shared/types';
import { interrupt, recordOutcome, runAction } from './actions';
import { nearStructure, senseRadius } from './environment';
import { contextTags } from './communication';
import { ageOf, stageOf, stepLife } from './life';
import { blocked, clampToBounds, dist } from './geometry';
import { addNode, addObstacle, biomeAt, createInitialWorld, logEvent, milestone, newId, type Rng, sampleFreeSpot, spawnAgents, track } from './world';
import { NODES } from '../shared/catalog';

export { runAction };

function isCurrent(state: WorldState, cmd: { agentId: string; runId: string; seq: number }) {
  const a = state.agents[cmd.agentId];
  return a && cmd.runId === state.runId && cmd.seq === a.controller.requestSeq ? a : null;
}

function sanitizeMemory(m: AgentMemory): AgentMemory {
  return {
    notes: m.notes.slice(0, CONFIG.notesMaxChars),
    places: m.places.slice(0, CONFIG.maxPlaces).map((p) => ({ label: p.label.slice(0, 40), x: p.x, z: p.z })),
    beliefs: m.beliefs.slice(0, CONFIG.maxBeliefs).map((b) => ({ appearance: b.appearance.slice(0, 80), verdict: b.verdict })),
  };
}

const describeAction = (a: Decision['plan'][number]) => {
  const { type, ...rest } = a as Record<string, unknown>;
  const parts = Object.values(rest).map((v) =>
    Array.isArray(v) ? `"${v.join(' ')}"`
      : v && typeof v === 'object' && 'x' in v ? `(${(v as unknown as Vec2).x.toFixed(0)},${(v as unknown as Vec2).z.toFixed(0)})`
      : String(v),
  );
  return parts.length ? `${type} ${parts.join(' ')}` : String(type);
};

/** Record what changed in the agent's self-authored memory (beliefs, places) on its timeline. */
function trackMemoryChanges(state: WorldState, agent: Agent, next: AgentMemory) {
  const prev = new Map(agent.memory.beliefs.map((b) => [b.appearance, b.verdict]));
  for (const b of next.beliefs) {
    const was = prev.get(b.appearance);
    if (was === undefined) track(state, agent, 'memory', `new belief: "${b.appearance}" → ${b.verdict}`);
    else if (was !== b.verdict) track(state, agent, 'memory', `changed belief: "${b.appearance}" ${was} → ${b.verdict}`);
  }
  const known = new Set(agent.memory.places.map((p) => p.label));
  const added = next.places.filter((p) => !known.has(p.label));
  if (added.length) track(state, agent, 'memory', `remembered ${added.map((p) => `${p.label} (${p.x.toFixed(0)},${p.z.toFixed(0)})`).join(', ')}`);
  const forgotten = agent.memory.places.filter((p) => !next.places.some((q) => q.label === p.label));
  if (forgotten.length) track(state, agent, 'memory', `forgot ${forgotten.map((p) => p.label).join(', ')}`);
}

function applyDecision(state: WorldState, agent: Agent, decision: Decision) {
  agent.turn += 1;
  track(
    state, agent, 'turn',
    `Turn ${agent.turn} · because ${agent.controller.interruptReason ?? 'scheduled'} → ${decision.plan.map(describeAction).join(' → ')}${decision.intent ? ` · intent: ${decision.intent}` : ''}`,
    true,
    decision.plan,
  );
  if (decision.memory) {
    const next = sanitizeMemory(decision.memory);
    trackMemoryChanges(state, agent, next);
    agent.memory = next;
  }
  agent.intent = decision.intent ? decision.intent.slice(0, CONFIG.intentMaxChars) : null;
  agent.controller.lastPlan = decision.plan;
  if (agent.status === 'dead') return;
  // A new plan replaces whatever was running.
  if (agent.status === 'resting') agent.status = 'active';
  agent.current = null;
  agent.target = null;
  agent.sprinting = false;
  agent.plan = decision.plan.slice(0, CONFIG.maxPlanLength);
}

export function applyWorldEdit(state: WorldState, edit: WorldEdit, source: string, rng: Rng) {
  const log = (ok: boolean, text: string) => logEvent(state, { kind: 'edit', ok, text: `[${source}] ${text}` });
  switch (edit.type) {
    case 'add_resource': {
      const p = clampToBounds(edit.position, state.bounds, 1);
      if (blocked(state, p, 0.5)) return log(false, 'add_resource rejected: position blocked');
      const id = addNode(state, edit.kind, p);
      return log(true, `added ${edit.kind} ${id} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
    }
    case 'remove_resource':
      if (!state.resources[edit.nodeId]) return log(false, `remove_resource rejected: no ${edit.nodeId}`);
      delete state.resources[edit.nodeId];
      return log(true, `removed ${edit.nodeId}`);
    case 'add_obstacle': {
      const p = clampToBounds(edit.position, state.bounds, edit.radius);
      if (blocked(state, p, edit.radius)) return log(false, 'add_obstacle rejected: overlaps obstacle or agent');
      const o = addObstacle(state, edit.shape, p, rng, edit.radius);
      return log(true, `added ${edit.shape} ${o.id} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
    }
    case 'add_hazard': {
      const p = clampToBounds(edit.position, state.bounds, 1);
      const id = newId(state, 'h');
      state.hazards[id] = { id, kind: edit.kind, position: p, radius: edit.radius };
      return log(true, `added ${edit.kind} hazard ${id}`);
    }
    case 'set_weather':
      setWeather(state, edit.weather, rng);
      return log(true, `weather set to ${edit.weather}`);
    case 'spawn_agents':
      spawnAgents(state, edit.count, edit.controller, state.defaultTier, rng);
      return;
  }
}

/** Applies a queued command at a simulation boundary. Returns a replacement state on reset. */
export function applyCommand(state: WorldState, cmd: SimCommand, rng: Rng, nextRunId: () => string): WorldState {
  switch (cmd.type) {
    case 'pause':
      state.paused = true;
      for (const a of Object.values(state.agents)) {
        a.controller.pending = false;
        a.controller.requestSeq += 1; // invalidate anything in flight
      }
      logEvent(state, { kind: 'system', ok: true, text: 'Paused' });
      return state;
    case 'resume':
      state.paused = false;
      for (const a of Object.values(state.agents)) interrupt(a, 'resumed');
      logEvent(state, { kind: 'system', ok: true, text: 'Resumed' });
      return state;
    case 'reset':
      return createInitialWorld(nextRunId(), state.defaultController, {
        seed: cmd.seed ?? state.seed,
        defaultTier: state.defaultTier,
        experiment: {
          commMode: state.experiment.commMode, traits: state.experiment.traits, scarcity: state.experiment.scarcity,
          lifespanSec: state.experiment.lifespanSec, inheritance: state.experiment.inheritance, ...cmd.experiment,
        },
      });
    case 'spawnAgents':
      spawnAgents(state, cmd.count, cmd.controller, cmd.tier ?? state.defaultTier, rng);
      return state;
    case 'setController': {
      const a = state.agents[cmd.agentId];
      if (!a) return state;
      a.controller.kind = cmd.controller;
      if (cmd.tier) a.controller.tier = cmd.tier;
      // Before its first decision, a controller change is part of the agent's starting endowment.
      if (a.turn === 0) {
        a.baseline.controller = a.controller.kind;
        a.baseline.tier = a.controller.tier;
      }
      a.controller.lastError = null;
      a.controller.errorStreak = 0;
      a.controller.pending = false;
      a.controller.requestSeq += 1;
      interrupt(a, 'controller changed');
      logEvent(state, {
        kind: 'system', agentId: a.id, ok: true,
        text: `${a.id} controller → ${cmd.controller}${cmd.controller === 'llm' ? ` (${a.controller.tier})` : ''}`,
      });
      return state;
    }
    case 'setDefaultController':
      state.defaultController = cmd.controller;
      if (cmd.tier) state.defaultTier = cmd.tier;
      return state;
    case 'edit':
      applyWorldEdit(state, cmd.edit, cmd.source, rng);
      return state;
    case 'decisionStarted': {
      const a = state.agents[cmd.agentId];
      if (!a || cmd.runId !== state.runId || cmd.seq <= a.controller.requestSeq) return state;
      a.controller.requestSeq = cmd.seq;
      a.controller.pending = true;
      a.controller.lastDecisionAt = state.time;
      a.controller.lastObservation = cmd.observation;
      a.controller.needsDecision = false;
      return state;
    }
    case 'decisionResult': {
      const a = isCurrent(state, cmd);
      if (!a) return state; // stale: old run, removed agent, or superseded request
      a.controller.pending = false;
      a.controller.lastError = null;
      a.controller.errorStreak = 0;
      a.controller.lastLatencyMs = cmd.latencyMs;
      applyDecision(state, a, cmd.decision);
      return state;
    }
    case 'decisionError': {
      const a = isCurrent(state, cmd);
      if (!a) return state;
      a.controller.pending = false;
      a.controller.lastError = cmd.error;
      a.controller.errorStreak += 1;
      a.controller.lastPlan = [{ type: 'wait' }];
      logEvent(state, { kind: 'error', agentId: a.id, ok: false, text: `${a.id} decision failed: ${cmd.error}` });
      track(state, a, 'error', `decision failed: ${cmd.error.slice(0, 160)}`, false);
      return state;
    }
  }
}

// ---------- ecology, weather, body ----------

const WEATHER_NEXT: Record<Weather, [Weather, number][]> = {
  clear: [['cloudy', 1]],
  cloudy: [['rain', 0.5], ['clear', 0.5]],
  rain: [['storm', 0.35], ['cloudy', 0.65]],
  storm: [['rain', 1]],
};

function setWeather(state: WorldState, w: Weather, rng: Rng) {
  if (state.weather !== w) logEvent(state, { kind: 'weather', ok: true, text: `Weather: ${state.weather} → ${w}` });
  state.weather = w;
  state.nextWeatherAt = state.time + 60 + rng() * 60;
}

const SPREADS = new Set(['berry_bush', 'fruit_tree', 'mushroom_patch', 'toxic_mushroom_patch', 'herb_patch', 'moss_patch', 'fiber_grass', 'cactus']);

/** Slow ecological change: full plants seed neighbours (per-biome cap); patches left at 0 too long wither away. */
function stepSuccession(state: WorldState, rng: Rng) {
  const counts = new Map<string, number>();
  for (const r of Object.values(state.resources)) counts.set(`${r.biome}:${r.kind}`, (counts.get(`${r.biome}:${r.kind}`) ?? 0) + 1);
  for (const r of Object.values(state.resources)) {
    if (r.depletedSince !== null && state.time - r.depletedSince > CONFIG.witherAfterSec && SPREADS.has(r.kind)) {
      delete state.resources[r.id];
      logEvent(state, { kind: 'ecology', ok: false, text: `${r.id} (${r.kind.replace(/_/g, ' ')}) withered after being stripped bare` });
      continue;
    }
    const key = `${r.biome}:${r.kind}`;
    if (!SPREADS.has(r.kind) || r.units < r.maxUnits || (counts.get(key) ?? 0) >= CONFIG.maxNodesPerKindPerBiome) continue;
    if (rng() > CONFIG.spreadChance) continue;
    const p = sampleFreeSpot(state, rng, { near: r.position, within: CONFIG.spreadRadius, biome: r.biome, radius: 0.8, clearOf: 1.8 });
    if (!p) continue;
    const id = addNode(state, r.kind, p);
    state.resources[id].units = 1;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    logEvent(state, { kind: 'ecology', ok: true, text: `${NODES[r.kind].appearance} spread: new ${id} near ${r.id}` });
  }
}

function stepEcology(state: WorldState, dt: number, rng: Rng) {
  for (const r of Object.values(state.resources)) {
    if (r.units < r.maxUnits) r.units = Math.min(r.maxUnits, r.units + (r.regrowPerMin * dt) / 60);
    if (r.units < 1) r.depletedSince ??= state.time;
    else r.depletedSince = null;
  }
  if (state.time >= state.nextEcologyAt) {
    state.nextEcologyAt = state.time + CONFIG.ecologyIntervalSec;
    stepSuccession(state, rng);
  }
  if (state.time >= state.nextWeatherAt) {
    const opts = WEATHER_NEXT[state.weather];
    let roll = rng();
    let next = opts[opts.length - 1][0];
    for (const [w, p] of opts) {
      if ((roll -= p) <= 0) {
        next = w;
        break;
      }
    }
    setWeather(state, next, rng);
  }
  const spoil = (items: { kind: string; label: string; spoilsAt: number | null }[]) => {
    for (const i of items) {
      if (i.spoilsAt !== null && i.spoilsAt <= state.time) {
        i.kind = 'rotten_food';
        i.label = `rotting ${i.label.replace(/^rotting /, '')}`;
        i.spoilsAt = null;
      }
    }
  };
  for (const s of Object.values(state.structures)) if (s.items) spoil(s.items);
  spoil(Object.values(state.groundItems).map((g) => g.item));
}

function damage(state: WorldState, a: Agent, amount: number, cause: string) {
  if (amount <= 0) return;
  a.health = Math.max(0, a.health - amount);
  a.stats.damageTaken += amount;
  // Log and interrupt once per damage episode, not every tick.
  if (state.time - a.lastDamageAt > 3) {
    logEvent(state, { kind: 'hazard', agentId: a.id, ok: false, text: `${a.id} hurt by ${cause}` });
    recordOutcome(state, a, a.current?.action.type ?? 'wait', false, `you are being hurt by ${cause}`, false, false);
    track(state, a, 'hurt', `hurt by ${cause} (health ${a.health.toFixed(0)})`, false);
    interrupt(a, `hurt by ${cause}`);
  }
  a.lastDamageAt = state.time;
}

function stepBody(state: WorldState, a: Agent, dt: number, rng: Rng) {
  const biome = BIOMES[biomeAt(state, a.position)];
  const sheltered = Boolean(nearStructure(state, a, 'shelter', CONFIG.shelterRadius));
  const fire = Boolean(nearStructure(state, a, 'campfire', CONFIG.campfireRadius));
  const storm = state.weather === 'storm' && !sheltered ? CONFIG.stormDrainMultiplier : 1;
  const sprinting = a.sprinting && Boolean(a.target) && a.stamina > 0;
  const warm = (fire ? 0.7 : 1) * (stageOf(state, a) === 'elder' ? 1.3 : 1);
  const prev = { energy: a.energy, hydration: a.hydration, health: a.health };

  a.energy -= CONFIG.energyDrainPerSec * biome.energyDrainMul * storm * warm * (sprinting ? 1.5 : 1) * dt;
  a.hydration -= CONFIG.hydrationDrainPerSec * biome.thirstMul * (sprinting ? 1.5 : 1) * dt;
  if ((state.weather === 'rain' || state.weather === 'storm') && !sheltered) a.hydration += CONFIG.rainHydrationPerSec * dt;
  if (sprinting) a.stamina -= CONFIG.staminaSprintCostPerSec * dt;
  else if (a.status !== 'resting') a.stamina += CONFIG.staminaRegenPerSec * dt;
  if (a.sickUntil > state.time) a.energy -= CONFIG.sickEnergyLossPerSec * dt;
  if (a.poisonedUntil > state.time) damage(state, a, CONFIG.poisonHealthLossPerSec * dt, 'poison');
  if (a.energy <= 0) damage(state, a, CONFIG.starvingHealthLossPerSec * dt, 'starvation');
  if (a.hydration <= 0) damage(state, a, CONFIG.starvingHealthLossPerSec * dt, 'dehydration');

  for (const h of Object.values(state.hazards)) {
    if (dist(h.position, a.position) >= h.radius) continue;
    const def = HAZARDS[h.kind];
    damage(state, a, def.damagePerSec * dt, h.kind);
    if (def.poisonChancePerSec && rng() < def.poisonChancePerSec * dt) {
      a.poisonedUntil = Math.max(a.poisonedUntil, state.time + 12);
      a.stats.poisonings++;
      damage(state, a, 5, `${h.kind} bite`);
    }
    if (def.hitChancePerSec && rng() < def.hitChancePerSec * dt) damage(state, a, def.hitDamage ?? 10, h.kind);
  }

  a.energy = Math.max(0, Math.min(CONFIG.maxVital, a.energy));
  a.hydration = Math.max(0, Math.min(CONFIG.maxVital, a.hydration));
  a.stamina = Math.max(0, Math.min(CONFIG.maxVital, a.stamina));
  if (a.stamina <= 0) a.sprinting = false;

  for (const [k, label] of [['energy', 'hungry'], ['hydration', 'thirsty'], ['health', 'badly hurt']] as const) {
    if (prev[k] > 25 && a[k] <= 25) interrupt(a, `${label} (${k} ${a[k].toFixed(0)})`);
  }

  // Carried food spoils.
  for (const i of a.items) {
    if (i.spoilsAt !== null && i.spoilsAt <= state.time && ITEMS[i.kind].spoilSec) {
      recordOutcome(state, a, 'wait', false, `${i.label} [${i.id}] has gone rotten`, false, false);
      i.kind = 'rotten_food';
      i.label = `rotting ${i.label}`;
      i.spoilsAt = null;
    }
  }

  if (a.health <= 0) {
    a.deathCause ??= a.poisonedUntil > state.time ? 'poison' : a.energy <= 0 ? 'starvation' : a.hydration <= 0 ? 'dehydration' : 'injury';
    a.status = 'dead';
    a.courting = null;
    a.plan = [];
    a.current = null;
    a.target = null;
    a.controller.needsDecision = false;
    logEvent(state, { kind: 'death', agentId: a.id, ok: false, text: `✝ ${a.id} died of ${a.deathCause} at age ${ageOf(state, a).toFixed(0)}s (gen ${a.generation}, ${a.children.length} children)` });
    milestone(state, a, `Died of ${a.deathCause} after ${(state.time - a.bornAt).toFixed(0)}s`);
  }
}

function stepPlan(state: WorldState, a: Agent, dt: number, rng: Rng) {
  if (!a.current && a.plan.length) a.current = { action: a.plan.shift()!, startedAt: state.time, progress: 0 };
  if (!a.current) return;
  const status = runAction(state, a, a.current, dt, rng);
  if (status === 'ongoing') return;
  if (a.status === 'resting') a.status = 'active';
  a.current = null;
  if (status === 'failed') {
    a.plan = [];
    interrupt(a, 'action failed');
  } else if (!a.plan.length) {
    interrupt(a, 'plan complete');
  }
}

const BIOME_NAMES: Record<string, string> = { meadow: 'the meadow', forest: 'the forest', lake: 'the lakeshore', highlands: 'the highlands', scrub: 'the scrubland', swamp: 'the swamp' };

/** Periodic growth samples + exposure tracking (what each agent has perceived, where it has been). */
function sample(state: WorldState) {
  let food = 0, water = 0, materials = 0, harmful = 0;
  for (const r of Object.values(state.resources)) {
    const u = Math.floor(r.units);
    if (r.kind === 'fresh_water') water++;
    else if (r.kind === 'toxic_water' || r.kind === 'toxic_mushroom_patch') harmful += r.kind === 'toxic_water' ? 1 : u;
    else if (r.kind === 'wood_pile' || r.kind === 'stone_pile' || r.kind === 'fiber_grass') materials += u;
    else food += u;
  }
  const agents = Object.values(state.agents);
  state.history.push({
    t: state.time, food, water, materials, harmful, patches: Object.keys(state.resources).length,
    alive: agents.filter((a) => a.status !== 'dead').length, structures: Object.keys(state.structures).length,
    births: state.births.length, generations: Math.max(0, ...agents.map((a) => a.generation)),
  });
  if (state.history.length > CONFIG.growthMax) state.history.shift();
  for (const a of agents) {
    if (a.status === 'dead') continue;
    state.contextBase.samples++;
    for (const c of contextTags(state, a)) state.contextBase.counts[c] = (state.contextBase.counts[c] ?? 0) + 1;
    const biome = biomeAt(state, a.position);
    if (!a.biomesVisited.includes(biome)) {
      a.biomesVisited.push(biome);
      if (a.biomesVisited.length > 1) milestone(state, a, `Entered ${BIOME_NAMES[biome]} for the first time`);
    }
    const r = senseRadius(state, a);
    for (const n of Object.values(state.resources)) {
      if (dist(n.position, a.position) > r) continue;
      const look = NODES[n.kind].appearance;
      if (!a.discovered.includes(look)) {
        a.discovered.push(look);
        if (a.discovered.length > 1) track(state, a, 'milestone', `Discovered: ${look}`);
      }
    }
    a.growth.push({
      t: state.time, energy: a.energy, hydration: a.hydration, health: a.health, stamina: a.stamina, items: a.items.length,
      eaten: a.stats.eaten, distance: a.stats.distance, discoveries: a.discovered.length, beliefs: a.memory.beliefs.length,
      places: a.memory.places.length, messages: a.messagesSent + a.messagesHeard,
    });
    if (a.growth.length > CONFIG.growthMax) a.growth.shift();
  }
}

/** Advances the world by one fixed timestep. */
export function stepWorld(state: WorldState, dt: number, rng: Rng = Math.random) {
  if (state.paused) return;
  state.time += dt;
  if (state.time >= state.nextSampleAt) {
    state.nextSampleAt = state.time + CONFIG.sampleEverySec;
    sample(state);
  }
  stepEcology(state, dt, rng);
  stepLife(state);
  for (const m of Object.values(state.marks)) if (m.expiresAt <= state.time) delete state.marks[m.id];
  if (state.deliveries.length && state.time - state.deliveries[0].at > 3) state.deliveries.shift();
  for (const a of Object.values(state.agents)) {
    if (a.gesture && a.gesture.until <= state.time) a.gesture = null;
    if (a.status === 'dead') continue;
    stepPlan(state, a, dt, rng);
    stepBody(state, a, dt, rng);
    if (a.inbox.length) a.inbox = a.inbox.filter((m) => state.time - m.sentAt <= CONFIG.messageTtlSec);
  }
}

