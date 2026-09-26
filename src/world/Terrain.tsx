import { useMemo } from 'react';
import { BufferAttribute, Color, PlaneGeometry } from 'three';
import { BIOMES } from '../shared/catalog';
import { CONFIG } from '../shared/config';
import type { Biome } from '../shared/types';

/** Max visual dip below the (flat) sim ground; always <= 0 so flat decals and water discs stay visible. */
const DEPTH = 0.12;

/** Ground coloured per biome (nearest sites blended), with gentle visual-only undulation. The sim is flat. */
export function Terrain({ biomes, seed, onClick }: { biomes: Biome[]; seed: number; onClick: () => void }) {
  const geometry = useMemo(() => {
    const size = CONFIG.worldSize;
    const g = new PlaneGeometry(size, size, 160, 160);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new Color();
    const c2 = new Color();
    const s = seed * 0.137;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const ds = biomes.map((b) => ({ b, d: Math.hypot(b.site.x - x, b.site.z - z) })).sort((a, b) => a.d - b.d);
      const [n1, n2] = ds;
      c.set(BIOMES[n1.b.kind].color);
      if (n2) {
        const t = Math.max(0, 1 - (n2.d - n1.d) / 4) * 0.5;
        c.lerp(c2.set(BIOMES[n2.b.kind].color), t);
      }
      // Undulation in [0,1]: broad swells plus a finer ripple.
      const u =
        0.5 +
        0.3 * Math.sin(x * 0.21 + s) * Math.cos(z * 0.18 - s * 1.3) +
        0.15 * Math.sin(x * 0.53 + z * 0.41 + s * 2.1) +
        0.05 * Math.sin(x * 1.3 - s) * Math.sin(z * 1.1 + s);
      const h = Math.min(1, Math.max(0, u));
      const edge = Math.min(1, (size / 2 - Math.max(Math.abs(x), Math.abs(z))) / 2);
      pos.setY(i, -DEPTH * h * edge);
      const patch = Math.sin(x * 0.9 + seed) * Math.cos(z * 0.75 - seed) * 0.035 + Math.sin(x * 0.31 + z * 0.27) * 0.03;
      const fleck = (Math.sin(x * 12.9898 + z * 78.233 + seed) * 43758.5453) % 1;
      c.offsetHSL(0.004 * Math.sin(x * 0.4 - z * 0.3), 0.03 * (h - 0.5), patch - 0.05 * h + fleck * 0.02);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  }, [biomes, seed]);

  return (
    <mesh geometry={geometry} receiveShadow onClick={onClick}>
      <meshStandardMaterial vertexColors roughness={0.95} />
    </mesh>
  );
}
