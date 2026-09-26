import type { Agent, GroundItem, Hazard, Mark, Obstacle, ResourceNode, Structure, WorldState } from '../shared/types';
import type { SimStore } from './store';

/** Sim seconds between snapshots, and how much sim time is kept. */
export const FRAME_EVERY_SEC = 1;
export const REPLAY_WINDOW_SEC = 600;

/**
 * A read-only snapshot of what is visible at one moment. Append-only histories (timeline, growth, memory objects…)
 * are kept by reference and filtered to the viewed time; only small objects the simulator mutates in place are copied.
 */
export type Frame = {
  t: number;
  clockOffset: number;
  weather: WorldState['weather'];
  nextWeatherAt: number;
  agents: Record<string, Agent>;
  units: Record<string, number>;
  hazards: Hazard[];
  obstacles: Obstacle[];
  structures: Structure[];
  groundItems: GroundItem[];
  marks: Mark[];
  deliveries: WorldState['deliveries'];
  utterances: WorldState['utterances'];
};

function snapAgent(a: Agent): Agent {
  return {
    ...a,
    position: { ...a.position },
    target: a.target && { ...a.target },
    items: a.items.slice(),
    plan: a.plan.slice(),
    current: a.current && { ...a.current },
    stats: { ...a.stats },
    controller: { ...a.controller, lastObservation: null },
    gesture: a.gesture && { ...a.gesture },
    courting: a.courting && { ...a.courting },
    lastVisibleAct: a.lastVisibleAct && { ...a.lastVisibleAct },
    fly: a.fly && { ...a.fly },
  };
}

/** Records static resource data the first time each id is seen, so patches that later wither still render in the past. */
export function captureFrame(state: WorldState, registry: Map<string, ResourceNode>): Frame {
  const units: Record<string, number> = {};
  for (const r of Object.values(state.resources)) {
    if (!registry.has(r.id)) registry.set(r.id, { ...r });
    units[r.id] = r.units;
  }
  const agents: Record<string, Agent> = {};
  for (const a of Object.values(state.agents)) agents[a.id] = snapAgent(a);
  return {
    t: state.time,
    clockOffset: state.clockOffset,
    weather: state.weather,
    nextWeatherAt: state.nextWeatherAt,
    agents,
    units,
    hazards: Object.values(state.hazards),
    obstacles: Object.values(state.obstacles),
    structures: Object.values(state.structures).map((s) => ({ ...s, items: s.items?.slice() })),
    groundItems: Object.values(state.groundItems),
    marks: Object.values(state.marks),
    deliveries: state.deliveries.slice(),
    utterances: state.utterances.filter((u) => u.at >= state.time - 5),
  };
}

const byId = <T extends { id: string }>(xs: T[]) => Object.fromEntries(xs.map((x) => [x.id, x]));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
function lerpAngle(a: number, b: number, k: number) {
  const d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return a + d * k;
}

/** Last frame at or before t (frames are sorted by t). */
export function frameIndexAt(frames: Frame[], t: number): number {
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * The world as it looked at sim time t, shaped like WorldState so the renderer and panels can display it unchanged.
 * Global settings (bounds, biomes, mode, paused, experiment…) come from the live state.
 */
export function buildView(live: WorldState, frames: Frame[], registry: Map<string, ResourceNode>, t: number): WorldState {
  const i = frameIndexAt(frames, t);
  const f0 = frames[i];
  const f1 = frames[i + 1];
  const k = f1 ? Math.min(1, Math.max(0, (t - f0.t) / (f1.t - f0.t))) : 0;
  const agents: Record<string, Agent> = {};
  for (const a of Object.values(f0.agents)) {
    const b = f1?.agents[a.id];
    const moving = b && a.status !== 'dead' && b.status !== 'dead';
    agents[a.id] = {
      ...a,
      position: moving ? { x: lerp(a.position.x, b.position.x, k), z: lerp(a.position.z, b.position.z, k) } : a.position,
      heading: moving ? lerpAngle(a.heading, b.heading, k) : a.heading,
      timeline: a.timeline.filter((e) => e.at <= t),
      growth: a.growth.filter((g) => g.t <= t),
      milestones: a.milestones.filter((m) => m.at <= t),
    };
  }
  const resources: Record<string, ResourceNode> = {};
  for (const [id, u] of Object.entries(f0.units)) {
    const r = registry.get(id);
    if (r) resources[id] = { ...r, units: u };
  }
  return {
    ...live,
    time: t,
    clockOffset: f0.clockOffset,
    weather: f0.weather,
    nextWeatherAt: f0.nextWeatherAt,
    agents,
    resources,
    hazards: byId(f0.hazards),
    obstacles: byId(f0.obstacles),
    structures: byId(f0.structures),
    groundItems: byId(f0.groundItems),
    marks: byId(f0.marks),
    deliveries: f0.deliveries,
    utterances: f0.utterances,
    events: live.events.filter((e) => e.at <= t),
    history: live.history.filter((p) => p.t <= t),
    births: live.births.filter((b) => b.at <= t),
  };
}

export type Replay = {
  /** Store for display components: getState() is the viewed moment; everything else delegates to the live store. */
  viewStore: SimStore;
  /** null = live. */
  getViewTime(): number | null;
  /** Jump to sim time t (clamped to the recorded range); null returns to live. */
  seek(t: number | null): void;
  isPlaying(): boolean;
  setPlaying(p: boolean): void;
  getRate(): number;
  setRate(r: number): void;
  /** Recorded range [oldest, live] in sim seconds. */
  range(): { start: number; end: number };
  subscribe(fn: () => void): () => void;
};

/**
 * Records the live world and lets the display look at any moment of the last REPLAY_WINDOW_SEC. Recording only reads
 * the live state; the simulation, controllers and God commands keep running on the live world while the past is shown.
 */
export function createReplay(store: SimStore, opts: { now?: () => number } = {}): Replay {
  const now = opts.now ?? (() => performance.now());
  let frames: Frame[] = [];
  let registry = new Map<string, ResourceNode>();
  let runId = '';
  let viewTime: number | null = null;
  let playing = false;
  let rate = 1;
  let lastWall = now();
  let cache: { key: string; view: WorldState } | null = null;
  const subs = new Set<() => void>();
  const notify = () => subs.forEach((f) => f());

  const range = () => ({ start: frames[0]?.t ?? store.getState().time, end: store.getState().time });

  store.subscribe(() => {
    const s = store.getState();
    const wall = now();
    const dt = (wall - lastWall) / 1000;
    lastWall = wall;
    if (s.runId !== runId) {
      // Reset/new world: the old run's past is gone.
      frames = [];
      registry = new Map();
      runId = s.runId;
      viewTime = null;
      playing = false;
      cache = null;
    }
    const last = frames[frames.length - 1];
    if (!last || s.time - last.t >= FRAME_EVERY_SEC) {
      frames.push(captureFrame(s, registry));
      while (frames.length > 1 && s.time - frames[0].t > REPLAY_WINDOW_SEC) frames.shift();
    }
    if (viewTime !== null) {
      if (playing) viewTime += dt * rate * store.getSpeed();
      if (viewTime >= s.time) {
        viewTime = null; // caught up with the present
        playing = false;
      } else if (viewTime < frames[0].t) {
        viewTime = frames[0].t; // that moment has scrolled out of the window
      }
    }
    notify();
  });

  const view = (): WorldState => {
    const live = store.getState();
    if (viewTime === null || frames.length === 0) return live;
    const key = `${viewTime}|${frames.length}|${frames[0].t}|${live.eventSeq}`;
    if (cache?.key !== key) cache = { key, view: buildView(live, frames, registry, viewTime) };
    return cache.view;
  };

  return {
    viewStore: { ...store, getState: view },
    getViewTime: () => viewTime,
    seek(t) {
      if (t === null || frames.length === 0) {
        viewTime = null;
        playing = false;
      } else {
        const r = range();
        viewTime = t >= r.end ? null : Math.max(r.start, t);
        if (viewTime === null) playing = false;
      }
      lastWall = now();
      notify();
    },
    isPlaying: () => playing,
    setPlaying(p) {
      playing = p && viewTime !== null;
      lastWall = now();
      notify();
    },
    getRate: () => rate,
    setRate(r) {
      rate = r;
      notify();
    },
    range,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
