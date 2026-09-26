import { CONFIG } from '../shared/config';
import type { Action, Agent, Decision, SimCommand, WorldEdit, WorldState } from '../shared/types';
import { blocked, clampToBounds, dist } from './geometry';
import { createInitialWorld, logEvent, newId, type Rng, spawnAgents } from './world';

function outcome(state: WorldState, agent: Agent, actionType: Action['type'], ok: boolean, detail: string, log = true) {
  agent.recentOutcomes.push({ actionType, ok, detail, at: state.time });
  if (agent.recentOutcomes.length > CONFIG.recentOutcomes) agent.recentOutcomes.shift();
  if (log) logEvent(state, { kind: 'action', agentId: agent.id, ok, text: `${agent.id} ${actionType}: ${detail}` });
}

/** Validates and applies one action. The simulator is the only thing that mutates entities. */
export function applyAction(state: WorldState, agent: Agent, action: Action) {
  switch (action.type) {
    case 'move': {
      if (agent.status === 'exhausted') return outcome(state, agent, 'move', false, 'exhausted; eat to recover');
      const t = clampToBounds(action.target, state.bounds, CONFIG.agentRadius);
      agent.target = t;
      agent.stuckFor = 0;
      return outcome(state, agent, 'move', true, `heading to (${t.x.toFixed(1)}, ${t.z.toFixed(1)})`);
    }
    case 'wait':
      agent.target = null;
      return outcome(state, agent, 'wait', true, 'waiting', false);
    case 'take': {
      const food = state.food[action.foodId];
      if (!food || food.units <= 0) return outcome(state, agent, 'take', false, `no food ${action.foodId}`);
      const d = dist(agent.position, food.position);
      if (d > CONFIG.interactDistance) return outcome(state, agent, 'take', false, `${food.id} too far (${d.toFixed(1)} > ${CONFIG.interactDistance})`);
      if (agent.inventory >= CONFIG.inventoryCapacity) return outcome(state, agent, 'take', false, 'inventory full');
      food.units -= 1;
      agent.inventory += 1;
      if (food.units <= 0) delete state.food[food.id];
      return outcome(state, agent, 'take', true, `took 1 from ${food.id} (${Math.max(0, food.units)} left)`);
    }
    case 'eat': {
      if (agent.inventory <= 0) return outcome(state, agent, 'eat', false, 'nothing carried');
      agent.inventory -= 1;
      agent.energy = Math.min(CONFIG.maxEnergy, agent.energy + CONFIG.eatEnergy);
      agent.stats.eaten += 1;
      if (agent.status === 'exhausted' && agent.energy > 0) agent.status = 'active';
      return outcome(state, agent, 'eat', true, `ate; energy ${agent.energy.toFixed(0)}`);
    }
    case 'give': {
      const r = state.agents[action.recipientId];
      if (!r || r.id === agent.id) return outcome(state, agent, 'give', false, `no recipient ${action.recipientId}`);
      if (dist(agent.position, r.position) > CONFIG.interactDistance + 2 * CONFIG.agentRadius)
        return outcome(state, agent, 'give', false, `${r.id} too far`);
      if (agent.inventory <= 0) return outcome(state, agent, 'give', false, 'nothing carried');
      if (r.inventory >= CONFIG.inventoryCapacity) return outcome(state, agent, 'give', false, `${r.id} inventory full`);
      agent.inventory -= 1;
      r.inventory += 1;
      return outcome(state, agent, 'give', true, `gave 1 food to ${r.id}`);
    }
    case 'say': {
      const text = action.text.slice(0, CONFIG.messageMaxChars).trim();
      if (!text) return outcome(state, agent, 'say', false, 'empty message');
      const recipients = Object.values(state.agents).filter(
        (a) => a.id !== agent.id && dist(a.position, agent.position) <= CONFIG.commRadius,
      );
      const id = newId(state, 'm');
      for (const r of recipients) {
        r.inbox.push({ id, senderId: agent.id, text, sentAt: state.time });
        if (r.inbox.length > CONFIG.inboxMax) r.inbox.shift();
      }
      const to = recipients.map((r) => r.id).join(', ') || 'nobody in range';
      return outcome(state, agent, 'say', true, `"${text}" → ${to}`);
    }
  }
}

function isCurrent(state: WorldState, cmd: { agentId: string; runId: string; seq: number }) {
  const a = state.agents[cmd.agentId];
  return a && cmd.runId === state.runId && cmd.seq === a.controller.requestSeq ? a : null;
}

function applyDecision(state: WorldState, agent: Agent, decision: Decision) {
  if (decision.memory !== undefined) agent.memory = decision.memory.slice(0, CONFIG.memoryMaxChars);
  agent.intent = decision.intent ? decision.intent.slice(0, CONFIG.intentMaxChars) : null;
  agent.controller.lastAction = decision.action;
  applyAction(state, agent, decision.action);
}

export function applyWorldEdit(state: WorldState, edit: WorldEdit, source: string, rng: Rng) {
  const log = (ok: boolean, text: string) => logEvent(state, { kind: 'edit', ok, text: `[${source}] ${text}` });
  switch (edit.type) {
    case 'add_food': {
      const p = clampToBounds(edit.position, state.bounds, 0.5);
      if (Object.values(state.obstacles).some((o) => dist(o.position, p) < o.radius + 0.5))
        return log(false, 'add_food rejected: overlaps obstacle');
      const id = newId(state, 'f');
      state.food[id] = { id, position: p, units: edit.units };
      return log(true, `added ${id} (${edit.units} units) at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
    }
    case 'remove_food':
      if (!state.food[edit.foodId]) return log(false, `remove_food rejected: no ${edit.foodId}`);
      delete state.food[edit.foodId];
      return log(true, `removed ${edit.foodId}`);
    case 'add_obstacle': {
      const p = clampToBounds(edit.position, state.bounds, edit.radius);
      if (blocked(state, p, edit.radius)) return log(false, 'add_obstacle rejected: overlaps obstacle or agent');
      const id = newId(state, 'o');
      state.obstacles[id] = { id, shape: edit.shape, position: p, radius: edit.radius, height: 2 };
      return log(true, `added ${id} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
    }
    case 'spawn_agents':
      spawnAgents(state, edit.count, edit.controller, rng);
      return;
  }
}

/** Applies a queued command at a simulation boundary. Returns a replacement state on reset. */
export function applyCommand(state: WorldState, cmd: SimCommand, rng: Rng, nextRunId: () => string): WorldState {
  switch (cmd.type) {
    case 'pause':
      state.paused = true;
      for (const a of Object.values(state.agents)) {
        a.controller.pending = false;
        a.controller.requestSeq += 1; // invalidate anything in flight
      }
      logEvent(state, { kind: 'system', ok: true, text: 'Paused' });
      return state;
    case 'resume':
      state.paused = false;
      logEvent(state, { kind: 'system', ok: true, text: 'Resumed' });
      return state;
    case 'reset':
      return createInitialWorld(nextRunId(), state.defaultController);
    case 'spawnAgents':
      spawnAgents(state, cmd.count, cmd.controller, rng);
      return state;
    case 'setController': {
      const a = state.agents[cmd.agentId];
      if (!a) return state;
      a.controller.kind = cmd.controller;
      a.controller.lastError = null;
      a.controller.pending = false;
      a.controller.requestSeq += 1;
      logEvent(state, { kind: 'system', agentId: a.id, ok: true, text: `${a.id} controller → ${cmd.controller}` });
      return state;
    }
    case 'setDefaultController':
      state.defaultController = cmd.controller;
      return state;
    case 'edit':
      applyWorldEdit(state, cmd.edit, cmd.source, rng);
      return state;
    case 'decisionStarted': {
      const a = state.agents[cmd.agentId];
      if (!a || cmd.runId !== state.runId || cmd.seq <= a.controller.requestSeq) return state;
      a.controller.requestSeq = cmd.seq;
      a.controller.pending = true;
      a.controller.lastDecisionAt = state.time;
      a.controller.lastObservation = cmd.observation;
      return state;
    }
    case 'decisionResult': {
      const a = isCurrent(state, cmd);
      if (!a) return state; // stale: old run, removed agent, or superseded request
      a.controller.pending = false;
      a.controller.lastError = null;
      applyDecision(state, a, cmd.decision);
      return state;
    }
    case 'decisionError': {
      const a = isCurrent(state, cmd);
      if (!a) return state;
      a.controller.pending = false;
      a.controller.lastError = cmd.error;
      a.controller.lastAction = { type: 'wait' };
      a.target = null;
      logEvent(state, { kind: 'error', agentId: a.id, ok: false, text: `${a.id} decision failed: ${cmd.error}` });
      return state;
    }
  }
}

const SIDESTEP = [Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2];

function moveAgent(state: WorldState, a: Agent, dt: number) {
  if (!a.target || a.status !== 'active') return;
  const dx = a.target.x - a.position.x;
  const dz = a.target.z - a.position.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.05) {
    a.target = null;
    outcome(state, a, 'move', true, 'arrived', false);
    return;
  }
  const step = Math.min(CONFIG.speed * dt, d);
  const base = Math.atan2(dz, dx);
  let moved = false;
  for (const off of [0, ...SIDESTEP]) {
    const ang = base + off;
    const p = { x: a.position.x + Math.cos(ang) * step, z: a.position.z + Math.sin(ang) * step };
    if (blocked(state, p, CONFIG.agentRadius, a.id)) continue;
    a.position = p;
    a.heading = ang;
    a.stats.distance += step;
    // Direct progress resets; side-stepping counts slowly toward "stuck".
    a.stuckFor = off === 0 ? 0 : a.stuckFor + dt * 0.25;
    moved = true;
    break;
  }
  if (!moved) a.stuckFor += dt;
  if (a.stuckFor >= 1.5) {
    a.target = null;
    a.stuckFor = 0;
    outcome(state, a, 'move', false, 'blocked; target cleared');
  }
}

/** Advances the world by one fixed timestep. */
export function stepWorld(state: WorldState, dt: number) {
  if (state.paused) return;
  state.time += dt;
  for (const a of Object.values(state.agents)) {
    moveAgent(state, a, dt);
    a.energy = Math.max(0, Math.min(CONFIG.maxEnergy, a.energy - CONFIG.energyDrainPerSec * dt));
    if (a.energy <= 0 && a.status === 'active') {
      a.status = 'exhausted';
      a.target = null;
      logEvent(state, { kind: 'system', agentId: a.id, ok: false, text: `${a.id} is exhausted` });
    }
    if (a.inbox.length) a.inbox = a.inbox.filter((m) => state.time - m.sentAt <= CONFIG.messageTtlSec);
  }
}
