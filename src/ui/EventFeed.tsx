import { useWorldThrottled } from '../sim/react';

const CLS: Record<string, string> = { hazard: 'hz', message: 'msg', death: 'death', error: 'err', weather: 'msg', ecology: 'eco' };

export function EventFeed() {
  const world = useWorldThrottled(300);
  const events = world.events.slice(-50).reverse();
  return (
    <div className="feed">
      {events.map((e) => (
        <div key={e.seq} className={CLS[e.kind] ?? (e.ok ? '' : 'err')}>
          <span className="small">{e.at.toFixed(0)}s</span> {e.text}
        </div>
      ))}
    </div>
  );
}
