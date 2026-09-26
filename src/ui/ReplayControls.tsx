import { useReplay, useSim } from '../sim/react';

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** Timeline-header controls for looking back in time. The live simulation keeps running regardless. */
export function ReplayControls() {
  const replay = useReplay();
  const vt = replay.getViewTime();
  const { start, end } = replay.range();
  const seekBy = (d: number) => replay.seek((vt ?? end) + d);
  return (
    <span className="replay-controls">
      <button className="chip-btn" title="Jump back 10 s" onClick={() => seekBy(-10)} disabled={end - start < 1}>⏪ 10s</button>
      {vt !== null && (
        <>
          <button className="chip-btn" onClick={() => replay.setPlaying(!replay.isPlaying())}>{replay.isPlaying() ? '⏸' : '▶'}</button>
          {[1, 2, 4].map((r) => (
            <button key={r} className={`chip-btn ${replay.getRate() === r ? 'on' : ''}`} onClick={() => replay.setRate(r)}>{r}×</button>
          ))}
          <button className="chip-btn" title="Forward 10 s" onClick={() => seekBy(10)}>10s ⏩</button>
        </>
      )}
      <button className={`chip-btn ${vt === null ? 'on live' : ''}`} onClick={() => replay.seek(null)}>● {vt === null ? 'LIVE' : 'Go live'}</button>
      <span className="small">{vt === null ? `click the timeline to look back (up to ${clock(end - start)})` : `viewing ${clock(vt)}`}</span>
    </span>
  );
}

/** Viewport banner shown while a past moment is displayed. */
export function ReplayBanner() {
  const replay = useReplay();
  const live = useSim().getLiveState();
  const vt = replay.getViewTime();
  if (vt === null) return null;
  return (
    <div className="replay-banner">
      ⏪ Replay · viewing t={clock(vt)} ({Math.round(live.time - vt)}s ago){replay.isPlaying() ? ` · playing ${replay.getRate()}×` : ' · paused'} · the live world
      keeps running (now t={clock(live.time)}) · God commands act on the live world
      <button onClick={() => replay.seek(null)}>Go live</button>
    </div>
  );
}
