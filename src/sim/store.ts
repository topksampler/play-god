import { CONFIG } from '../shared/config';
import type { SimCommand, WorldState } from '../shared/types';
import { applyCommand, stepWorld } from './step';
import { createInitialWorld, type Rng } from './world';

export type SimStore = {
  getState(): WorldState;
  /** Monotonic counter, bumps after each tick that changed anything. For useSyncExternalStore. */
  getVersion(): number;
  subscribe(fn: () => void): () => void;
  /** Queue a command; applied at the next simulation boundary (or immediately via flush()). */
  dispatch(cmd: SimCommand): void;
  /** Apply queued commands and advance by dt seconds of fixed steps. */
  tick(dt: number): void;
  start(): () => void;
  /** Simulation speed multiplier (0.25–4). Rendering is unaffected. */
  getSpeed(): number;
  setSpeed(x: number): void;
  /** Extra slowdown (≤ 1) applied on top of speed. Fly mode lowers it when brains cannot keep up. */
  getTimeScale(): number;
  setTimeScale(scale: number): void;
};

export function createSimStore(opts: { rng?: Rng; seed?: number } = {}): SimStore {
  const rng = opts.rng ?? Math.random;
  let runCounter = 1;
  const nextRunId = () => `run-${++runCounter}`;
  let state = createInitialWorld('run-1', 'scripted', { seed: opts.seed });
  let version = 0;
  const queue: SimCommand[] = [];
  const subs = new Set<() => void>();
  const stepDt = 1 / CONFIG.tickHz;
  let acc = 0;
  let speed = 1;
  let timeScale = 1;

  const notify = () => {
    version++;
    subs.forEach((f) => f());
  };

  const flush = () => {
    while (queue.length) state = applyCommand(state, queue.shift()!, rng, nextRunId);
  };

  const store: SimStore = {
    getState: () => state,
    getVersion: () => version,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    dispatch(cmd) {
      queue.push(cmd);
    },
    tick(dt) {
      flush();
      const k = speed * timeScale;
      acc = Math.min(acc + dt * k, CONFIG.maxCatchUpSec * k); // cap catch-up after a tab stall
      while (acc >= stepDt) {
        stepWorld(state, stepDt, rng);
        acc -= stepDt;
      }
      notify();
    },
    getTimeScale: () => timeScale,
    setTimeScale(scale) {
      timeScale = Number.isFinite(scale) ? Math.min(1, Math.max(0.02, scale)) : 1;
    },
    getSpeed: () => speed,
    setSpeed(x) {
      speed = Math.max(0.25, Math.min(4, x));
      notify();
    },
    start() {
      let last = performance.now();
      const id = setInterval(() => {
        const now = performance.now();
        store.tick((now - last) / 1000);
        last = now;
      }, 1000 / CONFIG.tickHz);
      return () => clearInterval(id);
    },
  };
  return store;
}
