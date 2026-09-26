import type { Vec2, WorldState } from '../shared/types';
import { timeOfDay, worldClock } from './environment';
import { dist } from './geometry';

const r1 = (n: number) => Math.round(n * 10) / 10;
const MAX_RESOURCES = 150;

/**
 * Compact, JSON-safe snapshot of actual world state for the God console.
 * It is the only source of facts the world-command model may use for status answers and placement.
 */
export function worldStatus(state: WorldState, selectedId: string | null = null) {
  const agents = Object.values(state.agents);
  const resources = Object.values(state.resources);
  const hazards = Object.values(state.hazards);
  // Distances are computed here so the model never has to do geometry ("the hazard nearest a1").
  const nearest = <T extends { id: string; position: Vec2 }>(from: Vec2, items: T[], n: number, pad: (t: T) => number = () => 0) =>
    items
      .map((t) => ({ t, d: Math.max(0, dist(from, t.position) - pad(t)) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, n);
  const living = agents.filter((a) => a.status !== 'dead');
  const lowest = (k: 'energy' | 'hydration' | 'health') =>
    living.length ? living.reduce((m, a) => (a[k] < m[k] ? a : m)) : null;
  const byKind: Record<string, { patches: number; units: number }> = {};
  for (const r of resources) {
    const k = (byKind[r.kind] ??= { patches: 0, units: 0 });
    k.patches += 1;
    k.units += Math.floor(r.units);
  }
  const sel = selectedId ? state.agents[selectedId] : undefined;
  return {
    mode: state.mode,
    selected: sel ? { id: sel.id, x: r1(sel.position.x), z: r1(sel.position.z) } : null,
    time: Math.round(state.time),
    timeOfDay: timeOfDay(worldClock(state)),
    weather: state.weather,
    nextWeatherInSec: Math.max(0, Math.round(state.nextWeatherAt - state.time)),
    paused: state.paused,
    bounds: state.bounds,
    compass: 'north = -z, east = +x',
    biomes: state.biomes.map((b) => ({ kind: b.kind, x: r1(b.site.x), z: r1(b.site.z) })),
    agents: {
      alive: living.length,
      dead: agents.length - living.length,
      // Precomputed so status answers never depend on the model scanning for minima.
      lowestAmongLiving: Object.fromEntries(
        (['energy', 'hydration', 'health'] as const).map((k) => {
          const a = lowest(k);
          return [k, a ? { id: a.id, value: Math.round(a[k]) } : null];
        }),
      ),
      list: agents.map((a) => ({
        id: a.id,
        status: a.status,
        x: r1(a.position.x),
        z: r1(a.position.z),
        energy: Math.round(a.energy),
        hydration: Math.round(a.hydration),
        health: Math.round(a.health),
        controller: a.controller.kind === 'llm' ? `llm/${a.controller.tier}` : a.controller.kind === 'fly' ? 'connectome fruit fly' : a.controller.kind,
        doing: a.fly ? (a.fly.flight ? 'flying' : a.fly.feeding ? 'feeding' : a.fly.speed > 0.05 ? 'walking' : 'still') : a.current?.action.type ?? 'idle',
        ...(a.deathCause ? { deathCause: a.deathCause } : {}),
        carrying: a.items.length,
        ...(a.status !== 'dead'
          ? {
              nearestHazards: nearest(a.position, hazards, 3, (h) => h.radius).map(({ t, d }) => ({ id: t.id, kind: t.kind, distance: r1(d) })),
              nearestResources: nearest(a.position, resources, 5).map(({ t, d }) => ({ id: t.id, kind: t.kind, distance: r1(d) })),
            }
          : {}),
      })),
    },
    resources: {
      byKind,
      list: resources.slice(0, MAX_RESOURCES).map((r) => ({ id: r.id, kind: r.kind, x: r1(r.position.x), z: r1(r.position.z), units: Math.floor(r.units) })),
      ...(resources.length > MAX_RESOURCES ? { omitted: resources.length - MAX_RESOURCES } : {}),
    },
    hazards: hazards.map((h) => ({ id: h.id, kind: h.kind, x: r1(h.position.x), z: r1(h.position.z), radius: r1(h.radius) })),
    structures: Object.values(state.structures).map((s) => ({ id: s.id, kind: s.kind, x: r1(s.position.x), z: r1(s.position.z) })),
    obstacles: Object.keys(state.obstacles).length,
    births: state.births.length,
    ...(state.mode !== 'agents' ? { flyEggs: (state.flyEggs ?? []).length, flyEscapes: agents.reduce((s, a) => s + (a.fly?.escapes ?? 0), 0) } : {}),
    recentEvents: state.events.slice(-12).map((e) => `${Math.round(e.at)}s ${e.text}`),
  };
}
