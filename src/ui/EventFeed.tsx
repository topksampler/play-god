import { useWorld } from '../sim/react';

export function EventFeed() {
  const world = useWorld();
  const events = world.events.slice(-40).reverse();
  return (
    <div className="feed">
      {events.map((e) => (
        <div key={e.seq} className={e.ok ? '' : 'err'}>
          <span className="small">{e.at.toFixed(1)}s</span> {e.text}
        </div>
      ))}
    </div>
  );
}
