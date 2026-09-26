import { useMemo } from 'react';
import { BufferAttribute, Color, PlaneGeometry } from 'three';
import { BIOMES } from '../shared/catalog';
import { CONFIG } from '../shared/config';
import type { Biome } from '../shared/types';

/** Ground plane coloured per biome (nearest site), with subtle noise. Visual only; the sim is flat. */
export function Terrain({ biomes, seed, onClick }: { biomes: Biome[]; seed: number; onClick: () => void }) {
  const geometry = useMemo(() => {
    const size = CONFIG.worldSize;
    const g = new PlaneGeometry(size, size, 160, 160);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      // Blend the two nearest biomes near borders for a softer edge.
      const ds = biomes.map((b) => ({ b, d: Math.hypot(b.site.x - x, b.site.z - z) })).sort((a, b) => a.d - b.d);
      const [n1, n2] = ds;
      c.set(BIOMES[n1.b.kind].color);
      if (n2) {
        const t = Math.max(0, 1 - (n2.d - n1.d) / 3) * 0.5;
        c.lerp(new Color(BIOMES[n2.b.kind].color), t);
      }
      const noise = Math.sin(x * 1.7 + seed) * Math.cos(z * 1.3 - seed) * 0.04 + Math.sin(x * 0.31 + z * 0.27) * 0.03;
      c.offsetHSL(0, 0, noise);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new BufferAttribute(colors, 3));
    return g;
  }, [biomes, seed]);

  return (
    <mesh geometry={geometry} receiveShadow onClick={onClick}>
      <meshStandardMaterial vertexColors roughness={0.95} />
    </mesh>
  );
}
