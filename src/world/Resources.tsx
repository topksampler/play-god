import { useFrame } from '@react-three/fiber';
import { memo, useMemo, useRef, useState } from 'react';
import type { Group, Mesh } from 'three';
import { NODES } from '../shared/catalog';
import type { ResourceNode } from '../shared/types';
import { Label } from './Label';

/** Deterministic per-node pseudo-random, so each patch looks different but stable across renders. */
function hash(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const around = (n: number, r: number, rnd: () => number, jitter = 0.35) =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / Math.max(1, n)) * Math.PI * 2 + rnd() * jitter;
    const rr = r * (0.7 + rnd() * 0.5);
    return [Math.cos(a) * rr, Math.sin(a) * rr, rnd()] as const;
  });

function Sway({ children, amount = 0.06, speed = 1.3, seed = 0 }: { children: React.ReactNode; amount?: number; speed?: number; seed?: number }) {
  const ref = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime * speed + seed * 10;
    ref.current.rotation.z = Math.sin(t) * amount;
    ref.current.rotation.x = Math.cos(t * 0.7) * amount * 0.6;
  });
  return <group ref={ref}>{children}</group>;
}

function BerryBush({ n, rnd }: { n: number; rnd: () => number }) {
  const blobs = useMemo(() => around(4, 0.45, rnd), [rnd]);
  const clusters = useMemo(() => around(6, 0.7, rnd, 0.8), [rnd]);
  const greens = ['#2f6b2f', '#3d7d36', '#2a5e2c', '#4a8a3f'];
  return (
    <group>
      {blobs.map(([x, z, r], i) => (
        <mesh key={i} position={[x, 0.45 + r * 0.25, z]} castShadow>
          <icosahedronGeometry args={[0.45 + r * 0.2, 1]} />
          <meshStandardMaterial color={greens[i % 4]} flatShading roughness={0.9} />
        </mesh>
      ))}
      <mesh position={[0, 0.85, 0]} castShadow>
        <icosahedronGeometry args={[0.5, 1]} />
        <meshStandardMaterial color="#357a33" flatShading roughness={0.9} />
      </mesh>
      {clusters.slice(0, n).map(([x, z, r], i) => (
        <group key={i} position={[x, 0.55 + r * 0.45, z]}>
          {[[0, 0, 0], [0.09, -0.05, 0.05], [-0.07, -0.06, 0.06]].map((p, j) => (
            <mesh key={j} position={p as [number, number, number]}>
              <sphereGeometry args={[0.075, 8, 8]} />
              <meshStandardMaterial color="#2b3fbf" roughness={0.3} metalness={0.1} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

function FruitTree({ n, rnd }: { n: number; rnd: () => number }) {
  const canopy = useMemo(() => around(3, 0.7, rnd), [rnd]);
  const fruit = useMemo(() => around(8, 1.25, rnd, 0.9), [rnd]);
  return (
    <group>
      <mesh position={[0, 1.1, 0]} castShadow>
        <cylinderGeometry args={[0.14, 0.3, 2.2, 7]} />
        <meshStandardMaterial color="#6b4423" flatShading />
      </mesh>
      <mesh position={[0.25, 1.7, 0]} rotation={[0, 0, -0.7]} castShadow>
        <cylinderGeometry args={[0.05, 0.09, 0.9, 5]} />
        <meshStandardMaterial color="#6b4423" flatShading />
      </mesh>
      <Sway amount={0.025} speed={0.8} seed={rnd()}>
        {canopy.map(([x, z, r], i) => (
          <mesh key={i} position={[x, 2.6 + r * 0.5, z]} castShadow>
            <icosahedronGeometry args={[0.95 + r * 0.3, 1]} />
            <meshStandardMaterial color={['#3e8e41', '#4f9d45', '#357f3a'][i]} flatShading roughness={0.85} />
          </mesh>
        ))}
        <mesh position={[0, 3.3, 0]} castShadow>
          <icosahedronGeometry args={[0.9, 1]} />
          <meshStandardMaterial color="#48954a" flatShading />
        </mesh>
        {fruit.slice(0, n).map(([x, z, r], i) => (
          <mesh key={i} position={[x, 2.1 + r * 0.9, z]}>
            <sphereGeometry args={[0.16, 10, 10]} />
            <meshStandardMaterial color="#ff8c1a" roughness={0.4} />
          </mesh>
        ))}
      </Sway>
      {n >= 5 && (
        <mesh position={[0.8, 0.14, 0.5]}>
          <sphereGeometry args={[0.15, 8, 8]} />
          <meshStandardMaterial color="#e07b10" />
        </mesh>
      )}
    </group>
  );
}

function Mushrooms({ n, rnd, toxic }: { n: number; rnd: () => number; toxic: boolean }) {
  const caps = useMemo(() => around(6, 0.35, rnd, 1), [rnd]);
  const spots = useMemo(() => Array.from({ length: 6 }, () => [rnd() * Math.PI * 2, 0.3 + rnd() * 0.9] as const), [rnd]);
  return (
    <group>
      {caps.slice(0, Math.max(1, n)).map(([x, z, r], i) => {
        const s = 0.7 + r * 0.7;
        return (
          <group key={i} position={[x, 0, z]} rotation={[(r - 0.5) * 0.3, 0, (r - 0.5) * 0.3]} scale={s}>
            <mesh position={[0, 0.14, 0]}>
              <cylinderGeometry args={[0.045, 0.06, 0.28, 7]} />
              <meshStandardMaterial color="#efe4cf" />
            </mesh>
            <mesh position={[0, 0.28, 0]} scale={[1, 0.6, 1]} castShadow>
              <sphereGeometry args={[0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshStandardMaterial color={toxic ? '#d62828' : '#8d6e63'} roughness={toxic ? 0.35 : 0.8} />
            </mesh>
            {toxic &&
              spots.map(([a, e], j) => (
                <mesh key={j} position={[Math.cos(a) * 0.13 * Math.sin(e), 0.28 + 0.1 * Math.cos(e), Math.sin(a) * 0.13 * Math.sin(e)]}>
                  <sphereGeometry args={[0.025, 5, 5]} />
                  <meshStandardMaterial color="#ffffff" />
                </mesh>
              ))}
          </group>
        );
      })}
    </group>
  );
}

function Water({ kind, n, rnd }: { kind: 'fresh_water' | 'toxic_water' | 'fish_spot'; n: number; rnd: () => number }) {
  const ripple = useRef<Mesh>(null);
  const fish = useRef<Group>(null);
  const bubbles = useRef<Group>(null);
  const toxic = kind === 'toxic_water';
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (ripple.current) {
      const p = (t * 0.5) % 1;
      ripple.current.scale.setScalar(0.4 + p * 0.8);
      (ripple.current.material as { opacity: number }).opacity = 0.5 * (1 - p);
    }
    if (fish.current) fish.current.rotation.y = t * 0.8;
    if (bubbles.current)
      bubbles.current.children.forEach((b, i) => {
        const p = (t * 0.4 + i * 0.37) % 1;
        b.position.y = 0.02 + p * 0.25;
        b.scale.setScalar(1 - p);
      });
  });
  const reeds = useMemo(() => around(5, 1.2, rnd, 0.6), [rnd]);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <circleGeometry args={[1.3, 28]} />
        <meshStandardMaterial color={toxic ? '#5a4f1c' : '#3d6b3a'} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.035, 0]}>
        <circleGeometry args={[1.1, 28]} />
        <meshStandardMaterial color={toxic ? '#6b7a2a' : '#3f9ae0'} roughness={0.08} metalness={0.2} transparent opacity={0.92} />
      </mesh>
      <mesh ref={ripple} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.045, 0]}>
        <ringGeometry args={[0.9, 1, 32]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.4} depthWrite={false} />
      </mesh>
      {reeds.map(([x, z, r], i) => (
        <mesh key={i} position={[x, 0.3 + r * 0.2, z]} rotation={[0, 0, (r - 0.5) * 0.3]}>
          <coneGeometry args={[0.035, 0.7 + r * 0.4, 4]} />
          <meshStandardMaterial color={toxic ? '#7a6a3a' : '#5f8f3a'} />
        </mesh>
      ))}
      {kind === 'fish_spot' && (
        <group ref={fish}>
          {Array.from({ length: Math.max(0, n) }).map((_, i) => {
            const a = (i / Math.max(1, n)) * Math.PI * 2;
            return (
              <group key={i} position={[Math.cos(a) * 0.55, 0.05, Math.sin(a) * 0.55]} rotation={[0, -a, 0]}>
                <mesh scale={[1, 0.45, 0.35]}>
                  <sphereGeometry args={[0.16, 8, 6]} />
                  <meshStandardMaterial color="#c9d3dd" metalness={0.5} roughness={0.3} />
                </mesh>
                <mesh position={[0, 0, -0.17]} rotation={[Math.PI / 2, 0, 0]}>
                  <coneGeometry args={[0.07, 0.12, 3]} />
                  <meshStandardMaterial color="#aab4be" />
                </mesh>
              </group>
            );
          })}
        </group>
      )}
      {toxic && (
        <group ref={bubbles}>
          {around(5, 0.6, rnd, 1).map(([x, z], i) => (
            <mesh key={i} position={[x, 0.05, z]}>
              <sphereGeometry args={[0.05, 6, 6]} />
              <meshStandardMaterial color="#c8d86a" transparent opacity={0.8} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}

function Cactus({ n }: { n: number }) {
  const green = '#4f8a3a';
  return (
    <group>
      <mesh position={[0, 0.75, 0]} castShadow>
        <cylinderGeometry args={[0.22, 0.26, 1.5, 8]} />
        <meshStandardMaterial color={green} flatShading />
      </mesh>
      <mesh position={[0, 1.5, 0]}>
        <sphereGeometry args={[0.22, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={green} flatShading />
      </mesh>
      {[[-1, 0.7, 0.45], [1, 0.95, 0.35]].map(([side, y, h], i) => (
        <group key={i} position={[side * 0.3, y, 0]}>
          <mesh rotation={[0, 0, (side * Math.PI) / 2]}>
            <cylinderGeometry args={[0.1, 0.1, 0.3, 6]} />
            <meshStandardMaterial color={green} flatShading />
          </mesh>
          <mesh position={[side * 0.13, h / 2, 0]}>
            <cylinderGeometry args={[0.1, 0.11, h, 6]} />
            <meshStandardMaterial color={green} flatShading />
          </mesh>
        </group>
      ))}
      {Array.from({ length: Math.min(n, 3) }).map((_, i) => (
        <mesh key={i} position={[Math.cos(i * 2.1) * 0.14, 1.62, Math.sin(i * 2.1) * 0.14]}>
          <sphereGeometry args={[0.09, 8, 8]} />
          <meshStandardMaterial color="#e0457b" roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

function Hive({ n }: { n: number }) {
  const bees = useRef<Group>(null);
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
      <mesh position={[0, 0.6, 0]} castShadow>
        <cylinderGeometry args={[0.45, 0.55, 1.2, 8]} />
        <meshStandardMaterial color="#5d4037" flatShading />
      </mesh>
      <mesh position={[0, 1.22, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.2, 0.45, 8]} />
        <meshStandardMaterial color="#3e2a22" />
      </mesh>
      {[0.28, 0.22, 0.15].map((r, i) => (
        <mesh key={i} position={[0.45, 1.05 - i * 0.16, 0]}>
          <cylinderGeometry args={[r * (0.6 + n * 0.15), r * (0.7 + n * 0.15), 0.16, 10]} />
          <meshStandardMaterial color="#f2b705" emissive="#6b4e00" emissiveIntensity={0.4} roughness={0.35} />
        </mesh>
      ))}
      <group ref={bees}>
        {Array.from({ length: 6 }).map((_, i) => (
          <mesh key={i}>
            <sphereGeometry args={[0.04, 5, 5]} />
            <meshBasicMaterial color={i % 2 ? '#1a1a1a' : '#ffd000'} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function Tufts({ n, rnd, color, flower, tall }: { n: number; rnd: () => number; color: string; flower?: string; tall?: boolean }) {
  const blades = useMemo(() => around(tall ? 12 : 7, tall ? 0.4 : 0.3, rnd, 1), [rnd, tall]);
  const shown = Math.max(tall ? 5 : 3, Math.round((blades.length * Math.max(1, n)) / 6));
  return (
    <Sway amount={tall ? 0.12 : 0.05} speed={tall ? 1.6 : 1.1} seed={rnd()}>
      {blades.slice(0, shown).map(([x, z, r], i) => (
        <group key={i} position={[x, 0, z]} rotation={[(r - 0.5) * 0.4, r * 6, (r - 0.5) * 0.4]}>
          <mesh position={[0, tall ? 0.45 + r * 0.2 : 0.18, 0]} scale={tall ? 1 : [1.6, 1, 0.5]}>
            <coneGeometry args={[tall ? 0.03 : 0.09, tall ? 0.9 + r * 0.4 : 0.36, 4]} />
            <meshStandardMaterial color={color} flatShading />
          </mesh>
          {flower && i % 3 === 0 && (
            <mesh position={[0, 0.4, 0]}>
              <sphereGeometry args={[0.045, 6, 6]} />
              <meshStandardMaterial color={flower} />
            </mesh>
          )}
        </group>
      ))}
    </Sway>
  );
}

function MossLog({ n }: { n: number }) {
  return (
    <group>
      <mesh position={[0, 0.2, 0]} rotation={[0, 0.4, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.2, 0.22, 1.4, 8]} />
        <meshStandardMaterial color="#4e3b2a" flatShading />
      </mesh>
      {Array.from({ length: Math.max(1, n + 1) }).map((_, i) => (
        <mesh key={i} position={[Math.cos(0.4) * (i * 0.3 - 0.4), 0.36, -Math.sin(0.4) * (i * 0.3 - 0.4)]} scale={[1, 0.35, 1]}>
          <sphereGeometry args={[0.18, 8, 6]} />
          <meshStandardMaterial color="#a4d36a" roughness={1} />
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
              <meshStandardMaterial color="#8b5a2b" flatShading />
            </mesh>
            <mesh position={[(k - 1) * 0.2, 0, 0.451]}>
              <circleGeometry args={[0.08, 7]} />
              <meshStandardMaterial color="#d9b382" />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function StonePile({ n, rnd }: { n: number; rnd: () => number }) {
  const stones = useMemo(() => around(6, 0.35, rnd, 1), [rnd]);
  const greys = ['#9e9e9e', '#8a8a8a', '#b0aca6', '#7d7a75'];
  return (
    <group>
      {stones.slice(0, Math.max(1, n)).map(([x, z, r], i) => (
        <mesh key={i} position={[x, 0.07 + (i > 3 ? 0.12 : 0), z]} rotation={[r, r * 3, 0]} scale={[1.3, 0.5, 1]} castShadow>
          <dodecahedronGeometry args={[0.16 + r * 0.06, 0]} />
          <meshStandardMaterial color={greys[i % 4]} flatShading roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

/** One resource node: a detailed low-poly model whose visible fruit/fish/etc. tracks available units. Hover for a tooltip. */
export const ResourceMesh = memo(function ResourceMesh({ node, units }: { node: ResourceNode; units: number }) {
  const [hover, setHover] = useState(false);
  const rnd = useMemo(() => hash(node.id), [node.id]);
  const n = Math.min(units, 6);
  const def = NODES[node.kind];
  let body: React.ReactNode;
  switch (node.kind) {
    case 'berry_bush': body = <BerryBush n={n} rnd={rnd} />; break;
    case 'fruit_tree': body = <FruitTree n={n} rnd={rnd} />; break;
    case 'mushroom_patch': body = <Mushrooms n={n} rnd={rnd} toxic={false} />; break;
    case 'toxic_mushroom_patch': body = <Mushrooms n={n} rnd={rnd} toxic />; break;
    case 'fish_spot':
    case 'fresh_water':
    case 'toxic_water': body = <Water kind={node.kind} n={n} rnd={rnd} />; break;
    case 'cactus': body = <Cactus n={n} />; break;
    case 'honey_hive': body = <Hive n={n} />; break;
    case 'herb_patch': body = <Tufts n={n} rnd={rnd} color="#aebfb2" flower="#9b7fd1" />; break;
    case 'fiber_grass': body = <Tufts n={n} rnd={rnd} color="#c2b35a" tall />; break;
    case 'moss_patch': body = <MossLog n={n} />; break;
    case 'wood_pile': body = <WoodPile n={n} />; break;
    case 'stone_pile': body = <StonePile n={n} rnd={rnd} />; break;
  }
  return (
    <group
      position={[node.position.x, 0, node.position.z]}
      rotation={[0, rnd() * Math.PI * 2, 0]}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHover(true);
      }}
      onPointerOut={() => setHover(false)}
    >
      <group scale={units < 1 && node.kind !== 'fresh_water' && node.kind !== 'toxic_water' ? 0.8 : 1}>{body}</group>
      {hover && (
        <Label
          position={[0, node.kind === 'fruit_tree' ? 4.4 : 1.8, 0]}
          bg="rgba(20,24,32,0.9)"
          lines={[`${node.id} · ${node.kind.replace(/_/g, ' ')} (truth)`, `looks like: ${def.appearance}`, `${units}/${node.maxUnits} units · regrows ${def.regrowPerMin}/min`]}
        />
      )}
    </group>
  );
});
