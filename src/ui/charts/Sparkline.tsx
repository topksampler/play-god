import { useState } from 'react';

/**
 * Single-series area sparkline with a hover crosshair + tooltip.
 * One measure per chart (small multiples), shared x = sim time. The title names the series (no legend).
 */
export function Sparkline({
  title, points, color, max, unit = '', width = 180, height = 44, format = (v: number) => v.toFixed(0),
}: {
  title: string;
  points: { t: number; v: number }[];
  color: string;
  max?: number;
  unit?: string;
  width?: number;
  height?: number;
  format?: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const last = points.at(-1);
  if (points.length < 2) {
    return (
      <div className="spark">
        <div className="spark-head"><span>{title}</span><b>{last ? format(last.v) + unit : '—'}</b></div>
        <div className="spark-empty" style={{ height }}>collecting…</div>
      </div>
    );
  }
  const t0 = points[0].t;
  const t1 = points.at(-1)!.t;
  const hi = max ?? Math.max(1, ...points.map((p) => p.v));
  const x = (t: number) => ((t - t0) / Math.max(1e-6, t1 - t0)) * width;
  const y = (v: number) => height - 2 - (Math.min(v, hi) / hi) * (height - 4);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const area = `${line}L${width},${height}L0,${height}Z`;
  const h = hover !== null ? points[hover] : null;
  return (
    <div className="spark">
      <div className="spark-head">
        <span>{title}</span>
        <b>{format((h ?? last!).v)}{unit}</b>
      </div>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${title}: now ${format(last!.v)}${unit}`}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const tt = t0 + ((e.clientX - r.left) / r.width) * (t1 - t0);
          let best = 0;
          for (let i = 1; i < points.length; i++) if (Math.abs(points[i].t - tt) < Math.abs(points[best].t - tt)) best = i;
          setHover(best);
        }}
        onMouseLeave={() => setHover(null)}
      >
        <line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} className="spark-axis" />
        <path d={area} fill={color} opacity={0.14} />
        <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
        {h && (
          <>
            <line x1={x(h.t)} x2={x(h.t)} y1={0} y2={height} className="spark-cross" />
            <circle cx={x(h.t)} cy={y(h.v)} r={4} fill={color} stroke="var(--surface-1)" strokeWidth={2} />
          </>
        )}
      </svg>
      <div className="spark-foot">{h ? `at ${h.t.toFixed(0)}s` : `${t0.toFixed(0)}s → ${t1.toFixed(0)}s`}</div>
    </div>
  );
}
