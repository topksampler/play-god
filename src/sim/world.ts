import { BIOMES, NODES } from '../shared/catalog';
import { AGENT_COLORS, CONFIG } from '../shared/config';
import type {
  FlyBodyState, WorldMode,
  ExperimentConfig, Trait, TimelineEntry, Agent, AgentMemory, AgentTier, Biome, BiomeKind, ControllerKind, NodeKind, Obstacle, ObstacleShape, SimEvent, Vec2, WorldState,
} from '../shared/types';
import { blocked, dist, obstacleDistance } from './geometry';
import { mulberry32, type Rng } from './rng';

export type { Rng };

export function logEvent(state: WorldState, e: Omit<SimEvent, 'seq' | 'at'>) {
  state.eventSeq += 1;
  state.events.push({ ...e, seq: state.eventSeq, at: state.time });
  if (state.events.length > CONFIG.maxEvents) state.events.splice(0, state.events.length - CONFIG.maxEvents);
}

export function newId(state: WorldState, prefix: string) {
  const n = (state.idCounters[prefix] ?? 0) + 1;
  state.idCounters[prefix] = n;
  return `${prefix}${n}`;
}

export function biomeAt(state: WorldState, p: Vec2): BiomeKind {
  let best = state.biomes[0];
  let bd = Infinity;
  for (const b of state.biomes) {
    const d = dist(b.site, p);
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best?.kind ?? 'meadow';
}

const CONS = ['k', 't', 'm', 'n', 'r', 's', 'v', 'z', 'p', 'l', 'g', 'd'];
const VOWS = ['a', 'e', 'i', 'o', 'u'];
/** Two-syllable nonsense tokens (CVCV), avoiding a few accidental English words. */
export function makeLexicon(rng: Rng, n = CONFIG.lexiconSize): string[] {
  const banned = new Set(['mama', 'papa', 'nono', 'soso', 'tutu', 'lola', 'gogo', 'dodo', 'mimi', 'nana', 'kiki', 'lulu']);
  const out = new Set<string>();
  while (out.size < n) {
    const w = CONS[Math.floor(rng() * CONS.length)] + VOWS[Math.floor(rng() * 5)] + CONS[Math.floor(rng() * CONS.length)] + VOWS[Math.floor(rng() * 5)];
    if (!banned.has(w)) out.add(w);
  }
  return [...out];
}

export const TRAITS: Record<Trait, { label: string; effect: string }> = {
  keen_eyes: { label: 'keen eyes', effect: 'sees 35% further' },
  strong: { label: 'strong', effect: 'carries 3 more items' },
  swift: { label: 'swift', effect: 'moves 25% faster' },
  hardy: { label: 'hardy', effect: 'poison and sickness hit half as hard' },
};
export const traitMods = (traits: Trait[]) => ({
  senseMul: traits.includes('keen_eyes') ? 1.35 : 1,
  speedMul: traits.includes('swift') ? 1.25 : 1,
  extraCapacity: traits.includes('strong') ? 3 : 0,
  poisonResist: traits.includes('hardy') ? 0.5 : 1,
});

const FOOD_KINDS = new Set<NodeKind>(['berry_bush', 'fruit_tree', 'mushroom_patch', 'fish_spot', 'cactus', 'honey_hive']);
const SCARCITY = { abundant: { count: 1.5, regrow: 1.6 }, normal: { count: 1, regrow: 1 }, scarce: { count: 0.5, regrow: 0.4 } } as const;

export const emptyMemory = (): AgentMemory => ({ notes: '', places: [], beliefs: [] });

export const newFlyBody = (): FlyBodyState => ({
  turnRate: 0, speed: 0, feeding: false, readout: null, motorAt: null, lastTaste: null, feedProgress: 0, brainStatus: 'loading',
});

export function createAgent(state: WorldState, position: Vec2, controller: ControllerKind, tier: AgentTier, rng: Rng = Math.random): Agent {
  const index = Object.keys(state.agents).length;
  const id = newId(state, controller === 'fly' ? 'f' : 'a');
  const all = Object.keys(TRAITS) as Trait[];
  const traits: Trait[] = state.experiment.traits ? [all[(index + Math.floor(rng() * all.length)) % all.length]] : [];
  const mods = traitMods(traits);
  return {
    id,
    color: AGENT_COLORS[index % AGENT_COLORS.length],
    position: { ...position },
    heading: controller === 'fly' ? rng() * Math.PI * 2 : 0,
    energy: 80,
    hydration: 80,
    health: CONFIG.maxVital,
    stamina: CONFIG.maxVital,
    poisonedUntil: 0,
    sickUntil: 0,
    status: 'active',
    target: null,
    path: null,
    sprinting: false,
    items: [],
    capacity: CONFIG.baseCapacity + mods.extraCapacity,
    hasTorch: false,
    plan: [],
    current: null,
    memory: emptyMemory(),
    intent: null,
    inbox: [],
    recentOutcomes: [],
    controller: {
      kind: controller,
      tier,
      pending: false,
      requestSeq: 0,
      lastError: null,
      errorStreak: 0,
      // Stagger first decisions so agents don't all request at once.
      lastDecisionAt: state.time - CONFIG.minDecisionGapSec + 0.3 + index * 0.6,
      lastLatencyMs: null,
      lastPlan: null,
      lastObservation: null,
      needsDecision: true,
      interruptReason: 'spawned',
    },
    stats: { eaten: 0, drank: 0, distance: 0, poisonings: 0, built: 0, damageTaken: 0 },
    lastDamageAt: -Infinity,
    stuckFor: 0,
    bornAt: state.time,
    traits,
    baseline: {
      traits, capacity: CONFIG.baseCapacity + mods.extraCapacity, senseMul: mods.senseMul, speedMul: mods.speedMul,
      poisonResist: mods.poisonResist, controller, tier, commMode: state.experiment.commMode, energy: 80, hydration: 80,
    },
    gesture: null,
    lastVisibleAct: null,
    generation: 0,
    parents: [],
    children: [],
    courting: null,
    lastBirthAt: -Infinity,
    deathCause: null,
    turn: 0,
    timeline: [],
    growth: [],
    discovered: [],
    biomesVisited: [],
    milestones: [],
    actionCounts: {},
    messagesSent: 0,
    messagesHeard: 0,
    fly: controller === 'fly' ? newFlyBody() : null,
  };
}

/** Append to an agent's timeline (bounded). */
export function track(state: WorldState, a: Agent, kind: TimelineEntry['kind'], text: string, ok = true, plan?: TimelineEntry['plan']) {
  state.eventSeq += 1;
  a.timeline.push({ seq: state.eventSeq, at: state.time, turn: a.turn, kind, ok, text, ...(plan ? { plan } : {}) });
  if (a.timeline.length > CONFIG.timelineMax) a.timeline.splice(0, a.timeline.length - CONFIG.timelineMax);
}

/** Record a first-time achievement once. */
export function milestone(state: WorldState, a: Agent, text: string) {
  if (a.milestones.some((m) => m.text === text) || a.milestones.length > 60) return;
  a.milestones.push({ at: state.time, text });
  track(state, a, 'milestone', text);
}

/** Bounded rejection sampling for a free spot. Returns null if none found. */
export function sampleFreeSpot(
  state: WorldState,
  rng: Rng,
  opts: { radius?: number; near?: Vec2; within?: number; biome?: BiomeKind; clearOf?: number } = {},
): Vec2 | null {
  const { min, max } = state.bounds;
  const radius = opts.radius ?? CONFIG.agentRadius + 0.2;
  const clear = opts.clearOf ?? 0;
  for (let i = 0; i < CONFIG.spawnAttempts; i++) {
    const w = opts.within ?? 10;
    const p = opts.near
      ? { x: opts.near.x + (rng() * 2 - 1) * w, z: opts.near.z + (rng() * 2 - 1) * w }
      : { x: min.x + 2 + rng() * (max.x - min.x - 4), z: min.z + 2 + rng() * (max.z - min.z - 4) };
    if (opts.biome && biomeAt(state, p) !== opts.biome) continue;
    if (blocked(state, p, radius)) continue;
    if (clear > 0) {
      const crowded =
        Object.values(state.resources).some((r) => dist(r.position, p) < clear) ||
        Object.values(state.hazards).some((h) => dist(h.position, p) < h.radius + clear * 0.5);
      if (crowded) continue;
    }
    return p;
  }
  return null;
}

/** Living-population cap for the Spawn controls: plan agents, or flies (also bounded by brain-worker capacity). */
export function populationLimit(state: WorldState): number {
  return state.mode === 'flies' ? Math.min(CONFIG.maxFlies, state.flyCapacity ?? CONFIG.maxFlies) : CONFIG.maxAgents;
}

export function spawnAgents(state: WorldState, count: number, controller: ControllerKind, tier: AgentTier, rng: Rng): string[] {
  const spawned: string[] = [];
  const flies = state.mode === 'flies';
  if (flies !== (controller === 'fly')) {
    logEvent(state, { kind: 'spawn', ok: false, text: `Spawn rejected: ${controller} creatures cannot enter ${state.mode} mode` });
    return spawned;
  }
  const limit = populationLimit(state);
  const room = limit - Object.values(state.agents).filter((a) => a.status !== 'dead').length;
  if (room <= 0) {
    logEvent(state, { kind: 'spawn', ok: false, text: flies ? `Spawn rejected: max ${limit} living flies` : `Spawn rejected: max ${limit} living agents via Spawn (births can go beyond)` });
    return spawned;
  }
  const n = Math.min(count, room);
  // Spawn around the central meadow so newcomers begin somewhere survivable.
  const home = state.biomes[4]?.site;
  for (let i = 0; i < n; i++) {
    const p = (home && sampleFreeSpot(state, rng, { near: home, within: flies ? 14 : 10 })) || sampleFreeSpot(state, rng);
    if (!p) {
      logEvent(state, { kind: 'spawn', ok: false, text: 'Spawn rejected: no free spot found' });
      break;
    }
    const agent = createAgent(state, p, controller, tier, rng);
    state.agents[agent.id] = agent;
    spawned.push(agent.id);
    logEvent(state, { kind: 'spawn', agentId: agent.id, ok: true, text: `Spawned ${agent.id} (${controller === 'fly' ? 'connectome fly' : controller}${controller === 'llm' ? `/${tier}` : ''})` });
  }
  if (n < count) logEvent(state, { kind: 'spawn', ok: false, text: `Only ${n} of ${count} spawned: max ${limit} ${flies ? 'flies' : 'agents'}` });
  return spawned;
}

export function addNode(state: WorldState, kind: NodeKind, position: Vec2) {
  const def = NODES[kind];
  const id = newId(state, 'r');
  const regrow = FOOD_KINDS.has(kind) ? def.regrowPerMin * SCARCITY[state.experiment.scarcity].regrow : def.regrowPerMin;
  state.resources[id] = {
    id, kind, biome: biomeAt(state, position), position,
    units: def.maxUnits, maxUnits: def.maxUnits, regrowPerMin: regrow, depletedSince: null,
  };
  return id;
}

const OBSTACLE_DIMS: Record<ObstacleShape, (rng: Rng) => Partial<Obstacle>> = {
  rock: (r) => ({ radius: 0.6 + r() * 0.6, height: 0.8 + r() * 0.6, solid: true }),
  boulder: (r) => ({ radius: 1.2 + r() * 0.9, height: 1.8 + r() * 1.2, solid: true }),
  tree: (r) => ({ radius: 0.45 + r() * 0.25, height: 4 + r() * 3, solid: true }),
  log: (r) => ({ radius: 0.35, halfLength: 1.6 + r() * 1.2, angle: r() * Math.PI, height: 0.7, solid: true }),
  cliff: (r) => ({ radius: 0.9, halfLength: 5 + r() * 4, angle: r() * Math.PI, height: 3.5 + r() * 2, solid: true }),
  bush: (r) => ({ radius: 0.9 + r() * 0.5, height: 1, solid: false }),
  lake: (r) => ({ radius: 5.5 + r() * 2, height: 0.05, solid: true }),
};

export function addObstacle(state: WorldState, shape: ObstacleShape, position: Vec2, rng: Rng, radius?: number) {
  const id = newId(state, 'o');
  const dims = OBSTACLE_DIMS[shape](rng);
  state.obstacles[id] = { id, shape, position, height: 1, solid: true, ...dims, radius: radius ?? dims.radius ?? 1 } as Obstacle;
  return state.obstacles[id];
}

const BIOME_LAYOUT: BiomeKind[] = ['meadow', 'forest', 'lake', 'highlands', 'scrub', 'swamp', 'meadow', 'forest', 'lake'];

function generate(state: WorldState, rng: Rng) {
  const h = CONFIG.worldSize / 2;
  // Biome sites on a jittered 3x3 grid → Voronoi regions.
  const cells = 3;
  const cell = CONFIG.worldSize / cells;
  const order = [...BIOME_LAYOUT];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  // Keep a meadow in the centre so the default camera opens on a survivable area.
  const mi = order.indexOf('meadow');
  [order[4], order[mi]] = [order[mi], order[4]];
  state.biomes = order.map((kind, i): Biome => ({
    id: `b${i}`,
    kind,
    site: {
      x: -h + cell * ((i % cells) + 0.5) + (i === 4 ? 0 : (rng() - 0.5) * cell * 0.4),
      z: -h + cell * (Math.floor(i / cells) + 0.5) + (i === 4 ? 0 : (rng() - 0.5) * cell * 0.4),
    },
  }));

  for (const b of state.biomes) {
    const def = BIOMES[b.kind];
    const place = (radius: number, clearOf = 0) =>
      sampleFreeSpot(state, rng, { near: b.site, within: cell * 0.5, biome: b.kind, radius, clearOf });
    let lake: Obstacle | null = null;
    for (const [shape, n] of def.obstacles) {
      for (let i = 0; i < n; i++) {
        if (shape === 'lake') {
          lake = addObstacle(state, 'lake', { ...b.site }, rng);
          continue;
        }
        const p = place(shape === 'cliff' ? 2.5 : 1.4);
        if (p) addObstacle(state, shape, p, rng);
      }
    }
    for (const [kind, base] of def.nodes) {
      const n = FOOD_KINDS.has(kind) ? Math.max(1, Math.round(base * SCARCITY[state.experiment.scarcity].count)) : base;
      for (let i = 0; i < n; i++) {
        let p: Vec2 | null;
        if (lake && (kind === 'fresh_water' || kind === 'fish_spot')) {
          // Water nodes sit on the shore, just outside the lake.
          const ang = rng() * Math.PI * 2;
          p = { x: lake.position.x + Math.cos(ang) * (lake.radius + 0.9), z: lake.position.z + Math.sin(ang) * (lake.radius + 0.9) };
        } else {
          p = place(1, 2.5);
        }
        if (!p) continue;
        const id = addNode(state, kind, p);
        // High-value honey is guarded.
        if (kind === 'honey_hive') {
          const hz = newId(state, 'h');
          state.hazards[hz] = { id: hz, kind: b.kind === 'scrub' ? 'snakes' : 'wasps', position: { ...state.resources[id].position }, radius: 2.4 };
        }
      }
    }
    for (const [kind, n] of def.hazards) {
      for (let i = 0; i < n; i++) {
        const p = place(1, 3);
        if (!p) continue;
        const id = newId(state, 'h');
        state.hazards[id] = { id, kind, position: p, radius: 1.8 + rng() * 1.4 };
      }
    }
  }
  for (const r of Object.values(state.resources)) {
    if (Object.values(state.obstacles).some((o) => o.solid && obstacleDistance(o, r.position) < 0.3)) delete state.resources[r.id];
  }
}

export function createInitialWorld(
  runId: string,
  defaultController: ControllerKind,
  opts: { seed?: number; defaultTier?: AgentTier; experiment?: Partial<Omit<ExperimentConfig, 'lexicon'>>; mode?: WorldMode; flyCapacity?: number } = {},
): WorldState {
  const mode = opts.mode ?? 'agents';
  const seed = opts.seed ?? CONFIG.defaultSeed;
  const rng = mulberry32(seed);
  const lexicon = makeLexicon(mulberry32(seed ^ 0x5eed));
  const h = CONFIG.worldSize / 2;
  const state: WorldState = {
    runId,
    seed,
    time: CONFIG.dayLengthSec * 0.05,
    clockOffset: 0,
    paused: false,
    mode,
    flyCapacity: opts.flyCapacity,
    defaultController,
    defaultTier: opts.defaultTier ?? 'fast',
    weather: 'clear',
    nextWeatherAt: 90,
    nextEcologyAt: 20,
    bounds: { min: { x: -h, z: -h }, max: { x: h, z: h } },
    biomes: [],
    agents: {},
    resources: {},
    hazards: {},
    obstacles: {},
    structures: {},
    groundItems: {},
    marks: {},
    experiment: {
      commMode: opts.experiment?.commMode ?? 'english',
      traits: opts.experiment?.traits ?? false,
      scarcity: opts.experiment?.scarcity ?? 'normal',
      lifespanSec: opts.experiment?.lifespanSec ?? CONFIG.defaultLifespanSec,
      inheritance: opts.experiment?.inheritance ?? 'none',
      lexicon,
    },
    utterances: [],
    courtships: [],
    births: [],
    contextBase: { samples: 0, counts: {} },
    deliveries: [],
    events: [],
    eventSeq: 0,
    history: [],
    nextSampleAt: 0,
    idCounters: {},
  };
  generate(state, rng);
  // First agent: in the central meadow, next to its nearest berry bush.
  const meadow = state.biomes[4];
  const bush = Object.values(state.resources)
    .filter((r) => r.kind === 'berry_bush')
    .sort((a, b) => dist(a.position, meadow.site) - dist(b.position, meadow.site))[0];
  const start =
    (bush && sampleFreeSpot(state, rng, { near: bush.position, within: 3 })) ||
    sampleFreeSpot(state, rng, { near: meadow.site, within: 6 }) ||
    { x: 0, z: 0 };
  // defaultController is the plan-controller preference for agent mode; it survives a visit to fly mode.
  state.defaultController = defaultController === 'fly' ? 'scripted' : defaultController;
  const firstController: ControllerKind = mode === 'flies' ? 'fly' : state.defaultController;
  const first = createAgent(state, start, firstController, state.defaultTier, rng);
  state.agents[first.id] = first;
  logEvent(state, { kind: 'system', ok: true, text: `Run ${runId} started (seed ${seed}, comm ${state.experiment.commMode}, food ${state.experiment.scarcity}${state.experiment.traits ? ', traits on' : ''})` });
  if (mode === 'flies') logEvent(state, { kind: 'system', ok: true, text: 'Fruit-fly mode: each fly is driven by its own connectome circuit' });
  logEvent(state, { kind: 'spawn', agentId: first.id, ok: true, text: `Spawned ${first.id} (${firstController === 'fly' ? 'connectome fly' : firstController})` });
  return state;
}
