import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, type Group, ShaderMaterial } from 'three';
import { useSim } from '../sim/react';
import { mulberry32 } from '../sim/rng';
import { ATMOS } from './atmosphere';
import type { TerrainModel } from './terrain-model';

/**
 * Ambient scenery life: butterflies, birds, fireflies. Purely decorative — not sim entities, not food,
 * invisible to agents, and not clickable. Kept small and clearly distinct from agents.
 */
export function Ambient({ terrain }: { terrain: TerrainModel }) {
  return (
    <>
      <Butterflies terrain={terrain} />
      <Birds />
      <Fireflies terrain={terrain} />
    </>
  );
}

const WING_COLORS = ['#fff4d6', '#ffd23f', '#ff9f43', '#7ec8ff', '#f78fb3', '#ffffff'];

function Butterflies({ terrain }: { terrain: TerrainModel }) {
  const store = useSim();
  const ref = useRef<Group>(null);
  const flies = useMemo(() => {
    const rnd = mulberry32(31);
    const out: { hx: number; hz: number; a: number[]; color: string }[] = [];
    for (let i = 0; i < 400 && out.length < 34; i++) {
      const x = (rnd() * 2 - 1) * terrain.half * 0.95;
      const z = (rnd() * 2 - 1) * terrain.half * 0.95;
      const k = terrain.biomeAt(x, z);
      if (k !== 'meadow' && k !== 'lake' && !(k === 'forest' && rnd() < 0.2)) continue;
      out.push({ hx: x, hz: z, a: Array.from({ length: 6 }, () => rnd()), color: WING_COLORS[Math.floor(rnd() * WING_COLORS.length)] });
    }
    return out;
  }, [terrain]);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const w = store.getState().weather;
    g.visible = ATMOS.uNight.value < 0.5 && (w === 'clear' || w === 'cloudy');
    if (!g.visible) return;
    const t = clock.elapsedTime;
    g.children.forEach((b, i) => {
      const f = flies[i];
      const [a0, a1, a2, a3, a4, a5] = f.a;
      const tt = t * (0.35 + a0 * 0.3) + a1 * 50;
      const x = f.hx + Math.sin(tt) * 2.6 + Math.sin(tt * 2.3 + a2 * 9) * 0.8;
      const z = f.hz + Math.cos(tt * 0.8 + a3 * 5) * 2.6 + Math.cos(tt * 1.7) * 0.7;
      const y = terrain.height(x, z) + 0.7 + Math.sin(tt * 3.1 + a4 * 7) * 0.35 + a5 * 0.6;
      const dx = x - b.position.x;
      const dz = z - b.position.z;
      b.position.set(x, y, z);
      if (Math.abs(dx) + Math.abs(dz) > 1e-4) b.rotation.y = Math.atan2(dx, dz);
      const flap = Math.sin(t * (16 + a0 * 6) + a1 * 20) * 1.1;
      (b.children[0] as Group).rotation.z = 0.2 + flap;
      (b.children[1] as Group).rotation.z = -0.2 - flap;
    });
  });
  return (
    <group ref={ref}>
      {flies.map((f, i) => (
        <group key={i} scale={0.9}>
          {[1, -1].map((side) => (
            <group key={side}>
              <mesh position={[side * 0.09, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <circleGeometry args={[0.1, 6]} />
                <meshStandardMaterial color={f.color} side={DoubleSide} roughness={0.6} emissive={f.color} emissiveIntensity={0.15} />
              </mesh>
            </group>
          ))}
        </group>
      ))}
    </group>
  );
}

function Birds() {
  const ref = useRef<Group>(null);
  const store = useSim();
  const birds = useMemo(() => {
    const rnd = mulberry32(77);
    return Array.from({ length: 14 }, (_, i) => ({
      flock: i < 8 ? 0 : 1,
      off: [rnd() * 6 - 3, rnd() * 3, rnd() * 6 - 3],
      phase: rnd() * 10,
    }));
  }, []);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    g.visible = ATMOS.uNight.value < 0.6 && store.getState().weather !== 'storm';
    const t = clock.elapsedTime;
    g.children.forEach((b, i) => {
      const bd = birds[i];
      const R = bd.flock ? 55 : 38;
      const sp = bd.flock ? 0.05 : 0.07;
      const a = t * sp + bd.flock * 2.5;
      const cx = bd.flock ? -20 : 15;
      const cz = bd.flock ? 10 : -12;
      b.position.set(cx + Math.cos(a) * R + bd.off[0], (bd.flock ? 36 : 30) + bd.off[1] + Math.sin(t * 0.3 + bd.phase) * 1.5, cz + Math.sin(a) * R + bd.off[2]);
      b.rotation.y = -a;
      const flap = Math.sin(t * 7 + bd.phase * 3) > 0.2 ? Math.sin(t * 9 + bd.phase) * 0.6 : 0.1;
      (b.children[0] as Group).rotation.x = flap;
      (b.children[1] as Group).rotation.x = -flap;
    });
  });
  return (
    <group ref={ref}>
      {birds.map((_, i) => (
        <group key={i}>
          {[1, -1].map((side) => (
            <group key={side}>
              <mesh position={[0, 0, side * 0.45]} rotation={[0, side > 0 ? 0.35 : -0.35, 0]}>
                <boxGeometry args={[0.28, 0.03, 0.9]} />
                <meshBasicMaterial color="#2a2d33" />
              </mesh>
            </group>
          ))}
        </group>
      ))}
    </group>
  );
}

function Fireflies({ terrain }: { terrain: TerrainModel }) {
  const ref = useRef<Group>(null);
  const { geometry, material } = useMemo(() => {
    const rnd = mulberry32(12);
    const pts: number[] = [];
    const ph: number[] = [];
    for (let i = 0; i < 2000 && ph.length < 260; i++) {
      const x = (rnd() * 2 - 1) * terrain.half;
      const z = (rnd() * 2 - 1) * terrain.half;
      const k = terrain.biomeAt(x, z);
      const d = k === 'swamp' ? 1 : k === 'forest' ? 0.8 : k === 'lake' ? 0.5 : k === 'meadow' ? 0.25 : 0;
      if (rnd() > d) continue;
      pts.push(x, Math.max(terrain.height(x, z), terrain.lakeLevel) + 0.4 + rnd() * 1.8, z);
      ph.push(rnd() * 100);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
    g.setAttribute('aPhase', new BufferAttribute(new Float32Array(ph), 1));
    const m = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uTime: ATMOS.uTime, uNight: ATMOS.uNight, uDpr: { value: Math.min(2, window.devicePixelRatio) } },
      vertexShader: /* glsl */ `
        attribute float aPhase; uniform float uTime; uniform float uNight; uniform float uDpr;
        varying float vA;
        void main() {
          vec3 p = position;
          p.x += sin(uTime * 0.4 + aPhase) * 0.8;
          p.z += cos(uTime * 0.33 + aPhase * 1.3) * 0.8;
          p.y += sin(uTime * 0.7 + aPhase * 2.1) * 0.3;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float blink = smoothstep(0.55, 1.0, sin(uTime * (1.2 + fract(aPhase) * 1.6) + aPhase));
          vA = uNight * blink;
          gl_PointSize = uDpr * 70.0 / -mv.z;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float core = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vec3(1.0, 0.95, 0.45) * (1.0 + 4.0 * core * core), core * vA);
        }`,
    });
    return { geometry: g, material: m };
  }, [terrain]);
  useFrame(() => {
    if (ref.current) ref.current.visible = ATMOS.uNight.value > 0.05;
  });
  return (
    <group ref={ref}>
      <points geometry={geometry} material={material} frustumCulled={false} />
    </group>
  );
}
