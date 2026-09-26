// Shared contracts. Owner: Person A (integration). Request changes; do not redefine elsewhere.

export type Vec2 = { x: number; z: number };
export type ControllerKind = 'scripted' | 'llm' | 'fly';

export type Action =
  | { type: 'move'; target: Vec2 }
  | { type: 'take'; foodId: string }
  | { type: 'eat' }
  | { type: 'give'; recipientId: string }
  | { type: 'say'; text: string }
  | { type: 'wait' };

export type Decision = { action: Action; memory?: string; intent?: string };

export type Outcome = { actionType: Action['type']; ok: boolean; detail: string; at: number };

export type Message = { id: string; senderId: string; text: string; sentAt: number };

export type Observation = {
  runId: string;
  observedAt: number;
  self: { id: string; position: Vec2; energy: number; inventory: number };
  bounds: { min: Vec2; max: Vec2 };
  visibleFood: { id: string; position: Vec2; units: number }[];
  visibleAgents: { id: string; position: Vec2 }[];
  visibleObstacles: { id: string; position: Vec2; radius: number }[];
  messages: Message[];
  recentOutcomes: { actionType: Action['type']; ok: boolean; detail: string }[];
};

export interface Controller {
  kind: ControllerKind;
  decide(input: { observation: Observation; memory: string }, signal: AbortSignal): Promise<Decision>;
}

export type AgentStatus = 'active' | 'exhausted';

/** Per-agent controller bookkeeping. Mutable only via sim commands. */
export type ControllerState = {
  kind: ControllerKind;
  pending: boolean;
  requestSeq: number;
  lastError: string | null;
  lastDecisionAt: number | null;
  lastAction: Action | null;
  lastObservation: Observation | null;
};

export type Agent = {
  id: string;
  color: string;
  position: Vec2;
  heading: number;
  energy: number;
  inventory: number;
  status: AgentStatus;
  target: Vec2 | null;
  memory: string;
  intent: string | null;
  inbox: Message[];
  recentOutcomes: Outcome[];
  controller: ControllerState;
  stats: { eaten: number; distance: number };
  /** Seconds spent unable to make progress toward target. */
  stuckFor: number;
};

export type FoodPatch = { id: string; position: Vec2; units: number };
export type Obstacle = { id: string; shape: 'box' | 'cylinder'; position: Vec2; radius: number; height: number };

export type SimEvent = {
  seq: number;
  at: number;
  kind: 'spawn' | 'action' | 'error' | 'system' | 'edit';
  agentId?: string;
  ok: boolean;
  text: string;
};

export type WorldState = {
  runId: string;
  time: number;
  paused: boolean;
  /** Controller kind for newly spawned agents; preserved across reset. */
  defaultController: ControllerKind;
  bounds: { min: Vec2; max: Vec2 };
  agents: Record<string, Agent>;
  food: Record<string, FoodPatch>;
  obstacles: Record<string, Obstacle>;
  events: SimEvent[];
  eventSeq: number;
  nextId: number;
};

/** Allowlisted world edits (God mode, P1). Simulator validates execution. */
export type WorldEdit =
  | { type: 'add_food'; position: Vec2; units: number }
  | { type: 'remove_food'; foodId: string }
  | { type: 'add_obstacle'; position: Vec2; radius: number; shape: 'box' | 'cylinder' }
  | { type: 'spawn_agents'; count: number; controller: ControllerKind };

/** Commands accepted by the store. The only way to mutate world state. */
export type SimCommand =
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'reset' }
  | { type: 'spawnAgents'; count: number; controller: ControllerKind }
  | { type: 'setController'; agentId: string; controller: ControllerKind }
  | { type: 'setDefaultController'; controller: ControllerKind }
  | { type: 'edit'; edit: WorldEdit; source: string }
  | { type: 'decisionStarted'; agentId: string; runId: string; seq: number; observation: Observation }
  | { type: 'decisionResult'; agentId: string; runId: string; seq: number; decision: Decision }
  | { type: 'decisionError'; agentId: string; runId: string; seq: number; error: string };
