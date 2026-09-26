import { AGENT_COLORS, CONFIG } from '../shared/config';
import type { Agent, ControllerKind, SimEvent, Vec2, WorldState } from '../shared/types';
import { blocked } from './geometry';

export type Rng = () => number;

export function logEvent(state: WorldState, e: Omit<SimEvent, 'seq' | 'at'>) {
  state.eventSeq += 1;
  state.events.push({ ...e, seq: state.eventSeq, at: state.time });
  if (state.events.length > CONFIG.maxEvents) state.events.splice(0, state.events.length - CONFIG.maxEvents);
}

export function newId(state: WorldState, prefix: string) {
  state.nextId += 1;
  return `${prefix}${state.nextId}`;
}

export function createAgent(state: WorldState, position: Vec2, controller: ControllerKind): Agent {
  const index = Object.keys(state.agents).length;
  const id = newId(state, 'a');
  return {
    id,
    color: AGENT_COLORS[state.nextId % AGENT_COLORS.length],
    position: { ...position },
    heading: 0,
    energy: CONFIG.maxEnergy,
    inventory: 0,
    status: 'active',
    target: null,
    memory: '',
    intent: null,
    inbox: [],
    recentOutcomes: [],
    controller: {
      kind: controller,
      pending: false,
      requestSeq: 0,
      lastError: null,
      // Stagger first decisions so agents don't all request at once.
      lastDecisionAt: state.time - CONFIG.decisionIntervalSec + 0.3 + index * 0.8,
      lastAction: null,
      lastObservation: null,
    },
    stats: { eaten: 0, distance: 0 },
    stuckFor: 0,
  };
}

/** Bounded rejection sampling for a free spot. Returns null if none found. */
export function sampleFreeSpot(state: WorldState, rng: Rng, radius: number = CONFIG.agentRadius + 0.2): Vec2 | null {
  const { min, max } = state.bounds;
  for (let i = 0; i < CONFIG.spawnAttempts; i++) {
    const p = { x: min.x + 1 + rng() * (max.x - min.x - 2), z: min.z + 1 + rng() * (max.z - min.z - 2) };
    if (!blocked(state, p, radius)) return p;
  }
  return null;
}

export function spawnAgents(state: WorldState, count: number, controller: ControllerKind, rng: Rng): string[] {
  const spawned: string[] = [];
  const room = CONFIG.maxAgents - Object.keys(state.agents).length;
  if (room <= 0) {
    logEvent(state, { kind: 'spawn', ok: false, text: `Spawn rejected: max ${CONFIG.maxAgents} agents` });
    return spawned;
  }
  const n = Math.min(count, room);
  for (let i = 0; i < n; i++) {
    const p = sampleFreeSpot(state, rng);
    if (!p) {
      logEvent(state, { kind: 'spawn', ok: false, text: 'Spawn rejected: no free spot found' });
      break;
    }
    const agent = createAgent(state, p, controller);
    state.agents[agent.id] = agent;
    spawned.push(agent.id);
    logEvent(state, { kind: 'spawn', agentId: agent.id, ok: true, text: `Spawned ${agent.id} (${controller})` });
  }
  if (n < count) logEvent(state, { kind: 'spawn', ok: false, text: `Only ${n} of ${count} spawned: max ${CONFIG.maxAgents} agents` });
  return spawned;
}

export function createInitialWorld(runId: string, defaultController: ControllerKind): WorldState {
  const h = CONFIG.worldSize / 2;
  const state: WorldState = {
    runId,
    time: 0,
    paused: false,
    defaultController,
    bounds: { min: { x: -h, z: -h }, max: { x: h, z: h } },
    agents: {},
    food: {
      f1: { id: 'f1', position: { x: 4, z: -3 }, units: 5 },
      f2: { id: 'f2', position: { x: -8, z: 8 }, units: 5 },
      f3: { id: 'f3', position: { x: 10, z: 9 }, units: 5 },
    },
    obstacles: {
      o1: { id: 'o1', shape: 'box', position: { x: 0, z: 4 }, radius: 1.5, height: 2 },
      o2: { id: 'o2', shape: 'cylinder', position: { x: -6, z: -6 }, radius: 1.2, height: 2.5 },
      o3: { id: 'o3', shape: 'box', position: { x: 8, z: -9 }, radius: 1.5, height: 1.5 },
      o4: { id: 'o4', shape: 'cylinder', position: { x: -10, z: 2 }, radius: 1, height: 3 },
    },
    events: [],
    eventSeq: 0,
    nextId: 0,
  };
  // First agent near visible, reachable food (f1 is 3.5 units away).
  const first = createAgent(state, { x: 0.5, z: -3 }, defaultController);
  state.agents[first.id] = first;
  logEvent(state, { kind: 'system', ok: true, text: `Run ${runId} started` });
  logEvent(state, { kind: 'spawn', agentId: first.id, ok: true, text: `Spawned ${first.id} (${defaultController})` });
  return state;
}
