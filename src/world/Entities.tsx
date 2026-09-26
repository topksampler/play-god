import { memo } from 'react';
import { HAZARDS } from '../shared/catalog';
import type { GroundItem, Hazard, Obstacle, Structure } from '../shared/types';

const ring = (n: number, r: number) =>
  Array.from({ length: n }, (_, i) => [Math.cos((i / Math.max(1, n)) * Math.PI * 2) * r, Math.sin((i / Math.max(1, n)) * Math.PI * 2) * r] as const);

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
