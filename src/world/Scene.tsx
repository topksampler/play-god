import { Line, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { type Group, type Mesh, type Vector3 } from 'three';
import { CONFIG } from '../shared/config';
import type { Agent, WorldState } from '../shared/types';
import { senseRadius } from '../sim/environment';
import { dist } from '../sim/geometry';
import { useSim, useWorldThrottled } from '../sim/react';
import { Ambient } from './Ambient';
import { CommsLayer } from './Comms';
import { Creature } from './Creature';
import { Effects } from './Effects';
import { Flora } from './Flora';
import { FlyModel } from './FlyModel';
import { GroundItemMesh, HazardMesh, ObstacleMesh, StructureMesh } from './Entities';
import { Label } from './Label';
import { ResourceMesh } from './Resources';
import { Atmosphere, DEBUG_VIEW } from './Sky';
import { Terrain } from './Terrain';
import { TerrainContext, buildTerrainModel, terrainKey, useTerrain, type TerrainModel } from './terrain-model';
import { Lakes, Ponds } from './Water';

const tierLabel = (a: Agent) => (a.controller.kind === 'llm' ? (a.controller.tier === 'smart' ? 'SONNET' : 'HAIKU') : a.controller.kind.toUpperCase());

function AgentMesh({ agent, selected, onSelect }: { agent: Agent; selected: boolean; onSelect: () => void }) {
  const store = useSim();
  const terrain = useTerrain();
  const ref = useRef<Group>(null);
  useFrame((_, dt) => {
    const a = store.getState().agents[agent.id];
    const g = ref.current;
    if (!a || !g) return;
    // Render-side smoothing toward the authoritative sim position; height follows the drawn terrain.
    const k = 1 - Math.exp(-dt * 12);
    g.position.x += (a.position.x - g.position.x) * k;
    g.position.z += (a.position.z - g.position.z) * k;
    g.position.y = terrain.surface(g.position.x, g.position.z);
    g.rotation.y = -a.heading + Math.PI / 2;
  });
  const dead = agent.status === 'dead';
  const c = agent.controller;
  const now = store.getState().time;
  const cond = [agent.poisonedUntil > now && 'POISONED', agent.sickUntil > now && 'SICK'].filter(Boolean).join(' ');
  return (
    <group ref={ref} position={[agent.position.x, terrain.surface(agent.position.x, agent.position.z), agent.position.z]}>
      <group scale={agent.generation > 0 && now - agent.bornAt < CONFIG.childSec ? 0.62 : 1}>
        <Creature agent={agent} onSelect={onSelect} />
      </group>
      <FootRing color={dead ? '#555555' : agent.color} selected={selected} />
      {agent.hasTorch && !dead && <pointLight position={[0, 1.6, 0]} color="#ffb347" intensity={4} distance={9} decay={1.6} />}
      <Label
        position={[0, 2.05, 0]}
        outline={selected ? '#ffffff' : undefined}
        lines={[
          `${agent.id} · ${tierLabel(agent)}${c.pending ? ' …' : ''}${c.lastError ? ' ⚠' : ''}${dead ? ' · DEAD' : ''}`,
          `⚡${agent.energy.toFixed(0)} 💧${agent.hydration.toFixed(0)} ❤${agent.health.toFixed(0)} 🎒${agent.items.length}${cond ? ' ' + cond : ''}`,
          ...(agent.current && !dead ? [`▶ ${agent.current.action.type}${agent.plan.length ? ` (+${agent.plan.length})` : ''}`] : []),
          ...(agent.courting && agent.courting.until > now && !dead ? [`💗 → ${agent.courting.target}`] : []),
        ]}
      />
    </group>
  );
}

const r5 = (v: number) => Math.round(v / 5) * 5;

/** A connectome-driven fruit fly. Only the selected fly gets a stats label, to keep 40+ flies cheap to draw. */
function FlyAgentMesh({ agent, selected, onSelect }: { agent: Agent; selected: boolean; onSelect: () => void }) {
  const store = useSim();
  const terrain = useTerrain();
  const ref = useRef<Group>(null);
  useFrame((_, dt) => {
    const a = store.getState().agents[agent.id];
    const g = ref.current;
    if (!a || !g) return;
    const k = 1 - Math.exp(-dt * 12);
    g.position.x += (a.position.x - g.position.x) * k;
    g.position.z += (a.position.z - g.position.z) * k;
    // Escape flights arc up and back down (altitude is cosmetic; the simulator is 2D).
    const fl = a.fly?.flight;
    const t = store.getState().time;
    const alt = fl && t < fl.until ? Math.sin(Math.min(1, (t - fl.since) / (fl.until - fl.since)) * Math.PI) * 2.2 : 0;
    g.position.y = terrain.surface(g.position.x, g.position.z) + alt;
    g.rotation.y = -a.heading + Math.PI / 2;
  });
  const f = agent.fly!;
  const dead = agent.status === 'dead';
  return (
    <group ref={ref} position={[agent.position.x, terrain.surface(agent.position.x, agent.position.z), agent.position.z]}>
      <group
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
      >
        <FlyModel color={agent.color} feeding={f.feeding} moving={f.speed > 0.05} dead={dead} flying={Boolean(f.flight)} scale={1} />
      </group>
      {selected ? (
        <Label
          position={[0, 1.4, 0]}
          outline="#ffffff"
          lines={[
            `${agent.id} · FLY BRAIN${f.brainStatus === 'running' ? '' : ` (${f.brainStatus})`}${dead ? ' · DEAD' : ''}`,
            // Rounded to 5 so the label texture is not rebuilt on every tiny vital change.
            `⚡${r5(agent.energy)} 💧${r5(agent.hydration)} ❤${r5(agent.health)}${f.feeding ? ' · feeding' : ''}`,
          ]}
        />
      ) : (
        <Label position={[0, 1.1, 0]} lines={[agent.id]} bg="rgba(20,24,32,0.55)" />
      )}
    </group>
  );
}

/** The hand of a swat in progress, sweeping from the swatter onto the fly (drawn from actual simulator state). */
function SwatHand({ flyId, terrain }: { flyId: string; terrain: TerrainModel }) {
  const store = useSim();
  const ref = useRef<Mesh>(null);
  useFrame(() => {
    const s = store.getState();
    const fly = s.agents[flyId];
    const t = fly?.fly?.threat;
    const m = ref.current;
    if (!m) return;
    // Shown during the strike and briefly at the point of impact.
    if (!fly || !t || s.time > t.end + 0.35 || s.time < t.start) {
      m.visible = false;
      return;
    }
    const p = Math.min(1, Math.max(0, (s.time - t.start) / (t.end - t.start)));
    const x = t.from.x + (fly.position.x - t.from.x) * p;
    const z = t.from.z + (fly.position.z - t.from.z) * p;
    m.visible = true;
    m.position.set(x, terrain.surface(x, z) + 1.3 * (1 - p) + 0.12, z);
  });
  return (
    <mesh ref={ref} scale={[0.34, 0.1, 0.42]} castShadow>
      <sphereGeometry args={[1, 14, 10]} />
      <meshStandardMaterial color="#e8b48a" roughness={0.7} />
    </mesh>
  );
}

/** Fly eggs, recent fly sounds, and swats in progress. */
function FlyLife({ world, terrain }: { world: WorldState; terrain: TerrainModel }) {
  const said = new Map<string, string>();
  for (const s of world.flySounds ?? []) if (world.time - s.at < 1.8) said.set(s.flyId, s.text);
  return (
    <>
      {(world.flyEggs ?? []).map((e) => (
        <mesh key={e.id} position={[e.position.x, terrain.surface(e.position.x, e.position.z) + 0.05, e.position.z]} scale={[0.07, 0.05, 0.11]}>
          <sphereGeometry args={[1, 8, 6]} />
          <meshStandardMaterial color="#fbf7ea" roughness={0.4} />
        </mesh>
      ))}
      {[...said.entries()].map(([id, text]) => {
        const a = world.agents[id];
        if (!a) return null;
        const fl = a.fly?.flight;
        const alt = fl && world.time < fl.until ? 2.2 : 0;
        return (
          <Label key={`s-${id}`} position={[a.position.x, terrain.surface(a.position.x, a.position.z) + 1.6 + alt, a.position.z]} bg="rgba(255,244,200,0.95)" outline="#c99a2e" lines={[`🪰 ${text}`]} dark />
        );
      })}
      {Object.values(world.agents)
        .filter((a) => a.fly)
        .map((a) => (
          <SwatHand key={`h-${world.runId}-${a.id}`} flyId={a.id} terrain={terrain} />
        ))}
    </>
  );
}

/** Soft identity disc under each agent; pulses when selected. */
function FootRing({ color, selected }: { color: string; selected: boolean }) {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const s = selected ? 1 + Math.sin(clock.elapsedTime * 4) * 0.08 : 1;
    ref.current.scale.setScalar(s);
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.07, 0]} renderOrder={2}>
      <ringGeometry args={[selected ? 0.5 : 0.42, selected ? 0.66 : 0.54, 40]} />
      <meshBasicMaterial color={color} transparent opacity={selected ? 0.95 : 0.6} depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
    </mesh>
  );
}

/** Dashed path to the agent's actual movement target, draped over the terrain. */
function TargetLine({ agent, terrain }: { agent: Agent; terrain: TerrainModel }) {
  const t = agent.target!;
  const points = useMemo(() => {
    const len = Math.hypot(t.x - agent.position.x, t.z - agent.position.z);
    const n = Math.max(2, Math.ceil(len / 0.8));
    return Array.from({ length: n + 1 }, (_, i) => {
      const x = agent.position.x + ((t.x - agent.position.x) * i) / n;
      const z = agent.position.z + ((t.z - agent.position.z) * i) / n;
      return [x, terrain.surface(x, z) + 0.12, z] as [number, number, number];
    });
  }, [agent.position.x, agent.position.z, t.x, t.z, terrain]);
  const end = points[points.length - 1];
  return (
    <group>
      <Line points={points} color={agent.color} lineWidth={2} dashed dashSize={0.45} gapSize={0.3} transparent opacity={0.8} />
      <mesh position={end} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.18, 0.3, 24]} />
        <meshBasicMaterial color={agent.color} transparent opacity={0.9} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** The selected agent's actual sense radius, draped over the terrain. */
function SenseRing({ center, radius, color, terrain }: { center: { x: number; z: number }; radius: number; color: string; terrain: TerrainModel }) {
  const points = useMemo(
    () =>
      Array.from({ length: 129 }, (_, i) => {
        const a = (i / 128) * Math.PI * 2;
        const x = center.x + Math.cos(a) * radius;
        const z = center.z + Math.sin(a) * radius;
        return [x, Math.max(terrain.surface(x, z), terrain.lakeLevel) + 0.15, z] as [number, number, number];
      }),
    [center.x, center.z, radius, terrain],
  );
  return <Line points={points} color={color} lineWidth={2.2} transparent opacity={0.75} />;
}

/** Smoothly keeps the orbit target on the selected agent (camera keeps its offset, so orbit/zoom still work). */
function FollowCam({ agentId }: { agentId: string | null }) {
  const store = useSim();
  const terrain = useTerrain();
  const controls = useThree((s) => s.controls) as unknown as { target: Vector3; update: () => void } | null;
  const camera = useThree((s) => s.camera);
  useFrame((_, dt) => {
    const a = agentId ? store.getState().agents[agentId] : null;
    if (!a || !controls) return;
    const k = 1 - Math.exp(-dt * 3);
    const dx = (a.position.x - controls.target.x) * k;
    const dz = (a.position.z - controls.target.z) * k;
    const dy = (terrain.surface(a.position.x, a.position.z) + 0.6 - controls.target.y) * k;
    controls.target.x += dx;
    controls.target.y += dy;
    controls.target.z += dz;
    camera.position.x += dx;
    camera.position.y += dy;
    camera.position.z += dz;
    controls.update();
  });
  return null;
}

/** Keeps the orbiting camera above the drawn terrain (mountains are real geometry). */
function CameraGuard() {
  const terrain = useTerrain();
  useFrame(({ camera }) => {
    const min = terrain.height(camera.position.x, camera.position.z) + 2;
    if (camera.position.y < min) camera.position.y = min;
  });
  return null;
}

/** Dev-only hook for scripted screenshots: set camera view and a render-only time offset. */
function DevHook() {
  const controls = useThree((s) => s.controls) as unknown as { target: Vector3; update: () => void } | null;
  const camera = useThree((s) => s.camera);
  const store = useSim();
  useEffect(() => {
    if (!import.meta.env.DEV || !controls) return;
    (window as unknown as { __playgod: unknown }).__playgod = {
      // Dev-only read access and command dispatch for automated smoke tests.
      state: () => store.getLiveState(),
      dispatch: (cmd: Parameters<typeof store.dispatch>[0]) => store.dispatch(cmd),
      setView: (v: { pos?: [number, number, number]; target?: [number, number, number]; timeOffset?: number; weather?: string }) => {
        if (v.pos) camera.position.set(...v.pos);
        if (v.target) controls.target.set(...v.target);
        if (v.timeOffset !== undefined) DEBUG_VIEW.timeOffset = v.timeOffset;
        if (v.weather) store.dispatch({ type: 'edit', source: 'dev screenshot', edit: { type: 'set_weather', weather: v.weather as 'clear' } });
        controls.update();
      },
    };
  }, [controls, camera, store]);
  return null;
}

function World({ selectedId, onSelect, follow }: { selectedId: string | null; onSelect: (id: string | null) => void; follow: boolean }) {
  const world = useWorldThrottled(200);
  const key = terrainKey(world);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const terrain = useMemo(() => buildTerrainModel(world), [key]);
  const selected = selectedId ? world.agents[selectedId] : undefined;
  const obstacles = Object.values(world.obstacles);
  // Flies have no sight radius: show what is within smelling range of the selected fly instead.
  const range = selected ? (selected.fly ? CONFIG.flyOdorSigma * 3 : senseRadius(world, selected)) : 0;
  const labelled = selected ? Object.values(world.resources).filter((r) => dist(r.position, selected.position) <= range) : [];
  return (
    <TerrainContext.Provider value={terrain}>
      <Atmosphere />
      <Terrain model={terrain} obstacles={obstacles} onClick={() => onSelect(null)} />
      <Lakes terrain={terrain} />
      <Ponds terrain={terrain} />
      <Flora terrain={terrain} obstacles={obstacles} />
      <Ambient terrain={terrain} />
      {obstacles.map((o) => (
        <ObstacleMesh key={o.id} o={o} terrain={terrain} />
      ))}
      {Object.values(world.hazards).map((h) => (
        <HazardMesh key={h.id} h={h} terrain={terrain} />
      ))}
      {Object.values(world.resources).map((r) => (
        <ResourceMesh key={r.id} node={r} units={Math.floor(r.units)} terrain={terrain} />
      ))}
      {labelled.map((r) => (
        <Label
          key={r.id}
          position={[r.position.x, terrain.surface(r.position.x, r.position.z) + (r.kind === 'fruit_tree' ? 4.6 : 1.9), r.position.z]}
          bg="rgba(24,28,34,0.72)"
          lines={[`${r.id} ${r.kind.replace(/_/g, ' ')} ×${Math.floor(r.units)}`]}
        />
      ))}
      {Object.values(world.structures).map((s) => (
        <StructureMesh key={s.id} s={s} lit={(s.litUntil ?? 0) > world.time} terrain={terrain} />
      ))}
      {Object.values(world.groundItems).map((g) => (
        <GroundItemMesh key={g.id} g={g} terrain={terrain} />
      ))}
      {Object.values(world.agents)
        .filter((a) => a.target && a.status !== 'dead')
        .map((a) => (
          <TargetLine key={a.id} agent={a} terrain={terrain} />
        ))}
      {selected && <SenseRing center={selected.position} radius={range} color={selected.color} terrain={terrain} />}
      <CommsLayer world={world} terrain={terrain} />
      {world.mode !== 'agents' && <FlyLife world={world} terrain={terrain} />}
      {Object.values(world.agents).map((a) =>
        a.fly ? (
          <FlyAgentMesh key={`${world.runId}-${a.id}`} agent={a} selected={a.id === selectedId} onSelect={() => onSelect(a.id)} />
        ) : (
          <AgentMesh key={`${world.runId}-${a.id}`} agent={a} selected={a.id === selectedId} onSelect={() => onSelect(a.id)} />
        ),
      )}
      <FollowCam agentId={follow ? selectedId : null} />
      <OrbitControls makeDefault maxPolarAngle={1.4} minDistance={4} maxDistance={170} target={[0, 0, 4]} enableDamping dampingFactor={0.08} />
      <CameraGuard />
      <DevHook />
      <Effects />
    </TerrainContext.Provider>
  );
}

export function Scene(props: { selectedId: string | null; onSelect: (id: string | null) => void; follow: boolean }) {
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [30, 25, 56], fov: 45, near: 0.3, far: 2000 }} gl={{ antialias: false, powerPreference: 'high-performance' }}>
      <World {...props} />
    </Canvas>
  );
}
