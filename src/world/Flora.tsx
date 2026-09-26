import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  IcosahedronGeometry,
  type InstancedMesh,
  MeshStandardMaterial,
  Object3D,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BiomeKind, Obstacle } from '../shared/types';
import { obstacleDistance } from '../sim/geometry';
import { mulberry32 } from '../sim/rng';
import { ATMOS } from './atmosphere';
import { smoothstep } from './noise';
import type { TerrainModel } from './terrain-model';

/**
 * Decorative ground cover (grass, flowers, reeds, pebbles, far forests). Purely visual: not resources,
 * not obstacles, not visible to agents. Everything is instanced and built once per terrain.
 */

/** Wind sway for instanced vegetation: bends vertices by height, in world space, with travelling gusts. */
function windMaterial(params: ConstructorParameters<typeof MeshStandardMaterial>[0], stiffness = 1) {
  const m = new MeshStandardMaterial(params);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = ATMOS.uTime;
    shader.uniforms.uWind = ATMOS.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace(
        '#include <project_vertex>',
        /* glsl */ `
        vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        {
          float k = max(position.y, 0.0);
          k = k * k * ${(1 / stiffness).toFixed(3)};
          vec2 wp = mvPosition.xz;
          float gust = smoothstep(0.2, 1.0, sin(uTime * 0.7 - wp.x * 0.07 - wp.y * 0.045)) * 0.9;
          float sway = sin(uTime * 1.9 + wp.x * 0.37 + wp.y * 0.21) * 0.35 + sin(uTime * 3.3 + wp.x * 1.1) * 0.12;
          mvPosition.x += (sway + gust) * 0.16 * k * uWind;
          mvPosition.z += (sway * 0.6 + gust * 0.4) * 0.1 * k * uWind;
        }
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`,
      );
  };
  m.customProgramCacheKey = () => `wind-${stiffness}`;
  return m;
}

/** A tuft of tapered blades; vertex colour dark at the root, light at the tip; normals point up so it shades like turf. */
function tuftGeometry(blades: number, seed: number) {
  const rnd = mulberry32(seed);
  const pos: number[] = [];
  const col: number[] = [];
  const nrm: number[] = [];
  for (let b = 0; b < blades; b++) {
    const a = rnd() * Math.PI * 2;
    const r = rnd() * 0.12;
    const bx = Math.cos(a) * r;
    const bz = Math.sin(a) * r;
    const h = 0.7 + rnd() * 0.5;
    const w = 0.018 + rnd() * 0.016;
    const lean = (rnd() - 0.5) * 0.5;
    const face = rnd() * Math.PI;
    const fx = Math.cos(face) * w;
    const fz = Math.sin(face) * w;
    const lx = Math.cos(a) * lean;
    const lz = Math.sin(a) * lean;
    // 2 segments: base quad + tip triangle.
    const mid = 0.5 * h;
    const P = [
      [bx - fx, 0, bz - fz],
      [bx + fx, 0, bz + fz],
      [bx - fx * 0.7 + lx * 0.3, mid, bz - fz * 0.7 + lz * 0.3],
      [bx + fx * 0.7 + lx * 0.3, mid, bz + fz * 0.7 + lz * 0.3],
      [bx + lx, h, bz + lz],
    ];
    // Both windings with upward normals: two-sided blades that shade like turf (no back-face normal flip).
    const tris = [0, 1, 2, 2, 1, 3, 2, 3, 4, 2, 1, 0, 3, 1, 2, 4, 3, 2];
    for (const i of tris) {
      pos.push(...P[i]);
      const t = P[i][1] / h;
      const c = 0.68 + 0.5 * t;
      col.push(c, c, c * 0.95);
      nrm.push(0, 1, 0);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  return g;
}

function flowerGeometry() {
  const stem = new CylinderGeometry(0.012, 0.016, 0.34, 3);
  stem.translate(0, 0.17, 0);
  const head = new IcosahedronGeometry(0.06, 0);
  head.scale(1.3, 0.55, 1.3);
  head.translate(0, 0.35, 0);
  const color = (g: BufferGeometry, r: number, gg: number, b: number) => {
    const n = g.attributes.position.count;
    g.setAttribute('color', new BufferAttribute(new Float32Array(Array.from({ length: n * 3 }, (_, i) => [r, gg, b][i % 3])), 3));
    g.deleteAttribute('uv');
    return g;
  };
  // Stem is dark green (multiplied by white instance colour → stays green), head takes the instance colour.
  return mergeGeometries([color(stem.toNonIndexed(), 0.18, 0.35, 0.12), color(head, 1, 1, 1)])!;
}

function reedGeometry() {
  const parts: BufferGeometry[] = [];
  const rnd = mulberry32(5);
  const paint = (g: BufferGeometry, c: [number, number, number]) => {
    const ng = g.toNonIndexed();
    ng.deleteAttribute('uv');
    ng.setAttribute('color', new BufferAttribute(new Float32Array(Array.from({ length: ng.attributes.position.count * 3 }, (_, i) => c[i % 3])), 3));
    return ng;
  };
  for (let i = 0; i < 5; i++) {
    const h = 0.9 + rnd() * 0.7;
    const g = new ConeGeometry(0.025, h, 3);
    g.translate((rnd() - 0.5) * 0.25, h / 2, (rnd() - 0.5) * 0.25);
    parts.push(paint(g, [1, 1, 1]));
  }
  // Two cattail heads (brown regardless of instance tint, which is green).
  for (let i = 0; i < 2; i++) {
    const c = new CylinderGeometry(0.045, 0.045, 0.2, 5);
    c.translate((rnd() - 0.5) * 0.2, 1.25 + rnd() * 0.3, (rnd() - 0.5) * 0.2);
    parts.push(paint(c, [0.9, 0.5, 0.45]));
  }
  return mergeGeometries(parts)!;
}

function pineGeometry() {
  const trunk = new CylinderGeometry(0.12, 0.18, 1.2, 5);
  trunk.translate(0, 0.6, 0);
  const tiers = [0, 1, 2].map((i) => {
    const c = new ConeGeometry(1.2 - i * 0.3, 1.6 - i * 0.2, 7);
    c.translate(0, 1.4 + i * 0.85, 0);
    return c.toNonIndexed();
  });
  const t = trunk.toNonIndexed();
  const setCol = (g: BufferGeometry, c: [number, number, number]) =>
    g.setAttribute('color', new BufferAttribute(new Float32Array(Array.from({ length: g.attributes.position.count * 3 }, (_, i) => c[i % 3])), 3));
  setCol(t, [0.42, 0.3, 0.2]);
  tiers.forEach((g, i) => setCol(g, [0.75 + i * 0.12, 0.85 + i * 0.1, 0.75 + i * 0.1]));
  [t, ...tiers].forEach((g) => g.deleteAttribute('uv'));
  const g = mergeGeometries([t, ...tiers])!;
  g.computeVertexNormals();
  return g;
}

const GRASS: Record<BiomeKind, { density: number; color: string; alt: string; h: [number, number] }> = {
  meadow: { density: 1, color: '#7fbf4d', alt: '#a6cf5a', h: [0.38, 0.62] },
  lake: { density: 0.85, color: '#78b84c', alt: '#98c95a', h: [0.38, 0.6] },
  forest: { density: 0.42, color: '#4d8a36', alt: '#5f9a3a', h: [0.3, 0.5] },
  swamp: { density: 0.7, color: '#6f8a3c', alt: '#8a9a46', h: [0.55, 0.85] },
  highlands: { density: 0.35, color: '#9aa25a', alt: '#b5b06a', h: [0.22, 0.38] },
  scrub: { density: 0.16, color: '#c9ad62', alt: '#d8c07a', h: [0.3, 0.5] },
};

type Inst = { x: number; y: number; z: number; s: number; sy?: number; ry: number; color: Color; tilt?: number };

function useInstances(ref: React.RefObject<InstancedMesh | null>, items: Inst[]) {
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const o = new Object3D();
    items.forEach((it, i) => {
      o.position.set(it.x, it.y, it.z);
      o.rotation.set(it.tilt ?? 0, it.ry, (it.tilt ?? 0) * 0.7);
      o.scale.set(it.s, it.sy ?? it.s, it.s);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      mesh.setColorAt(i, it.color);
    });
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [ref, items]);
}

export function Flora({ terrain, obstacles }: { terrain: TerrainModel; obstacles: Obstacle[] }) {
  const solidKey = obstacles.map((o) => o.id).join(',');
  const data = useMemo(() => {
    const rnd = mulberry32(terrain.key.length * 131 + 7);
    const { fbm, n2 } = terrain.noise;
    const solids = obstacles.filter((o) => o.shape !== 'lake');
    const blocked = (x: number, z: number, pad: number) => {
      for (const l of terrain.lakes) if (Math.hypot(x - l.x, z - l.z) < l.r * 0.93 + pad) return true;
      for (const p of terrain.ponds) if (Math.hypot(x - p.x, z - p.z) < p.r * 1.12 + pad) return true;
      for (const o of solids) {
        if (Math.abs(o.position.x - x) > (o.halfLength ?? o.radius) + 1 || Math.abs(o.position.z - z) > (o.halfLength ?? o.radius) + 1) continue;
        if (obstacleDistance(o, { x, z }) < (o.shape === 'bush' ? -0.3 : 0.05) + pad) return true;
      }
      return false;
    };
    const tint = (hex: string, alt: string, x: number, z: number) => {
      const c = new Color(hex).lerp(new Color(alt), smoothstep(-0.3, 0.4, fbm(x / 6, z / 6, 2)));
      c.offsetHSL((rnd() - 0.5) * 0.03, (rnd() - 0.5) * 0.1, (rnd() - 0.5) * 0.08);
      return c;
    };

    const grass: Inst[] = [];
    const flowers: Inst[] = [];
    const pebbles: Inst[] = [];
    const reeds: Inst[] = [];
    const lim = terrain.half + 3;
    const N = 34000;
    for (let i = 0; i < N; i++) {
      const x = (rnd() * 2 - 1) * lim;
      const z = (rnd() * 2 - 1) * lim;
      const kind = terrain.biomeAt(x, z);
      const g = GRASS[kind];
      const clump = 0.35 + 0.65 * smoothstep(-0.35, 0.35, fbm(x / 5 + 11, z / 5 - 4, 2));
      if (rnd() > g.density * clump) continue;
      if (blocked(x, z, 0)) continue;
      const y = terrain.height(x, z);
      if (y < terrain.lakeLevel + 0.02) continue;
      const hs = g.h[0] + rnd() * (g.h[1] - g.h[0]);
      grass.push({ x, y: y - 0.02, z, s: 0.9 + rnd() * 0.5, sy: hs * 0.9, ry: rnd() * Math.PI * 2, color: tint(g.color, g.alt, x, z) });
    }
    const FLOWER_COLORS = ['#fff6e0', '#ffd23f', '#f78fb3', '#b39ddb', '#ff9f68', '#ffffff'];
    for (let i = 0; i < 5200; i++) {
      const x = (rnd() * 2 - 1) * terrain.half;
      const z = (rnd() * 2 - 1) * terrain.half;
      const kind = terrain.biomeAt(x, z);
      const d = kind === 'meadow' ? 1 : kind === 'lake' ? 0.55 : kind === 'forest' ? 0.12 : kind === 'highlands' ? 0.15 : 0;
      const bloom = smoothstep(0.05, 0.4, n2(x / 9 + 3, z / 9 + 8));
      if (rnd() > d * bloom) continue;
      if (blocked(x, z, 0.1)) continue;
      const pal = kind === 'highlands' ? ['#b39ddb', '#fff6e0'] : FLOWER_COLORS;
      // Patches share a hue, like real wildflower drifts.
      const ci = Math.floor(((n2(x / 4, z / 4) + 1) / 2) * pal.length) % pal.length;
      flowers.push({ x, y: terrain.height(x, z), z, s: 0.8 + rnd() * 0.6, ry: rnd() * 6.28, color: new Color(rnd() < 0.8 ? pal[ci] : pal[Math.floor(rnd() * pal.length)]), tilt: (rnd() - 0.5) * 0.3 });
    }
    for (let i = 0; i < 4200; i++) {
      const x = (rnd() * 2 - 1) * terrain.half;
      const z = (rnd() * 2 - 1) * terrain.half;
      const kind = terrain.biomeAt(x, z);
      const d = kind === 'highlands' ? 0.5 : kind === 'scrub' ? 0.35 : kind === 'lake' ? 0.08 : 0.04;
      if (rnd() > d) continue;
      if (blocked(x, z, 0.15)) continue;
      const base = kind === 'scrub' ? '#b08a64' : '#8d8a84';
      const c = new Color(base).offsetHSL(0, 0, (rnd() - 0.5) * 0.12);
      pebbles.push({ x, y: terrain.height(x, z) - 0.02, z, s: 0.07 + rnd() ** 2 * 0.22, sy: 0.05 + rnd() * 0.08, ry: rnd() * 6.28, color: c, tilt: (rnd() - 0.5) * 0.6 });
    }
    // Pebbly beaches ring the lakes.
    for (const l of terrain.lakes) {
      for (let i = 0; i < 90; i++) {
        const a = rnd() * Math.PI * 2;
        const r = l.r * (0.88 + rnd() * 0.18);
        const x = l.x + Math.cos(a) * r;
        const z = l.z + Math.sin(a) * r;
        const y = terrain.height(x, z);
        if (y < terrain.lakeLevel - 0.08) continue;
        pebbles.push({ x, y: y - 0.02, z, s: 0.06 + rnd() * 0.14, sy: 0.05 + rnd() * 0.06, ry: rnd() * 6.28, color: new Color('#a59d90').offsetHSL(0, 0, (rnd() - 0.5) * 0.15), tilt: rnd() * 0.5 });
      }
      // Reed beds in the shallows.
      for (let i = 0; i < 70; i++) {
        const a = n2(i * 0.37, l.seed) * Math.PI * 2 + rnd() * 0.6;
        const r = l.r * (0.8 + rnd() * 0.16);
        const x = l.x + Math.cos(a) * r;
        const z = l.z + Math.sin(a) * r;
        const depth = terrain.lakeLevel - terrain.height(x, z);
        if (depth < -0.05 || depth > 0.45) continue;
        reeds.push({ x, y: terrain.height(x, z), z, s: 0.8 + rnd() * 0.5, ry: rnd() * 6.28, color: new Color('#6f9a3e').offsetHSL(0, 0, (rnd() - 0.5) * 0.1), tilt: (rnd() - 0.5) * 0.2 });
      }
    }
    // Swamp reeds.
    for (let i = 0; i < 2500; i++) {
      const x = (rnd() * 2 - 1) * terrain.half;
      const z = (rnd() * 2 - 1) * terrain.half;
      if (terrain.biomeAt(x, z) !== 'swamp' || rnd() > 0.25 || blocked(x, z, 0.2)) continue;
      reeds.push({ x, y: terrain.height(x, z), z, s: 0.7 + rnd() * 0.5, ry: rnd() * 6.28, color: new Color('#7a8a3e').offsetHSL(0, 0, (rnd() - 0.5) * 0.1), tilt: (rnd() - 0.5) * 0.25 });
    }

    // Forests climbing the foothills outside the fence.
    const pines: Inst[] = [];
    for (let i = 0; i < 16000 && pines.length < 1500; i++) {
      const a = rnd() * Math.PI * 2;
      const r = terrain.half + 3 + rnd() ** 1.4 * 120;
      const x = Math.cos(a) * r * 1.2;
      const z = Math.sin(a) * r * 1.2;
      if (Math.max(Math.abs(x), Math.abs(z)) < terrain.half + 5) continue;
      const y = terrain.height(x, z);
      const [, ny] = terrain.normal(x, z);
      const band = smoothstep(17, 10, y) * smoothstep(0.72, 0.88, ny) * 0.8;
      const patch = smoothstep(-0.25, 0.2, fbm(x / 22, z / 22, 2));
      if (rnd() > band * patch) continue;
      const s = 0.9 + rnd() * 1.0;
      const c = new Color(rnd() < 0.15 ? '#4a7a3a' : '#2f5a30').offsetHSL((rnd() - 0.5) * 0.03, 0, (rnd() - 0.5) * 0.08);
      pines.push({ x, y: y - 0.3, z, s, sy: s * (0.9 + rnd() * 0.5), ry: rnd() * 6.28, color: c });
    }
    return { grass, flowers, pebbles, reeds, pines };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrain, solidKey]);

  const geos = useMemo(
    () => ({
      tuft: tuftGeometry(9, 3),
      flower: flowerGeometry(),
      pebble: new DodecahedronGeometry(1, 0),
      reed: reedGeometry(),
      pine: pineGeometry(),
    }),
    [],
  );
  const mats = useMemo(
    () => ({
      grass: windMaterial({ vertexColors: true, roughness: 0.9 }),
      flower: windMaterial({ vertexColors: true, roughness: 0.7 }, 1.4),
      reed: windMaterial({ vertexColors: true, roughness: 0.85, flatShading: true }, 2.5),
      pebble: new MeshStandardMaterial({ roughness: 0.95, flatShading: true }),
      pine: new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }),
    }),
    [],
  );
  useEffect(() => () => Object.values(geos).forEach((g) => g.dispose()), [geos]);

  const grassRef = useRef<InstancedMesh>(null);
  const flowerRef = useRef<InstancedMesh>(null);
  const pebbleRef = useRef<InstancedMesh>(null);
  const reedRef = useRef<InstancedMesh>(null);
  const pineRef = useRef<InstancedMesh>(null);
  useInstances(grassRef, data.grass);
  useInstances(flowerRef, data.flowers);
  useInstances(pebbleRef, data.pebbles);
  useInstances(reedRef, data.reeds);
  useInstances(pineRef, data.pines);

  // Instance counts are upper bounds; useInstances sets the live count.
  return (
    <group>
      <instancedMesh ref={grassRef} args={[geos.tuft, mats.grass, Math.max(1, data.grass.length)]} receiveShadow frustumCulled={false} />
      <instancedMesh ref={flowerRef} args={[geos.flower, mats.flower, Math.max(1, data.flowers.length)]} frustumCulled={false} />
      <instancedMesh ref={pebbleRef} args={[geos.pebble, mats.pebble, Math.max(1, data.pebbles.length)]} receiveShadow castShadow frustumCulled={false} />
      <instancedMesh ref={reedRef} args={[geos.reed, mats.reed, Math.max(1, data.reeds.length)]} castShadow frustumCulled={false} />
      <instancedMesh ref={pineRef} args={[geos.pine, mats.pine, Math.max(1, data.pines.length)]} frustumCulled={false} />
    </group>
  );
}

