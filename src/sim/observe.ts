import { HAZARDS, NODES } from '../shared/catalog';
import { CONFIG } from '../shared/config';
import type { Observation, Vec2, WorldState } from '../shared/types';
import { bearing, dist } from './geometry';
import { senseRadius, timeOfDay } from './environment';
import { biomeAt } from './world';

const r1 = (n: number) => Math.round(n * 10) / 10;
const pos = (p: Vec2) => ({ x: r1(p.x), z: r1(p.z) });

/**
 * Radius-only perception (no occlusion). Agents see appearances, never true kinds, and never full world state.
 */
export function observe(state: WorldState, agentId: string): Observation {
  const self = state.agents[agentId];
  if (!self) throw new Error(`No agent ${agentId}`);
  const radius = senseRadius(state, self);
  const d = (p: Vec2) => dist(p, self.position);
  const nearest = <T extends { position: Vec2 }>(xs: T[], max: number, extra = (_: T) => 0) =>
    xs
      .map((x) => ({ x, dd: d(x.position) - extra(x) }))
      .filter((e) => e.dd <= radius)
      .sort((a, b) => a.dd - b.dd)
      .slice(0, max)
      .map((e) => e.x);

  const conditions: string[] = [];
  if (self.poisonedUntil > state.time) conditions.push('poisoned');
  if (self.sickUntil > state.time) conditions.push('sick');
  if (self.energy < 20) conditions.push('starving');
  if (self.hydration < 20) conditions.push('parched');

  return {
    runId: state.runId,
    observedAt: r1(state.time),
    timeOfDay: timeOfDay(state.time),
    weather: state.weather,
    self: {
      id: self.id,
      position: pos(self.position),
      biome: biomeAt(state, self.position),
      energy: Math.round(self.energy),
      hydration: Math.round(self.hydration),
      health: Math.round(self.health),
      stamina: Math.round(self.stamina),
      conditions,
      status: self.status,
      items: self.items.map((i) => ({ id: i.id, label: i.label, fresh: i.kind !== 'rotten_food' })),
      capacity: self.capacity,
      hasTorch: self.hasTorch,
      senseRadius: r1(radius),
      currentAction: self.current?.action.type ?? null,
      planRemaining: self.plan.length,
      trigger: self.controller.interruptReason,
    },
    bounds: state.bounds,
    visibleResources: nearest(Object.values(state.resources), CONFIG.observeMaxResources).map((r) => ({
      id: r.id,
      appearance: NODES[r.kind].appearance,
      position: pos(r.position),
      distance: r1(d(r.position)),
      bearing: bearing(self.position, r.position),
      units: Math.floor(r.units),
    })),
    visibleHazards: nearest(Object.values(state.hazards), CONFIG.observeMaxOther, (h) => h.radius).map((h) => ({
      id: h.id,
      appearance: HAZARDS[h.kind].appearance,
      position: pos(h.position),
      radius: r1(h.radius),
      distance: r1(Math.max(0, d(h.position) - h.radius)),
    })),
    visibleObstacles: nearest(Object.values(state.obstacles), CONFIG.observeMaxOther, (o) => o.halfLength ?? o.radius).map((o) => ({
      id: o.id,
      kind: o.shape,
      position: pos(o.position),
      radius: r1(o.radius),
      solid: o.solid,
      ...(o.halfLength !== undefined ? { halfLength: r1(o.halfLength), angle: r1(o.angle ?? 0) } : {}),
    })),
    visibleAgents: nearest(
      Object.values(state.agents).filter((a) => a.id !== self.id),
      CONFIG.observeMaxOther,
    ).map((a) => ({ id: a.id, position: pos(a.position), distance: r1(d(a.position)), status: a.status })),
    visibleStructures: nearest(Object.values(state.structures), CONFIG.observeMaxOther).map((s) => ({
      id: s.id,
      kind: s.kind,
      position: pos(s.position),
      distance: r1(d(s.position)),
      ...(s.kind === 'sign' ? { text: s.text } : {}),
      ...(s.kind === 'campfire' ? { lit: (s.litUntil ?? 0) > state.time } : {}),
      ...(s.kind === 'cache' && d(s.position) <= 4 ? { contents: (s.items ?? []).map((i) => ({ id: i.id, label: i.label })) } : {}),
    })),
    visibleGroundItems: nearest(Object.values(state.groundItems), CONFIG.observeMaxOther).map((g) => ({
      id: g.id,
      label: g.item.label,
      position: pos(g.position),
      distance: r1(d(g.position)),
    })),
    messages: self.inbox.map((m) => ({ ...m })),
    recentOutcomes: self.recentOutcomes.map(({ actionType, ok, detail, at }) => ({ actionType, ok, detail, secondsAgo: Math.round(state.time - at) })),
    rememberedPlaces: self.memory.places.map((p) => ({
      label: p.label,
      position: { x: r1(p.x), z: r1(p.z) },
      distance: r1(dist(p, self.position)),
      bearing: bearing(self.position, p),
    })),
  };
}
