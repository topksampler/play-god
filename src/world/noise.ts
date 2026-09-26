import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js';
import { mulberry32 } from '../sim/rng';

/** Seeded 2D noise helpers for render-only procedural detail (terrain, rocks, flora). */
export function makeNoise(seed: number) {
  const s = new SimplexNoise({ random: mulberry32(seed) });
  const n2 = (x: number, z: number) => s.noise(x, z);
  const fbm = (x: number, z: number, octaves = 4) => {
    let sum = 0;
    let amp = 0.5;
    let f = 1;
    for (let i = 0; i < octaves; i++) {
      sum += amp * s.noise(x * f, z * f);
      f *= 2.03;
      amp *= 0.5;
    }
    return sum;
  };
  /** Sharp-crested ridges in [0,1] — mountain ranges. */
  const ridged = (x: number, z: number, octaves = 5) => {
    let sum = 0;
    let amp = 0.55;
    let f = 1;
    let prev = 1;
    for (let i = 0; i < octaves; i++) {
      const r = 1 - Math.abs(s.noise(x * f, z * f));
      const v = r * r * prev;
      sum += v * amp;
      prev = v;
      f *= 2.1;
      amp *= 0.5;
    }
    return sum;
  };
  const n3 = (x: number, y: number, z: number) => s.noise3d(x, y, z);
  return { n2, n3, fbm, ridged };
}

export type Noise = ReturnType<typeof makeNoise>;

/** Deterministic per-id random stream, so each entity looks different but stable across renders. */
export function hashRng(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
