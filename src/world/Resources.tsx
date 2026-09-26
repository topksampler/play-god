import { useFrame } from '@react-three/fiber';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { CylinderGeometry, type Group, type Mesh } from 'three';
import { NODES } from '../shared/catalog';
import type { ResourceNode } from '../shared/types';
import { Label } from './Label';
import { hashRng } from './noise';
import { ROCK_LOOKS, Sway, displace, foliageGeometry, rockGeometry } from './props';
import type { TerrainModel } from './terrain-model';

type P3 = [number, number, number];

const around = (n: number, r: number, rnd: () => number, jitter = 0.35) =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / Math.max(1, n)) * Math.PI * 2 + rnd() * jitter;
    const rr = r * (0.7 + rnd() * 0.5);
    return [Math.cos(a) * rr, Math.sin(a) * rr, rnd()] as const;
  });

function useDispose(geoms: { dispose: () => void }[]) {
  useEffect(() => () => geoms.forEach((g) => g.dispose()), [geoms]);
}

function BerryBush({ n, rnd }: { n: number; rnd: () => number }) {
  const blobs = useMemo(
    () =>
      [...around(4, 0.45, rnd), [0, 0, 0.5] as const].map(([x, z, r], i) => ({
        g: foliageGeometry(rnd() * 100, '#1f4d24', '#357a33', '#6fae4a'),
        p: [x, i === 4 ? 0.8 : 0.45 + r * 0.25, z] as P3,
        s: (i === 4 ? 0.52 : 0.45 + r * 0.2) as number,
      })),
    [rnd],
  );
  useDispose(useMemo(() => blobs.map((b) => b.g), [blobs]));
  const clusters = useMemo(() => around(6, 0.62, rnd, 0.8), [rnd]);
  return (
    <group>
      {blobs.map((b, i) => (
        <mesh key={i} geometry={b.g} position={b.p} scale={b.s} castShadow receiveShadow>
          <meshStandardMaterial vertexColors flatShading roughness={0.85} />
        </mesh>
      ))}
      {clusters.slice(0, n).map(([x, z, r], i) => (
        <group key={i} position={[x, 0.55 + r * 0.45, z]}>
          {[[0, 0, 0], [0.09, -0.05, 0.05], [-0.07, -0.06, 0.06], [0.02, -0.1, -0.06]].map((p, j) => (
            <mesh key={j} position={p as P3}>
              <sphereGeometry args={[0.075, 10, 8]} />
              <meshStandardMaterial color="#2f45c9" roughness={0.25} emissive="#0b1466" emissiveIntensity={0.25} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

function FruitTree({ n, rnd }: { n: number; rnd: () => number }) {
  const parts = useMemo(() => {
    const trunk = displace(new CylinderGeometry(0.16, 0.3, 2.2, 7, 3), 0.1, 3, rnd() * 100);
    const branch = displace(new CylinderGeometry(0.05, 0.09, 0.9, 5, 1), 0.1, 3, rnd() * 100);
    const canopy = [...around(3, 0.75, rnd), [0, 0, 0.6] as const].map(([x, z, r], i) => ({
      g: foliageGeometry(rnd() * 100, '#2d6a2e', '#4d9a43', '#9ccf5f'),
      p: [x, i === 3 ? 3.3 : 2.6 + r * 0.5, z] as P3,
      s: i === 3 ? 0.95 : 0.95 + r * 0.3,
    }));
    return { trunk, branch, canopy };
  }, [rnd]);
  useDispose(useMemo(() => [parts.trunk, parts.branch, ...parts.canopy.map((c) => c.g)], [parts]));
  const fruit = useMemo(() => around(8, 1.2, rnd, 0.9), [rnd]);
  return (
    <group>
      <mesh geometry={parts.trunk} position={[0, 1.1, 0]} castShadow>
        <meshStandardMaterial color="#5f4027" flatShading roughness={0.95} />
      </mesh>
      <mesh geometry={parts.branch} position={[0.25, 1.7, 0]} rotation={[0, 0, -0.7]} castShadow>
        <meshStandardMaterial color="#5f4027" flatShading />
      </mesh>
      <Sway amount={0.02} speed={0.8} seed={rnd()}>
        {parts.canopy.map((c, i) => (
          <mesh key={i} geometry={c.g} position={c.p} scale={c.s} castShadow receiveShadow>
            <meshStandardMaterial vertexColors flatShading roughness={0.85} />
          </mesh>
        ))}
        {fruit.slice(0, n).map(([x, z, r], i) => (
          <mesh key={i} position={[x, 2.15 + r * 0.9, z]} castShadow>
            <sphereGeometry args={[0.17, 12, 10]} />
            <meshStandardMaterial color="#ff8a14" roughness={0.35} emissive="#7a2e00" emissiveIntensity={0.2} />
          </mesh>
        ))}
      </Sway>
      {n >= 5 && (
        <mesh position={[0.8, 0.14, 0.5]}>
          <sphereGeometry args={[0.15, 10, 8]} />
          <meshStandardMaterial color="#d9700f" />
        </mesh>
      )}
    </group>
  );
}

function Mushrooms({ n, rnd, toxic }: { n: number; rnd: () => number; toxic: boolean }) {
  const caps = useMemo(() => around(6, 0.35, rnd, 1), [rnd]);
  const spots = useMemo(() => Array.from({ length: 7 }, () => [rnd() * Math.PI * 2, 0.3 + rnd() * 0.9] as const), [rnd]);
  return (
    <group>
      {caps.slice(0, Math.max(1, n)).map(([x, z, r], i) => {
        const s = 0.75 + r * 0.75;
        return (
          <group key={i} position={[x, 0, z]} rotation={[(r - 0.5) * 0.3, 0, (r - 0.5) * 0.3]} scale={s}>
            <mesh position={[0, 0.14, 0]} castShadow>
              <cylinderGeometry args={[0.045, 0.065, 0.28, 8]} />
              <meshStandardMaterial color="#f1e8d6" roughness={0.8} />
            </mesh>
            <mesh position={[0, 0.275, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.165, 14]} />
              <meshStandardMaterial color={toxic ? '#f3d3c8' : '#d8c3a5'} side={2} />
            </mesh>
            <mesh position={[0, 0.28, 0]} scale={[1, 0.62, 1]} castShadow>
              <sphereGeometry args={[0.17, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshStandardMaterial color={toxic ? '#d8232a' : '#8a6246'} roughness={toxic ? 0.3 : 0.75} />
            </mesh>
            {toxic &&
              spots.map(([a, e], j) => (
                <mesh key={j} position={[Math.cos(a) * 0.135 * Math.sin(e), 0.28 + 0.1 * Math.cos(e), Math.sin(a) * 0.135 * Math.sin(e)]}>
                  <sphereGeometry args={[0.024, 5, 5]} />
                  <meshStandardMaterial color="#ffffff" />
                </mesh>
              ))}
          </group>
        );
      })}
    </group>
  );
}

/** Surface ripple ring (real water source cue). */
function Ripple({ y, r, color = '#ffffff' }: { y: number; r: number; color?: string }) {
  const ref = useRef<Mesh>(null);
  const ph = useMemo(() => Math.random(), []);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const p = (clock.elapsedTime * 0.35 + ph) % 1;
    ref.current.scale.setScalar(0.25 + p * r);
    (ref.current.material as { opacity: number }).opacity = 0.35 * (1 - p);
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, y + 0.015, 0]} renderOrder={3}>
      <ringGeometry args={[0.92, 1, 40]} />
      <meshBasicMaterial color={color} transparent opacity={0.3} depthWrite={false} />
    </mesh>
  );
}

/**
 * Water node details. The water surface itself is drawn by Water.tsx (a pond, or the lake it sits beside);
 * here we add the cues that tell sources apart: fish, toxic bubbles, reeds, rim stones, ripples.
 */
function WaterFeature({ node, n, terrain }: { node: ResourceNode; n: number; terrain: TerrainModel }) {
  const fish = useRef<Group>(null);
  const bubbles = useRef<Group>(null);
  const kind = node.kind as 'fresh_water' | 'toxic_water' | 'fish_spot';
  const toxic = kind === 'toxic_water';
  const lake = terrain.shoreNodes.get(node.id);
  const pond = terrain.ponds.find((p) => p.id === node.id);
  const { x, z } = node.position;
  const m = useMemo(() => {
    const rnd = hashRng(node.id);
    // Where the visible water is, relative to the node: its own pond, or a spot just inside the lake edge.
    let cx = 0;
    let cz = 0;
    let level = pond?.level ?? terrain.height(x, z);
    let rimR = (pond?.r ?? 1.2) * 1.08;
    if (lake) {
      const dx = lake.x - x;
      const dz = lake.z - z;
      const d = Math.hypot(dx, dz) || 1;
      cx = (dx / d) * 1.9;
      cz = (dz / d) * 1.9;
      level = terrain.lakeLevel;
      rimR = 1.1;
    }
    const look = toxic ? ROCK_LOOKS.swampy : ROCK_LOOKS.granite;
    const stones = Array.from({ length: lake ? 4 : 7 }, (_, i) => {
      const a = (i / (lake ? 4 : 7)) * Math.PI * 2 + rnd() * 0.6;
      const px = cx + Math.cos(a) * rimR * (lake ? 1.2 : 1);
      const pz = cz + Math.sin(a) * rimR * (lake ? 1.2 : 1);
      const s = 0.12 + rnd() * 0.16;
      return { g: rockGeometry(rnd() * 100, look, 0, 0.3), p: [px, Math.max(terrain.height(x + px, z + pz), level) + s * 0.2, pz] as P3, s };
    });
    const reeds = around(lake ? 5 : 7, rimR * 1.05, rnd, 0.9).map(([rx, rz, r]) => {
      const px = cx + rx;
      const pz = cz + rz;
      return { p: [px, Math.max(terrain.height(x + px, z + pz), level - 0.1), pz] as P3, h: 0.7 + r * 0.6, tilt: (r - 0.5) * 0.3 };
    });
    return { cx, cz, level, stones, reeds, rimR };
  }, [node.id, lake, pond, terrain, x, z, toxic]);
  useDispose(useMemo(() => m.stones.map((s) => s.g), [m]));

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (fish.current) fish.current.rotation.y = t * 0.9;
    if (fish.current)
      fish.current.children.forEach((f, i) => {
        f.position.y = -0.06 + Math.sin(t * 3 + i) * 0.02;
        f.rotation.z = Math.sin(t * 9 + i) * 0.25;
      });
    if (bubbles.current)
      bubbles.current.children.forEach((b, i) => {
        const p = (t * 0.45 + i * 0.37) % 1;
        b.position.y = p * 0.12;
        b.scale.setScalar(p < 0.85 ? 0.4 + p : 0.001);
      });
  });
  const reedColor = toxic ? '#7a6f3a' : '#5f8f3a';
  return (
    <group position={[x, 0, z]}>
      {m.stones.map((s, i) => (
        <mesh key={i} geometry={s.g} position={s.p} scale={[s.s, s.s * 0.7, s.s]} castShadow receiveShadow>
          <meshStandardMaterial vertexColors flatShading roughness={0.9} />
        </mesh>
      ))}
      <Sway amount={0.06} speed={1.4} seed={m.rimR}>
        {m.reeds.map((r, i) => (
          <group key={i} position={r.p} rotation={[r.tilt, 0, r.tilt * 0.6]}>
            <mesh position={[0, r.h / 2, 0]}>
              <coneGeometry args={[0.03, r.h, 4]} />
              <meshStandardMaterial color={reedColor} flatShading />
            </mesh>
            {!toxic && i % 2 === 0 && (
              <mesh position={[0, r.h * 0.82, 0]}>
                <cylinderGeometry args={[0.045, 0.045, 0.18, 6]} />
                <meshStandardMaterial color="#6b4428" />
              </mesh>
            )}
          </group>
        ))}
      </Sway>
      <group position={[m.cx, 0, m.cz]}>
        <Ripple y={m.level} r={lake ? 1.4 : Math.min(1.1, m.rimR * 0.85)} color={toxic ? '#e2e59a' : '#ffffff'} />
        {kind === 'fish_spot' && (
          <group ref={fish} position={[0, m.level, 0]}>
            {Array.from({ length: Math.max(0, n) }).map((_, i) => {
              const a = (i / Math.max(1, n)) * Math.PI * 2;
              return (
                <group key={i} position={[Math.cos(a) * 0.55, -0.06, Math.sin(a) * 0.55]} rotation={[0, -a, 0]}>
                  <mesh scale={[0.4, 0.45, 1]}>
                    <sphereGeometry args={[0.17, 10, 8]} />
                    <meshStandardMaterial color="#d7e0e8" metalness={0.55} roughness={0.25} />
                  </mesh>
                  <mesh position={[0, 0, -0.2]} rotation={[Math.PI / 2, 0, 0]} scale={[0.3, 1, 1]}>
                    <coneGeometry args={[0.1, 0.14, 4]} />
                    <meshStandardMaterial color="#9fb0bf" metalness={0.4} roughness={0.35} />
                  </mesh>
                </group>
              );
            })}
          </group>
        )}
        {toxic && (
          <group ref={bubbles} position={[0, m.level, 0]}>
            {around(7, 0.6, hashRng(node.id + 'b'), 1).map(([bx, bz], i) => (
              <mesh key={i} position={[bx, 0, bz]}>
                <sphereGeometry args={[0.05, 8, 6]} />
                <meshStandardMaterial color="#cddb6a" roughness={0.2} transparent opacity={0.85} />
              </mesh>
            ))}
          </group>
        )}
      </group>
    </group>
  );
}

function Cactus({ n, rnd }: { n: number; rnd: () => number }) {
  const geo = useMemo(() => {
    const ribbed = (r0: number, r1: number, h: number) => {
      const g = new CylinderGeometry(r1, r0, h, 16, 4);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const z = p.getZ(i);
        const a = Math.atan2(z, x);
        const k = 1 + Math.cos(a * 8) * 0.09;
        p.setXYZ(i, x * k, p.getY(i), z * k);
      }
      g.computeVertexNormals();
      return g;
    };
    return { body: ribbed(0.26, 0.22, 1.5), arm: ribbed(0.11, 0.1, 0.5), elbow: ribbed(0.11, 0.11, 0.3) };
  }, []);
  useDispose(useMemo(() => Object.values(geo), [geo]));
  const green = '#4f8a3a';
  const lean = useMemo(() => (rnd() - 0.5) * 0.1, [rnd]);
  return (
    <group rotation={[lean, 0, lean]}>
      <mesh geometry={geo.body} position={[0, 0.75, 0]} castShadow>
        <meshStandardMaterial color={green} roughness={0.7} />
      </mesh>
      <mesh position={[0, 1.5, 0]} castShadow>
        <sphereGeometry args={[0.22, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={green} roughness={0.7} />
      </mesh>
      {[
        [-1, 0.7, 0.45],
        [1, 0.95, 0.35],
      ].map(([side, y, h], i) => (
        <group key={i} position={[side * 0.3, y, 0]}>
          <mesh geometry={geo.elbow} rotation={[0, 0, (side * Math.PI) / 2]}>
            <meshStandardMaterial color={green} roughness={0.7} />
          </mesh>
          <mesh geometry={geo.arm} position={[side * 0.13, h / 2, 0]} scale={[1, h / 0.5, 1]} castShadow>
            <meshStandardMaterial color={green} roughness={0.7} />
          </mesh>
          <mesh position={[side * 0.13, h, 0]}>
            <sphereGeometry args={[0.1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color={green} roughness={0.7} />
          </mesh>
        </group>
      ))}
      {Array.from({ length: Math.min(n, 3) }).map((_, i) => (
        <mesh key={i} position={[Math.cos(i * 2.1) * 0.14, 1.63, Math.sin(i * 2.1) * 0.14]} castShadow>
          <icosahedronGeometry args={[0.09, 1]} />
          <meshStandardMaterial color="#ea4f8b" roughness={0.35} emissive="#5a0d2c" emissiveIntensity={0.25} />
        </mesh>
      ))}
    </group>
  );
}

function Hive({ n, rnd }: { n: number; rnd: () => number }) {
  const bees = useRef<Group>(null);
  const trunk = useMemo(() => displace(new CylinderGeometry(0.42, 0.56, 1.3, 9, 3, true), 0.08, 3, rnd() * 100), [rnd]);
  useDispose(useMemo(() => [trunk], [trunk]));
  useFrame(({ clock }) => {
    if (!bees.current) return;
    const t = clock.elapsedTime;
    bees.current.children.forEach((b, i) => {
      const a = t * (2 + i * 0.4) + i;
      b.position.set(Math.cos(a) * (0.6 + (i % 3) * 0.2), 1.4 + Math.sin(a * 1.7) * 0.3, Math.sin(a) * (0.6 + (i % 2) * 0.25));
    });
  });
  return (
    <group>
      <mesh geometry={trunk} position={[0, 0.65, 0]} castShadow>
        <meshStandardMaterial color="#5a3d2a" flatShading side={2} roughness={0.95} />
      </mesh>
      <mesh position={[0, 1.3, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.18, 0.44, 9]} />
        <meshStandardMaterial color="#3e2a1e" />
      </mesh>
      <mesh position={[0, 1.2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.36, 9]} />
        <meshStandardMaterial color="#1c120c" />
      </mesh>
      {[0.28, 0.22, 0.15].map((r, i) => (
        <mesh key={i} position={[0.45, 1.05 - i * 0.16, 0]}>
          <cylinderGeometry args={[r * (0.6 + n * 0.15), r * (0.7 + n * 0.15), 0.16, 12]} />
          <meshStandardMaterial color="#f2b705" emissive="#8a5a00" emissiveIntensity={0.45} roughness={0.2} metalness={0.1} />
        </mesh>
      ))}
      {n > 0 &&
        [0.1, -0.12].map((dz, i) => (
          <mesh key={i} position={[0.5, 0.62 - i * 0.1, dz]} scale={[0.6, 1.6, 0.6]}>
            <sphereGeometry args={[0.07, 8, 6]} />
            <meshStandardMaterial color="#f7c21a" emissive="#8a5a00" emissiveIntensity={0.5} roughness={0.15} />
          </mesh>
        ))}
      <group ref={bees}>
        {Array.from({ length: 7 }).map((_, i) => (
          <mesh key={i}>
            <sphereGeometry args={[0.045, 6, 5]} />
            <meshStandardMaterial color={i % 2 ? '#1a1a1a' : '#ffd000'} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function Tufts({ n, rnd, color, flower, tall }: { n: number; rnd: () => number; color: string; flower?: string; tall?: boolean }) {
  const blades = useMemo(() => around(tall ? 14 : 9, tall ? 0.42 : 0.32, rnd, 1), [rnd, tall]);
  const shown = Math.max(tall ? 6 : 4, Math.round((blades.length * Math.max(1, n)) / 6));
  return (
    <Sway amount={tall ? 0.12 : 0.05} speed={tall ? 1.6 : 1.1} seed={rnd()}>
      {blades.slice(0, shown).map(([x, z, r], i) => (
        <group key={i} position={[x, 0, z]} rotation={[(r - 0.5) * 0.4, r * 6, (r - 0.5) * 0.4]}>
          <mesh position={[0, tall ? 0.45 + r * 0.2 : 0.18, 0]} scale={tall ? 1 : [1.6, 1, 0.5]} castShadow>
            <coneGeometry args={[tall ? 0.03 : 0.09, tall ? 0.9 + r * 0.4 : 0.36, 4]} />
            <meshStandardMaterial color={color} flatShading />
          </mesh>
          {flower && i % 3 === 0 && (
            <mesh position={[0, 0.4, 0]}>
              <icosahedronGeometry args={[0.05, 0]} />
              <meshStandardMaterial color={flower} emissive={flower} emissiveIntensity={0.15} />
            </mesh>
          )}
          {tall && i % 4 === 0 && (
            <mesh position={[0, 1.0 + r * 0.35, 0]} scale={[1, 3, 1]}>
              <sphereGeometry args={[0.04, 5, 4]} />
              <meshStandardMaterial color="#d8c47a" />
            </mesh>
          )}
        </group>
      ))}
    </Sway>
  );
}

function MossLog({ n, rnd }: { n: number; rnd: () => number }) {
  const bark = useMemo(() => displace(new CylinderGeometry(0.2, 0.23, 1.4, 8, 3), 0.08, 3, rnd() * 100), [rnd]);
  const moss = useMemo(() => foliageGeometry(rnd() * 100, '#7fb14a', '#a4d36a', '#c8ec8a', 1, 0.3), [rnd]);
  useDispose(useMemo(() => [bark, moss], [bark, moss]));
  return (
    <group>
      <mesh geometry={bark} position={[0, 0.2, 0]} rotation={[0, 0.4, Math.PI / 2]} castShadow>
        <meshStandardMaterial color="#4e3b2a" flatShading />
      </mesh>
      {Array.from({ length: Math.max(1, n + 1) }).map((_, i) => (
        <mesh key={i} geometry={moss} position={[Math.cos(0.4) * (i * 0.3 - 0.4), 0.36, -Math.sin(0.4) * (i * 0.3 - 0.4)]} scale={[0.2, 0.08, 0.2]}>
          <meshStandardMaterial vertexColors flatShading roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

function WoodPile({ n }: { n: number }) {
  const logs = Math.max(1, n);
  return (
    <group>
      {Array.from({ length: logs }).map((_, i) => {
        const layer = Math.floor(i / 3);
        const k = i % 3;
        const rotY = layer % 2 ? Math.PI / 2 : 0;
        return (
          <group key={i} rotation={[0, rotY, 0]} position={[0, 0.1 + layer * 0.17, 0]}>
            <mesh position={[(k - 1) * 0.2, 0, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.08, 0.08, 0.9, 7]} />
              <meshStandardMaterial color="#7c5230" flatShading />
            </mesh>
            {[0.451, -0.451].map((dz) => (
              <mesh key={dz} position={[(k - 1) * 0.2, 0, dz]} rotation={[0, dz < 0 ? Math.PI : 0, 0]}>
                <circleGeometry args={[0.078, 7]} />
                <meshStandardMaterial color="#d9b382" />
              </mesh>
            ))}
          </group>
        );
      })}
    </group>
  );
}

function StonePile({ n, rnd }: { n: number; rnd: () => number }) {
  const stones = useMemo(() => around(6, 0.35, rnd, 1).map(([x, z, r]) => ({ g: rockGeometry(rnd() * 100, ROCK_LOOKS.granite, 0, 0.3), x, z, r })), [rnd]);
  useDispose(useMemo(() => stones.map((s) => s.g), [stones]));
  return (
    <group>
      {stones.slice(0, Math.max(1, n)).map((s, i) => (
        <mesh key={i} geometry={s.g} position={[s.x, 0.07 + (i > 3 ? 0.12 : 0), s.z]} rotation={[s.r, s.r * 3, 0]} scale={[0.22 + s.r * 0.06, 0.1, 0.17 + s.r * 0.05]} castShadow receiveShadow>
          <meshStandardMaterial vertexColors flatShading roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

const WATER = new Set(['fresh_water', 'toxic_water', 'fish_spot']);

/** One resource node: a detailed low-poly model whose visible fruit/fish/etc. tracks available units. Hover for a tooltip. */
export const ResourceMesh = memo(function ResourceMesh({ node, units, terrain }: { node: ResourceNode; units: number; terrain: TerrainModel }) {
  const [hover, setHover] = useState(false);
  const rnd = useMemo(() => hashRng(node.id), [node.id]);
  const rotY = useMemo(() => hashRng(node.id + 'r')() * Math.PI * 2, [node.id]);
  const n = Math.min(units, 6);
  const def = NODES[node.kind];
  const water = WATER.has(node.kind);
  const y = water ? 0 : terrain.surface(node.position.x, node.position.z) - 0.03;
  let body: React.ReactNode;
  switch (node.kind) {
    case 'berry_bush': body = <BerryBush n={n} rnd={rnd} />; break;
    case 'fruit_tree': body = <FruitTree n={n} rnd={rnd} />; break;
    case 'mushroom_patch': body = <Mushrooms n={n} rnd={rnd} toxic={false} />; break;
    case 'toxic_mushroom_patch': body = <Mushrooms n={n} rnd={rnd} toxic />; break;
    case 'fish_spot':
    case 'fresh_water':
    case 'toxic_water': body = null; break;
    case 'cactus': body = <Cactus n={n} rnd={rnd} />; break;
    case 'honey_hive': body = <Hive n={n} rnd={rnd} />; break;
    case 'herb_patch': body = <Tufts n={n} rnd={rnd} color="#b7c9bb" flower="#a58be0" />; break;
    case 'fiber_grass': body = <Tufts n={n} rnd={rnd} color="#c8b65a" tall />; break;
    case 'moss_patch': body = <MossLog n={n} rnd={rnd} />; break;
    case 'wood_pile': body = <WoodPile n={n} />; break;
    case 'stone_pile': body = <StonePile n={n} rnd={rnd} />; break;
  }
  const labelY = (node.kind === 'fruit_tree' ? 4.4 : 1.8) + (water ? terrain.surface(node.position.x, node.position.z) : 0);
  return (
    <group
      onPointerOver={(e) => {
        e.stopPropagation();
        setHover(true);
      }}
      onPointerOut={() => setHover(false)}
    >
      {water ? (
        <WaterFeature node={node} n={n} terrain={terrain} />
      ) : (
        <group position={[node.position.x, y, node.position.z]} rotation={[0, rotY, 0]}>
          <group scale={units < 1 ? 0.8 : 1}>{body}</group>
        </group>
      )}
      {hover && (
        <Label
          position={[node.position.x, labelY + (water ? 0 : y), node.position.z]}
          bg="rgba(20,24,32,0.9)"
          lines={[`${node.id} · ${node.kind.replace(/_/g, ' ')} (truth)`, `looks like: ${def.appearance}`, `${units}/${node.maxUnits} units · regrows ${def.regrowPerMin}/min`]}
        />
      )}
    </group>
  );
});
