import { useFrame } from '@react-three/fiber';
import { memo, useEffect, useMemo, useRef } from 'react';
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  type Group,
  type InstancedMesh,
  type Mesh,
  Object3D,
  RingGeometry,
  SRGBColorSpace,
} from 'three';
import { HAZARDS } from '../shared/catalog';
import type { GroundItem, Hazard, Obstacle, Structure } from '../shared/types';
import { ITEM_COLOR } from './Creature';
import { hashRng } from './noise';
import { ROCK_LOOKS, Sway, displace, faceNoise, foliageGeometry, paintFaces, radialTexture, rockGeometry, type RockLook } from './props';
import type { TerrainModel } from './terrain-model';

type P3 = [number, number, number];

const rockLookAt = (terrain: TerrainModel, x: number, z: number): RockLook => {
  const k = terrain.biomeAt(x, z);
  return k === 'scrub' ? ROCK_LOOKS.sandstone : k === 'highlands' ? ROCK_LOOKS.granite : k === 'swamp' ? ROCK_LOOKS.swampy : k === 'forest' ? ROCK_LOOKS.mossy : ROCK_LOOKS.granite;
};

/** Lowest ground under a footprint, so props on slopes never float. */
const minHeight = (t: TerrainModel, x: number, z: number, r: number) => {
  let h = t.height(x, z);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    h = Math.min(h, t.height(x + Math.cos(a) * r, z + Math.sin(a) * r));
  }
  return h;
};

function Rock({ o, terrain }: { o: Obstacle; terrain: TerrainModel }) {
  const { x, z } = o.position;
  const parts = useMemo(() => {
    const rnd = hashRng(o.id);
    const look = rockLookAt(terrain, x, z);
    const big = o.shape === 'boulder';
    const main = rockGeometry(rnd() * 100, look, big ? 2 : 1, big ? 0.24 : 0.3);
    const out: { g: ReturnType<typeof rockGeometry>; p: P3; s: P3; r: P3 }[] = [];
    const base = minHeight(terrain, x, z, o.radius * 0.8);
    const hy = o.height / 2;
    out.push({ g: main, p: [0, base + hy * 0.55 - 0.1, 0], s: [o.radius * 1.02, hy, o.radius * (0.85 + rnd() * 0.2)], r: [0, rnd() * 6.28, (rnd() - 0.5) * 0.15] });
    if (big && rnd() < 0.7) {
      const a = rnd() * 6.28;
      const g2 = rockGeometry(rnd() * 100, look, 1, 0.3);
      const s = o.radius * 0.55;
      out.push({ g: g2, p: [Math.cos(a) * o.radius * 0.75, base + s * 0.5, Math.sin(a) * o.radius * 0.75], s: [s, s * 0.8, s * 0.9], r: [0.3, rnd() * 6.28, 0.2] });
    }
    // Scatter of small stones around the base.
    const n = big ? 4 : 3;
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.28;
      const d = o.radius * (1.05 + rnd() * 0.35);
      const s = 0.12 + rnd() * 0.18;
      const px = Math.cos(a) * d;
      const pz = Math.sin(a) * d;
      out.push({ g: rockGeometry(rnd() * 100, look, 0, 0.3), p: [px, terrain.height(x + px, z + pz) + s * 0.3, pz], s: [s, s * 0.7, s], r: [rnd(), rnd() * 6.28, 0] });
    }
    return out;
  }, [o.id, o.radius, o.height, o.shape, terrain, x, z]);
  useEffect(() => () => parts.forEach((p) => p.g.dispose()), [parts]);
  return (
    <group position={[x, 0, z]}>
      {parts.map((p, i) => (
        <mesh key={i} geometry={p.g} position={p.p} scale={p.s} rotation={p.r} castShadow receiveShadow>
          <meshStandardMaterial vertexColors flatShading roughness={0.92} />
        </mesh>
      ))}
    </group>
  );
}

type TreeStyle = 'pine' | 'broadleaf' | 'swamp' | 'acacia';

function treeStyle(terrain: TerrainModel, o: Obstacle, rnd: () => number): TreeStyle {
  const k = terrain.biomeAt(o.position.x, o.position.z);
  if (k === 'swamp') return 'swamp';
  if (k === 'scrub') return 'acacia';
  if (k === 'highlands') return 'pine';
  if (k === 'forest') return rnd() < 0.62 ? 'pine' : 'broadleaf';
  return rnd() < 0.2 ? 'pine' : 'broadleaf';
}

function barkGeometry(r0: number, r1: number, h: number, seed: number, color = '#5b3f28') {
  const g = displace(new CylinderGeometry(r1, r0, h, 7, 3), 0.1, 3, seed);
  const base = new Color(color);
  const c = new Color();
  return paintFaces(g, (_ny, cy, cx, cz) => c.copy(base).offsetHSL(0, 0, faceNoise(cx * 3, cy * 4, cz * 3) * 0.06));
}

function Tree({ o, terrain }: { o: Obstacle; terrain: TerrainModel }) {
  const { x, z } = o.position;
  const model = useMemo(() => {
    const rnd = hashRng(o.id);
    const style = treeStyle(terrain, o, rnd);
    const H = o.height;
    const R = o.radius;
    const seed = rnd() * 100;
    const trunk: { g: ReturnType<typeof barkGeometry>; p: P3; r: P3 }[] = [];
    const leaves: { g: ReturnType<typeof foliageGeometry>; p: P3; s: P3; r?: P3 }[] = [];
    const strands: { p: P3; h: number }[] = [];
    if (style === 'pine') {
      const th = H * 0.32;
      trunk.push({ g: barkGeometry(R * 0.5, R * 0.32, th, seed, '#5a3d27'), p: [0, th / 2, 0], r: [0, 0, 0] });
      const tiers = 4;
      const greens = ['#24492a', '#2c5a31', '#356a37', '#3f7a3d'];
      for (let i = 0; i < tiers; i++) {
        const f = i / (tiers - 1);
        const rad = R * (3.4 - f * 2.2) * (0.92 + rnd() * 0.16);
        const ch = H * (0.36 - f * 0.08);
        const g = displace(new ConeGeometry(1, 1, 9, 2), 0.1, 2.2, seed + i);
        const c = new Color();
        const col = new Color(greens[i]);
        const tip = new Color('#6f9a4a');
        paintFaces(g, (ny, cy) => c.copy(col).lerp(tip, Math.max(0, cy) * 0.35 + Math.max(0, ny - 0.5) * 0.2).offsetHSL(0, 0, (rnd() - 0.5) * 0.04));
        leaves.push({ g, p: [0, H * 0.24 + f * H * 0.56 + ch / 2, 0], s: [rad, ch, rad], r: [0, rnd() * 6.28, 0] });
      }
    } else if (style === 'broadleaf') {
      const th = H * 0.5;
      const lean = (rnd() - 0.5) * 0.12;
      trunk.push({ g: barkGeometry(R * 0.55, R * 0.34, th, seed, '#5d4129'), p: [0, th / 2, 0], r: [lean, 0, lean] });
      for (let i = 0; i < 2; i++) {
        const a = rnd() * 6.28;
        trunk.push({ g: barkGeometry(R * 0.2, R * 0.1, H * 0.28, seed + i + 3, '#5d4129'), p: [Math.cos(a) * R * 0.5, th * 0.85, Math.sin(a) * R * 0.5], r: [Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7] });
      }
      const blobs = 5 + Math.floor(rnd() * 3);
      const pal = rnd() < 0.5 ? ['#2f6a2c', '#4a8f3a', '#8cc257'] : ['#346d2d', '#56963f', '#9ccb5e'];
      for (let i = 0; i < blobs; i++) {
        const a = (i / blobs) * 6.28 + rnd();
        const d = i === 0 ? 0 : R * (1.6 + rnd() * 0.9);
        const s = R * (2.2 + rnd() * 0.9) * (i === 0 ? 1.25 : 1);
        leaves.push({ g: foliageGeometry(seed + i * 7, pal[0], pal[1], pal[2]), p: [Math.cos(a) * d, H * (0.66 + rnd() * 0.18) + (i === 0 ? H * 0.1 : 0), Math.sin(a) * d], s: [s, s * 0.82, s] });
      }
    } else if (style === 'swamp') {
      const th = H * 0.62;
      trunk.push({ g: barkGeometry(R * 0.7, R * 0.3, th, seed, '#3f3326'), p: [0, th / 2, 0], r: [(rnd() - 0.5) * 0.25, 0, (rnd() - 0.5) * 0.25] });
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * 6.28 + rnd();
        trunk.push({ g: barkGeometry(R * 0.28, R * 0.08, R * 2.2, seed + i, '#3f3326'), p: [Math.cos(a) * R * 0.7, R * 0.45, Math.sin(a) * R * 0.7], r: [Math.sin(a) * 1.1, 0, -Math.cos(a) * 1.1] });
      }
      const blobs = 4;
      for (let i = 0; i < blobs; i++) {
        const a = (i / blobs) * 6.28 + rnd();
        const d = i === 0 ? 0 : R * 1.9;
        const s = R * (2.3 + rnd() * 0.7);
        const p: P3 = [Math.cos(a) * d, th + R * (0.3 + rnd() * 0.6), Math.sin(a) * d];
        leaves.push({ g: foliageGeometry(seed + i * 5, '#3a4a26', '#56693a', '#7d8f4c'), p, s: [s, s * 0.45, s] });
        for (let k = 0; k < 5; k++) {
          const b = rnd() * 6.28;
          const rr = s * (0.5 + rnd() * 0.45);
          strands.push({ p: [p[0] + Math.cos(b) * rr, p[1] - s * 0.25, p[2] + Math.sin(b) * rr], h: 0.6 + rnd() * 1.1 });
        }
      }
    } else {
      // Acacia: bent trunk, wide flat umbrella canopy.
      const th = H * 0.62;
      trunk.push({ g: barkGeometry(R * 0.45, R * 0.25, th, seed, '#6b4a30'), p: [0, th / 2, 0], r: [0.1, 0, -0.12] });
      trunk.push({ g: barkGeometry(R * 0.22, R * 0.12, H * 0.35, seed + 1, '#6b4a30'), p: [R * 0.7, th * 0.9, 0], r: [0, 0, -0.8] });
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * 6.28 + rnd();
        const s = R * (2.4 + rnd() * 0.8);
        leaves.push({ g: foliageGeometry(seed + i * 3, '#55672f', '#7a8c3c', '#a3ad55', 1, 0.18), p: [Math.cos(a) * R * 1.4, th + R * 0.5, Math.sin(a) * R * 1.4], s: [s, s * 0.28, s] });
      }
    }
    return { style, trunk, leaves, strands, base: minHeight(terrain, x, z, R * 0.7) - 0.08, sway: rnd() };
  }, [o, terrain, x, z]);
  useEffect(() => () => [...model.trunk, ...model.leaves].forEach((p) => p.g.dispose()), [model]);
  return (
    <group position={[x, model.base, z]}>
      {model.trunk.map((t, i) => (
        <mesh key={i} geometry={t.g} position={t.p} rotation={t.r} castShadow receiveShadow>
          <meshStandardMaterial vertexColors flatShading roughness={0.95} />
        </mesh>
      ))}
      <Sway amount={model.style === 'pine' ? 0.012 : 0.02} speed={0.7 + model.sway * 0.4} seed={model.sway}>
        {model.leaves.map((l, i) => (
          <mesh key={i} geometry={l.g} position={l.p} scale={l.s} rotation={l.r ?? [0, 0, 0]} castShadow receiveShadow>
            <meshStandardMaterial vertexColors flatShading roughness={0.85} />
          </mesh>
        ))}
        {model.strands.map((s, i) => (
          <mesh key={i} position={[s.p[0], s.p[1] - s.h / 2, s.p[2]]} rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.07, s.h, 4]} />
            <meshStandardMaterial color="#8d9a5c" flatShading roughness={1} />
          </mesh>
        ))}
      </Sway>
    </group>
  );
}

/** Narrow a unit box toward its top (and skew it), turning blocks into weathered rock slabs. */
function taper<G extends ReturnType<typeof displace>>(g: G, top: number, skew: number) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) + 0.5;
    const k = 1 - (1 - top) * t;
    p.setXYZ(i, p.getX(i) * k + skew * t * 0.5, p.getY(i), p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

function Cliff({ o, terrain }: { o: Obstacle; terrain: TerrainModel }) {
  const { x, z } = o.position;
  const a = o.angle ?? 0;
  const parts = useMemo(() => {
    const rnd = hashRng(o.id);
    const L = (o.halfLength ?? 1) * 2;
    const n = Math.max(3, Math.ceil(L / 1.35));
    const seed = rnd() * 100;
    const light = new Color('#aa9f8e');
    const mid = new Color('#8f8575');
    const dark = new Color('#6f6659');
    const cap = new Color('#7f8f55');
    const out: { g: ReturnType<typeof displace>; p: P3; r: P3; s: P3 }[] = [];
    const c = new Color();
    for (let i = 0; i < n; i++) {
      const f = n === 1 ? 0.5 : i / (n - 1);
      const lx = -L / 2 + 0.65 + f * (L - 1.3);
      const wx = x + Math.cos(a) * lx;
      const wz = z + Math.sin(a) * lx;
      const base = minHeight(terrain, wx, wz, 0.9) - 0.35;
      const h = o.height * (0.45 + 0.45 * Math.sin(Math.PI * f) + rnd() * 0.35);
      const g = taper(displace(new BoxGeometry(1, 1, 1, 2, 4, 2), 0.18, 1.6, seed + i * 3.1), 0.45 + rnd() * 0.35, (rnd() - 0.5) * 0.35);
      // Sedimentary strata in world height, grassy caps on top faces.
      paintFaces(g, (ny, cy, cx, cz) => {
        const wy = base + (cy + 0.5) * h;
        const band = Math.sin(wy * 3.1 + faceNoise(cx, cy, cz, 2) * 1.2);
        c.copy(mid).lerp(band > 0.3 ? light : dark, Math.abs(band) * 0.6);
        c.multiplyScalar(0.85 + 0.2 * Math.max(0, ny));
        if (ny > 0.7) c.copy(cap).offsetHSL(0, 0, faceNoise(cx * 3, cy, cz * 3) * 0.06);
        return c;
      });
      out.push({ g, p: [lx, base + h / 2, (rnd() - 0.5) * 0.25], r: [(rnd() - 0.5) * 0.14, (rnd() - 0.5) * 0.9, (rnd() - 0.5) * 0.16], s: [1.4 + rnd() * 0.6, h, 1.6 + rnd() * 0.4] });
      if (rnd() < 0.45) {
        const g2 = displace(new BoxGeometry(1, 1, 1, 1, 2, 1), 0.2, 1.8, seed + i * 7.7);
        paintFaces(g2, (ny) => c.copy(ny > 0.7 ? cap : mid).offsetHSL(0, 0, (rnd() - 0.5) * 0.05));
        const hh = 0.6 + rnd() * 0.9;
        out.push({ g: g2, p: [lx + (rnd() - 0.5) * 0.4, base + h + hh / 2 - 0.15, 0], r: [0, rnd(), (rnd() - 0.5) * 0.3], s: [0.8 + rnd() * 0.4, hh, 0.9] });
      }
    }
    // Scree at the foot of the ridge, inside the collision margin.
    for (let i = 0; i < Math.ceil(L * 0.9); i++) {
      const lx = (rnd() - 0.5) * L;
      const lz = (rnd() < 0.5 ? -1 : 1) * (1.0 + rnd() * 0.35);
      const wx = x + Math.cos(a) * lx - Math.sin(a) * lz;
      const wz = z + Math.sin(a) * lx + Math.cos(a) * lz;
      const s = 0.12 + rnd() * 0.22;
      out.push({ g: rockGeometry(rnd() * 100, ROCK_LOOKS.granite, 0, 0.3), p: [lx, terrain.height(wx, wz) + s * 0.25, lz], r: [rnd(), rnd() * 6, 0], s: [s, s * 0.7, s] });
    }
    return out;
  }, [o, terrain, x, z, a]);
  useEffect(() => () => parts.forEach((p) => p.g.dispose()), [parts]);
  return (
    <group position={[x, 0, z]} rotation={[0, -a, 0]}>
      {parts.map((p, i) => (
        <mesh key={i} geometry={p.g} position={p.p} rotation={p.r} scale={p.s} castShadow receiveShadow>
          <meshStandardMaterial vertexColors flatShading roughness={0.93} />
        </mesh>
      ))}
    </group>
  );
}

function Log({ o, terrain }: { o: Obstacle; terrain: TerrainModel }) {
  const { x, z } = o.position;
  const a = o.angle ?? 0;
  const hl = o.halfLength ?? 1;
  const m = useMemo(() => {
    const rnd = hashRng(o.id);
    const ha = terrain.height(x - Math.cos(a) * hl, z - Math.sin(a) * hl);
    const hb = terrain.height(x + Math.cos(a) * hl, z + Math.sin(a) * hl);
    const pitch = Math.atan2(hb - ha, hl * 2);
    const bark = displace(new CylinderGeometry(o.radius, o.radius * 1.05, hl * 2, 10, 5, true), 0.08, 2.5, rnd() * 100);
    const c = new Color();
    const b0 = new Color('#5a412c');
    const b1 = new Color('#3f2d1f');
    const moss = new Color('#6f9a3a');
    const k = terrain.biomeAt(x, z);
    const mossy = k === 'forest' || k === 'swamp';
    paintFaces(bark, (_ny, cy, cx, cz) => {
      c.copy(b0).lerp(b1, Math.abs(faceNoise(cx * 6, cy * 1.5, cz * 6)) * 1.3);
      // Local +x of the cylinder becomes world-up after the roll below.
      if (mossy && cx > o.radius * 0.45 && faceNoise(cx, cy * 1.2, cz, 2) > -0.1) c.copy(moss).offsetHSL(0, 0, faceNoise(cy, cx, cz, 5) * 0.05);
      return c;
    });
    return { bark, pitch, y: (ha + hb) / 2 + o.radius * 0.85, mossy, fungus: rnd() < 0.6, stub: rnd() * hl - hl / 2 };
  }, [o, terrain, x, z, a, hl]);
  useEffect(() => () => m.bark.dispose(), [m]);
  return (
    <group position={[x, m.y, z]} rotation={[0, -a, 0]}>
      <group rotation={[0, 0, m.pitch]}>
        <mesh geometry={m.bark} rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
          <meshStandardMaterial vertexColors flatShading roughness={0.95} />
        </mesh>
        {[-1, 1].map((side) => (
          <group key={side} position={[side * hl, 0, 0]} rotation={[0, side * (Math.PI / 2), 0]}>
            <mesh>
              <circleGeometry args={[o.radius * 0.98, 10]} />
              <meshStandardMaterial color="#c9a579" roughness={0.9} />
            </mesh>
            {[0.35, 0.65].map((f) => (
              <mesh key={f} position={[0, 0, 0.005]}>
                <ringGeometry args={[o.radius * f, o.radius * f + 0.025, 16]} />
                <meshStandardMaterial color="#9a7550" roughness={0.9} />
              </mesh>
            ))}
          </group>
        ))}
        <mesh position={[m.stub, o.radius * 0.6, 0.12]} rotation={[0.5, 0, 0.3]} castShadow>
          <cylinderGeometry args={[0.05, 0.08, 0.55, 5]} />
          <meshStandardMaterial color="#4f3a28" flatShading />
        </mesh>
        {m.fungus &&
          [0, 1, 2].map((i) => (
            <mesh key={i} position={[m.stub * 0.5 + i * 0.22 - 0.2, 0.05 - i * 0.08, o.radius * 0.92]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 0.35]}>
              <cylinderGeometry args={[0.13 - i * 0.02, 0.13 - i * 0.02, 0.06, 10, 1, false, 0, Math.PI]} />
              <meshStandardMaterial color={m.mossy ? '#d8c39a' : '#c9a36a'} roughness={0.7} />
            </mesh>
          ))}
      </group>
    </group>
  );
}

function Bush({ o, terrain }: { o: Obstacle; terrain: TerrainModel }) {
  const { x, z } = o.position;
  const m = useMemo(() => {
    const rnd = hashRng(o.id);
    const k = terrain.biomeAt(x, z);
    const pal = k === 'swamp' ? ['#3b4d27', '#5a6d38', '#869a4f'] : k === 'forest' ? ['#264f24', '#3d7532', '#6fa549'] : ['#2f6127', '#4d8b37', '#8dc05a'];
    const blobs = Array.from({ length: 5 + Math.floor(rnd() * 3) }, (_, i) => {
      const a = (i / 6) * 6.28 + rnd();
      const d = i === 0 ? 0 : o.radius * (0.45 + rnd() * 0.3);
      const s = o.radius * (0.48 + rnd() * 0.25) * (i === 0 ? 1.2 : 1);
      return { g: foliageGeometry(rnd() * 100, pal[0], pal[1], pal[2]), p: [Math.cos(a) * d, s * 0.62, Math.sin(a) * d] as P3, s };
    });
    const flowers =
      k === 'meadow' || k === 'lake'
        ? Array.from({ length: 7 }, () => {
            const a = rnd() * 6.28;
            const b = blobs[Math.floor(rnd() * blobs.length)];
            return { p: [b.p[0] + Math.cos(a) * b.s * 0.8, b.p[1] + b.s * 0.45, b.p[2] + Math.sin(a) * b.s * 0.8] as P3, c: rnd() < 0.5 ? '#fff4f0' : '#f6a6c1' };
          })
        : [];
    return { blobs, flowers, y: minHeight(terrain, x, z, o.radius * 0.6) - 0.05, seed: rnd() };
  }, [o, terrain, x, z]);
  useEffect(() => () => m.blobs.forEach((b) => b.g.dispose()), [m]);
  return (
    <group position={[x, m.y, z]}>
      <Sway amount={0.03} speed={1.1} seed={m.seed}>
        {m.blobs.map((b, i) => (
          <mesh key={i} geometry={b.g} position={b.p} scale={[b.s, b.s * 0.85, b.s]} castShadow receiveShadow>
            <meshStandardMaterial vertexColors flatShading roughness={0.85} />
          </mesh>
        ))}
        {m.flowers.map((f, i) => (
          <mesh key={i} position={f.p}>
            <icosahedronGeometry args={[0.06, 0]} />
            <meshStandardMaterial color={f.c} roughness={0.6} />
          </mesh>
        ))}
      </Sway>
    </group>
  );
}

export const ObstacleMesh = memo(function ObstacleMesh({ o, terrain }: { o: Obstacle; terrain: TerrainModel }) {
  switch (o.shape) {
    case 'rock':
    case 'boulder':
      return <Rock o={o} terrain={terrain} />;
    case 'tree':
      return <Tree o={o} terrain={terrain} />;
    case 'log':
      return <Log o={o} terrain={terrain} />;
    case 'cliff':
      return <Cliff o={o} terrain={terrain} />;
    case 'bush':
      return <Bush o={o} terrain={terrain} />;
    case 'lake':
      return null; // Rendered by Water.tsx as a real basin + shader surface.
  }
});

/** Ground-hugging decal: a disc whose vertices follow the terrain, with a soft radial alpha. */
function Decal({ x, z, r, terrain, color, opacity, roughness = 0.95, lift = 0.04 }: { x: number; z: number; r: number; terrain: TerrainModel; color: string; opacity: number; roughness?: number; lift?: number }) {
  const g = useMemo(() => {
    const g = new RingGeometry(0.001, r, 40, 8);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, Math.max(terrain.height(p.getX(i) + x, p.getZ(i) + z), terrain.lakeLevel) + lift);
    g.computeVertexNormals();
    return g;
  }, [x, z, r, terrain, lift]);
  useEffect(() => () => g.dispose(), [g]);
  return (
    <mesh geometry={g} position={[x, 0, z]} receiveShadow renderOrder={1}>
      <meshStandardMaterial color={color} alphaMap={radialTexture()} transparent opacity={opacity} depthWrite={false} roughness={roughness} polygonOffset polygonOffsetFactor={-1} />
    </mesh>
  );
}

function Brambles({ h, terrain }: { h: Hazard; terrain: TerrainModel }) {
  const items = useMemo(() => {
    const rnd = hashRng(h.id);
    const n = Math.round(h.radius * 3.2);
    return Array.from({ length: n }, () => {
      const a = rnd() * 6.28;
      const d = Math.sqrt(rnd()) * h.radius * 0.85;
      const px = Math.cos(a) * d;
      const pz = Math.sin(a) * d;
      const s = 0.3 + rnd() * 0.3;
      const g = foliageGeometry(rnd() * 100, '#2b1f2b', '#4a3348', '#6b4a63', 0, 0.35);
      const spikes = Array.from({ length: 7 }, () => {
        const u = rnd() * 6.28;
        const v = rnd() * 1.2 - 0.2;
        return { p: [Math.cos(u) * Math.cos(v), Math.sin(v) * 0.7, Math.sin(u) * Math.cos(v)] as P3, r: [Math.cos(u) * 1.2, 0, -Math.sin(u) * 1.2] as P3 };
      });
      return { g, p: [px, terrain.height(h.position.x + px, h.position.z + pz) + s * 0.45, pz] as P3, s, spikes };
    });
  }, [h, terrain]);
  useEffect(() => () => items.forEach((i) => i.g.dispose()), [items]);
  return (
    <>
      {items.map((b, i) => (
        <group key={i} position={b.p} scale={b.s}>
          <mesh geometry={b.g} scale={[1, 0.7, 1]} castShadow>
            <meshStandardMaterial vertexColors flatShading roughness={0.9} />
          </mesh>
          {b.spikes.map((s, k) => (
            <mesh key={k} position={s.p} rotation={s.r}>
              <coneGeometry args={[0.06, 0.4, 4]} />
              <meshStandardMaterial color="#d9cbb0" roughness={0.6} />
            </mesh>
          ))}
        </group>
      ))}
    </>
  );
}

function Swarm({ h, terrain }: { h: Hazard; terrain: TerrainModel }) {
  const ref = useRef<InstancedMesh>(null);
  const n = 22;
  const seeds = useMemo(() => {
    const rnd = hashRng(h.id);
    return Array.from({ length: n }, () => [rnd() * 10, 0.6 + rnd() * 0.8, rnd() * 10, rnd()] as const);
  }, [h.id]);
  const y0 = terrain.height(h.position.x, h.position.z);
  const o = useMemo(() => new Object3D(), []);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const t = clock.elapsedTime;
    const R = h.radius * 0.55;
    seeds.forEach(([a, sp, b, c], i) => {
      o.position.set(Math.sin(t * sp * 3 + a) * R * (0.4 + c * 0.6), y0 + 1.2 + Math.sin(t * sp * 5 + b) * 0.6, Math.cos(t * sp * 2.6 + b) * R * (0.4 + c * 0.6));
      o.rotation.y = t * sp * 3 + a;
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, n]} frustumCulled={false}>
      <sphereGeometry args={[0.06, 6, 4]} />
      <meshStandardMaterial color="#ffc400" emissive="#3a2a00" roughness={0.4} />
    </instancedMesh>
  );
}

function Snakes({ h, terrain }: { h: Hazard; terrain: TerrainModel }) {
  const ref = useRef<Group>(null);
  const SEG = 12;
  const tufts = useMemo(() => {
    const rnd = hashRng(h.id);
    return Array.from({ length: Math.round(h.radius * 4) }, () => {
      const a = rnd() * 6.28;
      const d = Math.sqrt(rnd()) * h.radius * 0.9;
      const px = Math.cos(a) * d;
      const pz = Math.sin(a) * d;
      return { p: [px, terrain.height(h.position.x + px, h.position.z + pz), pz] as P3, s: 0.6 + rnd() * 0.6, r: rnd() * 6 };
    });
  }, [h, terrain]);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const t = clock.elapsedTime * 0.35;
    g.children.forEach((snake, si) => {
      snake.children.forEach((seg, i) => {
        const u = t + si * 3.1 - i * 0.045;
        const R = h.radius * (0.45 + 0.1 * si);
        const wig = Math.sin(u * 22 + i * 0.9) * 0.18;
        const x = Math.cos(u) * (R + wig);
        const z = Math.sin(u) * (R + wig);
        seg.position.set(x, terrain.height(h.position.x + x, h.position.z + z) + 0.07, z);
      });
    });
  });
  return (
    <>
      {tufts.map((t, i) => (
        <group key={i} position={t.p} rotation={[0, t.r, 0]} scale={t.s}>
          {[-0.08, 0, 0.08].map((dx, k) => (
            <mesh key={k} position={[dx, 0.3, dx * 0.5]} rotation={[dx * 2, 0, dx * 3]}>
              <coneGeometry args={[0.04, 0.65, 3]} />
              <meshStandardMaterial color={k === 1 ? '#c9ae6a' : '#b39458'} flatShading />
            </mesh>
          ))}
        </group>
      ))}
      <group ref={ref}>
        {[0, 1].map((si) => (
          <group key={si}>
            {Array.from({ length: SEG }).map((_, i) => (
              <mesh key={i} scale={[1, 0.7, 1]} castShadow>
                <sphereGeometry args={[i === 0 ? 0.095 : 0.08 * (1 - (i / SEG) * 0.6), 7, 5]} />
                <meshStandardMaterial color={i === 0 ? '#4a5226' : i % 3 === 0 ? '#2e3318' : '#6b7436'} roughness={0.5} />
              </mesh>
            ))}
          </group>
        ))}
      </group>
    </>
  );
}

function Rockfall({ h, terrain }: { h: Hazard; terrain: TerrainModel }) {
  const falling = useRef<Mesh>(null);
  const dust = useRef<Mesh>(null);
  const rubble = useMemo(() => {
    const rnd = hashRng(h.id);
    return Array.from({ length: Math.round(h.radius * 5) }, () => {
      const a = rnd() * 6.28;
      const d = Math.sqrt(rnd()) * h.radius * 0.9;
      const px = Math.cos(a) * d;
      const pz = Math.sin(a) * d;
      const s = 0.12 + rnd() ** 2 * 0.35;
      return { g: rockGeometry(rnd() * 100, ROCK_LOOKS.granite, 0, 0.35), p: [px, terrain.height(h.position.x + px, h.position.z + pz) + s * 0.3, pz] as P3, s, r: rnd() * 6 };
    });
  }, [h, terrain]);
  const fallGeo = useMemo(() => rockGeometry(7, ROCK_LOOKS.granite, 0, 0.3), []);
  useEffect(() => () => [...rubble.map((r) => r.g), fallGeo].forEach((g) => g.dispose()), [rubble, fallGeo]);
  const st = useRef({ start: -10, x: 0, z: 0 });
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const s = st.current;
    if (t - s.start > 5 + (h.id.length % 3)) {
      s.start = t;
      const a = Math.random() * 6.28;
      const d = Math.random() * h.radius * 0.7;
      s.x = Math.cos(a) * d;
      s.z = Math.sin(a) * d;
    }
    const e = t - s.start;
    const ground = terrain.height(h.position.x + s.x, h.position.z + s.z) + 0.15;
    const y = Math.max(ground, 8 - 0.5 * 18 * e * e);
    if (falling.current) {
      falling.current.position.set(s.x, y, s.z);
      falling.current.rotation.x = e * 6;
      falling.current.visible = e < 2.2;
    }
    if (dust.current) {
      const impact = Math.sqrt(16 / 18);
      const k = e - impact;
      dust.current.visible = k > 0 && k < 1.2;
      dust.current.position.set(s.x, ground + 0.2, s.z);
      dust.current.scale.setScalar(0.3 + k * 1.6);
      (dust.current.material as { opacity: number }).opacity = Math.max(0, 0.45 * (1 - k / 1.2));
    }
  });
  return (
    <>
      {rubble.map((r, i) => (
        <mesh key={i} geometry={r.g} position={r.p} scale={[r.s, r.s * 0.7, r.s]} rotation={[0, r.r, 0]} castShadow receiveShadow>
          <meshStandardMaterial vertexColors flatShading roughness={0.95} />
        </mesh>
      ))}
      <mesh ref={falling} geometry={fallGeo} scale={0.32} castShadow>
        <meshStandardMaterial vertexColors flatShading />
      </mesh>
      <mesh ref={dust}>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial color="#c9bba5" transparent opacity={0.4} depthWrite={false} roughness={1} />
      </mesh>
    </>
  );
}

function MudBubbles({ h, terrain, color }: { h: Hazard; terrain: TerrainModel; color: string }) {
  const ref = useRef<Group>(null);
  const spots = useMemo(() => {
    const rnd = hashRng(h.id);
    return Array.from({ length: 6 }, () => {
      const a = rnd() * 6.28;
      const d = Math.sqrt(rnd()) * h.radius * 0.6;
      return { x: Math.cos(a) * d, z: Math.sin(a) * d, ph: rnd() * 5 };
    });
  }, [h.id, h.radius]);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const t = clock.elapsedTime;
    g.children.forEach((b, i) => {
      const p = ((t * 0.5 + spots[i].ph) % 2.5) / 2.5;
      const sc = p < 0.85 ? p * 0.12 : 0;
      b.scale.setScalar(sc + 0.001);
    });
  });
  return (
    <group ref={ref}>
      {spots.map((s, i) => (
        <mesh key={i} position={[s.x, terrain.height(h.position.x + s.x, h.position.z + s.z) + 0.04, s.z]}>
          <sphereGeometry args={[1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={color} roughness={0.15} />
        </mesh>
      ))}
    </group>
  );
}

const HAZARD_DECAL: Record<Hazard['kind'], { color: string; opacity: number; roughness: number }> = {
  thorns: { color: '#3d2f35', opacity: 0.55, roughness: 0.95 },
  mud: { color: '#46301f', opacity: 0.92, roughness: 0.22 },
  wasps: { color: '#b58f1c', opacity: 0.22, roughness: 0.9 },
  snakes: { color: '#a78a52', opacity: 0.45, roughness: 0.95 },
  rockfall: { color: '#7a746c', opacity: 0.6, roughness: 0.95 },
  leeches: { color: '#18231b', opacity: 0.9, roughness: 0.12 },
};

/** Hazards: a soft ground decal marking the real radius, plus themed props that read at a glance. */
export const HazardMesh = memo(function HazardMesh({ h, terrain }: { h: Hazard; terrain: TerrainModel }) {
  const d = HAZARD_DECAL[h.kind] ?? { color: HAZARDS[h.kind]?.color ?? '#888', opacity: 0.35, roughness: 0.9 };
  return (
    <group>
      <Decal x={h.position.x} z={h.position.z} r={h.radius} terrain={terrain} color={d.color} opacity={d.opacity} roughness={d.roughness} />
      <group position={[h.position.x, 0, h.position.z]}>
        {h.kind === 'thorns' && <Brambles h={h} terrain={terrain} />}
        {h.kind === 'wasps' && <Swarm h={h} terrain={terrain} />}
        {h.kind === 'snakes' && <Snakes h={h} terrain={terrain} />}
        {h.kind === 'rockfall' && <Rockfall h={h} terrain={terrain} />}
        {h.kind === 'mud' && <MudBubbles h={h} terrain={terrain} color="#3a2819" />}
        {h.kind === 'leeches' && <MudBubbles h={h} terrain={terrain} color="#26352a" />}
      </group>
    </group>
  );
});

function Flames() {
  const ref = useRef<Group>(null);
  const light = useRef<{ intensity: number } | null>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    ref.current?.children.forEach((f, i) => {
      const k = 1 + Math.sin(t * (9 + i * 3) + i) * 0.12 + Math.sin(t * 23 + i * 2) * 0.06;
      f.scale.set(1, k, 1);
      f.rotation.y = t * (1 + i * 0.5);
    });
    if (light.current) light.current.intensity = 9 + Math.sin(t * 13) * 1.5 + Math.sin(t * 29) * 1;
  });
  return (
    <>
      <group ref={ref}>
        {[
          [0.26, 0.75, '#ff5a00', 3],
          [0.18, 0.6, '#ff9500', 5],
          [0.1, 0.42, '#ffe066', 8],
        ].map(([r, h, c, e], i) => (
          <mesh key={i} position={[0, 0.18 + (h as number) / 2, 0]}>
            <coneGeometry args={[r as number, h as number, 7]} />
            <meshStandardMaterial color={c as string} emissive={c as string} emissiveIntensity={e as number} toneMapped={false} transparent opacity={0.9} />
          </mesh>
        ))}
      </group>
      <pointLight ref={light as never} position={[0, 1, 0]} color="#ff9a3c" intensity={9} distance={13} decay={1.5} />
    </>
  );
}

function SignBoard({ text }: { text: string }) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#d2b48a';
    ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = 'rgba(90,60,30,0.35)';
    for (let y = 10; y < 128; y += 14) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(80, y + 3, 170, y - 3, 256, y + 1);
      ctx.stroke();
    }
    ctx.fillStyle = '#3b2412';
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      if (ctx.measureText(line + ' ' + w).width > 230 && line) {
        lines.push(line);
        line = w;
      } else line = line ? line + ' ' + w : w;
    }
    lines.push(line);
    lines.slice(0, 4).forEach((l, i, arr) => ctx.fillText(l, 128, 64 + (i - (arr.length - 1) / 2) * 26));
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
  }, [text]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <mesh position={[0, 1.05, 0.03]}>
      <planeGeometry args={[0.95, 0.48]} />
      <meshStandardMaterial map={tex} roughness={0.9} />
    </mesh>
  );
}

export function StructureMesh({ s, lit, terrain }: { s: Structure; lit: boolean; terrain: TerrainModel }) {
  const { x, z } = s.position;
  const y = terrain.surface(x, z);
  const rnd = useMemo(() => hashRng(s.id), [s.id]);
  const stones = useMemo(() => Array.from({ length: 9 }, (_, i) => rockGeometry(i * 3.3 + 1, ROCK_LOOKS.granite, 0, 0.3)), []);
  useEffect(() => () => stones.forEach((g) => g.dispose()), [stones]);
  const rot = useMemo(() => rnd() * 6.28, [rnd]);
  switch (s.kind) {
    case 'campfire':
      return (
        <group position={[x, y, z]}>
          {stones.map((g, i) => {
            const a = (i / stones.length) * Math.PI * 2;
            return (
              <mesh key={i} geometry={g} position={[Math.cos(a) * 0.48, 0.06, Math.sin(a) * 0.48]} scale={[0.14, 0.1, 0.12]} rotation={[0, a, 0]} castShadow>
                <meshStandardMaterial vertexColors flatShading />
              </mesh>
            );
          })}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
            <circleGeometry args={[0.42, 16]} />
            <meshStandardMaterial color={lit ? '#2a1a10' : '#4a4540'} roughness={1} />
          </mesh>
          {[0, 1, 2, 3].map((i) => {
            const a = (i / 4) * Math.PI * 2 + 0.4;
            return (
              <mesh key={i} position={[Math.cos(a) * 0.17, 0.2, Math.sin(a) * 0.17]} rotation={[Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9]} castShadow>
                <cylinderGeometry args={[0.045, 0.06, 0.6, 6]} />
                <meshStandardMaterial color={lit ? '#3b2616' : '#2b2420'} flatShading />
              </mesh>
            );
          })}
          {lit && <Flames />}
        </group>
      );
    case 'shelter':
      return (
        <group position={[x, y, z]} rotation={[0, rot, 0]}>
          {[-1, 1].map((side) => (
            <group key={side} rotation={[0, 0, side * 0.85]} position={[side * 0.62, 0.72, 0]}>
              <mesh castShadow receiveShadow>
                <boxGeometry args={[0.1, 1.8, 2.3]} />
                <meshStandardMaterial color="#b38a4a" roughness={1} flatShading />
              </mesh>
              {[-0.6, -0.2, 0.2, 0.6].map((dy) => (
                <mesh key={dy} position={[side * 0.06, dy, 0]}>
                  <boxGeometry args={[0.04, 0.08, 2.34]} />
                  <meshStandardMaterial color="#8f6a35" roughness={1} />
                </mesh>
              ))}
            </group>
          ))}
          <mesh position={[0, 1.42, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.06, 0.06, 2.6, 6]} />
            <meshStandardMaterial color="#5a3e27" />
          </mesh>
        </group>
      );
    case 'cache':
      return (
        <group position={[x, y, z]} rotation={[0, rot, 0]}>
          <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.9, 0.6, 0.6]} />
            <meshStandardMaterial color="#8a5f3a" roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.62, 0]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1, 1]} castShadow>
            <cylinderGeometry args={[0.3, 0.3, 0.9, 12, 1, false, 0, Math.PI]} />
            <meshStandardMaterial color="#7a5232" roughness={0.9} />
          </mesh>
          {[-0.36, 0.36].map((dx) => (
            <mesh key={dx} position={[dx, 0.45, 0]}>
              <boxGeometry args={[0.06, 0.95, 0.64]} />
              <meshStandardMaterial color="#4f4f4f" metalness={0.6} roughness={0.4} />
            </mesh>
          ))}
          <mesh position={[0, 0.55, 0.31]}>
            <boxGeometry args={[0.12, 0.14, 0.03]} />
            <meshStandardMaterial color="#c9a227" metalness={0.8} roughness={0.3} />
          </mesh>
        </group>
      );
    case 'sign':
      return (
        <group position={[x, y, z]} rotation={[0, rot, 0]}>
          <mesh position={[0, 0.6, 0]} castShadow>
            <boxGeometry args={[0.09, 1.2, 0.09]} />
            <meshStandardMaterial color="#6d4c2f" />
          </mesh>
          <mesh position={[0, 1.05, 0]} castShadow>
            <boxGeometry args={[1.0, 0.52, 0.05]} />
            <meshStandardMaterial color="#b8956a" />
          </mesh>
          <SignBoard text={s.text ?? ''} />
        </group>
      );
  }
}

export function GroundItemMesh({ g, terrain }: { g: GroundItem; terrain: TerrainModel }) {
  const k = g.item.kind;
  const y = terrain.surface(g.position.x, g.position.z);
  const color = ITEM_COLOR[k] ?? '#e0c080';
  return (
    <group position={[g.position.x, y, g.position.z]}>
      {k === 'wood' ? (
        <mesh position={[0, 0.07, 0]} rotation={[0, 0.6, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.07, 0.07, 0.5, 6]} />
          <meshStandardMaterial color={color} flatShading />
        </mesh>
      ) : k === 'stone' ? (
        <mesh position={[0, 0.08, 0]} scale={[0.14, 0.09, 0.12]} castShadow>
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={color} flatShading />
        </mesh>
      ) : (
        <mesh position={[0, 0.1, 0]} castShadow>
          <icosahedronGeometry args={[0.1, 1]} />
          <meshStandardMaterial color={color} roughness={0.5} />
        </mesh>
      )}
    </group>
  );
}

