// Shared contracts. Owner: Person A (integration). Request changes; do not redefine elsewhere.

export type Vec2 = { x: number; z: number };
export type ControllerKind = 'scripted' | 'llm' | 'fly';
/** Which population inhabits the world: plan-based agents (LLM/scripted) or connectome-driven fruit flies. */
export type WorldMode = 'agents' | 'flies';
/** LLM model tier for in-world agents: fast = Haiku, smart = Sonnet (server maps tier → model). */
export type AgentTier = 'fast' | 'smart';

export type BiomeKind = 'meadow' | 'forest' | 'lake' | 'highlands' | 'scrub' | 'swamp';
export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';
export type Weather = 'clear' | 'cloudy' | 'rain' | 'storm';

export type NodeKind =
  | 'berry_bush' | 'fruit_tree' | 'mushroom_patch' | 'toxic_mushroom_patch' | 'fish_spot' | 'cactus'
  | 'honey_hive' | 'herb_patch' | 'moss_patch' | 'wood_pile' | 'stone_pile' | 'fiber_grass'
  | 'fresh_water' | 'toxic_water';

export type ItemKind =
  | 'berries' | 'fruit' | 'mushroom' | 'toxic_mushroom' | 'cooked_mushroom' | 'fish' | 'cooked_fish'
  | 'cactus_fruit' | 'honey' | 'herb' | 'moss' | 'wood' | 'stone' | 'fiber' | 'rotten_food';

export type HazardKind = 'thorns' | 'mud' | 'wasps' | 'snakes' | 'rockfall' | 'leeches';
export type ObstacleShape = 'rock' | 'boulder' | 'tree' | 'log' | 'cliff' | 'bush' | 'lake';
export type StructureKind = 'campfire' | 'shelter' | 'cache' | 'sign';
export type RecipeKind = 'basket' | 'torch';

export type Action =
  | { type: 'move'; target: Vec2; sprint?: boolean }
  | { type: 'follow'; agentId: string }
  | { type: 'gather'; nodeId: string }
  | { type: 'eat'; itemId: string }
  | { type: 'drink'; sourceId: string }
  | { type: 'drop'; itemId: string }
  | { type: 'pickup'; groundItemId: string }
  | { type: 'give'; recipientId: string; itemId: string }
  | { type: 'rest' }
  | { type: 'inspect'; targetId: string }
  | { type: 'say'; text: string }
  | { type: 'craft'; recipe: RecipeKind }
  | { type: 'build'; structure: StructureKind; text?: string }
  | { type: 'cook'; itemId: string }
  | { type: 'deposit'; cacheId: string; itemId: string }
  | { type: 'withdraw'; cacheId: string; itemId: string }
  | { type: 'wait'; seconds?: number };
export type ActionType = Action['type'];

/** Private, bounded, agent-authored memory. Beliefs are what the agent concluded, not verified truth. */
export type AgentMemory = {
  notes: string;
  places: { label: string; x: number; z: number }[];
  beliefs: { appearance: string; verdict: 'safe' | 'harmful' | 'unknown' }[];
};

/** A controller returns a short plan (1–3 actions) executed in order by the simulator. */
export type Decision = { plan: Action[]; memory?: AgentMemory; intent?: string };

export type Outcome = { actionType: ActionType; ok: boolean; detail: string; at: number };
export type Message = { id: string; senderId: string; text: string; sentAt: number };
export type AgentStatus = 'active' | 'resting' | 'dead';

export type Observation = {
  runId: string;
  observedAt: number;
  timeOfDay: TimeOfDay;
  weather: Weather;
  self: {
    id: string;
    position: Vec2;
    biome: BiomeKind;
    energy: number;
    hydration: number;
    health: number;
    stamina: number;
    conditions: string[];
    status: AgentStatus;
    /** Items as the agent perceives them (label), not their true kind. */
    items: { id: string; label: string; fresh: boolean }[];
    capacity: number;
    hasTorch: boolean;
    senseRadius: number;
    currentAction: ActionType | null;
    planRemaining: number;
    /** Why this decision was requested (e.g. "plan complete", "hurt by thorns", "message from a2"). */
    trigger: string | null;
  };
  bounds: { min: Vec2; max: Vec2 };
  visibleResources: { id: string; appearance: string; position: Vec2; distance: number; bearing: string; units: number }[];
  visibleHazards: { id: string; appearance: string; position: Vec2; radius: number; distance: number }[];
  visibleObstacles: { id: string; kind: ObstacleShape; position: Vec2; radius: number; solid: boolean; halfLength?: number; angle?: number }[];
  visibleAgents: { id: string; position: Vec2; distance: number; status: AgentStatus }[];
  visibleStructures: {
    id: string; kind: StructureKind; position: Vec2; distance: number; text?: string; lit?: boolean;
    /** Cache contents, visible only when standing near the cache. */
    contents?: { id: string; label: string }[];
  }[];
  visibleGroundItems: { id: string; label: string; position: Vec2; distance: number }[];
  messages: Message[];
  recentOutcomes: { actionType: ActionType; ok: boolean; detail: string; secondsAgo: number }[];
  /** The agent's own remembered places, with current distance and compass bearing. */
  rememberedPlaces: { label: string; position: Vec2; distance: number; bearing: string }[];
};

export interface Controller {
  kind: ControllerKind;
  decide(input: { observation: Observation; memory: AgentMemory; tier: AgentTier }, signal: AbortSignal): Promise<Decision>;
}

/** Per-agent controller bookkeeping. Mutable only via sim commands. */
export type ControllerState = {
  kind: ControllerKind;
  tier: AgentTier;
  pending: boolean;
  requestSeq: number;
  lastError: string | null;
  /** Consecutive failed decisions; drives retry backoff. */
  errorStreak: number;
  lastDecisionAt: number | null;
  lastLatencyMs: number | null;
  lastPlan: Action[] | null;
  lastObservation: Observation | null;
  /** Set by the simulator when something happened that warrants an early re-decision. */
  needsDecision: boolean;
  interruptReason: string | null;
};

export type Item = { id: string; kind: ItemKind; label: string; spoilsAt: number | null };

/** Latest spike-derived readouts of a fly's circuit (Hz), for inspection. Not a decision. */
export type FlyReadout = {
  dna02: [number, number];
  dna01: [number, number];
  mn9: number;
  pam: number;
  ppl1: number;
  steer: number;
  valence: number;
  brainDriven: number;
};

/** Low-level motor state of a fly body, written only by `flyMotors` commands from the fly brain driver. */
export type FlyBodyState = {
  turnRate: number;
  speed: number;
  feeding: boolean;
  readout: FlyReadout | null;
  /** Sim time of the last motor command applied; flies stand still until their brain has produced one. */
  motorAt: number | null;
  /** Sim time of the last taste of food/water (drives the brain's gustatory and reward inputs). */
  lastTaste: { at: number; sugar: boolean; bitter: boolean; ate: boolean } | null;
  feedProgress: number;
  brainStatus: 'loading' | 'running' | 'error';
};

/** The action currently executing (possibly still approaching its target). */
export type ActiveAction = { action: Action; startedAt: number; progress: number };

export type Agent = {
  id: string;
  color: string;
  position: Vec2;
  heading: number;
  energy: number;
  hydration: number;
  health: number;
  stamina: number;
  poisonedUntil: number;
  sickUntil: number;
  status: AgentStatus;
  target: Vec2 | null;
  sprinting: boolean;
  items: Item[];
  capacity: number;
  hasTorch: boolean;
  plan: Action[];
  current: ActiveAction | null;
  memory: AgentMemory;
  intent: string | null;
  inbox: Message[];
  recentOutcomes: Outcome[];
  controller: ControllerState;
  stats: { eaten: number; drank: number; distance: number; poisonings: number; built: number; damageTaken: number };
  lastDamageAt: number;
  /** Seconds spent unable to make progress toward target. */
  stuckFor: number;
  /** Planned waypoints toward `target` (simulator-internal path planning), and the target they were planned for. */
  route: Vec2[] | null;
  routeFor: Vec2 | null;
  /** Last damage time per cause, so a new hazard is reported even while another damage source is active. */
  damageAt: Record<string, number>;
  /** Present only for fruit flies (controller kind 'fly'). */
  fly: FlyBodyState | null;
};

export type ResourceNode = {
  id: string;
  kind: NodeKind;
  biome: BiomeKind;
  position: Vec2;
  /** Fractional; whole units are available. */
  units: number;
  maxUnits: number;
  regrowPerMin: number;
  /** Sim time when units first hit 0 (for withering), or null. */
  depletedSince: number | null;
};

export type Hazard = { id: string; kind: HazardKind; position: Vec2; radius: number };

export type Obstacle = {
  id: string;
  shape: ObstacleShape;
  position: Vec2;
  /** Collision circle radius (circle shapes) or half-width (rect shapes). */
  radius: number;
  height: number;
  /** Oriented rectangle for cliff/log: half-length along `angle`. */
  halfLength?: number;
  angle?: number;
  /** Bushes are passable but slow. */
  solid: boolean;
};

export type Structure = {
  id: string;
  kind: StructureKind;
  position: Vec2;
  builderId: string;
  builtAt: number;
  text?: string;
  items?: Item[];
  litUntil?: number;
};

export type GroundItem = { id: string; item: Item; position: Vec2; droppedBy: string };
export type Biome = { id: string; kind: BiomeKind; site: Vec2 };

export type SimEvent = {
  seq: number;
  at: number;
  kind: 'spawn' | 'action' | 'error' | 'system' | 'edit' | 'hazard' | 'death' | 'message' | 'weather' | 'ecology';
  agentId?: string;
  ok: boolean;
  text: string;
};

export type WorldState = {
  runId: string;
  seed: number;
  time: number;
  paused: boolean;
  mode: WorldMode;
  /** Live fly capacity reported by the brain workers (undefined until known). */
  flyCapacity?: number;
  /** Controller kind/tier for newly spawned agents; preserved across reset. */
  defaultController: ControllerKind;
  defaultTier: AgentTier;
  weather: Weather;
  nextWeatherAt: number;
  nextEcologyAt: number;
  bounds: { min: Vec2; max: Vec2 };
  biomes: Biome[];
  agents: Record<string, Agent>;
  resources: Record<string, ResourceNode>;
  hazards: Record<string, Hazard>;
  obstacles: Record<string, Obstacle>;
  structures: Record<string, Structure>;
  groundItems: Record<string, GroundItem>;
  events: SimEvent[];
  eventSeq: number;
  /** Per-prefix id counters (a1, a2… for agents; r1… for resources). */
  idCounters: Record<string, number>;
};

/** Allowlisted world edits (God mode). Simulator validates execution. */
export type WorldEdit =
  | { type: 'add_resource'; kind: NodeKind; position: Vec2 }
  | { type: 'remove_resource'; nodeId: string }
  | { type: 'add_obstacle'; shape: 'rock' | 'boulder' | 'tree'; position: Vec2; radius: number }
  | { type: 'add_hazard'; kind: HazardKind; position: Vec2; radius: number }
  | { type: 'set_weather'; weather: Weather }
  | { type: 'spawn_agents'; count: number; controller: ControllerKind };

/** Commands accepted by the store. The only way to mutate world state. */
export type SimCommand =
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'reset'; seed?: number; mode?: WorldMode }
  | { type: 'spawnAgents'; count: number; controller: ControllerKind; tier?: AgentTier }
  | { type: 'setController'; agentId: string; controller: ControllerKind; tier?: AgentTier }
  | { type: 'setDefaultController'; controller: ControllerKind; tier?: AgentTier }
  | { type: 'edit'; edit: WorldEdit; source: string }
  | { type: 'decisionStarted'; agentId: string; runId: string; seq: number; observation: Observation }
  | { type: 'decisionResult'; agentId: string; runId: string; seq: number; decision: Decision; latencyMs: number }
  | { type: 'decisionError'; agentId: string; runId: string; seq: number; error: string }
  | { type: 'flyMotors'; runId: string; motors: FlyMotorCommand[] }
  | { type: 'flyCapacity'; capacity: number }
  | { type: 'flyBrainError'; runId: string; agentIds: string[]; error: string };

export type FlyMotorCommand = { agentId: string; turnRate: number; speed: number; feeding: boolean; readout: FlyReadout };
