import { createContext, useContext, useSyncExternalStore } from 'react';
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
