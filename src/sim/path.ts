import { CONFIG } from '../shared/config';
import type { Vec2, WorldState } from '../shared/types';
import { obstacleDistance } from './geometry';

/**
 * Grid A* over solid obstacles (inflated by the agent radius), with extra cost inside hazards.
 * The grid is rebuilt only when the obstacle/hazard set changes. Other agents are dodged locally by stepToward.
 */
const CELL = 0.5;
const HAZARD_COST = 6;
const MAX_EXPANSIONS = 40000;

type Grid = { key: string; n: number; min: number; solid: Uint8Array; hazard: Uint8Array };
const cache = new WeakMap<WorldState, Grid>();

function gridKey(state: WorldState) {
  return `${Object.keys(state.obstacles).join(',')}|${Object.values(state.hazards).map((h) => `${h.id}:${h.radius}`).join(',')}`;
}

function buildGrid(state: WorldState): Grid {
  const n = Math.ceil(CONFIG.worldSize / CELL);
  const min = state.bounds.min.x;
  const solid = new Uint8Array(n * n);
  const hazard = new Uint8Array(n * n);
  const pad = CONFIG.agentRadius + 0.05;
  const mark = (arr: Uint8Array, cx: number, cz: number, r: number, test: (p: Vec2) => boolean) => {
    const i0 = Math.max(0, Math.floor((cx - r - min) / CELL));
    const i1 = Math.min(n - 1, Math.floor((cx + r - min) / CELL));
    const j0 = Math.max(0, Math.floor((cz - r - min) / CELL));
    const j1 = Math.min(n - 1, Math.floor((cz + r - min) / CELL));
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) if (test({ x: min + (i + 0.5) * CELL, z: min + (j + 0.5) * CELL })) arr[j * n + i] = 1;
  };
  for (const o of Object.values(state.obstacles)) {
    if (!o.solid) continue;
    const reach = (o.halfLength ?? 0) + o.radius + pad;
    mark(solid, o.position.x, o.position.z, reach, (p) => obstacleDistance(o, p) < pad);
  }
  for (const h of Object.values(state.hazards)) {
    mark(hazard, h.position.x, h.position.z, h.radius + 0.3, (p) => Math.hypot(p.x - h.position.x, p.z - h.position.z) < h.radius + 0.3);
  }
  for (let i = 0; i < n; i++) {
    solid[i] = solid[(n - 1) * n + i] = solid[i * n] = solid[i * n + n - 1] = 1;
  }
  return { key: gridKey(state), n, min, solid, hazard };
}

function getGrid(state: WorldState): Grid {
  const g = cache.get(state);
  if (g && g.key === gridKey(state)) return g;
  const fresh = buildGrid(state);
  cache.set(state, fresh);
  return fresh;
}

const cellOf = (g: Grid, p: Vec2) => [
  Math.min(g.n - 1, Math.max(0, Math.floor((p.x - g.min) / CELL))),
  Math.min(g.n - 1, Math.max(0, Math.floor((p.z - g.min) / CELL))),
];
const centre = (g: Grid, i: number, j: number): Vec2 => ({ x: g.min + (i + 0.5) * CELL, z: g.min + (j + 0.5) * CELL });

/** True if the straight segment a→b crosses no solid cell (and, if avoidHazards, no hazard cell). */
export function clearLine(state: WorldState, a: Vec2, b: Vec2, avoidHazards = false): boolean {
  return clearLineG(getGrid(state), a, b, avoidHazards);
}

function clearLineG(g: Grid, a: Vec2, b: Vec2, avoidHazards: boolean): boolean {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (CELL * 0.5));
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    const [i, j] = cellOf(g, { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    if (g.solid[j * g.n + i] || (avoidHazards && g.hazard[j * g.n + i])) return false;
  }
  return true;
}

function nearestFree(g: Grid, i: number, j: number): [number, number] | null {
  if (!g.solid[j * g.n + i]) return [i, j];
  for (let r = 1; r < 12; r++)
    for (let di = -r; di <= r; di++)
      for (const dj of [-r, r]) {
        for (const [x, y] of [[i + di, j + dj], [i + dj, j + di]]) {
          if (x >= 0 && y >= 0 && x < g.n && y < g.n && !g.solid[y * g.n + x]) return [x, y];
        }
      }
  return null;
}

/**
 * Returns waypoints from `from` to `to` (excluding the start, ending at `to` or the nearest reachable point),
 * or null if unreachable. Hazards are avoided when a detour is not much longer.
 */
export function planPath(state: WorldState, from: Vec2, to: Vec2): Vec2[] | null {
  const g = getGrid(state);
  if (clearLineG(g, from, to, true)) return [{ ...to }];
  const { n } = g;
  const s0 = cellOf(g, from);
  const goalCell = cellOf(g, to);
  const start = nearestFree(g, s0[0], s0[1]);
  const goal = nearestFree(g, goalCell[0], goalCell[1]);
  if (!start || !goal) return null;
  const startIdx = start[1] * n + start[0];
  const goalIdx = goal[1] * n + goal[0];
  const cost = new Float32Array(n * n).fill(Infinity);
  const parent = new Int32Array(n * n).fill(-1);
  const closed = new Uint8Array(n * n);
  const heap: number[] = [];
  const prio: number[] = [];
  const push = (idx: number, p: number) => {
    heap.push(idx);
    prio.push(p);
    let c = heap.length - 1;
    while (c > 0) {
      const par = (c - 1) >> 1;
      if (prio[par] <= prio[c]) break;
      [heap[par], heap[c]] = [heap[c], heap[par]];
      [prio[par], prio[c]] = [prio[c], prio[par]];
      c = par;
    }
  };
  const pop = () => {
    const top = heap[0];
    const lastI = heap.pop()!;
    const lastP = prio.pop()!;
    if (heap.length) {
      heap[0] = lastI;
      prio[0] = lastP;
      let c = 0;
      for (;;) {
        const l = 2 * c + 1, r = l + 1;
        let m = c;
        if (l < heap.length && prio[l] < prio[m]) m = l;
        if (r < heap.length && prio[r] < prio[m]) m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c], heap[m]];
        [prio[m], prio[c]] = [prio[c], prio[m]];
        c = m;
      }
    }
    return top;
  };
  const h = (i: number, j: number) => {
    const dx = Math.abs(i - goal[0]), dz = Math.abs(j - goal[1]);
    return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz);
  };
  cost[startIdx] = 0;
  push(startIdx, h(start[0], start[1]));
  let expansions = 0;
  let found = false;
  while (heap.length && expansions++ < MAX_EXPANSIONS) {
    const cur = pop();
    if (closed[cur]) continue;
    if (cur === goalIdx) {
      found = true;
      break;
    }
    closed[cur] = 1;
    const ci = cur % n, cj = (cur / n) | 0;
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const nIdx = nj * n + ni;
        if (g.solid[nIdx] || closed[nIdx]) continue;
        if (di && dj && (g.solid[cj * n + ni] || g.solid[nj * n + ci])) continue;
        const step = (di && dj ? 1.4142 : 1) * (g.hazard[nIdx] ? HAZARD_COST : 1);
        const c = cost[cur] + step;
        if (c < cost[nIdx]) {
          cost[nIdx] = c;
          parent[nIdx] = cur;
          push(nIdx, c + h(ni, nj));
        }
      }
  }
  if (!found) return null;
  const cells: Vec2[] = [];
  for (let c = goalIdx; c !== startIdx && c >= 0; c = parent[c]) cells.push(centre(g, c % n, (c / n) | 0));
  cells.reverse();
  const end = goalIdx === goalCell[1] * n + goalCell[0] ? { ...to } : cells.at(-1) ?? { ...to };
  if (cells.length) cells[cells.length - 1] = end;
  else cells.push(end);
  // String-pull: keep only waypoints needed to preserve clear lines (hazard-free where the grid path was).
  const out: Vec2[] = [];
  let anchor = from;
  let i = 0;
  while (i < cells.length) {
    let j = cells.length - 1;
    while (j > i && !clearLineG(g, anchor, cells[j], !g.hazard[cellIndex(g, cells[j])] && !g.hazard[cellIndex(g, anchor)])) j--;
    out.push(cells[j]);
    anchor = cells[j];
    i = j + 1;
  }
  return out;
}

function cellIndex(g: Grid, p: Vec2) {
  const [i, j] = cellOf(g, p);
  return j * g.n + i;
}
