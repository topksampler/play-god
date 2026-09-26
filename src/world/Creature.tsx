import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Group } from 'three';
import type { Agent, ItemKind } from '../shared/types';
import { useSim } from '../sim/react';

const ITEM_COLOR: Partial<Record<ItemKind, string>> = {
  berries: '#2b3fbf', fruit: '#ff8c1a', mushroom: '#8d6e63', toxic_mushroom: '#d62828', cooked_mushroom: '#a0522d', fish: '#c9d3dd',
  cooked_fish: '#d99a5b', cactus_fruit: '#e0457b', honey: '#f2b705', herb: '#aebfb2', moss: '#a4d36a', wood: '#8b5a2b',
  stone: '#9e9e9e', fiber: '#c2b35a', rotten_food: '#556b2f',
};

/**
 * Low-poly biped with limbs driven by actual sim state: walk cycle when moving, arm poses for gestures,
 * eating/gathering motions, carried items on its back. Poses reflect real actions only.
 */
export function Creature({ agent, onSelect }: { agent: Agent; onSelect: () => void }) {
  const store = useSim();
  const body = useRef<Group>(null);
  const legL = useRef<Group>(null);
  const legR = useRef<Group>(null);
  const armL = useRef<Group>(null);
  const armR = useRef<Group>(null);
  const head = useRef<Group>(null);
  const last = useRef({ x: agent.position.x, z: agent.position.z, phase: 0 });
  const dead = agent.status === 'dead';

  useFrame((_, dt) => {
    const s = store.getState();
    const a = s.agents[agent.id];
    if (!a || !body.current) return;
    const moved = Math.hypot(a.position.x - last.current.x, a.position.z - last.current.z);
    last.current.x = a.position.x;
    last.current.z = a.position.z;
    const walking = moved > 0.001 && a.status === 'active';
    last.current.phase += walking ? dt * (a.sprinting ? 16 : 9) : 0;
    const p = last.current.phase;
    const swing = walking ? Math.sin(p) * 0.7 : 0;
    const gesture = a.gesture && a.gesture.until > s.time ? a.gesture.kind : null;
    const t = performance.now() / 1000;
    const act = a.current?.action.type;
    const recently = a.lastVisibleAct && a.lastVisibleAct.until > s.time ? a.lastVisibleAct.text : '';

    if (legL.current) legL.current.rotation.x = swing;
    if (legR.current) legR.current.rotation.x = -swing;
    let al = -swing * 0.6;
    let ar = swing * 0.6;
    let arz = 0;
    let lean = 0;
    let bob = walking ? Math.abs(Math.sin(p)) * 0.06 : 0;
    if (gesture === 'point') ar = -Math.PI / 2;
    if (gesture === 'wave') { ar = -Math.PI * 0.9; arz = Math.sin(t * 10) * 0.5; }
    if (gesture === 'beckon') { ar = -Math.PI / 2.4 + Math.sin(t * 8) * 0.5; }
    if (gesture === 'jump') { bob = Math.abs(Math.sin(t * 7)) * 0.6; al = ar = -Math.PI * 0.8; }
    if (gesture === 'crouch' || a.status === 'resting') bob = -0.25;
    if (/eating|drinking/.test(recently)) { ar = -Math.PI * 0.75 + Math.sin(t * 12) * 0.15; lean = 0.15; }
    if (/gathering|picking up/.test(recently) || act === 'gather') { lean = 0.35; al = ar = -0.9; }
    if (act === 'build' || act === 'craft' || /building|crafting/.test(recently)) { ar = -1 + Math.sin(t * 14) * 0.6; lean = 0.25; }
    if (armL.current) armL.current.rotation.x = al;
    if (armR.current) { armR.current.rotation.x = ar; armR.current.rotation.z = arz; }
    body.current.position.y = bob;
    body.current.rotation.x = lean;
    if (head.current) head.current.rotation.y = walking ? 0 : Math.sin(t * 0.7 + agent.id.length) * 0.4;
  });

  const color = dead ? '#666' : agent.color;
  const items = agent.items.slice(0, 9);
  return (
    <group
      rotation={dead ? [0, 0, Math.PI / 2] : [0, 0, 0]}
      position={dead ? [0, 0.35, 0] : [0, 0, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <group ref={body}>
        {/* torso */}
        <mesh position={[0, 0.78, 0]} scale={[1, 1.15, 0.85]} castShadow>
          <sphereGeometry args={[0.36, 12, 10]} />
          <meshStandardMaterial color={color} flatShading roughness={0.7} />
        </mesh>
        {/* belly */}
        <mesh position={[0, 0.72, 0.2]} scale={[0.8, 0.9, 0.5]}>
          <sphereGeometry args={[0.3, 10, 8]} />
          <meshStandardMaterial color="#f3e9dc" flatShading />
        </mesh>
        {/* head */}
        <group ref={head} position={[0, 1.28, 0.02]}>
          <mesh castShadow>
            <sphereGeometry args={[0.27, 12, 10]} />
            <meshStandardMaterial color={color} flatShading roughness={0.7} />
          </mesh>
          {[-0.1, 0.1].map((x) => (
            <group key={x} position={[x, 0.05, 0.22]}>
              <mesh>
                <sphereGeometry args={[0.07, 8, 8]} />
                <meshStandardMaterial color="#ffffff" />
              </mesh>
              <mesh position={[0, 0, 0.05]}>
                <sphereGeometry args={[0.035, 6, 6]} />
                <meshStandardMaterial color={dead ? '#999' : '#111'} />
              </mesh>
            </group>
          ))}
          {[-0.15, 0.15].map((x) => (
            <mesh key={x} position={[x, 0.24, -0.02]} rotation={[0, 0, x > 0 ? -0.4 : 0.4]}>
              <coneGeometry args={[0.07, 0.18, 5]} />
              <meshStandardMaterial color={color} flatShading />
            </mesh>
          ))}
        </group>
        {/* arms */}
        {[
          [armL, -0.38],
          [armR, 0.38],
        ].map(([ref, x], i) => (
          <group key={i} ref={ref as React.RefObject<Group>} position={[x as number, 0.98, 0]}>
            <mesh position={[0, -0.22, 0]} castShadow>
              <capsuleGeometry args={[0.07, 0.3, 3, 6]} />
              <meshStandardMaterial color={color} flatShading />
            </mesh>
            <mesh position={[0, -0.44, 0]}>
              <sphereGeometry args={[0.08, 6, 6]} />
              <meshStandardMaterial color="#f3e9dc" />
            </mesh>
          </group>
        ))}
        {/* back pouch with carried items (what others can see it holding) */}
        {items.length > 0 && (
          <group position={[0, 0.85, -0.34]}>
            <mesh scale={[1, 0.8, 0.5]}>
              <sphereGeometry args={[0.24, 8, 6]} />
              <meshStandardMaterial color="#7a5c3e" flatShading />
            </mesh>
            {items.map((it, i) => (
              <mesh key={it.id} position={[((i % 3) - 1) * 0.12, 0.18 + Math.floor(i / 3) * 0.1, -0.05]}>
                <sphereGeometry args={[0.065, 6, 6]} />
                <meshStandardMaterial color={ITEM_COLOR[it.kind] ?? '#ccc'} />
              </mesh>
            ))}
          </group>
        )}
      </group>
      {/* legs */}
      {[
        [legL, -0.16],
        [legR, 0.16],
      ].map(([ref, x], i) => (
        <group key={i} ref={ref as React.RefObject<Group>} position={[x as number, 0.45, 0]}>
          <mesh position={[0, -0.22, 0]} castShadow>
            <capsuleGeometry args={[0.08, 0.28, 3, 6]} />
            <meshStandardMaterial color={color} flatShading />
          </mesh>
          <mesh position={[0, -0.42, 0.06]} scale={[1, 0.5, 1.5]}>
            <sphereGeometry args={[0.09, 6, 6]} />
            <meshStandardMaterial color="#3b2f2a" />
          </mesh>
        </group>
      ))}
    </group>
  );
}
