import { useEffect, useState } from 'react';
import { fetchHealth } from './controllers/llm';
import { startFlyDriver } from './controllers/fly/driver';
import { startScheduler } from './controllers/scheduler';
import type { HealthResponse } from './shared/schemas';
import { ReplayContext, SimContext } from './sim/react';
import { createReplay } from './sim/replay';
import { createSimStore } from './sim/store';
import type { DossierTab } from './ui/Dossier';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { Hud } from './ui/Hud';
import { Panel } from './ui/Panel';
import { ReplayBanner } from './ui/ReplayControls';
import { WorldTimeline } from './ui/WorldTimeline';
import { Minimap } from './world/Minimap';
import { Scene } from './world/Scene';

const store = createSimStore();
// Display reads the replay view (live, or a past moment); the simulation, scheduler and fly driver use the live store.
const replay = createReplay(store);

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>('a1');
  const [tab, setTab] = useState<DossierTab>('overview');
  const [focusSeq, setFocusSeq] = useState<number | null>(null);
  const [follow, setFollow] = useState(false);

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
    <SimContext.Provider value={replay.viewStore}>
      <ReplayContext.Provider value={replay}>
      <div className="app">
        <div className="main">
          <div className="viewport">
            <ErrorBoundary name="3D view">
              <Scene selectedId={selectedId} onSelect={setSelectedId} follow={follow} />
            </ErrorBoundary>
            <Minimap selectedId={selectedId} onSelect={setSelectedId} />
            <Hud />
            <ReplayBanner />
            <button className={`follow ${follow ? 'on' : ''}`} onClick={() => setFollow((f) => !f)}>
              🎥 {follow ? `following ${selectedId ?? '—'}` : 'follow selected'}
            </button>
          </div>
          <ErrorBoundary name="Timeline">
            <WorldTimeline
              selectedId={selectedId}
              onPick={(id, seq) => {
                setSelectedId(id);
                setTab('timeline');
                setFocusSeq(seq);
              }}
            />
          </ErrorBoundary>
        </div>
        <ErrorBoundary name="Panel">
          <Panel health={health} selectedId={selectedId} onSelect={setSelectedId} tab={tab} setTab={setTab} focusSeq={focusSeq} />
        </ErrorBoundary>
      </div>
      </ReplayContext.Provider>
    </SimContext.Provider>
  );
}
