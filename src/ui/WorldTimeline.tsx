import { useState } from 'react';
import type { TimelineEntry } from '../shared/types';
import { useWorldThrottled } from '../sim/react';
import { KIND_STYLE, KINDS } from './kinds';

const WINDOWS = [60, 180, 600] as const;

/** Swimlanes: one lane per agent, one mark per recorded event, over a sliding window of sim time. */
export function WorldTimeline({ selectedId, onPick }: { selectedId: string | null; onPick: (agentId: string, seq: number) => void }) {
  const world = useWorldThrottled(500);
  const [win, setWin] = useState<number>(180);
  const [hover, setHover] = useState<{ x: number; y: number; e: TimelineEntry; agent: string } | null>(null);
  const agents = Object.values(world.agents);
  const W = 1000;
  const LANE = 22;
  const LEFT = 64;
  const t1 = world.time;
  const t0 = Math.max(0, t1 - win);
  const x = (t: number) => LEFT + ((t - t0) / Math.max(1, t1 - t0)) * (W - LEFT - 8);
  const H = 18 + agents.length * LANE;
  const ticks: number[] = [];
  const step = win <= 60 ? 10 : win <= 180 ? 30 : 60;
  for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) ticks.push(t);

  return (
    <div className="wtl">
      <div className="wtl-head">
        <b>Timeline</b>
        {KINDS.map((k) => (
          <span key={k} className="legend">
            <span style={{ color: KIND_STYLE[k].color }}>{KIND_STYLE[k].glyph}</span> {KIND_STYLE[k].label}
          </span>
        ))}
        <span className="spacer" />
        {WINDOWS.map((w) => (
          <button key={w} className={`chip-btn ${w === win ? 'on' : ''}`} onClick={() => setWin(w)}>
            last {w >= 60 ? `${w / 60}m` : `${w}s`}
          </button>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: H }} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={12} y2={H} className="wtl-grid" />
            <text x={x(t)} y={9} className="wtl-tick">{`${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`}</text>
          </g>
        ))}
        {agents.map((a, i) => {
          const y = 18 + i * LANE + LANE / 2;
          return (
            <g key={a.id}>
              <rect x={0} y={y - LANE / 2} width={W} height={LANE} className={a.id === selectedId ? 'wtl-lane sel' : 'wtl-lane'} />
              <circle cx={10} cy={y} r={5} fill={a.color} />
              <text x={20} y={y + 4} className="wtl-name">{a.id}{a.status === 'dead' ? ' ✝' : ''}</text>
              {a.timeline
                .filter((e) => e.at >= t0)
                .map((e) => {
                  const cx = x(e.at);
                  const st = KIND_STYLE[e.kind];
                  const common = {
                    onMouseEnter: () => setHover({ x: cx, y, e, agent: a.id }),
                    onClick: () => onPick(a.id, e.seq),
                    style: { cursor: 'pointer' },
                  };
                  if (e.kind === 'turn') return <line key={e.seq} x1={cx} x2={cx} y1={y - 8} y2={y + 8} stroke={st.color} strokeWidth={1.5} {...common} />;
                  if (e.kind === 'milestone')
                    return <path key={e.seq} d={`M${cx},${y - 7}L${cx + 6},${y + 5}L${cx - 6},${y + 5}Z`} fill={st.color} {...common} />;
                  if (e.kind === 'said' || e.kind === 'heard')
                    return <rect key={e.seq} x={cx - 4} y={y - 4} width={8} height={8} transform={`rotate(45 ${cx} ${y})`} fill={e.kind === 'said' ? st.color : 'var(--surface-1)'} stroke={st.color} strokeWidth={2} {...common} />;
                  if (e.kind === 'memory') return <rect key={e.seq} x={cx - 4} y={y - 4} width={8} height={8} fill={st.color} {...common} />;
                  if (e.kind === 'hurt' || e.kind === 'error')
                    return <path key={e.seq} d={`M${cx - 4},${y - 4}L${cx + 4},${y + 4}M${cx + 4},${y - 4}L${cx - 4},${y + 4}`} stroke={st.color} strokeWidth={2.5} {...common} />;
                  return <circle key={e.seq} cx={cx} cy={y} r={3.5} fill={e.ok ? st.color : 'var(--surface-1)'} stroke={st.color} strokeWidth={1.5} {...common} />;
                })}
            </g>
          );
        })}
      </svg>
      {hover && (
        <div className="wtl-tip" style={{ left: `${(hover.x / W) * 100}%`, top: hover.y + 30 }}>
          <b>{hover.agent}</b> · {KIND_STYLE[hover.e.kind].label} · {hover.e.at.toFixed(0)}s
          <br />
          {hover.e.text}
          <div className="small">click to open in the agent's timeline</div>
        </div>
      )}
    </div>
  );
}
