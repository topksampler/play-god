import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { WorldState } from '../shared/types';
import type { Replay } from './replay';
import type { SimStore } from './store';

export const SimContext = createContext<SimStore | null>(null);

export function useSim(): SimStore {
  const s = useContext(SimContext);
  if (!s) throw new Error('SimContext missing');
  return s;
}

/** Re-renders on every tick. For per-frame 3D reads, use useSim().getState() inside useFrame instead. */
export function useWorld(): WorldState {
  const store = useSim();
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store.getState();
}

/** Re-renders at most every `ms` — for heavier React trees (3D scene, panels). */
export function useWorldThrottled(ms = 250): WorldState {
  const store = useSim();
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return store.getState();
}

export const ReplayContext = createContext<Replay | null>(null);

/** Replay controls; re-renders when the viewed moment, play state or recorded range changes. */
export function useReplay(): Replay {
  const r = useContext(ReplayContext);
  if (!r) throw new Error('ReplayContext missing');
  useSyncExternalStore(r.subscribe, () => `${r.getViewTime()}|${r.isPlaying()}|${r.getRate()}|${Math.floor(r.range().start)}|${Math.floor(r.range().end)}`);
  return r;
}
