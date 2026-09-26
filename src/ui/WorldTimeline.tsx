import { useState } from 'react';
import type { TimelineEntry } from '../shared/types';
import { MOMENT_ICON } from '../sim/moments';
import { useChronicle, useReplay, useSim, useWorldThrottled } from '../sim/react';
import { KIND_STYLE, KINDS } from './kinds';
import { ReplayControls } from './ReplayControls';

const WINDOWS = [60, 180, 600] as const;
const W = 1000;
const LANE = 20;
const LEFT = 64;

/**
 * Story lane (recorded moments, tap to watch) over per-agent swimlanes. The axis always spans the live window;
 * clicking or dragging anywhere shows that moment in the replay.
 */
export function WorldTimeline({
  selectedId, onPick, onWatch,
}: {
  selectedId: string | null;
  onPick: (agentId: string, seq: number) => void;
  onWatch: (at: number, agentId?: string) => void;
}) {
  useWorldThrottled(500); // re-render cadence
  const world = useSim().getLiveState();
  const replay = useReplay();
  const chronicle = useChronicle();
  const [win, setWin] = useState<number>(180);
  const [key, setKey] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number; e: TimelineEntry; agent: string } | null>(null);
  const agents = Object.values(world.agents);
  const t1 = world.time;
  const t0 = Math.max(0, t1 - win);
  const x = (t: number) => LEFT + ((t - t0) / Math.max(1, t1 - t0)) * (W - LEFT - 8);
  const pct = (t: number) => `${(x(t) / W) * 100}%`;
  const H = 14 + agents.length * LANE;
  const ticks: number[] = [];
  const step = win <= 60 ? 10 : win <= 180 ? 30 : 60;
  for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) ticks.push(t);
  const recStart = replay.range().start;
  const vt = replay.getViewTime();
  const story = chronicle.moments().filter((m) => m.weight >= 2 && m.at >= t0);
  const seekAt = (e: React.PointerEvent<HTMLElement | SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    if (px < LEFT) return;
    replay.seek(t0 + ((px - LEFT) / (W - LEFT - 8)) * Math.max(1, t1 - t0));
  };
  const scrub = {
    onPointerDown: seekAt,
    onPointerMove: (e: React.PointerEvent<HTMLElement | SVGSVGElement>) => e.buttons & 1 && seekAt(e),
  };

  return (
    <div className={`wtl ${vt !== null ? 'replaying' : ''}`}>
      <div className="wtl-head">
        <b className="wtl-title">Timeline</b>
        <ReplayControls />
        <span className="spacer" />
        <div className="seg">
          {WINDOWS.map((w) => (
            <button key={w} className={w === win ? 'on' : ''} onClick={() => setWin(w)}>{w / 60}m</button>
          ))}
        </div>
        <button className={`chip-btn ${key ? 'on' : ''}`} onClick={() => setKey((k) => !k)} title="What the marks mean">key</button>
      </div>
      {key && (
        <div className="wtl-key">
          {KINDS.map((k) => (
            <span key={k}><span style={{ color: KIND_STYLE[k].color }}>{KIND_STYLE[k].glyph}</span> {KIND_STYLE[k].label}</span>
          ))}
          <span>· top row: story moments (tap to watch)</span>
        </div>
      )}
      <div className="wtl-axis" {...scrub}>
        {ticks.map((t) => (
          <span key={t} style={{ left: pct(t) }}>{`${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`}</span>
        ))}
        {vt !== null && <i className="wtl-axis-head" style={{ left: pct(vt) }} />}
      </div>
      <div className="wtl-story" {...scrub}>
        <span className="wtl-story-label">story</span>
        {recStart > t0 && <i className="wtl-norec-strip" style={{ left: pct(t0), width: `calc(${pct(recStart)} - ${pct(t0)})` }} />}
        {story.map((m) => (
          <button
            key={m.id}
            className={`wtl-moment w${m.weight}`}
            style={{ left: pct(m.at) }}
            title={`${Math.floor(m.at / 60)}:${String(Math.floor(m.at % 60)).padStart(2, '0')} ${m.title} — tap to watch`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onWatch(m.at, m.agents[0])}
          >
            {MOMENT_ICON[m.kind]}
          </button>
        ))}
        {vt !== null && <i className="wtl-story-head" style={{ left: pct(vt) }} />}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ height: H, cursor: 'col-resize' }}
        onMouseLeave={() => setHover(null)}
        {...scrub}
      >
        {recStart > t0 && <rect x={LEFT} y={0} width={Math.max(0, x(recStart) - LEFT)} height={H} className="wtl-norec" />}
        {ticks.map((t) => <line key={t} x1={x(t)} x2={x(t)} y1={0} y2={H} className="wtl-grid" />)}
        {agents.map((a, i) => {
          const y = 8 + i * LANE + LANE / 2;
          return (
            <g key={a.id}>
              <rect x={0} y={y - LANE / 2} width={W} height={LANE} className={a.id === selectedId ? 'wtl-lane sel' : i % 2 ? 'wtl-lane alt' : 'wtl-lane'} />
              <circle cx={10} cy={y} r={4.5} fill={a.status === 'dead' ? '#888' : a.color} />
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
                  if (e.kind === 'turn') return <line key={e.seq} x1={cx} x2={cx} y1={y - 7} y2={y + 7} stroke={st.color} strokeWidth={1.5} {...common} />;
                  if (e.kind === 'milestone')
                    return <path key={e.seq} d={`M${cx},${y - 6}L${cx + 5},${y + 4}L${cx - 5},${y + 4}Z`} fill={st.color} {...common} />;
                  if (e.kind === 'said' || e.kind === 'heard')
                    return <rect key={e.seq} x={cx - 3.5} y={y - 3.5} width={7} height={7} transform={`rotate(45 ${cx} ${y})`} fill={e.kind === 'said' ? st.color : 'var(--surface-1)'} stroke={st.color} strokeWidth={2} {...common} />;
                  if (e.kind === 'memory') return <rect key={e.seq} x={cx - 3.5} y={y - 3.5} width={7} height={7} fill={st.color} {...common} />;
                  if (e.kind === 'hurt' || e.kind === 'error')
                    return <path key={e.seq} d={`M${cx - 3.5},${y - 3.5}L${cx + 3.5},${y + 3.5}M${cx + 3.5},${y - 3.5}L${cx - 3.5},${y + 3.5}`} stroke={st.color} strokeWidth={2.2} {...common} />;
                  return <circle key={e.seq} cx={cx} cy={y} r={3} fill={e.ok ? st.color : 'var(--surface-1)'} stroke={st.color} strokeWidth={1.5} {...common} />;
                })}
            </g>
          );
        })}
        {vt !== null && <line x1={x(vt)} x2={x(vt)} y1={0} y2={H} className="wtl-playhead-line" />}
      </svg>
      {hover && (
        <div className="wtl-tip" style={{ left: `${(hover.x / W) * 100}%`, top: hover.y + 70 }}>
          <b>{hover.agent}</b> · {KIND_STYLE[hover.e.kind].label} · {hover.e.at.toFixed(0)}s
          <br />
          {hover.e.text}
          <div className="small">click to view that moment</div>
        </div>
      )}
    </div>
  );
}
