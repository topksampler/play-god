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
      <button className="chip-btn" title="Back 10 s" onClick={() => seekBy(-10)} disabled={end - start < 1}>⏪ 10s</button>
      {vt !== null && (
        <div className="seg">
          <button onClick={() => replay.setPlaying(!replay.isPlaying())} title={replay.isPlaying() ? 'Pause replay' : 'Play replay'}>{replay.isPlaying() ? '⏸' : '▶'}</button>
          {[1, 2, 4].map((r) => (
            <button key={r} className={replay.getRate() === r ? 'on' : ''} onClick={() => replay.setRate(r)}>{r}×</button>
          ))}
          <button title="Forward 10 s" onClick={() => seekBy(10)}>10s ⏩</button>
        </div>
      )}
      <button className={`live-pill ${vt === null ? 'on' : ''}`} onClick={() => replay.seek(null)} title={vt === null ? 'Showing the live world' : 'Back to the live world'}>
        ● {vt === null ? 'LIVE' : 'Go live'}
      </button>
      <span className="small">{vt === null ? `tap the timeline to rewind · ${clock(end - start)} recorded` : `viewing ${clock(vt)} · ${Math.round(end - vt)}s ago`}</span>
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
      ⏪ Replay · {clock(vt)} ({Math.round(live.time - vt)}s ago){replay.isPlaying() ? ` · playing ${replay.getRate()}×` : ' · paused'} · the live world keeps running
      <button onClick={() => replay.seek(null)}>Go live</button>
    </div>
  );
}
