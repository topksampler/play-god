import { useState } from 'react';
import type { SimEvent } from '../shared/types';
import { useWorldThrottled } from '../sim/react';

const CLS: Record<string, string> = { hazard: 'hz', message: 'msg', death: 'death', error: 'err', weather: 'msg', ecology: 'eco' };
const GROUPS: { id: string; label: string; kinds: SimEvent['kind'][] }[] = [
  { id: 'actions', label: 'actions', kinds: ['action'] },
  { id: 'social', label: 'messages', kinds: ['message'] },
  { id: 'danger', label: 'danger', kinds: ['hazard', 'death', 'error'] },
  { id: 'world', label: 'world', kinds: ['weather', 'ecology', 'edit', 'spawn', 'system'] },
];

/** Filterable, freezable world event log (actual simulator events). */
export function EventFeed() {
  const world = useWorldThrottled(500);
  const [on, setOn] = useState(new Set(GROUPS.map((g) => g.id)));
  const [frozen, setFrozen] = useState<SimEvent[] | null>(null);
  const kinds = new Set(GROUPS.filter((g) => on.has(g.id)).flatMap((g) => g.kinds));
  const events = (frozen ?? world.events).filter((e) => kinds.has(e.kind)).slice(-120).reverse();
  return (
    <div>
      <div className="row">
        {GROUPS.map((g) => (
          <button key={g.id} className={`chip-btn ${on.has(g.id) ? 'on' : ''}`} onClick={() => setOn((s) => { const n = new Set(s); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n; })}>
            {g.label}
          </button>
        ))}
        <button onClick={() => setFrozen(frozen ? null : [...world.events])}>{frozen ? '▶ Live' : '⏸ Freeze'}</button>
      </div>
      <div className="log">
        {events.map((e) => (
          <div key={e.seq} className={CLS[e.kind] ?? (e.ok ? '' : 'err')}>
            <span className="small">{e.at.toFixed(0)}s</span> {e.text}
          </div>
        ))}
      </div>
    </div>
  );
}
