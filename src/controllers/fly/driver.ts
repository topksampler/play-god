import type { FlyMotorCommand } from '../../shared/types';
import type { SimStore } from '../../sim/store';
import type { FlySensors } from './body';
import { flySensors } from './sensing';
import { FlySwarm, type SwarmStatus } from './swarm';

export type FlyDriverStatus =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'error'; error: string }
  | ({ state: 'running' } & SwarmStatus);

let status: FlyDriverStatus = { state: 'idle' };
export const flyDriverStatus = () => status;

function seedFor(runId: string, id: string): number {
  let h = 2166136261;
  for (const ch of `${runId}:${id}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/**
 * Bridges the simulator and the per-fly connectome brains running in Web Workers.
 * Every 50 ms it sends each fly's local sensory input to its brain and queues the latest motor
 * readouts as a `flyMotors` command. Rendering and the simulator never wait for the brains.
 */
export function startFlyDriver(store: SimStore, opts: { tickMs?: number; create?: () => Promise<FlySwarm> } = {}) {
  const create = opts.create ?? (() => FlySwarm.create());
  let swarm: FlySwarm | null = null;
  let loading: Promise<void> | null = null;
  const known = new Set<string>();
  let runId = store.getState().runId;
  let lastSentAt = -Infinity;
  let reportedError: string | null = null;
  let stopped = false;
  let speed = 1;

  const ensureSwarm = () => {
    if (swarm || loading) return;
    status = { state: 'loading' };
    loading = create()
      .then((s) => {
        if (stopped) return s.dispose();
        swarm = s;
        store.dispatch({ type: 'flyCapacity', capacity: s.status().capacity });
      })
      .catch((e: unknown) => {
        status = { state: 'error', error: e instanceof Error ? e.message : String(e) };
        const st = store.getState();
        store.dispatch({ type: 'flyBrainError', runId: st.runId, agentIds: Object.keys(st.agents), error: `brain workers failed to start: ${(status as { error: string }).error}` });
      })
      .finally(() => {
        loading = null;
      });
  };

  const tick = () => {
    const s = store.getState();
    if (s.mode !== 'flies') {
      if (swarm && known.size) swarm.reset();
      known.clear();
      lastSentAt = -Infinity;
      store.setTimeScale(1);
      if (swarm) status = { state: 'running', ...swarm.status() };
      return;
    }
    ensureSwarm();
    if (!swarm) return;
    if (s.runId !== runId) {
      swarm.reset();
      known.clear();
      runId = s.runId;
      lastSentAt = -Infinity;
      reportedError = null;
    }
    status = { state: 'running', ...swarm.status() };
    for (const id of known) {
      const a = s.agents[id];
      if (!a || a.status === 'dead') {
        swarm.remove(id);
        known.delete(id);
      }
    }
    const rejected: string[] = [];
    for (const a of Object.values(s.agents)) {
      if (!a.fly || a.status === 'dead' || known.has(a.id)) continue;
      if (swarm.spawn(a.id, seedFor(s.runId, a.id))) known.add(a.id);
      else rejected.push(a.id);
    }
    if (rejected.length) store.dispatch({ type: 'flyBrainError', runId: s.runId, agentIds: rejected, error: swarm.status().lastError ?? 'no brain capacity' });
    const err = swarm.status().lastError;
    if (err && err !== reportedError) {
      reportedError = err;
      store.dispatch({ type: 'flyBrainError', runId: s.runId, agentIds: [], error: err });
    }
    if (s.paused) return;
    // One brain tick covers 50 ms of simulated time; send the next only once the world has advanced that far.
    if (s.time - lastSentAt < tickSec * 0.95) return;
    const st = swarm.status();
    if (known.size) {
      speed += 0.2 * (Math.min(1, st.realtimeFactor * 0.9) - speed);
      store.setTimeScale(speed);
    } else {
      store.setTimeScale(1);
    }

    const motors: FlyMotorCommand[] = [];
    for (const id of known) {
      const m = swarm.motor(id);
      if (m) motors.push({ agentId: id, turnRate: m.turnRate, speed: m.speed, feeding: m.feeding, readout: m.readout });
    }
    if (motors.length) store.dispatch({ type: 'flyMotors', runId: s.runId, motors });

    const sensors = new Map<string, FlySensors>();
    for (const id of known) sensors.set(id, flySensors(s, s.agents[id], lastSentAt));
    lastSentAt = s.time;
    swarm.step(sensors);
  };

  const tickSec = (opts.tickMs ?? 50) / 1000;
  const timer = setInterval(tick, (opts.tickMs ?? 50) / 2);
  return () => {
    stopped = true;
    clearInterval(timer);
    store.setTimeScale(1);
    swarm?.dispose();
    swarm = null;
    status = { state: 'idle' };
  };
}
