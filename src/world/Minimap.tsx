import { useEffect, useRef } from 'react';
import { BIOMES, HAZARDS, NODES } from '../shared/catalog';
import { CONFIG } from '../shared/config';
import { useSim } from '../sim/react';

/** Top-down map of actual world state (human view; agents do not see this). */
export function Minimap({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string) => void }) {
  const store = useSim();
  const ref = useRef<HTMLCanvasElement>(null);
  const S = 200;
  useEffect(() => {
    const draw = () => {
      const c = ref.current;
      const ctx = c?.getContext('2d');
      if (!c || !ctx) return;
      const s = store.getState();
      const k = S / CONFIG.worldSize;
      const tx = (x: number) => (x - s.bounds.min.x) * k;
      const tz = (z: number) => (z - s.bounds.min.z) * k;
      const step = 4;
      for (let px = 0; px < S; px += step) {
        for (let pz = 0; pz < S; pz += step) {
          const x = px / k + s.bounds.min.x;
          const z = pz / k + s.bounds.min.z;
          let best = s.biomes[0];
          let bd = Infinity;
          for (const b of s.biomes) {
            const d = (b.site.x - x) ** 2 + (b.site.z - z) ** 2;
            if (d < bd) {
              bd = d;
              best = b;
            }
          }
          ctx.fillStyle = BIOMES[best.kind].color;
          ctx.fillRect(px, pz, step, step);
        }
      }
      for (const o of Object.values(s.obstacles)) {
        ctx.fillStyle = o.shape === 'lake' ? '#2f7fbf' : 'rgba(60,60,60,0.7)';
        ctx.beginPath();
        ctx.arc(tx(o.position.x), tz(o.position.z), Math.max(1, (o.halfLength ?? o.radius) * k), 0, Math.PI * 2);
        ctx.fill();
      }
      for (const h of Object.values(s.hazards)) {
        ctx.fillStyle = HAZARDS[h.kind].color + '88';
        ctx.beginPath();
        ctx.arc(tx(h.position.x), tz(h.position.z), h.radius * k, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const r of Object.values(s.resources)) {
        ctx.fillStyle = NODES[r.kind].color;
        ctx.globalAlpha = r.units >= 1 ? 1 : 0.35;
        ctx.fillRect(tx(r.position.x) - 1.5, tz(r.position.z) - 1.5, 3, 3);
      }
      ctx.globalAlpha = 1;
      for (const a of Object.values(s.agents)) {
        ctx.fillStyle = a.status === 'dead' ? '#444' : a.color;
        ctx.strokeStyle = a.id === selectedId ? '#fff' : '#000';
        ctx.lineWidth = a.id === selectedId ? 2 : 1;
        ctx.beginPath();
        ctx.arc(tx(a.position.x), tz(a.position.z), 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    };
    draw();
    const id = setInterval(draw, 500);
    return () => clearInterval(id);
  }, [store, selectedId]);

  return (
    <canvas
      ref={ref}
      width={S}
      height={S}
      className="minimap"
      title="Minimap (actual world state) — click an agent to select"
      onClick={(e) => {
        const s = store.getState();
        const rect = e.currentTarget.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * CONFIG.worldSize + s.bounds.min.x;
        const z = ((e.clientY - rect.top) / rect.height) * CONFIG.worldSize + s.bounds.min.z;
        const hit = Object.values(s.agents).sort((a, b) => Math.hypot(a.position.x - x, a.position.z - z) - Math.hypot(b.position.x - x, b.position.z - z))[0];
        if (hit && Math.hypot(hit.position.x - x, hit.position.z - z) < 4) onSelect(hit.id);
      }}
    />
  );
}
