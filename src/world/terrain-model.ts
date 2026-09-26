import { createContext, useContext } from 'react';
import { CONFIG } from '../shared/config';
import type { BiomeKind, WorldState } from '../shared/types';
import { lerp, makeNoise, smoothstep, type Noise } from './noise';

/**
 * Render-only terrain relief. The simulation stays on a flat X/Z plane; this model only decides how high
 * things are drawn so meshes, agents and props sit on the same sculpted ground. It never feeds back into the sim.
 */
export type Lake = { id: string; x: number; z: number; r: number; seed: number };
export type Pond = { id: string; kind: WaterKind; x: number; z: number; r: number; level: number };
export type WaterKind = 'fresh_water' | 'toxic_water' | 'fish_spot';

export type TerrainModel = {
  key: string;
  noise: Noise;
  half: number;
  lakes: Lake[];
  ponds: Pond[];
  /** Water nodes that sit on a lake shore render as lake-edge features instead of their own pond. */
  shoreNodes: Map<string, Lake>;
  lakeLevel: number;
  /** Ground height, including lake and pond basins. */
  height: (x: number, z: number) => number;
  /** Height a walker or prop rests at: the ground, but no deeper than wading depth inside ponds. */
  surface: (x: number, z: number) => number;
  /** Biome blend weights (sum 1) — soft Voronoi around the sim's biome sites. */
  weights: (x: number, z: number) => { kind: BiomeKind; w: number }[];
  biomeAt: (x: number, z: number) => BiomeKind;
  /** Unit terrain normal via central differences. */
  normal: (x: number, z: number) => [number, number, number];
};

const WATER_KINDS = new Set(['fresh_water', 'toxic_water', 'fish_spot']);
const POND_RADIUS: Record<WaterKind, number> = { fresh_water: 1.35, toxic_water: 1.3, fish_spot: 1.45 };

/** Per-biome relief: vertical offset and hill amplitude multiplier. */
const RELIEF: Record<BiomeKind, { off: number; amp: number }> = {
  meadow: { off: 0.1, amp: 1 },
  forest: { off: 0.35, amp: 1.25 },
  lake: { off: -0.1, amp: 0.6 },
  highlands: { off: 1.15, amp: 1.1 },
  scrub: { off: 0.2, amp: 0.55 },
  swamp: { off: -0.3, amp: 0.3 },
};

export function terrainKey(world: WorldState): string {
  const parts = [String(world.seed), ...world.biomes.map((b) => `${b.kind}${b.site.x.toFixed(1)},${b.site.z.toFixed(1)}`)];
  for (const o of Object.values(world.obstacles)) if (o.shape === 'lake') parts.push(`L${o.id}`);
  for (const r of Object.values(world.resources)) if (WATER_KINDS.has(r.kind)) parts.push(`W${r.id}`);
  return parts.join('|');
}

export function buildTerrainModel(world: WorldState): TerrainModel {
  const noise = makeNoise(world.seed * 7 + 11);
  const { n2, fbm, ridged } = noise;
  const half = CONFIG.worldSize / 2;
  const biomes = world.biomes;
  const lakeLevel = -0.22;

  const weights = (x: number, z: number) => {
    let dmin = Infinity;
    const ds = biomes.map((b) => {
      const d = Math.hypot(b.site.x - x, b.site.z - z);
      if (d < dmin) dmin = d;
      return d;
    });
    let sum = 0;
    const ws = ds.map((d) => {
      const w = Math.exp(-(d - dmin) / 2.4);
      sum += w;
      return w;
    });
    const out: { kind: BiomeKind; w: number }[] = [];
    ws.forEach((w, i) => {
      if (w / sum > 0.01) out.push({ kind: biomes[i].kind, w: w / sum });
    });
    return out.sort((a, b) => b.w - a.w);
  };

  const biomeAt = (x: number, z: number) => {
    let best = biomes[0];
    let bd = Infinity;
    for (const b of biomes) {
      const d = (b.site.x - x) ** 2 + (b.site.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best?.kind ?? 'meadow';
  };

  /** Distance outside the play square (negative inside), with rounded corners. */
  const outside = (x: number, z: number) => {
    const qx = Math.abs(x) - half;
    const qz = Math.abs(z) - half;
    return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
  };

  const base = (x: number, z: number) => {
    const ws = weights(x, z);
    let off = 0;
    let amp = 0;
    let hi = 0;
    let scrub = 0;
    for (const { kind, w } of ws) {
      off += RELIEF[kind].off * w;
      amp += RELIEF[kind].amp * w;
      if (kind === 'highlands') hi += w;
      if (kind === 'scrub') scrub += w;
    }
    let h = fbm(x / 30, z / 30, 3) * 1.25 * amp + n2(x / 7, z / 7) * 0.1 + off;
    if (hi > 0.01) h += hi * ridged(x / 10 + 5, z / 10 - 3, 3) * 0.9;
    if (scrub > 0.01) h += scrub * Math.sin(x * 0.32 + z * 0.12 + n2(x / 14, z / 14) * 2.5) * 0.16;
    const e = outside(x, z);
    if (e > -3) {
      const t = smoothstep(-3, 14, e);
      const foot = t * (2 + fbm(x / 18 + 9, z / 18, 3) * 3);
      const m = smoothstep(3, 42, e);
      // Broad ranges with sharp crests; a higher wall far out so every horizon is mountains.
      const r = ridged(x / 88 + 3.1, z / 88 - 1.7, 4);
      const peaks = m * (8 + 62 * Math.pow(r, 1.6)) + smoothstep(35, 130, e) * 20 + m * fbm(x / 14, z / 14, 3) * 3;
      h = h * (1 - t * 0.6) + foot + peaks;
    }
    return h;
  };

  const lakes: Lake[] = Object.values(world.obstacles)
    .filter((o) => o.shape === 'lake')
    .map((o, i) => ({ id: o.id, x: o.position.x, z: o.position.z, r: o.radius, seed: i * 17.3 + 2 }));

  /** Base height with the land around lakes gently levelled so a flat water plane meets an even shore. */
  const levelled = (x: number, z: number) => {
    let h = base(x, z);
    for (const l of lakes) {
      const d = Math.hypot(x - l.x, z - l.z);
      const f = smoothstep(l.r + 8, l.r + 1.2, d);
      if (f > 0) h = lerp(h, 0.02, f);
    }
    return h;
  };

  const shoreNodes = new Map<string, Lake>();
  const ponds: Pond[] = [];
  for (const r of Object.values(world.resources)) {
    if (!WATER_KINDS.has(r.kind)) continue;
    const lake = lakes.find((l) => Math.hypot(r.position.x - l.x, r.position.z - l.z) < l.r + 2.6);
    if (lake) {
      shoreNodes.set(r.id, lake);
      continue;
    }
    const kind = r.kind as WaterKind;
    ponds.push({ id: r.id, kind, x: r.position.x, z: r.position.z, r: POND_RADIUS[kind], level: levelled(r.position.x, r.position.z) - 0.12 });
  }

  /** Signed-distance shore profile: gentle beach on land, shelf then deep bowl under water. */
  const basin = (h: number, sd: number, level: number, deep: number, span: number) => {
    if (sd >= 0) {
      const t = Math.min(1, sd / 1.8);
      return lerp(level, h, 1 - (1 - t) * (1 - t));
    }
    const t = Math.min(1, -sd / 1.4);
    return level - deep * 0.18 * (1 - (1 - t) * (1 - t)) - deep * smoothstep(0.9, span, -sd);
  };

  const height = (x: number, z: number) => {
    let h = levelled(x, z);
    for (const l of lakes) {
      const dx = x - l.x;
      const dz = z - l.z;
      const d = Math.hypot(dx, dz);
      if (d > l.r + 2) continue;
      const a = Math.atan2(dz, dx);
      const shore = l.r * (0.9 + 0.045 * n2(Math.cos(a) * 1.4 + l.seed, Math.sin(a) * 1.4 - l.seed));
      h = Math.min(h, basin(h, d - shore, lakeLevel, 2.1, shore * 0.8));
    }
    for (const p of ponds) {
      const dx = x - p.x;
      const dz = z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > p.r + 3.2) continue;
      // Level the ground around the pond first, then carve.
      h = lerp(h, p.level + 0.12, smoothstep(p.r + 3.2, p.r + 0.6, d));
      const a = Math.atan2(dz, dx);
      const shore = p.r * (1 + 0.07 * n2(Math.cos(a) * 1.7 + p.x, Math.sin(a) * 1.7 + p.z));
      h = Math.min(h, basin(h, d - shore, p.level, 0.45, shore * 0.75));
    }
    return h;
  };

  const surface = (x: number, z: number) => {
    const h = height(x, z);
    for (const p of ponds) {
      if (Math.abs(x - p.x) < p.r + 0.5 && Math.abs(z - p.z) < p.r + 0.5) return Math.max(h, p.level - 0.18);
    }
    return h;
  };

  const normal = (x: number, z: number): [number, number, number] => {
    const e = 0.35;
    const nx = height(x - e, z) - height(x + e, z);
    const nz = height(x, z - e) - height(x, z + e);
    const ny = 2 * e;
    const l = Math.hypot(nx, ny, nz);
    return [nx / l, ny / l, nz / l];
  };

  return { key: terrainKey(world), noise, half, lakes, ponds, shoreNodes, lakeLevel, height, surface, weights, biomeAt, normal };
}

const flat: TerrainModel = (() => {
  const noise = makeNoise(1);
  return {
    key: 'flat',
    noise,
    half: CONFIG.worldSize / 2,
    lakes: [],
    ponds: [],
    shoreNodes: new Map(),
    lakeLevel: -0.2,
    height: () => 0,
    surface: () => 0,
    weights: () => [{ kind: 'meadow' as BiomeKind, w: 1 }],
    biomeAt: () => 'meadow' as BiomeKind,
    normal: () => [0, 1, 0],
  };
})();

export const TerrainContext = createContext<TerrainModel>(flat);
export const useTerrain = () => useContext(TerrainContext);
