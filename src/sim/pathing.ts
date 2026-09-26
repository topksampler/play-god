import { CONFIG } from '../shared/config';
import type { Vec2, WorldState } from '../shared/types';
import { obstacleDistance } from './geometry';

/** Coarse occupancy grid over solid obstacles (inflated by the agent radius), cached per obstacle set. */
const CELL = 1;
type Grid = { key: string; w: number; h: number; minX: number; minZ: number; blocked: Uint8Array };
const cache = new WeakMap<WorldState['obstacles'], Grid>();

function grid(state: WorldState): Grid {
  const key = `${Object.keys(state.obstacles).length}:${state.idCounters.o ?? 0}`;
  const hit = cache.get(state.obstacles);
  if (hit && hit.key === key) return hit;
  const { min, max } = state.bounds;
  const w = Math.ceil((max.x - min.x) / CELL);
  const h = Math.ceil((max.z - min.z) / CELL);
  const blocked = new Uint8Array(w * h);
  const pad = CONFIG.agentRadius + 0.05;
  // World edges.
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = min.x + (i + 0.5) * CELL;
      const z = min.z + (j + 0.5) * CELL;
      if (x - min.x < pad || max.x - x < pad || z - min.z < pad || max.z - z < pad) blocked[j * w + i] = 1;
    }
  }
  // Rasterise each solid obstacle over its bounding box only (O(obstacle area), not O(cells × obstacles)).
  for (const o of Object.values(state.obstacles)) {
    if (!o.solid) continue;
    const reach = (o.halfLength !== undefined ? Math.hypot(o.halfLength, o.radius) : o.radius) + pad;
    const i0 = Math.max(0, Math.floor((o.position.x - reach - min.x) / CELL));
    const i1 = Math.min(w - 1, Math.floor((o.position.x + reach - min.x) / CELL));
    const j0 = Math.max(0, Math.floor((o.position.z - reach - min.z) / CELL));
    const j1 = Math.min(h - 1, Math.floor((o.position.z + reach - min.z) / CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (blocked[j * w + i]) continue;
        const p = { x: min.x + (i + 0.5) * CELL, z: min.z + (j + 0.5) * CELL };
        if (obstacleDistance(o, p) < pad) blocked[j * w + i] = 1;
      }
    }
  }
  const g = { key, w, h, minX: min.x, minZ: min.z, blocked };
  cache.set(state.obstacles, g);
  return g;
}

const cellOf = (g: Grid, p: Vec2) => [
  Math.max(0, Math.min(g.w - 1, Math.floor((p.x - g.minX) / CELL))),
  Math.max(0, Math.min(g.h - 1, Math.floor((p.z - g.minZ) / CELL))),
] as const;
const centre = (g: Grid, i: number, j: number): Vec2 => ({ x: g.minX + (i + 0.5) * CELL, z: g.minZ + (j + 0.5) * CELL });

/** True if the straight segment a→b stays clear of solid obstacles (agents are handled by local steering). */
export function clearSegment(state: WorldState, a: Vec2, b: Vec2): boolean {
  const g = grid(state);
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.ceil(d / 0.35);
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const [i, j] = cellOf(g, { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    if (g.blocked[j * g.w + i]) return false;
  }
  return true;
}

/**
 * 8-connected A* on the occupancy grid, then line-of-sight smoothing. Returns waypoints (excluding start),
 * ending at `to` (or the nearest free cell to it). Returns null if unreachable within the expansion budget.
 */
export function findPath(state: WorldState, from: Vec2, to: Vec2, budget = 7000): Vec2[] | null {
  const g = grid(state);
  const [si, sj] = cellOf(g, from);
  let [ti, tj] = cellOf(g, to);
  if (g.blocked[tj * g.w + ti]) {
    // Nearest free cell to the goal (ring search).
    let found = false;
    for (let r = 1; r < 8 && !found; r++) {
      for (let dj = -r; dj <= r && !found; dj++) {
        for (let di = -r; di <= r && !found; di++) {
          const i = ti + di, j = tj + dj;
          if (i >= 0 && j >= 0 && i < g.w && j < g.h && !g.blocked[j * g.w + i]) { ti = i; tj = j; found = true; }
        }
      }
    }
    if (!found) return null;
  }
  const N = g.w * g.h;
  const gScore = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const start = sj * g.w + si;
  const goal = tj * g.w + ti;
  gScore[start] = 0;
  // Binary min-heap of [f, node].
  const heap: [number, number][] = [];
  const push = (f: number, n: number) => {
    heap.push([f, n]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  push(0, start);
  const hq = (i: number, j: number) => {
    const dx = Math.abs(i - ti), dz = Math.abs(j - tj);
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
  };
  let expanded = 0;
  while (heap.length && expanded < budget) {
    const [, cur] = pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    expanded++;
    if (cur === goal) break;
    const ci = cur % g.w, cj = (cur / g.w) | 0;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= g.w || nj >= g.h) continue;
        const n = nj * g.w + ni;
        if (closed[n]) continue;
        // Cells near the start may read as blocked when the agent stands legitimately close to an obstacle
        // or the edge; allow escaping through them.
        const c = centre(g, ni, nj);
        const escape = Math.hypot(c.x - from.x, c.z - from.z) < 1.6;
        if (g.blocked[n] && !escape) continue;
        // No corner cutting (except while escaping).
        if (!escape && di && dj && (g.blocked[cj * g.w + ni] || g.blocked[nj * g.w + ci])) continue;
        const cost = gScore[cur] + (di && dj ? Math.SQRT2 : 1);
        if (cost < gScore[n]) {
          gScore[n] = cost;
          came[n] = cur;
          push(cost + hq(ni, nj), n);
        }
      }
    }
  }
  if (came[goal] === -1 && goal !== start) return null;
  const cells: Vec2[] = [];
  for (let c = goal; c !== -1 && c !== start; c = came[c]) cells.push(centre(g, c % g.w, (c / g.w) | 0));
  cells.reverse();
  if (cells.length) cells[cells.length - 1] = clearSegment(state, cells[cells.length - 1], to) ? { ...to } : cells[cells.length - 1];
  // Line-of-sight smoothing.
  const out: Vec2[] = [];
  let anchor = from;
  for (let k = 0; k < cells.length; k++) {
    const next = cells[k + 1];
    if (!next || !clearSegment(state, anchor, next)) {
      out.push(cells[k]);
      anchor = cells[k];
    }
  }
  return out.length ? out : [{ ...to }];
}
