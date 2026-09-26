import { useEffect, useState } from 'react';
import { fetchHealth } from './controllers/llm';
import { startScheduler } from './controllers/scheduler';
import type { HealthResponse } from './shared/schemas';
import { SimContext } from './sim/react';
import { createSimStore } from './sim/store';
import { EventFeed } from './ui/EventFeed';
import { Panel } from './ui/Panel';
import { Scene } from './world/Scene';

const store = createSimStore();

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>('a1');

  useEffect(() => {
    const stopSim = store.start();
    const stopSched = startScheduler(store);
    fetchHealth().then((h) => {
      setHealth(h);
      if (h.llmConfigured) {
        store.dispatch({ type: 'setDefaultController', controller: 'llm' });
        for (const id of Object.keys(store.getState().agents))
          store.dispatch({ type: 'setController', agentId: id, controller: 'llm' });
      }
    });
    return () => {
      stopSched();
      stopSim();
    };
  }, []);

  return (
    <SimContext.Provider value={store}>
      <div className="app">
        <div className="viewport">
          <Scene selectedId={selectedId} onSelect={setSelectedId} />
          <EventFeed />
        </div>
        <Panel health={health} selectedId={selectedId} />
      </div>
    </SimContext.Provider>
  );
}
