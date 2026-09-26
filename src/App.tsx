import { useEffect, useState } from 'react';
import { fetchHealth } from './controllers/llm';
import { startFlyDriver } from './controllers/fly/driver';
import { startScheduler } from './controllers/scheduler';
import type { HealthResponse } from './shared/schemas';
import { SimContext } from './sim/react';
import { createSimStore } from './sim/store';
import { EventFeed } from './ui/EventFeed';
import { Hud } from './ui/Hud';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { Panel } from './ui/Panel';
import { Minimap } from './world/Minimap';
import { Scene } from './world/Scene';

const store = createSimStore();

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>('a1');

  useEffect(() => {
    const stopSim = store.start();
    const stopSched = startScheduler(store);
    const stopFlies = startFlyDriver(store);
    fetchHealth().then((h) => {
      setHealth(h);
      if (h.llmConfigured) {
        store.dispatch({ type: 'setDefaultController', controller: 'llm', tier: 'fast' });
        for (const a of Object.values(store.getState().agents))
          if (!a.fly) store.dispatch({ type: 'setController', agentId: a.id, controller: 'llm', tier: 'fast' });
      }
    });
    return () => {
      stopFlies();
      stopSched();
      stopSim();
    };
  }, []);

  return (
    <SimContext.Provider value={store}>
      <div className="app">
        <div className="viewport">
          <ErrorBoundary name="3D view">
            <Scene selectedId={selectedId} onSelect={setSelectedId} />
          </ErrorBoundary>
          <ErrorBoundary name="Event feed">
            <EventFeed />
          </ErrorBoundary>
          <Minimap selectedId={selectedId} onSelect={setSelectedId} />
          <Hud />
        </div>
        <ErrorBoundary name="Panel">
          <Panel health={health} selectedId={selectedId} onSelect={setSelectedId} />
        </ErrorBoundary>
      </div>
    </SimContext.Provider>
  );
}
