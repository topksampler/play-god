import { ITEMS, NODES } from '../shared/catalog';
import { CONFIG } from '../shared/config';
import type { Agent, FlyMotorCommand, NodeKind, ResourceNode, WorldState } from '../shared/types';
import { speedAt } from './actions';
import { blocked, dist } from './geometry';
import { logEvent } from './world';

/** Odor A: sweet fruit smells. Odor B: mushroom smell, shared by edible and toxic patches (only taste tells them apart). */
export const FLY_ODOR: Partial<Record<NodeKind, 'A' | 'B'>> = {
  berry_bush: 'A', fruit_tree: 'A', honey_hive: 'A', cactus: 'A',
  mushroom_patch: 'B', toxic_mushroom_patch: 'B',
};

/** What touching a node tastes like to a fly's gustatory receptor neurons (sugar/water class vs bitter class). */
export function flyTaste(kind: NodeKind): { sugar: boolean; bitter: boolean } {
  if (kind === 'toxic_mushroom_patch' || kind === 'toxic_water') return { sugar: false, bitter: true };
  if (FLY_ODOR[kind] || kind === 'fresh_water') return { sugar: true, bitter: false };
  return { sugar: false, bitter: false };
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

const clampNum = (x: number, lo: number, hi: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : 0);

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
  }
}

/** Body-level collision reflex: if the heading is blocked, try nearby headings (not a brain output; labelled in the UI). */
const DODGE = [0.5, -0.5, 1.1, -1.1, 1.8, -1.8, Math.PI];

/** Moves a fly by its latest brain motor command and applies taste/feeding. The simulator alone mutates the world. */
export function stepFly(state: WorldState, a: Agent, dt: number) {
  const f = a.fly!;
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
  }

  const node = flyContact(state, a);
  if (!node) {
    f.feedProgress = 0;
    return;
  }
  const taste = flyTaste(node.kind);
  const available = NODES[node.kind].drink ? true : node.units >= 1;
  f.lastTaste = { at: state.time, sugar: taste.sugar && available, bitter: taste.bitter, ate: false };
  if (!f.feeding || !available) {
    f.feedProgress = 0;
    return;
  }
  f.feedProgress += dt;
  if (f.feedProgress < CONFIG.flyFeedSecondsPerUnit) return;
  f.feedProgress = 0;
  f.lastTaste.ate = true;
  const drink = NODES[node.kind].drink;
  if (drink) {
    a.hydration = Math.min(CONFIG.maxVital, a.hydration + drink.hydration / 2);
    a.stats.drank++;
    if (drink.sickSec) a.sickUntil = Math.max(a.sickUntil, state.time + drink.sickSec);
    logEvent(state, { kind: 'action', agentId: a.id, ok: !drink.sickSec, text: `${a.id} drank from ${node.id} (proboscis extended; MN9 active)` });
    return;
  }
  node.units -= 1;
  const yields = NODES[node.kind].yields;
  const fx: { energy?: number; hydration?: number; poisonSec?: number } = yields ? ITEMS[yields] : {};
  a.energy = Math.min(CONFIG.maxVital, a.energy + (fx.energy ?? 0));
  a.hydration = Math.min(CONFIG.maxVital, a.hydration + (fx.hydration ?? 0));
  a.stats.eaten++;
  if (fx.poisonSec) {
    a.poisonedUntil = Math.max(a.poisonedUntil, state.time + fx.poisonSec);
    a.stats.poisonings++;
  }
  logEvent(state, {
    kind: 'action', agentId: a.id, ok: !fx.poisonSec,
    text: `${a.id} fed on ${node.id} (${node.kind.replace(/_/g, ' ')}): energy +${fx.energy ?? 0}${fx.poisonSec ? ', POISONED' : ''} (${Math.floor(node.units)} left)`,
  });
}
