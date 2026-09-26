import { useEffect, useState } from 'react';
import { fetchHealth } from './controllers/llm';
import { startFlyDriver } from './controllers/fly/driver';
import { startObserver } from './controllers/observer';
import { startScheduler } from './controllers/scheduler';
import type { HealthResponse } from './shared/schemas';
import { createChronicle } from './sim/chronicle';
import { ChronicleContext, ReplayContext, SimContext } from './sim/react';
import { createReplay } from './sim/replay';
import { createSimStore } from './sim/store';
import type { DossierTab } from './ui/Dossier';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { GodPanel } from './ui/GodPanel';
import { Hud } from './ui/Hud';
import { Panel } from './ui/Panel';
import { ReplayBanner } from './ui/ReplayControls';
import { WorldTimeline } from './ui/WorldTimeline';
import { Minimap } from './world/Minimap';
import { Scene } from './world/Scene';

const store = createSimStore();
// Display reads the replay view (live, or a past moment); the simulation, scheduler and fly driver use the live store.
const replay = createReplay(store);
// Recorded moments + run memory (read-only on the live world), and the observer agent that reads them.
const chronicle = createChronicle(store);
let llmReady = false;

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>('a1');
  const [tab, setTab] = useState<DossierTab>('overview');
  const [focusSeq, setFocusSeq] = useState<number | null>(null);
  const [follow, setFollow] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  /** Show a recorded moment: jump the replay a few seconds before it and play, following the creature involved. */
  const watch = (at: number, agentId?: string) => {
    replay.seek(Math.max(replay.range().start, at - 3));
    replay.setRate(1);
    replay.setPlaying(true);
    if (agentId) {
      setSelectedId(agentId);
      setFollow(true);
    }
  };

  useEffect(() => {
    const stopSim = store.start();
    const stopSched = startScheduler(store);
    const stopFlies = startFlyDriver(store);
    const stopObserver = startObserver(store, chronicle, () => llmReady);
    fetchHealth().then((h) => {
      setHealth(h);
      llmReady = h.llmConfigured;
      // The demo world is multi-species (LLM agents + connectome flies). Set the controller default first so the
      // agents created by the reset are LLM-driven.
      if (h.llmConfigured) store.dispatch({ type: 'setDefaultController', controller: 'llm', tier: 'fast' });
      store.dispatch({ type: 'reset', mode: 'mixed' });
    });
    return () => {
      stopObserver();
      stopFlies();
      stopSched();
      stopSim();
    };
  }, []);

  return (
    <SimContext.Provider value={replay.viewStore}>
      <ReplayContext.Provider value={replay}>
      <ChronicleContext.Provider value={chronicle}>
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
                // The click also moves the replay to that moment; the full entry is ready in Advanced → dossier.
                setSelectedId(id);
                setTab('timeline');
                setFocusSeq(seq);
              }}
              onWatch={watch}
            />
          </ErrorBoundary>
        </div>
        <ErrorBoundary name="Panel">
          <div className="side">
            <GodPanel
              health={health}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onWatch={watch}
              onFollow={(id) => {
                setSelectedId(id);
                setFollow(true);
              }}
              onAdvanced={(id) => {
                if (id) setSelectedId(id);
                setAdvanced(true);
              }}
            />
            {advanced && (
              <div className="drawer">
                <div className="drawer-head">
                  <b>⚙ Advanced</b>
                  <span className="small">speed · models · Lab · charts · raw events · full dossier</span>
                  <span className="spacer" />
                  <button onClick={() => setAdvanced(false)}>✕ Close</button>
                </div>
                <Panel health={health} selectedId={selectedId} onSelect={setSelectedId} tab={tab} setTab={setTab} focusSeq={focusSeq} />
              </div>
            )}
          </div>
        </ErrorBoundary>
      </div>
      </ChronicleContext.Provider>
      </ReplayContext.Provider>
    </SimContext.Provider>
  );
}
