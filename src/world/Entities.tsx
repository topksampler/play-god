import { memo } from 'react';
import { HAZARDS, NODES } from '../shared/catalog';
import type { GroundItem, Hazard, Obstacle, ResourceNode, Structure } from '../shared/types';

const ring = (n: number, r: number) =>
  Array.from({ length: n }, (_, i) => [Math.cos((i / Math.max(1, n)) * Math.PI * 2) * r, Math.sin((i / Math.max(1, n)) * Math.PI * 2) * r] as const);

/** Low-poly silhouettes per resource kind; visible fruit count tracks available units. */
export const ResourceMesh = memo(function ResourceMesh({ node, units }: { node: ResourceNode; units: number }) {
  const def = NODES[node.kind];
  const { x, z } = node.position;
  const n = Math.min(units, 6);
  const dim = units < 1 ? 0.35 : 1;
  switch (node.kind) {
    case 'berry_bush':
      return (
        <group position={[x, 0, z]}>
          <mesh position={[0, 0.5, 0]} castShadow>
            <icosahedronGeometry args={[0.7, 0]} />
            <meshStandardMaterial color="#2f6b2f" flatShading />
          </mesh>
          {ring(n, 0.55).map(([dx, dz], i) => (
            <mesh key={i} position={[dx, 0.6 + (i % 2) * 0.2, dz]}>
              <sphereGeometry args={[0.12, 6, 6]} />
              <meshStandardMaterial color={def.color} />
            </mesh>
          ))}
        </group>
      );
    case 'fruit_tree':
      return (
        <group position={[x, 0, z]}>
          <mesh position={[0, 1.2, 0]} castShadow>
            <cylinderGeometry args={[0.18, 0.25, 2.4, 6]} />
            <meshStandardMaterial color="#6b4423" flatShading />
          </mesh>
          <mesh position={[0, 2.8, 0]} castShadow>
            <icosahedronGeometry args={[1.3, 0]} />
            <meshStandardMaterial color="#3e8e41" flatShading />
          </mesh>
          {ring(n, 1.1).map(([dx, dz], i) => (
            <mesh key={i} position={[dx, 2.4, dz]}>
              <sphereGeometry args={[0.18, 6, 6]} />
              <meshStandardMaterial color={def.color} />
            </mesh>
          ))}
        </group>
      );
    case 'mushroom_patch':
    case 'toxic_mushroom_patch':
      return (
        <group position={[x, 0, z]}>
          {ring(Math.max(1, n), 0.35).map(([dx, dz], i) => (
            <group key={i} position={[dx, 0, dz]}>
              <mesh position={[0, 0.12, 0]}>
                <cylinderGeometry args={[0.05, 0.06, 0.24, 5]} />
                <meshStandardMaterial color="#f1e3c8" />
              </mesh>
              <mesh position={[0, 0.26, 0]}>
                <sphereGeometry args={[0.16, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2]} />
                <meshStandardMaterial color={def.color} transparent opacity={dim} />
              </mesh>
            </group>
          ))}
        </group>
      );
    case 'fish_spot':
    case 'fresh_water':
    case 'toxic_water':
      return (
        <group position={[x, 0.03, z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[1.1, 20]} />
            <meshStandardMaterial color={node.kind === 'toxic_water' ? def.color : '#4dabf7'} transparent opacity={0.85} roughness={0.2} />
          </mesh>
          {node.kind === 'fish_spot' &&
            ring(n, 0.5).map(([dx, dz], i) => (
              <mesh key={i} position={[dx, 0.05, dz]} rotation={[0, i, 0]}>
                <boxGeometry args={[0.3, 0.05, 0.1]} />
                <meshStandardMaterial color={def.color} />
              </mesh>
            ))}
        </group>
      );
    case 'cactus':
      return (
        <group position={[x, 0, z]}>
          <mesh position={[0, 0.6, 0]} castShadow>
            <cylinderGeometry args={[0.25, 0.3, 1.2, 7]} />
            <meshStandardMaterial color="#5a8f3c" flatShading />
          </mesh>
          {ring(n, 0.28).map(([dx, dz], i) => (
            <mesh key={i} position={[dx, 1.1, dz]}>
              <sphereGeometry args={[0.1, 6, 6]} />
              <meshStandardMaterial color={def.color} />
            </mesh>
          ))}
        </group>
      );
    case 'honey_hive':
      return (
        <group position={[x, 0, z]}>
          <mesh position={[0, 0.8, 0]} castShadow>
            <cylinderGeometry args={[0.45, 0.55, 1.6, 7]} />
            <meshStandardMaterial color="#5d4037" flatShading />
          </mesh>
          <mesh position={[0, 1.1, 0.45]}>
            <sphereGeometry args={[0.18 + n * 0.04, 6, 6]} />
            <meshStandardMaterial color={def.color} emissive="#6b4e00" />
          </mesh>
        </group>
      );
    case 'wood_pile':
      return (
        <group position={[x, 0.1, z]}>
          {ring(Math.max(1, n), 0.2).map(([dx, dz], i) => (
            <mesh key={i} position={[dx, (i % 2) * 0.12, dz]} rotation={[0, i * 1.1, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[0.08, 0.08, 1, 5]} />
              <meshStandardMaterial color={def.color} transparent opacity={dim} />
            </mesh>
          ))}
        </group>
      );
    case 'stone_pile':
      return (
        <group position={[x, 0.1, z]}>
          {ring(Math.max(1, n), 0.35).map(([dx, dz], i) => (
            <mesh key={i} position={[dx, 0, dz]} castShadow>
              <dodecahedronGeometry args={[0.18, 0]} />
              <meshStandardMaterial color={def.color} flatShading transparent opacity={dim} />
            </mesh>
          ))}
        </group>
      );
    default:
      // herbs, moss, fiber grass: tufts
      return (
        <group position={[x, 0, z]}>
          {ring(Math.max(2, n), 0.3).map(([dx, dz], i) => (
            <mesh key={i} position={[dx, 0.25, dz]}>
              <coneGeometry args={[0.1, 0.5 + (i % 3) * 0.15, 4]} />
              <meshStandardMaterial color={def.color} flatShading transparent opacity={dim} />
            </mesh>
          ))}
        </group>
      );
  }
});

export const ObstacleMesh = memo(function ObstacleMesh({ o }: { o: Obstacle }) {
  const { x, z } = o.position;
  switch (o.shape) {
    case 'rock':
      return (
        <mesh position={[x, o.height / 2 - 0.1, z]} castShadow receiveShadow>
          <dodecahedronGeometry args={[o.radius, 0]} />
          <meshStandardMaterial color="#8a8f98" flatShading />
        </mesh>
      );
    case 'boulder':
      return (
        <mesh position={[x, o.radius * 0.7, z]} scale={[1, o.height / (o.radius * 2), 1]} castShadow receiveShadow>
          <icosahedronGeometry args={[o.radius, 0]} />
          <meshStandardMaterial color="#7a7266" flatShading />
        </mesh>
      );
    case 'tree':
      return (
        <group position={[x, 0, z]}>
          <mesh position={[0, o.height * 0.25, 0]} castShadow>
            <cylinderGeometry args={[o.radius * 0.5, o.radius * 0.7, o.height * 0.5, 6]} />
            <meshStandardMaterial color="#5b3a1e" flatShading />
          </mesh>
          <mesh position={[0, o.height * 0.65, 0]} castShadow>
            <coneGeometry args={[o.radius * 3, o.height * 0.7, 7]} />
            <meshStandardMaterial color="#2d5a27" flatShading />
          </mesh>
        </group>
      );
    case 'log':
      return (
        <mesh position={[x, o.radius, z]} rotation={[0, -(o.angle ?? 0), Math.PI / 2]} castShadow>
          <cylinderGeometry args={[o.radius, o.radius, (o.halfLength ?? 1) * 2, 7]} />
          <meshStandardMaterial color="#6d4c2f" flatShading />
        </mesh>
      );
    case 'cliff':
      return (
        <mesh position={[x, o.height / 2, z]} rotation={[0, -(o.angle ?? 0), 0]} castShadow receiveShadow>
          <boxGeometry args={[(o.halfLength ?? 1) * 2, o.height, o.radius * 2]} />
          <meshStandardMaterial color="#8d8272" flatShading />
        </mesh>
      );
    case 'bush':
      return (
        <mesh position={[x, 0.45, z]} scale={[1, 0.6, 1]} castShadow>
          <icosahedronGeometry args={[o.radius, 0]} />
          <meshStandardMaterial color="#557a3a" flatShading transparent opacity={0.9} />
        </mesh>
      );
    case 'lake':
      return (
        <mesh position={[x, 0.04, z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <circleGeometry args={[o.radius, 40]} />
          <meshStandardMaterial color="#2f7fbf" roughness={0.15} metalness={0.1} />
        </mesh>
      );
  }
});

export const HazardMesh = memo(function HazardMesh({ h }: { h: Hazard }) {
  const def = HAZARDS[h.kind];
  return (
    <mesh position={[h.position.x, 0.05, h.position.z]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[h.radius, 28]} />
      <meshBasicMaterial color={def.color} transparent opacity={0.35} depthWrite={false} />
    </mesh>
  );
});

export function StructureMesh({ s, lit }: { s: Structure; lit: boolean }) {
  const { x, z } = s.position;
  switch (s.kind) {
    case 'campfire':
      return (
        <group position={[x, 0, z]}>
          {ring(5, 0.4).map(([dx, dz], i) => (
            <mesh key={i} position={[dx, 0.08, dz]}>
              <dodecahedronGeometry args={[0.12, 0]} />
              <meshStandardMaterial color="#777" flatShading />
            </mesh>
          ))}
          {lit && (
            <>
              <mesh position={[0, 0.3, 0]}>
                <coneGeometry args={[0.25, 0.6, 6]} />
                <meshStandardMaterial color="#ff7b00" emissive="#ff4800" emissiveIntensity={2} />
              </mesh>
              <pointLight position={[0, 1, 0]} color="#ff9a3c" intensity={8} distance={10} />
            </>
          )}
        </group>
      );
    case 'shelter':
      return (
        <mesh position={[x, 0.9, z]} rotation={[0, Math.PI / 4, 0]} castShadow>
          <coneGeometry args={[1.5, 1.8, 4]} />
          <meshStandardMaterial color="#9c6b3d" flatShading />
        </mesh>
      );
    case 'cache':
      return (
        <mesh position={[x, 0.35, z]} castShadow>
          <boxGeometry args={[0.8, 0.7, 0.6]} />
          <meshStandardMaterial color="#a1887f" flatShading />
        </mesh>
      );
    case 'sign':
      return (
        <group position={[x, 0, z]}>
          <mesh position={[0, 0.5, 0]}>
            <boxGeometry args={[0.08, 1, 0.08]} />
            <meshStandardMaterial color="#6d4c2f" />
          </mesh>
          <mesh position={[0, 1, 0]}>
            <boxGeometry args={[0.7, 0.35, 0.05]} />
            <meshStandardMaterial color="#d7b98e" />
          </mesh>
        </group>
      );
  }
}

export function GroundItemMesh({ g }: { g: GroundItem }) {
  return (
    <mesh position={[g.position.x, 0.1, g.position.z]}>
      <boxGeometry args={[0.2, 0.2, 0.2]} />
      <meshStandardMaterial color={g.item.kind === 'rotten_food' ? '#556b2f' : '#e0c080'} />
    </mesh>
  );
}
