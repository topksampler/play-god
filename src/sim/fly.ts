import { ITEMS, NODES } from '../shared/catalog';
import { CONFIG } from '../shared/config';
import type { Agent, FlyMotorCommand, Item, ItemKind, NodeKind, ResourceNode, Vec2, WorldState } from '../shared/types';
import { interrupt, recordOutcome, speedAt } from './actions';
import { blocked, clampToBounds, dist } from './geometry';
import { createAgent, logEvent, newId, populationLimit, livingOfKind, track } from './world';

/** Odor A: sweet fruit smells. Odor B: mushroom smell, shared by edible and toxic patches (only taste tells them apart). */
export const FLY_ODOR: Partial<Record<NodeKind, 'A' | 'B'>> = {
  berry_bush: 'A', fruit_tree: 'A', honey_hive: 'A', cactus: 'A',
  mushroom_patch: 'B', toxic_mushroom_patch: 'B',
};

/** Smell of carried or dropped food. Rotting fruit smells like fermenting fruit, the strongest attractant for Drosophila. */
export const ITEM_ODOR: Partial<Record<ItemKind, 'A' | 'B'>> = {
  berries: 'A', fruit: 'A', cactus_fruit: 'A', honey: 'A', rotten_food: 'A',
  mushroom: 'B', cooked_mushroom: 'B', toxic_mushroom: 'B',
};

/** What touching a node tastes like to a fly's gustatory receptor neurons (sugar/water class vs bitter class). */
export function flyTaste(kind: NodeKind): { sugar: boolean; bitter: boolean } {
  if (kind === 'toxic_mushroom_patch' || kind === 'toxic_water') return { sugar: false, bitter: true };
  if (FLY_ODOR[kind] || kind === 'fresh_water') return { sugar: true, bitter: false };
  return { sugar: false, bitter: false };
}

export function itemTaste(kind: ItemKind): { sugar: boolean; bitter: boolean } {
  if (kind === 'toxic_mushroom') return { sugar: false, bitter: true };
  return { sugar: Boolean(ITEM_ODOR[kind]), bitter: false };
}

export function flyContact(state: WorldState, a: Agent): ResourceNode | null {
  let best: ResourceNode | null = null;
  let bd: number = CONFIG.interactDistance;
  for (const r of Object.values(state.resources)) {
    const d = dist(r.position, a.position);
    if (d < bd && (flyTaste(r.kind).sugar || flyTaste(r.kind).bitter)) {
      bd = d;
      best = r;
    }
  }
  return best;
}

/** Food a fly can land on that is not a resource patch: an item carried by a plan agent, or lying on the ground. */
type ItemContact = { item: Item; owner: Agent | null; groundId: string | null };
const CARRIED_REACH = CONFIG.agentRadius + CONFIG.flyRadius + 0.3;

function itemContact(state: WorldState, a: Agent): ItemContact | null {
  for (const o of Object.values(state.agents)) {
    if (o.fly || o.status === 'dead' || dist(o.position, a.position) > CARRIED_REACH) continue;
    const item = o.items.find((i) => ITEM_ODOR[i.kind]);
    if (item) return { item, owner: o, groundId: null };
  }
  for (const g of Object.values(state.groundItems)) {
    if (ITEM_ODOR[g.item.kind] && dist(g.position, a.position) < 0.8) return { item: g.item, owner: null, groundId: g.id };
  }
  return null;
}

const clampNum = (x: number, lo: number, hi: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : 0);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];

/** Fly sounds. Wingbeat buzz during flight is physical; the rest are playful, rule-based sound effects (flies have no voice). */
const SOUNDS = {
  takeoff: ['BZZZZT!', 'bzzZZZZ!', 'VRRRMMM'],
  dodge: ['SUIIIIII!', 'suiii~ missed me', 'BZZ-nope!'],
  feed: ['suiii~', 'slurrrp', 'nom nom bzz'],
  nibble: ['suiii~ yours now', 'bzz… sweet', 'sluuurp'],
  idle: ['bzz', 'bz bz', 'bzzz?'],
  hatch: ['bzz!'],
} as const;

export function flySound(state: WorldState, a: Agent, kind: keyof typeof SOUNDS, force = false) {
  const f = a.fly!;
  if (!force && state.time - (f.lastSoundAt ?? -Infinity) < CONFIG.flySoundGapSec) return;
  f.lastSoundAt = state.time;
  const sounds = (state.flySounds ??= []);
  sounds.push({ at: state.time, flyId: a.id, text: pick(SOUNDS[kind]), where: { ...a.position } });
  if (sounds.length > 60) sounds.shift();
}

export function applyFlyMotors(state: WorldState, motors: FlyMotorCommand[]) {
  for (const m of motors) {
    const a = state.agents[m.agentId];
    if (!a?.fly || a.status === 'dead') continue;
    a.fly.turnRate = clampNum(m.turnRate, -6, 6);
    a.fly.speed = clampNum(m.speed, 0, CONFIG.flyWalkSpeed * 1.5);
    a.fly.feeding = Boolean(m.feeding);
    a.fly.readout = m.readout;
    a.fly.motorAt = state.time;
    a.fly.brainStatus = 'running';
    a.controller.lastError = null;
    if (m.escape) takeOff(state, a, 'Giant Fiber spike');
  }
}

/** Nearest approaching looming source for choosing an escape direction: an incoming hand, else the closest large creature. */
function threatSource(state: WorldState, a: Agent): { from: Vec2; by: string | null } | null {
  const t = a.fly!.threat;
  if (t && state.time <= t.end + 0.2) return { from: t.from, by: t.by };
  let best: Agent | null = null;
  let bd: number = CONFIG.flyLoomRange;
  for (const o of Object.values(state.agents)) {
    if (o.fly || o.status === 'dead') continue;
    const d = dist(o.position, a.position);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best ? { from: { ...best.position }, by: best.id } : null;
}

/**
 * Escape takeoff. The trigger is the fly's own Giant Fiber (DNp01) spike; the direction (away from the looming
 * source, with jitter) and the flight itself are body-level rules, since flight motor control is not simulated.
 */
export function takeOff(state: WorldState, a: Agent, reason: string) {
  const f = a.fly!;
  if (a.status === 'dead' || f.flight) return;
  if (state.time - (f.landedAt ?? -Infinity) < CONFIG.flyEscapeCooldownSec) return;
  const src = threatSource(state, a);
  const away = src ? Math.atan2(a.position.z - src.from.z, a.position.x - src.from.x) : Math.random() * Math.PI * 2;
  const heading = away + (Math.random() - 0.5) * 1.2;
  const dur = CONFIG.flyFlightMinSec + Math.random() * (CONFIG.flyFlightMaxSec - CONFIG.flyFlightMinSec);
  f.flight = { since: state.time, until: state.time + dur, heading, speed: CONFIG.flyFlightSpeed, from: src?.from ?? { ...a.position }, reason };
  f.feeding = false;
  f.feedProgress = 0;
  f.nibbling = null;
  f.escapes = (f.escapes ?? 0) + 1;
  const dodged = f.threat && state.time <= f.threat.end;
  flySound(state, a, dodged ? 'dodge' : 'takeoff', true);
  if (src?.by || dodged) logEvent(state, { kind: 'action', agentId: a.id, ok: true, text: `🪰 ${a.id} took off (${reason})${src?.by ? ` away from ${src.by}` : ''}` });
}

function stepFlight(state: WorldState, a: Agent, dt: number) {
  const f = a.fly!;
  const fl = f.flight!;
  if (state.time >= fl.until) {
    f.flight = null;
    f.landedAt = state.time;
    // Land on free ground: if the landing spot is taken, keep flying a little longer.
    if (blocked(state, a.position, CONFIG.flyRadius, a.id)) f.flight = { ...fl, until: state.time + 0.3 };
    else a.heading = fl.heading;
    return;
  }
  // Airborne: flies over obstacles, bounces off the world edge.
  let h = fl.heading + (Math.random() - 0.5) * 2 * dt;
  let p = { x: a.position.x + Math.cos(h) * fl.speed * dt, z: a.position.z + Math.sin(h) * fl.speed * dt };
  const c = clampToBounds(p, state.bounds, 1);
  if (c.x !== p.x) h = Math.PI - h;
  if (c.z !== p.z) h = -h;
  p = c;
  a.stats.distance += dist(p, a.position);
  a.position = p;
  a.heading = h;
  if (h !== fl.heading) f.flight = { ...fl, heading: h };
  f.lastTaste = null;
}

/** Body-level collision reflex: if the heading is blocked, try nearby headings (not a brain output; labelled in the UI). */
const DODGE = [0.5, -0.5, 1.1, -1.1, 1.8, -1.8, Math.PI];

/** Moves a fly by its latest brain motor command and applies taste/feeding. The simulator alone mutates the world. */
export function stepFly(state: WorldState, a: Agent, dt: number) {
  const f = a.fly!;
  if (f.threat && state.time > f.threat.end + 0.5) f.threat = null;
  if (f.flight) return stepFlight(state, a, dt);
  if (f.motorAt === null || state.time - f.motorAt > 2) {
    f.speed = 0;
    f.feeding = false;
  }
  a.heading += f.turnRate * dt;
  const step = f.speed * (speedAt(state, a) / CONFIG.speed) * dt;
  if (step > 0) {
    for (const off of [0, ...DODGE]) {
      const h = a.heading + off;
      const p = { x: a.position.x + Math.cos(h) * step, z: a.position.z + Math.sin(h) * step };
      if (blocked(state, p, CONFIG.flyRadius, a.id)) continue;
      a.position = p;
      a.heading = h;
      a.stats.distance += step;
      break;
    }
    if (Math.random() < dt / 25) flySound(state, a, 'idle');
  }

  const node = flyContact(state, a);
  const held = node ? null : itemContact(state, a);
  if (!node && !held) {
    f.feedProgress = 0;
    f.nibbling = null;
    return;
  }
  if (held) return feedOnItem(state, a, held, dt);
  f.nibbling = null;
  const taste = flyTaste(node!.kind);
  const available = NODES[node!.kind].drink ? true : node!.units >= 1;
  f.lastTaste = { at: state.time, sugar: taste.sugar && available, bitter: taste.bitter, ate: false };
  if (!f.feeding || !available) {
    f.feedProgress = 0;
    return;
  }
  f.feedProgress += dt;
  if (f.feedProgress < CONFIG.flyFeedSecondsPerUnit) return;
  f.feedProgress = 0;
  f.lastTaste.ate = true;
  const drink = NODES[node!.kind].drink;
  if (drink) {
    a.hydration = Math.min(CONFIG.maxVital, a.hydration + drink.hydration / 2);
    a.stats.drank++;
    if (drink.sickSec) a.sickUntil = Math.max(a.sickUntil, state.time + drink.sickSec);
    logEvent(state, { kind: 'action', agentId: a.id, ok: !drink.sickSec, text: `${a.id} drank from ${node!.id} (proboscis extended; MN9 active)` });
    return;
  }
  node!.units -= 1;
  const yields = NODES[node!.kind].yields;
  const fx: { energy?: number; hydration?: number; poisonSec?: number } = yields ? ITEMS[yields] : {};
  a.energy = Math.min(CONFIG.maxVital, a.energy + (fx.energy ?? 0));
  a.hydration = Math.min(CONFIG.maxVital, a.hydration + (fx.hydration ?? 0));
  a.stats.eaten++;
  if (fx.poisonSec) {
    a.poisonedUntil = Math.max(a.poisonedUntil, state.time + fx.poisonSec);
    a.stats.poisonings++;
  }
  flySound(state, a, 'feed');
  if (taste.sugar && FLY_ODOR[node!.kind] === 'A') maybeLayEgg(state, a);
  logEvent(state, {
    kind: 'action', agentId: a.id, ok: !fx.poisonSec,
    text: `${a.id} fed on ${node!.id} (${node!.kind.replace(/_/g, ' ')}): energy +${fx.energy ?? 0}${fx.poisonSec ? ', POISONED' : ''} (${Math.floor(node!.units)} left)`,
  });
}

/**
 * Landing on someone's food. Taste drives the same gustatory neurons as a fruit patch; if the brain extends the
 * proboscis (MN9) long enough the fly takes a nibble and the item rots sooner (flies spoil fruit).
 */
function feedOnItem(state: WorldState, a: Agent, c: ItemContact, dt: number) {
  const f = a.fly!;
  const taste = itemTaste(c.item.kind);
  f.nibbling = c.owner?.id ?? null;
  f.lastTaste = { at: state.time, sugar: taste.sugar, bitter: taste.bitter, ate: false };
  if (!f.feeding) {
    f.feedProgress = 0;
    return;
  }
  f.feedProgress += dt;
  if (f.feedProgress < CONFIG.flyNibbleSec) return;
  f.feedProgress = 0;
  f.lastTaste.ate = true;
  a.energy = Math.min(CONFIG.maxVital, a.energy + CONFIG.flyNibbleEnergy);
  a.stats.eaten++;
  if (c.item.kind !== 'rotten_food') {
    const soon = state.time + CONFIG.flyNibbleSpoilSec;
    c.item.spoilsAt = c.item.spoilsAt === null ? soon : Math.min(c.item.spoilsAt, soon);
  }
  if (c.item.kind === 'toxic_mushroom') a.poisonedUntil = Math.max(a.poisonedUntil, state.time + 10);
  flySound(state, a, 'nibble');
  if (taste.sugar) maybeLayEgg(state, a);
  const where = c.owner ? `${c.owner.id}'s ${c.item.label}` : `${c.item.label} on the ground`;
  logEvent(state, { kind: 'action', agentId: a.id, ok: true, text: `🪰 ${a.id} nibbled ${where} [${c.item.id}] — it will rot sooner` });
  const o = c.owner;
  if (o && state.time - (o.flyAnnoyedAt ?? -Infinity) > 20) {
    o.flyAnnoyedAt = state.time;
    recordOutcome(state, o, 'wait', false, `a fruit fly (${a.id}) landed on your ${c.item.label} [${c.item.id}] and is feeding on it; nibbled food rots sooner`, false, false);
    track(state, o, 'heard', `${a.id} is feeding on your ${c.item.label}`, false);
    interrupt(o, `a fly is eating your food`);
  }
}

/** Well-fed flies lay eggs on sweet food; each hatches later into a new fly with its own naive brain (body-level rule). */
function maybeLayEgg(state: WorldState, a: Agent) {
  const eggs = (state.flyEggs ??= []);
  if (a.energy < CONFIG.flyEggMinEnergy || eggs.length >= CONFIG.flyMaxEggs || Math.random() > CONFIG.flyEggChance) return;
  const id = newId(state, 'e');
  eggs.push({ id, position: { x: a.position.x + (Math.random() - 0.5) * 0.4, z: a.position.z + (Math.random() - 0.5) * 0.4 }, laidAt: state.time, hatchAt: state.time + CONFIG.flyEggHatchSec, parent: a.id });
  a.fly!.eggsLaid = (a.fly!.eggsLaid ?? 0) + 1;
  a.energy -= 10;
  logEvent(state, { kind: 'ecology', agentId: a.id, ok: true, text: `🥚 ${a.id} laid an egg (${id}); it hatches in ~${CONFIG.flyEggHatchSec}s` });
}

/** Hatch due eggs while there is fly capacity; eggs that wait too long die. */
export function stepFlyEggs(state: WorldState) {
  const eggs = state.flyEggs;
  if (!eggs?.length) return;
  for (let i = eggs.length - 1; i >= 0; i--) {
    const e = eggs[i];
    if (e.hatchAt > state.time) continue;
    if (state.time - e.hatchAt > 120) {
      eggs.splice(i, 1);
      continue;
    }
    if (livingOfKind(state, 'flies') >= populationLimit(state, 'flies')) continue;
    if (blocked(state, e.position, CONFIG.flyRadius)) continue;
    eggs.splice(i, 1);
    const child = createAgent(state, e.position, 'fly', state.defaultTier);
    const parent = state.agents[e.parent];
    child.generation = (parent?.generation ?? 0) + 1;
    child.parents = [e.parent];
    if (parent) {
      child.color = parent.color;
      parent.children.push(child.id);
    }
    state.agents[child.id] = child;
    flySound(state, child, 'hatch', true);
    logEvent(state, { kind: 'spawn', agentId: child.id, ok: true, text: `🐣 ${child.id} hatched from ${e.id} (parent ${e.parent}); new brain, nothing learned yet` });
  }
}

export function pruneFlySounds(state: WorldState) {
  const s = state.flySounds;
  while (s?.length && state.time - s[0].at > 6) s.shift();
}
