import { HAZARDS, NODES } from '../shared/catalog';
import { CONFIG } from '../shared/config';
import type { Observation, Vec2, WorldState } from '../shared/types';
import { bearing, dist } from './geometry';
import { senseRadius, timeOfDay, worldClock } from './environment';
import { biomeAt } from './world';
import { ageOf, stageOf, TRAIT_LOOKS } from './life';

/** Each agent sees the sound inventory in its own fixed shuffled order, so list position carries no shared meaning. */
function soundsFor(lexicon: string[], agentId: string) {
  let h = 2166136261;
  for (let i = 0; i < agentId.length; i++) h = Math.imul(h ^ agentId.charCodeAt(i), 16777619);
  const out = [...lexicon];
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 2246822507) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

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
    timeOfDay: timeOfDay(worldClock(state)),
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
      traits: self.traits,
      ageSec: Math.round(ageOf(state, self)),
      stage: stageOf(state, self),
      lifespanSec: state.experiment.lifespanSec || null,
      generation: self.generation,
      children: self.children.length,
      courtedBy: Object.values(state.agents)
        .filter((o) => o.courting?.target === self.id && o.courting.until > state.time && o.status !== 'dead')
        .map((o) => o.id),
      courting: self.courting && self.courting.until > state.time ? self.courting.target : null,
      voice: {
        mode: state.experiment.commMode,
        sounds: state.experiment.commMode === 'silent' ? [] : soundsFor(state.experiment.lexicon, self.id),
      },
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
      radius: r1(o.halfLength ?? o.radius),
    })),
    visibleAgents: nearest(
      Object.values(state.agents).filter((a) => a.id !== self.id),
      CONFIG.observeMaxOther,
    ).map((a) => {
      const doing = a.lastVisibleAct && a.lastVisibleAct.until > state.time ? a.lastVisibleAct.text
        : a.status === 'resting' ? 'resting' : a.current?.action.type === 'move' || a.current?.action.type === 'follow' ? 'walking' : undefined;
      const g = a.gesture && a.gesture.until > state.time ? a.gesture : null;
      const looks = a.health < 35 ? 'hurt' : a.energy < 30 || a.hydration < 30 ? 'weak' : a.stamina < 30 || a.energy < 50 ? 'tired' : 'healthy';
      return {
        id: a.id, position: pos(a.position), distance: r1(d(a.position)), status: a.status,
        stage: stageOf(state, a), looks: looks as 'healthy' | 'tired' | 'hurt' | 'weak', appears: a.traits.map((t) => TRAIT_LOOKS[t]),
        ...(a.courting?.target === self.id && a.courting.until > state.time ? { courtingYou: true } : {}),
        ...(doing ? { doing } : {}),
        ...(a.items.length ? { holding: a.items.slice(0, 4).map((i) => i.label) } : {}),
        ...(g ? { gesture: { kind: g.kind, ...(g.toward ? { toward: bearing(a.position, g.toward) } : {}) } } : {}),
      };
    }),
    visibleMarks: nearest(Object.values(state.marks), CONFIG.observeMaxOther).map((m) => ({
      id: m.id, glyph: m.glyph, position: pos(m.position), distance: r1(d(m.position)), ageSec: Math.round(state.time - m.at),
    })),
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
    recentOutcomes: self.recentOutcomes.map(({ actionType, ok, detail }) => ({ actionType, ok, detail })),
  };
}
