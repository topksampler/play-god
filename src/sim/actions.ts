import { COOKED, HAZARDS, ITEMS, NODES, RECIPES, STRUCTURES } from '../shared/catalog';
import { CONFIG } from '../shared/config';
import type { ActionType, ActiveAction, Agent, Item, ItemKind, Vec2, WorldState } from '../shared/types';
import { blocked, clampToBounds, dist, obstacleDistance } from './geometry';
import { nearStructure, senseRadius } from './environment';
import { planPath } from './path';
import { biomeAt, logEvent, newId, type Rng } from './world';
import { BIOMES } from '../shared/catalog';

export type ActionStatus = 'done' | 'ongoing' | 'failed';

export function recordOutcome(state: WorldState, agent: Agent, actionType: ActionType, ok: boolean, detail: string, log = true) {
  agent.recentOutcomes.push({ actionType, ok, detail, at: state.time });
  if (agent.recentOutcomes.length > CONFIG.recentOutcomes) agent.recentOutcomes.shift();
  if (log) logEvent(state, { kind: 'action', agentId: agent.id, ok, text: `${agent.id} ${actionType}: ${detail}` });
}

export function interrupt(agent: Agent, reason: string) {
  if (agent.status === 'dead') return;
  agent.controller.needsDecision = true;
  agent.controller.interruptReason = reason;
}

const REACH = CONFIG.interactDistance + 0.3;
const fmt = (p: Vec2) => `(${p.x.toFixed(1)}, ${p.z.toFixed(1)})`;

// ---------- movement ----------

const SIDESTEP = [Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, (3 * Math.PI) / 4, (-3 * Math.PI) / 4];

export function speedAt(state: WorldState, a: Agent): number {
  let s = CONFIG.speed * BIOMES[biomeAt(state, a.position)].speedMul;
  for (const h of Object.values(state.hazards)) {
    if (dist(h.position, a.position) < h.radius) s *= HAZARDS[h.kind].speedMul;
  }
  for (const o of Object.values(state.obstacles)) {
    if (!o.solid && obstacleDistance(o, a.position) < 0) s *= 0.6;
  }
  if (a.sprinting && a.stamina > 0) s *= CONFIG.sprintMultiplier;
  return s;
}

/** Steps toward agent.target. Returns 'arrived' | 'blocked' | 'moving'. */
const sameTarget = (a: Vec2 | null, b: Vec2 | null) => Boolean(a && b && Math.abs(a.x - b.x) < 0.25 && Math.abs(a.z - b.z) < 0.25);

export function stepToward(state: WorldState, a: Agent, dt: number, stopWithin = 0.05): 'arrived' | 'blocked' | 'moving' {
  if (!a.target) return 'arrived';
  const d = dist(a.position, a.target);
  if (d <= stopWithin) {
    a.target = null;
    a.route = null;
    a.sprinting = false;
    return 'arrived';
  }
  // Plan around obstacles (and, where possible, hazards) once per target; follow the waypoints.
  if (!a.route || !sameTarget(a.routeFor, a.target)) {
    a.route = planPath(state, a.position, a.target);
    a.routeFor = { ...a.target };
    if (!a.route) {
      a.target = null;
      a.sprinting = false;
      return 'blocked';
    }
  }
  while (a.route.length > 1 && dist(a.position, a.route[0]) < 0.35) a.route.shift();
  const next = a.route[0] ?? a.target;
  const dx = next.x - a.position.x;
  const dz = next.z - a.position.z;
  const step = Math.min(speedAt(state, a) * dt, Math.max(Math.hypot(dx, dz), 1e-6));
  const base = Math.atan2(dz, dx);
  let moved = false;
  for (const off of [0, ...SIDESTEP]) {
    const ang = base + off;
    const p = { x: a.position.x + Math.cos(ang) * step, z: a.position.z + Math.sin(ang) * step };
    if (blocked(state, p, CONFIG.agentRadius, a.id)) continue;
    a.position = p;
    a.heading = ang;
    a.stats.distance += step;
    // Direct progress resets; side-stepping counts slowly toward "stuck".
    a.stuckFor = off === 0 ? Math.max(0, a.stuckFor - dt) : a.stuckFor + dt * 0.3;
    moved = true;
    break;
  }
  if (!moved) a.stuckFor += dt;
  if (a.stuckFor >= 1 && a.stuckFor - dt < 1) a.route = null; // replan once (e.g. another agent is in the way)
  if (a.stuckFor >= 2.5) {
    a.target = null;
    a.route = null;
    a.stuckFor = 0;
    a.sprinting = false;
    return 'blocked';
  }
  return 'moving';
}

/**
 * Walk to a target entity, then act. Returns null when within reach (caller performs the effect),
 * or a status while approaching. The target must be perceivable when the action starts.
 */
function approach(state: WorldState, a: Agent, act: ActiveAction, pos: Vec2, dt: number, reach = REACH): ActionStatus | null {
  const d = dist(a.position, pos);
  if (d <= reach) {
    a.target = null;
    return null;
  }
  if (act.progress === 0) {
    if (d > senseRadius(state, a) + 1) return fail(state, a, act, 'target is not in sight');
    act.progress = 1;
    a.stuckFor = 0;
  }
  a.target = { ...pos };
  const r = stepToward(state, a, dt, reach * 0.8);
  if (r === 'blocked') return fail(state, a, act, 'path blocked');
  return 'ongoing';
}

function fail(state: WorldState, a: Agent, act: ActiveAction, detail: string): 'failed' {
  recordOutcome(state, a, act.action.type, false, detail);
  a.target = null;
  return 'failed';
}

function ok(state: WorldState, a: Agent, act: ActiveAction, detail: string, log = true): 'done' {
  recordOutcome(state, a, act.action.type, true, detail, log);
  return 'done';
}

// ---------- items ----------

function makeItem(state: WorldState, kind: ItemKind, label: string): Item {
  const spoil = ITEMS[kind].spoilSec;
  return { id: newId(state, 'i'), kind, label, spoilsAt: spoil ? state.time + spoil : null };
}

function takeItem(a: Agent, itemId: string): Item | null {
  const i = a.items.findIndex((x) => x.id === itemId);
  return i < 0 ? null : a.items.splice(i, 1)[0];
}

function countKind(items: Item[], kind: ItemKind) {
  return items.filter((i) => i.kind === kind).length;
}

function consumeNeeds(a: Agent, needs: Partial<Record<ItemKind, number>>): string | null {
  const missing = Object.entries(needs)
    .filter(([k, n]) => countKind(a.items, k as ItemKind) < (n ?? 0))
    .map(([k, n]) => `${n} ${k} (have ${countKind(a.items, k as ItemKind)})`);
  if (missing.length) return `missing ${missing.join(', ')}`;
  for (const [k, n] of Object.entries(needs)) {
    for (let i = 0; i < (n ?? 0); i++) {
      const idx = a.items.findIndex((x) => x.kind === k);
      a.items.splice(idx, 1);
    }
  }
  return null;
}

const ITEM_SOURCE: Partial<Record<ItemKind, string>> = Object.fromEntries(
  Object.values(NODES)
    .filter((n) => n.yields)
    .map((n) => [n.yields!, n.detail]),
);

/** Apply the true effect of eating. Detail describes sensations, not the item's true identity. */
function eatEffect(state: WorldState, a: Agent, item: Item, rng: Rng): string {
  const fx = ITEMS[item.kind];
  const parts: string[] = [];
  if (fx.energy) {
    a.energy = Math.min(CONFIG.maxVital, a.energy + fx.energy);
    parts.push(`energy +${fx.energy}`);
  }
  if (fx.hydration) {
    a.hydration = Math.min(CONFIG.maxVital, a.hydration + fx.hydration);
    parts.push(`hydration +${fx.hydration}`);
  }
  if (fx.health) {
    a.health = Math.min(CONFIG.maxVital, a.health + fx.health);
    parts.push(`health +${fx.health}`);
  }
  if (fx.cures?.includes('poison') && a.poisonedUntil > state.time) {
    a.poisonedUntil = 0;
    parts.push('the burning in your gut fades (poison cured)');
  }
  if (fx.cures?.includes('sick') && a.sickUntil > state.time) {
    a.sickUntil = 0;
    parts.push('your nausea passes (sickness cured)');
  }
  if (fx.poisonSec) {
    a.poisonedUntil = Math.max(a.poisonedUntil, state.time + fx.poisonSec);
    a.stats.poisonings++;
    parts.push(`bitter aftertaste, then stomach cramps — you are POISONED for ${fx.poisonSec}s`);
    logEvent(state, { kind: 'hazard', agentId: a.id, ok: false, text: `${a.id} was poisoned by ${item.label} (${item.kind})` });
  }
  const sick = fx.sickSec && (fx.sickChance === undefined || rng() < fx.sickChance);
  if (sick) {
    a.sickUntil = Math.max(a.sickUntil, state.time + fx.sickSec!);
    parts.push(`you feel nauseous — SICK for ${fx.sickSec}s`);
  }
  return parts.join('; ') || 'no noticeable effect';
}

// ---------- the action runner ----------

/** Runs one tick of the agent's current action. The simulator is the only thing that mutates entities. */
export function runAction(state: WorldState, a: Agent, act: ActiveAction, dt: number, rng: Rng): ActionStatus {
  const action = act.action;
  switch (action.type) {
    case 'wait': {
      a.target = null;
      act.progress += dt;
      const seconds = Math.min(10, Math.max(0, action.seconds ?? 3));
      return act.progress >= seconds ? ok(state, a, act, `waited ${seconds.toFixed(0)}s`, false) : 'ongoing';
    }

    case 'move': {
      if (act.progress === 0) {
        a.target = clampToBounds(action.target, state.bounds, CONFIG.agentRadius + 0.1);
        a.sprinting = Boolean(action.sprint);
        a.stuckFor = 0;
        act.progress = 1;
      }
      const r = stepToward(state, a, dt);
      if (r === 'arrived') return ok(state, a, act, `arrived at ${fmt(a.position)}`, false);
      if (r === 'blocked') return fail(state, a, act, `blocked near ${fmt(a.position)}; target cleared`);
      return 'ongoing';
    }

    case 'follow': {
      const t = state.agents[action.agentId];
      if (!t || t.id === a.id) return fail(state, a, act, `no agent ${action.agentId}`);
      const d = dist(t.position, a.position);
      if (d > senseRadius(state, a) * 1.2) return fail(state, a, act, `lost sight of ${t.id}`);
      if (d <= 2) return ok(state, a, act, `caught up with ${t.id}`, false);
      act.progress = 1;
      a.target = { ...t.position };
      if (stepToward(state, a, dt, 1.8) === 'blocked') return fail(state, a, act, 'path blocked');
      return 'ongoing';
    }

    case 'gather': {
      const node = state.resources[action.nodeId];
      if (!node) return fail(state, a, act, `no resource ${action.nodeId}`);
      const def = NODES[node.kind];
      if (!def.yields) return fail(state, a, act, `${node.id} cannot be gathered; try drink`);
      if (a.items.length >= a.capacity) return fail(state, a, act, `inventory full (${a.capacity})`);
      if (Math.floor(node.units) < 1) return fail(state, a, act, `${node.id} is depleted (regrowing)`);
      const s = approach(state, a, act, node.position, dt);
      if (s) return s;
      node.units -= 1;
      const item = makeItem(state, def.yields, def.itemLabel);
      a.items.push(item);
      return ok(state, a, act, `gathered ${item.label} [${item.id}] from ${node.id} (${Math.floor(node.units)} left)`);
    }

    case 'eat': {
      const item = a.items.find((x) => x.id === action.itemId);
      if (!item) return fail(state, a, act, `not carrying ${action.itemId}`);
      if (!ITEMS[item.kind].edible) return fail(state, a, act, `${item.label} is not edible`);
      takeItem(a, item.id);
      a.stats.eaten++;
      return ok(state, a, act, `ate ${item.label}: ${eatEffect(state, a, item, rng)}`);
    }

    case 'drink': {
      const node = state.resources[action.sourceId];
      const drink = node && NODES[node.kind].drink;
      if (!node || !drink) return fail(state, a, act, `${action.sourceId} is not drinkable water`);
      const s = approach(state, a, act, node.position, dt);
      if (s) return s;
      a.hydration = Math.min(CONFIG.maxVital, a.hydration + drink.hydration);
      a.stats.drank++;
      let detail = `drank from ${node.id}: hydration +${drink.hydration}`;
      if (drink.sickSec) {
        a.sickUntil = Math.max(a.sickUntil, state.time + drink.sickSec);
        detail += `; it tasted foul — you feel SICK for ${drink.sickSec}s`;
        logEvent(state, { kind: 'hazard', agentId: a.id, ok: false, text: `${a.id} got sick from toxic water ${node.id}` });
      }
      return ok(state, a, act, detail);
    }

    case 'drop': {
      const item = takeItem(a, action.itemId);
      if (!item) return fail(state, a, act, `not carrying ${action.itemId}`);
      const id = newId(state, 'g');
      state.groundItems[id] = { id, item, position: { ...a.position }, droppedBy: a.id };
      return ok(state, a, act, `dropped ${item.label} as ${id}`);
    }

    case 'pickup': {
      const g = state.groundItems[action.groundItemId];
      if (!g) return fail(state, a, act, `no ground item ${action.groundItemId}`);
      if (a.items.length >= a.capacity) return fail(state, a, act, 'inventory full');
      const s = approach(state, a, act, g.position, dt);
      if (s) return s;
      delete state.groundItems[g.id];
      a.items.push(g.item);
      return ok(state, a, act, `picked up ${g.item.label} [${g.item.id}]`);
    }

    case 'give': {
      const r = state.agents[action.recipientId];
      if (!r || r.id === a.id) return fail(state, a, act, `no recipient ${action.recipientId}`);
      if (r.status === 'dead') return fail(state, a, act, `${r.id} is dead`);
      if (!a.items.some((x) => x.id === action.itemId)) return fail(state, a, act, `not carrying ${action.itemId}`);
      if (r.items.length >= r.capacity) return fail(state, a, act, `${r.id} inventory full`);
      const s = approach(state, a, act, r.position, dt, REACH + 2 * CONFIG.agentRadius);
      if (s) return s;
      const item = takeItem(a, action.itemId)!;
      r.items.push(item);
      interrupt(r, `received ${item.label} from ${a.id}`);
      recordOutcome(state, r, 'give', true, `received ${item.label} [${item.id}] from ${a.id}`, false);
      return ok(state, a, act, `gave ${item.label} to ${r.id}`);
    }

    case 'rest': {
      if (act.progress === 0) {
        const inHazard = Object.values(state.hazards).find((h) => dist(h.position, a.position) < h.radius);
        if (inHazard) return fail(state, a, act, `cannot rest here: inside ${HAZARDS[inHazard.kind].appearance} (${inHazard.id}); move out first`);
        a.target = null;
        a.status = 'resting';
      }
      const sheltered = nearStructure(state, a, 'shelter', CONFIG.shelterRadius) || nearStructure(state, a, 'campfire', CONFIG.campfireRadius);
      const mul = sheltered ? 2 : 1;
      a.stamina = Math.min(CONFIG.maxVital, a.stamina + CONFIG.restStaminaPerSec * dt * mul);
      if (a.energy > 10 && a.hydration > 10) a.health = Math.min(CONFIG.maxVital, a.health + CONFIG.restHealPerSec * dt * mul);
      act.progress += dt;
      if (act.progress >= CONFIG.restSeconds) {
        a.status = 'active';
        return ok(state, a, act, `rested${sheltered ? ' (sheltered, 2x)' : ''}; health ${a.health.toFixed(0)}, stamina ${a.stamina.toFixed(0)}`, false);
      }
      return 'ongoing';
    }

    case 'inspect': {
      const id = action.targetId;
      const radius = senseRadius(state, a);
      const inRange = (p: Vec2) => dist(p, a.position) <= radius;
      const node = state.resources[id];
      if (node && inRange(node.position)) {
        const def = NODES[node.kind];
        return ok(state, a, act, `${id}: ${def.appearance}; ${def.detail}; about ${Math.floor(node.units)} units`);
      }
      const hz = state.hazards[id];
      if (hz && inRange(hz.position)) return ok(state, a, act, `${id}: ${HAZARDS[hz.kind].appearance}, radius ${hz.radius.toFixed(1)} — looks risky to cross`);
      const item = a.items.find((x) => x.id === id);
      if (item) {
        const rotten = item.kind === 'rotten_food' ? 'soft, smells rotten' : ITEM_SOURCE[item.kind] ?? 'nothing unusual';
        return ok(state, a, act, `${id}: ${item.label}; ${rotten}`);
      }
      const st = state.structures[id];
      if (st && inRange(st.position)) return ok(state, a, act, `${id}: ${st.kind} built by ${st.builderId}${st.text ? `, reads "${st.text}"` : ''}`);
      const ag = state.agents[id];
      if (ag && ag.id !== a.id && inRange(ag.position))
        return ok(state, a, act, `${id}: ${ag.status}, looks ${ag.health > 60 ? 'healthy' : ag.health > 25 ? 'hurt' : 'badly hurt'}, carrying ${ag.items.length} items`);
      return fail(state, a, act, `cannot see ${id}`);
    }

    case 'say': {
      const text = action.text.slice(0, CONFIG.messageMaxChars).trim();
      if (!text) return fail(state, a, act, 'empty message');
      const recipients = Object.values(state.agents).filter(
        (r) => r.id !== a.id && r.status !== 'dead' && dist(r.position, a.position) <= CONFIG.commRadius,
      );
      const id = newId(state, 'm');
      for (const r of recipients) {
        r.inbox.push({ id, senderId: a.id, text, sentAt: state.time });
        if (r.inbox.length > CONFIG.inboxMax) r.inbox.shift();
        interrupt(r, `message from ${a.id}`);
      }
      const to = recipients.map((r) => r.id).join(', ') || 'nobody in range';
      recordOutcome(state, a, 'say', true, `said "${text}" → ${to}`, false);
      logEvent(state, { kind: 'message', agentId: a.id, ok: recipients.length > 0, text: `${a.id} → ${to}: "${text}"` });
      return 'done';
    }

    case 'craft': {
      const recipe = RECIPES[action.recipe];
      if (!recipe) return fail(state, a, act, `unknown recipe ${action.recipe}`);
      if (action.recipe === 'basket' && a.capacity >= CONFIG.basketCapacity) return fail(state, a, act, 'already have a basket');
      if (action.recipe === 'torch' && a.hasTorch) return fail(state, a, act, 'already have a torch');
      const missing = consumeNeeds(a, recipe.needs);
      if (missing) return fail(state, a, act, `cannot craft ${action.recipe}: ${missing}`);
      if (action.recipe === 'basket') a.capacity = CONFIG.basketCapacity;
      if (action.recipe === 'torch') a.hasTorch = true;
      return ok(state, a, act, `crafted ${action.recipe} (${recipe.effect})`);
    }

    case 'build': {
      const def = STRUCTURES[action.structure];
      if (!def) return fail(state, a, act, `unknown structure ${action.structure}`);
      if (action.structure === 'sign' && !action.text?.trim()) return fail(state, a, act, 'a sign needs text');
      const p = {
        x: a.position.x + Math.cos(a.heading) * 1.2,
        z: a.position.z + Math.sin(a.heading) * 1.2,
      };
      if (blocked(state, p, 0.6, a.id) || Object.values(state.structures).some((s) => dist(s.position, p) < 2))
        return fail(state, a, act, 'no room to build here');
      const missing = consumeNeeds(a, def.needs);
      if (missing) return fail(state, a, act, `cannot build ${action.structure}: ${missing}`);
      const id = newId(state, 's');
      state.structures[id] = {
        id, kind: action.structure, position: p, builderId: a.id, builtAt: state.time,
        ...(action.structure === 'sign' ? { text: action.text!.trim().slice(0, CONFIG.signMaxChars) } : {}),
        ...(action.structure === 'cache' ? { items: [] } : {}),
        ...(action.structure === 'campfire' ? { litUntil: state.time + CONFIG.campfireBurnSec } : {}),
      };
      a.stats.built++;
      return ok(state, a, act, `built ${action.structure} ${id} at ${fmt(p)} (${def.effect})`);
    }

    case 'cook': {
      const item = a.items.find((x) => x.id === action.itemId);
      if (!item) return fail(state, a, act, `not carrying ${action.itemId}`);
      const cooked = COOKED[item.kind];
      if (!cooked) return fail(state, a, act, `${item.label} cannot be cooked`);
      if (!nearStructure(state, a, 'campfire', CONFIG.campfireRadius)) return fail(state, a, act, `no lit campfire within ${CONFIG.campfireRadius}`);
      const before = item.label;
      item.kind = cooked.kind;
      item.label = cooked.label;
      item.spoilsAt = state.time + (ITEMS[cooked.kind].spoilSec ?? 120);
      return ok(state, a, act, `cooked ${before} → ${cooked.label}`);
    }

    case 'deposit':
    case 'withdraw': {
      const cache = state.structures[action.cacheId];
      if (!cache || cache.kind !== 'cache') return fail(state, a, act, `no cache ${action.cacheId}`);
      const s = approach(state, a, act, cache.position, dt);
      if (s) return s;
      cache.items ??= [];
      if (action.type === 'deposit') {
        if (cache.items.length >= CONFIG.cacheCapacity) return fail(state, a, act, 'cache full');
        const item = takeItem(a, action.itemId);
        if (!item) return fail(state, a, act, `not carrying ${action.itemId}`);
        cache.items.push(item);
        return ok(state, a, act, `stored ${item.label} in ${cache.id} (${cache.items.length}/${CONFIG.cacheCapacity})`);
      }
      if (a.items.length >= a.capacity) return fail(state, a, act, 'inventory full');
      const idx = cache.items.findIndex((x) => x.id === action.itemId);
      if (idx < 0) return fail(state, a, act, `${action.itemId} is not in ${cache.id}`);
      const [item] = cache.items.splice(idx, 1);
      a.items.push(item);
      return ok(state, a, act, `took ${item.label} [${item.id}] from ${cache.id}`);
    }
  }
}
