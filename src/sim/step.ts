import { BIOMES, HAZARDS, ITEMS } from '../shared/catalog';
import { CONFIG } from '../shared/config';
import type { Agent, AgentMemory, Decision, SimCommand, Weather, WorldEdit, WorldState } from '../shared/types';
import { interrupt, recordOutcome, runAction } from './actions';
import { nearStructure } from './environment';
import { blocked, clampToBounds, dist } from './geometry';
import { addNode, addObstacle, biomeAt, createInitialWorld, logEvent, newId, type Rng, sampleFreeSpot, spawnAgents } from './world';
import { NODES } from '../shared/catalog';
import { applyFlyMotors, stepFly } from './fly';

export { runAction };

function isCurrent(state: WorldState, cmd: { agentId: string; runId: string; seq: number }) {
  const a = state.agents[cmd.agentId];
  // `pending` guards the race where a controller switch bumped requestSeq before decisionStarted was applied.
  return a && cmd.runId === state.runId && cmd.seq === a.controller.requestSeq && a.controller.pending ? a : null;
}

/** Interrupts that must trigger a fresh decision even if one just arrived. Messages etc. wait for the next one. */
const URGENT = /hurt|hungry|thirsty|poison/;

function sanitizeMemory(m: AgentMemory): AgentMemory {
  return {
    notes: m.notes.slice(0, CONFIG.notesMaxChars),
    places: m.places.slice(0, CONFIG.maxPlaces).map((p) => ({ label: p.label.slice(0, 40), x: p.x, z: p.z })),
    beliefs: m.beliefs.slice(0, CONFIG.maxBeliefs).map((b) => ({ appearance: b.appearance.slice(0, 80), verdict: b.verdict })),
  };
}

const sameAction = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function applyDecision(state: WorldState, agent: Agent, decision: Decision) {
  if (decision.memory) agent.memory = sanitizeMemory(decision.memory);
  agent.intent = decision.intent ? decision.intent.slice(0, CONFIG.intentMaxChars) : null;
  agent.controller.lastPlan = decision.plan;
  if (agent.status === 'dead') return;
  let plan = decision.plan.slice(0, CONFIG.maxPlanLength);
  // If the new plan starts with the action already running, keep it running instead of restarting it.
  if (agent.current && sameAction(plan[0], agent.current.action)) {
    agent.plan = plan.slice(1);
    return;
  }
  // Otherwise the new plan replaces whatever was running.
  if (agent.status === 'resting') agent.status = 'active';
  agent.current = null;
  agent.target = null;
  agent.route = null;
  agent.sprinting = false;
  agent.plan = plan;
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
    case 'spawn_agents': {
      // Creatures always match the world's population type; plan agents use the current default controller.
      const controller = state.mode === 'flies' ? 'fly' : edit.controller === 'fly' ? state.defaultController : edit.controller;
      const ids = spawnAgents(state, edit.count, controller, state.defaultTier, rng);
      return log(ids.length > 0, `spawned ${ids.length} ${state.mode === 'flies' ? 'flies' : 'agents'}${ids.length ? `: ${ids.join(', ')}` : ''}`);
    }
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
        mode: cmd.mode ?? state.mode,
        flyCapacity: state.flyCapacity,
      });
    case 'spawnAgents':
      spawnAgents(state, cmd.count, cmd.controller, cmd.tier ?? state.defaultTier, rng);
      return state;
    case 'flyCapacity':
      state.flyCapacity = Math.max(0, Math.floor(cmd.capacity));
      return state;
    case 'flyMotors':
      if (cmd.runId === state.runId && !state.paused) applyFlyMotors(state, cmd.motors);
      return state;
    case 'flyBrainError':
      if (cmd.runId !== state.runId) return state;
      for (const id of cmd.agentIds) {
        const a = state.agents[id];
        if (!a?.fly) continue;
        a.fly.brainStatus = 'error';
        a.controller.lastError = cmd.error.slice(0, 300);
      }
      logEvent(state, { kind: 'error', ok: false, text: `fly brain error: ${cmd.error.slice(0, 200)}` });
      return state;
    case 'setController': {
      const a = state.agents[cmd.agentId];
      if (!a) return state;
      if ((a.controller.kind === 'fly') !== (cmd.controller === 'fly')) {
        logEvent(state, { kind: 'system', agentId: a.id, ok: false, text: `${a.id}: a fly body cannot switch to a plan controller (or vice versa)` });
        return state;
      }
      a.controller.kind = cmd.controller;
      if (cmd.tier) a.controller.tier = cmd.tier;
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
      if (cmd.controller === 'fly') return state;
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
      if (a.controller.needsDecision && !URGENT.test(a.controller.interruptReason ?? '')) a.controller.needsDecision = false;
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
  // Log and interrupt once per damage episode and cause, not every tick.
  const cause_ = cause.replace(/ bite$/, '');
  if (state.time - (a.damageAt[cause_] ?? -Infinity) > 3) {
    logEvent(state, { kind: 'hazard', agentId: a.id, ok: false, text: `${a.id} hurt by ${cause}` });
    recordOutcome(state, a, a.current?.action.type ?? 'wait', false, `you are being hurt by ${cause}`, false);
    interrupt(a, `hurt by ${cause}`);
  }
  a.lastDamageAt = state.time;
  a.damageAt[cause_] = state.time;
}

function stepBody(state: WorldState, a: Agent, dt: number, rng: Rng) {
  const biome = BIOMES[biomeAt(state, a.position)];
  const sheltered = Boolean(nearStructure(state, a, 'shelter', CONFIG.shelterRadius));
  const fire = Boolean(nearStructure(state, a, 'campfire', CONFIG.campfireRadius));
  const storm = state.weather === 'storm' && !sheltered ? CONFIG.stormDrainMultiplier : 1;
  const sprinting = a.sprinting && Boolean(a.target) && a.stamina > 0;
  const warm = fire ? 0.7 : 1;
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
      recordOutcome(state, a, 'wait', false, `${i.label} [${i.id}] has gone rotten`, false);
      i.kind = 'rotten_food';
      i.label = `rotting ${i.label}`;
      i.spoilsAt = null;
    }
  }

  if (a.health <= 0) {
    a.status = 'dead';
    a.plan = [];
    a.current = null;
    a.target = null;
    a.controller.needsDecision = false;
    logEvent(state, { kind: 'death', agentId: a.id, ok: false, text: `${a.id} died (${a.stats.poisonings} poisonings, ate ${a.stats.eaten})` });
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

/** Advances the world by one fixed timestep. */
export function stepWorld(state: WorldState, dt: number, rng: Rng = Math.random) {
  if (state.paused) return;
  state.time += dt;
  stepEcology(state, dt, rng);
  for (const a of Object.values(state.agents)) {
    if (a.status === 'dead') continue;
    if (a.fly) stepFly(state, a, dt);
    else stepPlan(state, a, dt, rng);
    stepBody(state, a, dt, rng);
    if (a.inbox.length) a.inbox = a.inbox.filter((m) => state.time - m.sentAt <= CONFIG.messageTtlSec);
  }
}

