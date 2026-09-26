import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Group } from 'three';
import { CONFIG } from '../shared/config';
import type { Agent } from '../shared/types';
import { useSim, useWorld } from '../sim/react';
import { Label } from './Label';

function AgentMesh({ agent, selected, onSelect }: { agent: Agent; selected: boolean; onSelect: () => void }) {
  const store = useSim();
  const ref = useRef<Group>(null);
  useFrame((_, dt) => {
    const a = store.getState().agents[agent.id];
    const g = ref.current;
    if (!a || !g) return;
    // Render-side smoothing toward authoritative sim position.
    const k = 1 - Math.exp(-dt * 12);
    g.position.x += (a.position.x - g.position.x) * k;
    g.position.z += (a.position.z - g.position.z) * k;
    g.rotation.y = -a.heading + Math.PI / 2;
  });
  const exhausted = agent.status === 'exhausted';
  return (
    <group ref={ref} position={[agent.position.x, 0, agent.position.z]}>
      <mesh
        position={[0, 0.7, 0]}
        rotation={exhausted ? [0, 0, Math.PI / 2] : [0, 0, 0]}
        castShadow
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
      >
        <capsuleGeometry args={[CONFIG.agentRadius, 0.5, 4, 12]} />
        <meshStandardMaterial color={exhausted ? '#666' : agent.color} flatShading />
      </mesh>
      <mesh position={[0, 0.95, CONFIG.agentRadius * 0.8]}>
        <sphereGeometry args={[0.1, 8, 8]} />
        <meshStandardMaterial color="#111" />
      </mesh>
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[CONFIG.senseRadius - 0.05, CONFIG.senseRadius, 64]} />
          <meshBasicMaterial color={agent.color} transparent opacity={0.5} />
        </mesh>
      )}
      <Label
        position={[0, 1.9, 0]}
        outline={selected ? '#ffffff' : undefined}
        lines={[
          `${agent.id} · ${agent.controller.kind === 'llm' ? 'LLM' : agent.controller.kind.toUpperCase()}${
            agent.controller.pending ? ' …' : ''
          }${agent.controller.lastError ? ' ⚠' : ''}`,
          `⚡${agent.energy.toFixed(0)}  food ${agent.inventory}${exhausted ? '  EXHAUSTED' : ''}`,
        ]}
      />
    </group>
  );
}

function TargetLines() {
  const world = useWorld();
  return (
    <>
      {Object.values(world.agents)
        .filter((a) => a.target)
        .map((a) => {
          const t = a.target!;
          const dx = t.x - a.position.x;
          const dz = t.z - a.position.z;
          const len = Math.hypot(dx, dz);
          return (
            <mesh
              key={a.id}
              position={[(a.position.x + t.x) / 2, 0.03, (a.position.z + t.z) / 2]}
              rotation={[-Math.PI / 2, 0, -Math.atan2(dz, dx)]}
            >
              <planeGeometry args={[len, 0.06]} />
              <meshBasicMaterial color={a.color} transparent opacity={0.45} />
            </mesh>
          );
        })}
    </>
  );
}

function World({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string | null) => void }) {
  const world = useWorld();
  const size = CONFIG.worldSize;
  return (
    <>
      <color attach="background" args={['#bcd7e6']} />
      <fog attach="fog" args={['#bcd7e6', 40, 90]} />
      <hemisphereLight args={['#ffffff', '#6b8f5e', 0.8]} />
      <directionalLight position={[12, 20, 8]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]}>
        <orthographicCamera attach="shadow-camera" args={[-20, 20, 20, -20, 1, 60]} />
      </directionalLight>

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow onClick={() => onSelect(null)}>
        <planeGeometry args={[size, size]} />
        <meshStandardMaterial color="#8fbf73" />
      </mesh>
      <gridHelper args={[size, size, '#6f9d58', '#7fae66']} position={[0, 0.01, 0]} />
      {[
        [0, -size / 2, size, 0.3],
        [0, size / 2, size, 0.3],
        [-size / 2, 0, 0.3, size],
        [size / 2, 0, 0.3, size],
      ].map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, 0.25, z]} castShadow receiveShadow>
          <boxGeometry args={[w, 0.5, d]} />
          <meshStandardMaterial color="#7a6a58" />
        </mesh>
      ))}

      {Object.values(world.obstacles).map((o) => (
        <mesh key={o.id} position={[o.position.x, o.height / 2, o.position.z]} castShadow receiveShadow>
          {o.shape === 'box' ? (
            <boxGeometry args={[o.radius * 1.6, o.height, o.radius * 1.6]} />
          ) : (
            <cylinderGeometry args={[o.radius, o.radius, o.height, 7]} />
          )}
          <meshStandardMaterial color="#8a8f98" flatShading />
        </mesh>
      ))}

      {Object.values(world.food).map((f) => (
        <group key={f.id} position={[f.position.x, 0, f.position.z]}>
          {Array.from({ length: f.units }).map((_, i) => {
            const ang = (i / Math.max(1, f.units)) * Math.PI * 2;
            return (
              <mesh key={i} position={[Math.cos(ang) * 0.4, 0.2, Math.sin(ang) * 0.4]} castShadow>
                <icosahedronGeometry args={[0.2, 0]} />
                <meshStandardMaterial color="#e63946" flatShading />
              </mesh>
            );
          })}
          <Label position={[0, 1, 0]} bg="rgba(160,30,40,0.85)" lines={[`${f.id} ×${f.units}`]} />
        </group>
      ))}

      <TargetLines />
      {Object.values(world.agents).map((a) => (
        <AgentMesh key={`${world.runId}-${a.id}`} agent={a} selected={a.id === selectedId} onSelect={() => onSelect(a.id)} />
      ))}
      <OrbitControls makeDefault maxPolarAngle={Math.PI / 2.2} target={[0, 0, 0]} />
    </>
  );
}

export function Scene(props: { selectedId: string | null; onSelect: (id: string | null) => void }) {
  return (
    <Canvas shadows camera={{ position: [0, 24, 22], fov: 50 }}>
      <World {...props} />
    </Canvas>
  );
}
