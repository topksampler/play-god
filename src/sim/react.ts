import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { WorldState } from '../shared/types';
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
