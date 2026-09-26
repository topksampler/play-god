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
};

export function createSimStore(opts: { rng?: Rng } = {}): SimStore {
  const rng = opts.rng ?? Math.random;
  let runCounter = 1;
  const nextRunId = () => `run-${++runCounter}`;
  let state = createInitialWorld('run-1', 'scripted');
  let version = 0;
  const queue: SimCommand[] = [];
  const subs = new Set<() => void>();
  const stepDt = 1 / CONFIG.tickHz;
  let acc = 0;

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
      acc = Math.min(acc + dt, CONFIG.maxCatchUpSec); // cap catch-up after a tab stall
      while (acc >= stepDt) {
        stepWorld(state, stepDt);
        acc -= stepDt;
      }
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
