import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { BufferAttribute, BufferGeometry, Color, type DirectionalLight, type Fog, type Group, type HemisphereLight, type LineSegments } from 'three';
import { CONFIG } from '../shared/config';
import type { Agent } from '../shared/types';
import { daylight, senseRadius } from '../sim/environment';
import { dist } from '../sim/geometry';
import { useSim, useWorldThrottled } from '../sim/react';
import { GroundItemMesh, HazardMesh, ObstacleMesh, StructureMesh } from './Entities';
import { ResourceMesh } from './Resources';
import { Label } from './Label';
import { Terrain } from './Terrain';

const tierLabel = (a: Agent) => (a.controller.kind === 'llm' ? (a.controller.tier === 'smart' ? 'SONNET' : 'HAIKU') : a.controller.kind.toUpperCase());

function AgentMesh({ agent, selected, onSelect }: { agent: Agent; selected: boolean; onSelect: () => void }) {
  const store = useSim();
  const ref = useRef<Group>(null);
  useFrame((_, dt) => {
    const a = store.getState().agents[agent.id];
    const g = ref.current;
    if (!a || !g) return;
    // Render-side smoothing toward the authoritative sim position.
    const k = 1 - Math.exp(-dt * 12);
    g.position.x += (a.position.x - g.position.x) * k;
    g.position.z += (a.position.z - g.position.z) * k;
    g.rotation.y = -a.heading + Math.PI / 2;
  });
  const dead = agent.status === 'dead';
  const resting = agent.status === 'resting';
  const c = agent.controller;
  const cond = [agent.poisonedUntil > store.getState().time && 'POISONED', agent.sickUntil > store.getState().time && 'SICK']
    .filter(Boolean)
    .join(' ');
  return (
    <group ref={ref} position={[agent.position.x, 0, agent.position.z]}>
      <mesh
        position={[0, dead ? 0.3 : 0.7, 0]}
        rotation={dead ? [0, 0, Math.PI / 2] : [0, 0, 0]}
        scale={resting ? [1, 0.7, 1] : [1, 1, 1]}
        castShadow
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
      >
        <capsuleGeometry args={[CONFIG.agentRadius, 0.5, 4, 12]} />
        <meshStandardMaterial color={dead ? '#555' : agent.color} flatShading />
      </mesh>
      {!dead && (
        <mesh position={[0, 0.95, CONFIG.agentRadius * 0.8]}>
          <sphereGeometry args={[0.1, 8, 8]} />
          <meshStandardMaterial color="#111" />
        </mesh>
      )}
      {agent.hasTorch && !dead && <pointLight position={[0, 1.6, 0]} color="#ffb347" intensity={3} distance={8} />}
      <Label
        position={[0, 2, 0]}
        outline={selected ? '#ffffff' : undefined}
        lines={[
          `${agent.id} · ${tierLabel(agent)}${c.pending ? ' …' : ''}${c.lastError ? ' ⚠' : ''}${dead ? ' · DEAD' : ''}`,
          `⚡${agent.energy.toFixed(0)} 💧${agent.hydration.toFixed(0)} ❤${agent.health.toFixed(0)} 🎒${agent.items.length}${cond ? ' ' + cond : ''}`,
          ...(agent.current && !dead ? [`▶ ${agent.current.action.type}${agent.plan.length ? ` (+${agent.plan.length})` : ''}`] : []),
        ]}
      />
    </group>
  );
}

function TargetLine({ agent }: { agent: Agent }) {
  const t = agent.target!;
  const dx = t.x - agent.position.x;
  const dz = t.z - agent.position.z;
  const len = Math.hypot(dx, dz);
  return (
    <mesh position={[(agent.position.x + t.x) / 2, 0.06, (agent.position.z + t.z) / 2]} rotation={[-Math.PI / 2, 0, -Math.atan2(dz, dx)]}>
      <planeGeometry args={[len, 0.08]} />
      <meshBasicMaterial color={agent.color} transparent opacity={0.5} depthWrite={false} />
    </mesh>
  );
}

/** Day/night lighting and weather fog, driven by sim time every frame. */
function Sky() {
  const store = useSim();
  const hemi = useRef<HemisphereLight>(null);
  const sun = useRef<DirectionalLight>(null);
  const day = useMemo(() => new Color('#bcd7e6'), []);
  const night = useMemo(() => new Color('#0d1b2a'), []);
  const storm = useMemo(() => new Color('#56606b'), []);
  const tmp = useMemo(() => new Color(), []);
  useFrame(({ scene }) => {
    const s = store.getState();
    const l = daylight(s.time);
    const wx = s.weather === 'storm' ? 0.45 : s.weather === 'rain' ? 0.65 : s.weather === 'cloudy' ? 0.85 : 1;
    tmp.copy(night).lerp(day, l);
    if (wx < 1) tmp.lerp(storm, (1 - wx) * 0.8);
    if (scene.background instanceof Color) scene.background.copy(tmp);
    const fog = scene.fog as Fog | null;
    if (fog) {
      fog.color.copy(tmp);
      fog.far = 60 + 90 * wx;
      fog.near = 30 * wx;
    }
    // Storm lightning: brief random flashes.
    const flash = s.weather === 'storm' && Math.random() < 0.004 ? 2.5 : 0;
    if (flash && scene.background instanceof Color) scene.background.set('#dfe7ff');
    if (hemi.current) hemi.current.intensity = 0.15 + 0.75 * l * wx + flash;
    if (sun.current) {
      sun.current.intensity = 0.1 + 1.6 * l * wx;
      const ang = (s.time / CONFIG.dayLengthSec) * Math.PI * 2;
      sun.current.position.set(Math.cos(ang) * 40, 25 + Math.sin(ang) * 15, 20);
    }
  });
  return (
    <>
      <color attach="background" args={['#bcd7e6']} />
      <fog attach="fog" args={['#bcd7e6', 30, 150]} />
      <hemisphereLight ref={hemi} args={['#ffffff', '#4a6b3a', 0.8]} />
      <directionalLight ref={sun} position={[30, 40, 20]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]}>
        <orthographicCamera attach="shadow-camera" args={[-50, 50, 50, -50, 1, 140]} />
      </directionalLight>
    </>
  );
}

/** Rain streaks (line segments) around the camera target; denser and faster in storms. */
function Rain() {
  const store = useSim();
  const ref = useRef<LineSegments>(null);
  const N = 5000;
  const H = 22;
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    const p = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) {
      const x = (Math.random() - 0.5) * CONFIG.worldSize;
      const y = Math.random() * H;
      const z = (Math.random() - 0.5) * CONFIG.worldSize;
      p.set([x, y, z, x + 0.05, y + 0.7, z], i * 6);
    }
    g.setAttribute('position', new BufferAttribute(p, 3));
    return g;
  }, []);
  useFrame((_, dt) => {
    const w = store.getState().weather;
    const lines = ref.current;
    if (!lines) return;
    lines.visible = w === 'rain' || w === 'storm';
    if (!lines.visible) return;
    const arr = (geometry.attributes.position as BufferAttribute).array as Float32Array;
    const fall = (w === 'storm' ? 34 : 20) * dt;
    const drops = w === 'storm' ? N : N * 0.6;
    geometry.setDrawRange(0, drops * 2);
    for (let i = 0; i < drops; i++) {
      const o = i * 6;
      arr[o + 1] -= fall;
      arr[o + 4] -= fall;
      if (arr[o + 1] < 0) {
        arr[o + 1] += H;
        arr[o + 4] += H;
      }
    }
    geometry.attributes.position.needsUpdate = true;
  });
  return (
    <lineSegments ref={ref} geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial color="#cfe3ff" transparent opacity={0.55} />
    </lineSegments>
  );
}

function World({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string | null) => void }) {
  const world = useWorldThrottled(200);
  const selected = selectedId ? world.agents[selectedId] : undefined;
  const size = CONFIG.worldSize;
  const labelled = selected
    ? Object.values(world.resources).filter((r) => dist(r.position, selected.position) <= senseRadius(world, selected))
    : [];
  return (
    <>
      <Sky />
      <Rain />
      <Terrain biomes={world.biomes} seed={world.seed} onClick={() => onSelect(null)} />
      {[
        [0, -size / 2, size, 0.4],
        [0, size / 2, size, 0.4],
        [-size / 2, 0, 0.4, size],
        [size / 2, 0, 0.4, size],
      ].map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, 0.3, z]} castShadow receiveShadow>
          <boxGeometry args={[w, 0.6, d]} />
          <meshStandardMaterial color="#6b5b4a" />
        </mesh>
      ))}
      {Object.values(world.obstacles).map((o) => (
        <ObstacleMesh key={o.id} o={o} />
      ))}
      {Object.values(world.hazards).map((h) => (
        <HazardMesh key={h.id} h={h} />
      ))}
      {Object.values(world.resources).map((r) => (
        <ResourceMesh key={r.id} node={r} units={Math.floor(r.units)} />
      ))}
      {labelled.map((r) => (
        <Label key={r.id} position={[r.position.x, 1.6, r.position.z]} bg="rgba(40,40,40,0.7)" lines={[`${r.id} ${r.kind.replace(/_/g, ' ')} ×${Math.floor(r.units)}`]} />
      ))}
      {Object.values(world.structures).map((s) => (
        <StructureMesh key={s.id} s={s} lit={(s.litUntil ?? 0) > world.time} />
      ))}
      {Object.values(world.groundItems).map((g) => (
        <GroundItemMesh key={g.id} g={g} />
      ))}
      {Object.values(world.agents)
        .filter((a) => a.target && a.status !== 'dead')
        .map((a) => (
          <TargetLine key={a.id} agent={a} />
        ))}
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[selected.position.x, 0.07, selected.position.z]}>
          <ringGeometry args={[senseRadius(world, selected) - 0.08, senseRadius(world, selected), 64]} />
          <meshBasicMaterial color={selected.color} transparent opacity={0.6} depthWrite={false} />
        </mesh>
      )}
      {Object.values(world.agents).map((a) => (
        <AgentMesh key={`${world.runId}-${a.id}`} agent={a} selected={a.id === selectedId} onSelect={() => onSelect(a.id)} />
      ))}
      <OrbitControls makeDefault maxPolarAngle={Math.PI / 2.15} minDistance={5} maxDistance={120} target={[0, 0, 0]} />
    </>
  );
}

export function Scene(props: { selectedId: string | null; onSelect: (id: string | null) => void }) {
  return (
    <Canvas shadows camera={{ position: [0, 38, 34], fov: 50, far: 400 }}>
      <World {...props} />
    </Canvas>
  );
}

