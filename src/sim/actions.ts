import { COOKED, HAZARDS, ITEMS, NODES, RECIPES, STRUCTURES } from '../shared/catalog';
import { CONFIG } from '../shared/config';
import type { ActionType, ActiveAction, Agent, Item, ItemKind, Vec2, WorldState } from '../shared/types';
import { blocked, clampToBounds, dist, obstacleDistance } from './geometry';
import { nearStructure, senseRadius } from './environment';
import { hearersOf, recordUtterance } from './communication';
import { clearSegment, findPath } from './pathing';
import { closeEnough, mateBlocker, recordCourtship, stageOf, tryBirth } from './life';
import { biomeAt, logEvent, milestone, newId, type Rng, track, traitMods } from './world';
import { BIOMES } from '../shared/catalog';

export type ActionStatus = 'done' | 'ongoing' | 'failed';

const bearingOf = (from: Vec2, to: Vec2) => {
  const ang = Math.atan2(to.z - from.z, to.x - from.x);
  return ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'][(Math.round(ang / (Math.PI / 4)) + 8) % 8];
};

/** Local broadcast (speech or proto-language signal) to creatures within comm radius at send time. */
function deliver(state: WorldState, a: Agent, act: ActiveAction, channel: 'speech' | 'signal', content: string): 'done' {
  const recipients = hearersOf(state, a);
  const id = newId(state, 'm');
  for (const r of recipients) {
    r.inbox.push({ id, senderId: a.id, text: content, sentAt: state.time });
    if (r.inbox.length > CONFIG.inboxMax) r.inbox.shift();
    r.messagesHeard++;
    track(state, r, 'heard', `${a.id}: ${channel === 'signal' ? `sounds "${content}"` : `"${content}"`}`);
    interrupt(r, `${channel === 'signal' ? 'sounds' : 'message'} from ${a.id}`);
  }
  const to = recipients.map((r) => r.id).join(', ') || 'nobody in range';
  a.messagesSent++;
  recordUtterance(state, a, channel, content, recipients);
  track(state, a, 'said', `${channel === 'signal' ? 'sounds ' : ''}"${content}" → ${to}`, recipients.length > 0);
  recordOutcome(state, a, act.action.type, true, `${channel === 'signal' ? 'made sounds' : 'said'} "${content}" → ${to}`, false, true);
  logEvent(state, { kind: 'message', agentId: a.id, ok: recipients.length > 0, text: `${a.id} → ${to}: ${channel === 'signal' ? '🔊 ' : ''}"${content}"` });
  return 'done';
}

const FIRSTS: Partial<Record<ActionType, string>> = {
  gather: 'First gather', eat: 'First meal', drink: 'First drink', craft: 'First craft', build: 'First structure built',
  cook: 'First cooked food', give: 'First gift given', say: 'First words spoken', inspect: 'First close inspection',
  deposit: 'First item stored', rest: 'First rest', follow: 'First time following another creature',
};

export function recordOutcome(
  state: WorldState, agent: Agent, actionType: ActionType, ok: boolean, detail: string, log = true, timeline = true,
) {
  agent.recentOutcomes.push({ actionType, ok, detail, at: state.time });
  if (agent.recentOutcomes.length > CONFIG.recentOutcomes) agent.recentOutcomes.shift();
  if (timeline) {
    const c = (agent.actionCounts[actionType] ??= { ok: 0, fail: 0 });
    if (ok) c.ok++;
    else c.fail++;
    track(state, agent, 'action', `${actionType}: ${detail}`, ok);
    if (ok && FIRSTS[actionType] && c.ok === 1) milestone(state, agent, `${FIRSTS[actionType]} — ${detail.slice(0, 70)}`);
  }
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
  let s = CONFIG.speed * BIOMES[biomeAt(state, a.position)].speedMul * traitMods(a.traits).speedMul * (stageOf(state, a) === 'child' ? CONFIG.childSpeedMul : 1);
  for (const h of Object.values(state.hazards)) {
    if (dist(h.position, a.position) < h.radius) s *= HAZARDS[h.kind].speedMul;
  }
  for (const o of Object.values(state.obstacles)) {
    if (!o.solid && obstacleDistance(o, a.position) < 0) s *= 0.6;
  }
  if (a.sprinting && a.stamina > 0) s *= CONFIG.sprintMultiplier;
  return s;
}

/**
 * Steps toward agent.target, following A* waypoints around solid obstacles when the straight line is blocked,
 * with local side-steps for other agents. Returns 'arrived' | 'blocked' | 'moving'.
 */
export function stepToward(state: WorldState, a: Agent, dt: number, stopWithin = 0.05): 'arrived' | 'blocked' | 'moving' {
  if (!a.target) return 'arrived';
  const d = dist(a.position, a.target);
  if (d <= stopWithin) {
    a.target = null;
    a.path = null;
    a.sprinting = false;
    return 'arrived';
  }
  // Plan a route if needed (target changed, no path, or path end no longer matches target).
  const end = a.path?.at(-1);
  if (!a.path || !end || dist(end, a.target) > 1.5) {
    a.path = clearSegment(state, a.position, a.target) ? [{ ...a.target }] : findPath(state, a.position, a.target);
    if (!a.path) {
      a.target = null;
      a.sprinting = false;
      return 'blocked';
    }
  }
  while (a.path.length > 1 && dist(a.position, a.path[0]) < 0.4) a.path.shift();
  const way = a.path[0];
  const dx = way.x - a.position.x;
  const dz = way.z - a.position.z;
  const wd = Math.hypot(dx, dz);
  const step = Math.min(speedAt(state, a) * dt, Math.max(wd, 0.001), d);
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
  if (a.stuckFor >= 1 && a.stuckFor - dt < 1) a.path = null; // re-plan once before giving up
  if (a.stuckFor >= 3) {
    a.target = null;
    a.path = null;
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

const VISIBLE: Partial<Record<ActionType, string>> = {
  gather: 'gathering', eat: 'eating', drink: 'drinking', cook: 'cooking', craft: 'crafting', build: 'building',
  give: 'handing over', pickup: 'picking up', drop: 'dropping', deposit: 'storing', withdraw: 'taking from storage', inspect: 'inspecting',
};

function ok(state: WorldState, a: Agent, act: ActiveAction, detail: string, log = true): 'done' {
  recordOutcome(state, a, act.action.type, true, detail, log);
  // Others can briefly see what was done (observable behaviour, e.g. for imitation). Labels, not truths.
  const verb = VISIBLE[act.action.type];
  if (verb) {
    const m = detail.match(/(?:ate|gathered|drank from|cooked|crafted|built|gave|picked up|dropped|stored|took|inspect\w*)\s+([^:[(]+)/);
    a.lastVisibleAct = { text: `${verb}${m ? ' ' + m[1].trim().slice(0, 40) : ''}`, until: state.time + CONFIG.visibleActSec };
  }
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
  const resist = traitMods(a.traits).poisonResist;
  if (fx.poisonSec) {
    a.poisonedUntil = Math.max(a.poisonedUntil, state.time + fx.poisonSec * resist);
    a.stats.poisonings++;
    parts.push(`bitter aftertaste, then stomach cramps — you are POISONED for ${fx.poisonSec}s`);
    track(state, a, 'hurt', `poisoned by ${item.label} (truth: ${item.kind})`, false);
    logEvent(state, { kind: 'hazard', agentId: a.id, ok: false, text: `${a.id} was poisoned by ${item.label} (${item.kind})` });
  }
  const sick = fx.sickSec && (fx.sickChance === undefined || rng() < fx.sickChance);
  if (sick) {
    a.sickUntil = Math.max(a.sickUntil, state.time + fx.sickSec! * resist);
    parts.push(`you feel nauseous — SICK for ${fx.sickSec}s`);
  }
  return parts.join('; ') || 'no noticeable effect';
}

// ---------- the action runner ----------

/** Runs one tick of the agent's current action. The simulator is the only thing that mutates entities. */
export function runAction(state: WorldState, a: Agent, act: ActiveAction, dt: number, rng: Rng): ActionStatus {
  const action = act.action;
  switch (action.type) {
    case 'wait':
      a.target = null;
      return ok(state, a, act, 'waited', false);

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
      recordOutcome(state, r, 'give', true, `received ${item.label} [${item.id}] from ${a.id}`, false, false);
      track(state, r, 'heard', `received ${item.label} from ${a.id}`);
      return ok(state, a, act, `gave ${item.label} to ${r.id}`);
    }

    case 'rest': {
      if (act.progress === 0) {
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
      const mode = state.experiment.commMode;
      if (mode !== 'english') return fail(state, a, act, mode === 'proto' ? 'you have no words — only sounds (use signal)' : 'you cannot make sounds in this world');
      const text = action.text.slice(0, CONFIG.messageMaxChars).trim();
      if (!text) return fail(state, a, act, 'empty message');
      return deliver(state, a, act, 'speech', text);
    }

    case 'signal': {
      const mode = state.experiment.commMode;
      if (mode === 'silent') return fail(state, a, act, 'you cannot make sounds in this world');
      const lex = new Set(state.experiment.lexicon);
      const tokens = action.tokens.map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, CONFIG.maxSignalTokens);
      const bad = tokens.filter((t) => !lex.has(t));
      if (!tokens.length || bad.length) return fail(state, a, act, `you cannot make the sound(s) ${bad.join(' ') || '(none)'}; you can only make: ${state.experiment.lexicon.join(' ')}`);
      return deliver(state, a, act, 'signal', tokens.join(' '));
    }

    case 'gesture': {
      a.gesture = { kind: action.gesture, toward: action.toward ? clampToBounds(action.toward, state.bounds) : undefined, until: state.time + CONFIG.gestureSec };
      const seers = Object.values(state.agents).filter((o) => o.id !== a.id && o.status !== 'dead' && dist(o.position, a.position) <= senseRadius(state, o));
      recordUtterance(state, a, 'gesture', action.gesture + (action.toward ? ` toward ${bearingOf(a.position, action.toward)}` : ''), seers);
      for (const o of seers) interrupt(o, `${a.id} made a gesture`);
      track(state, a, 'said', `gestured: ${action.gesture}${action.toward ? ` toward ${bearingOf(a.position, action.toward)}` : ''} (seen by ${seers.map((o) => o.id).join(', ') || 'nobody'})`, seers.length > 0);
      for (const o of seers) track(state, o, 'heard', `saw ${a.id} ${action.gesture}${action.toward ? ` toward ${bearingOf(a.position, action.toward)}` : ''}`);
      recordOutcome(state, a, 'gesture', true, `${action.gesture} (seen by ${seers.length})`, false, true);
      return 'done';
    }

    case 'mark': {
      const mode = state.experiment.commMode;
      const glyph = action.glyph.trim().toLowerCase().slice(0, 12);
      if (mode !== 'english' && !state.experiment.lexicon.includes(glyph))
        return fail(state, a, act, `you can only scratch these shapes: ${state.experiment.lexicon.join(' ')}`);
      if (!glyph) return fail(state, a, act, 'empty mark');
      const id = newId(state, 'k');
      state.marks[id] = { id, glyph, position: { ...a.position }, by: a.id, at: state.time, expiresAt: state.time + CONFIG.markTtlSec };
      const ids = Object.keys(state.marks);
      if (ids.length > CONFIG.maxMarks) delete state.marks[ids[0]];
      recordUtterance(state, a, 'mark', glyph, []);
      track(state, a, 'said', `scratched mark "${glyph}" on the ground at (${a.position.x.toFixed(0)}, ${a.position.z.toFixed(0)})`);
      return ok(state, a, act, `left mark ${id} "${glyph}"`);
    }

    case 'court': {
      const t = state.agents[action.agentId];
      if (!t || t.id === a.id) return fail(state, a, act, `no creature ${action.agentId}`);
      if (t.status === 'dead') return fail(state, a, act, `${t.id} is dead`);
      if (stageOf(state, a) === 'child') return fail(state, a, act, 'you are still a child');
      if (stageOf(state, t) === 'child') return fail(state, a, act, `${t.id} is still a child`);
      if (!closeEnough(a, t)) {
        const s2 = approach(state, a, act, t.position, dt, CONFIG.courtDistance * 0.9);
        if (s2) return s2;
      }
      const mutual = t.courting?.target === a.id && t.courting.until > state.time;
      recordCourtship(state, a, t);
      a.courting = { target: t.id, since: state.time, until: state.time + CONFIG.courtWindowSec };
      if (!mutual) {
        track(state, a, 'said', `courted ${t.id} (waiting ${CONFIG.courtWindowSec}s for them to return it)`);
        track(state, t, 'heard', `${a.id} is courting you — court ${a.id} within ${CONFIG.courtWindowSec}s to accept, or ignore`);
        interrupt(t, `courted by ${a.id}`);
        logEvent(state, { kind: 'message', agentId: a.id, ok: true, text: `💗 ${a.id} courts ${t.id}` });
        return ok(state, a, act, `courting ${t.id}`, false);
      }
      // Both chose each other.
      for (const c of state.courtships) {
        if (c.outcome === 'pending' && ((c.from === a.id && c.to === t.id) || (c.from === t.id && c.to === a.id))) {
          c.outcome = 'mutual';
          c.endedAt = state.time;
        }
      }
      const r = tryBirth(state, a, t, rng);
      const last = state.courtships.at(-1)!;
      last.outcome = r.ok ? 'birth' : 'failed';
      last.reason = r.ok ? undefined : r.detail;
      a.courting = null;
      t.courting = null;
      track(state, t, 'heard', `${a.id} returned your courtship: ${r.detail}`, r.ok);
      interrupt(t, r.ok ? 'became a parent' : 'courtship returned');
      if (!r.ok) {
        logEvent(state, { kind: 'message', agentId: a.id, ok: false, text: `💞 ${a.id} + ${t.id} chose each other — ${r.detail}` });
        return fail(state, a, act, `you and ${t.id} chose each other, but ${r.detail}`);
      }
      void mateBlocker;
      return ok(state, a, act, `you and ${t.id} chose each other: ${r.detail}`);
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
