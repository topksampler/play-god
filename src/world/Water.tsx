import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BufferAttribute, Color, DoubleSide, type Group, RingGeometry, ShaderMaterial } from 'three';
import { ATMOS } from './atmosphere';
import { hashRng } from './noise';
import type { TerrainModel, WaterKind } from './terrain-model';

type WaterLook = { shallow: string; deep: string; foam: string; alpha: number; foamAmt: number };
const LOOKS: Record<'lake' | WaterKind, WaterLook> = {
  lake: { shallow: '#62c6c4', deep: '#0d466a', foam: '#f2fbff', alpha: 0.9, foamAmt: 1 },
  fresh_water: { shallow: '#72d0d2', deep: '#16688c', foam: '#f2fbff', alpha: 0.86, foamAmt: 0.8 },
  fish_spot: { shallow: '#5cc0b2', deep: '#135d74', foam: '#f2fbff', alpha: 0.86, foamAmt: 0.8 },
  toxic_water: { shallow: '#a3a83c', deep: '#4b561b', foam: '#d9dc8a', alpha: 0.96, foamAmt: 0.9 },
};

const vertex = /* glsl */ `
attribute float aDepth;
uniform float uTime;
varying float vDepth;
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vDepth = aDepth;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  wp.y += (sin(wp.x * 0.55 + uTime * 1.1) + cos(wp.z * 0.63 + uTime * 0.9)) * 0.012 * smoothstep(0.0, 0.4, aDepth);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const fragment = /* glsl */ `
uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uFoam;
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunColor;
uniform float uTime; uniform float uWind; uniform float uNight; uniform float uAlpha; uniform float uFoamAmt;
varying float vDepth;
varying vec3 vWorld;
#include <common>
#include <fog_pars_fragment>
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float waves(vec2 p) {
  float t = uTime;
  return vnoise(p * 1.1 + vec2(t * 0.32, t * 0.18)) * 0.5
       + vnoise(p * 2.7 - vec2(t * 0.22, -t * 0.37)) * 0.3
       + vnoise(p * 6.3 + vec2(-t * 0.55, t * 0.47)) * 0.2;
}
void main() {
  vec2 p = vWorld.xz;
  float e = 0.06;
  float amp = (0.18 + 0.22 * uWind);
  float h0 = waves(p);
  vec3 n = normalize(vec3((h0 - waves(p + vec2(e, 0.0))) / e * amp, 1.0, (h0 - waves(p + vec2(0.0, e))) / e * amp));
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = max(dot(n, V), 0.0);
  float fres = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);
  float depthT = smoothstep(0.0, 1.5, vDepth);
  vec3 body = mix(uShallow, uDeep, depthT) * mix(1.0, 0.22, uNight);
  vec3 R = reflect(-V, n);
  vec3 sky = mix(uHorizon, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.6));
  vec3 col = mix(body, sky, clamp(fres * 0.85, 0.0, 1.0));
  vec3 H = normalize(uSunDir + V);
  float glint = pow(max(dot(n, H), 0.0), 260.0) * 4.0 * smoothstep(-0.04, 0.12, uSunDir.y);
  col += uSunColor * glint;
  // Soft caustic shimmer in the shallows.
  col += uShallow * 0.18 * smoothstep(0.62, 0.9, vnoise(p * 3.1 + uTime * 0.4)) * (1.0 - depthT) * (1.0 - uNight);
  // Foam hugging the true shoreline (depth → 0).
  float band = 1.0 - smoothstep(0.0, 0.09 + 0.05 * sin(uTime * 1.4 + p.x * 0.9 + p.y * 0.7), vDepth);
  float fn = smoothstep(0.35, 0.75, vnoise(p * 4.5 + vec2(uTime * 0.25, -uTime * 0.2)));
  float foam = clamp(band * (0.55 + 0.7 * fn), 0.0, 1.0) * uFoamAmt;
  col = mix(col, uFoam * mix(1.0, 0.3, uNight), foam);
  float alpha = mix(uAlpha * 0.5, uAlpha, depthT);
  alpha = max(max(alpha, fres * 0.95), foam);
  alpha *= smoothstep(-0.015, 0.03, vDepth);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function makeWaterMaterial(look: WaterLook) {
  return new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    fog: true,
    side: DoubleSide,
    uniforms: {
      fogColor: { value: new Color() },
      fogDensity: { value: 0 },
      fogNear: { value: 1 },
      fogFar: { value: 2000 },
      uShallow: { value: new Color(look.shallow) },
      uDeep: { value: new Color(look.deep) },
      uFoam: { value: new Color(look.foam) },
      uAlpha: { value: look.alpha },
      uFoamAmt: { value: look.foamAmt },
      uTime: ATMOS.uTime,
      uWind: ATMOS.uWind,
      uNight: ATMOS.uNight,
      uZenith: ATMOS.uZenith,
      uHorizon: ATMOS.uHorizon,
      uSunDir: ATMOS.uSunDir,
      uSunColor: ATMOS.uSunColor,
    },
  });
}

const materials = new Map<string, ShaderMaterial>();
const waterMaterial = (kind: 'lake' | WaterKind) => {
  let m = materials.get(kind);
  if (!m) materials.set(kind, (m = makeWaterMaterial(LOOKS[kind])));
  return m;
};

/** Disc of water at `level`, with per-vertex depth from the terrain so foam and colour follow the real shore. */
function waterGeometry(terrain: TerrainModel, x: number, z: number, radius: number, level: number, rings: number) {
  const g = new RingGeometry(0.001, radius, 96, rings);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const depth = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) depth[i] = level - terrain.height(pos.getX(i) + x, pos.getZ(i) + z);
  g.setAttribute('aDepth', new BufferAttribute(depth, 1));
  return g;
}

export function Lakes({ terrain }: { terrain: TerrainModel }) {
  const lakes = useMemo(
    () => terrain.lakes.map((l) => ({ l, geometry: waterGeometry(terrain, l.x, l.z, l.r * 1.02, terrain.lakeLevel, 30) })),
    [terrain],
  );
  useEffect(() => () => lakes.forEach((l) => l.geometry.dispose()), [lakes]);
  return (
    <group>
      {lakes.map(({ l, geometry }) => (
        <group key={l.id}>
          <mesh geometry={geometry} material={waterMaterial('lake')} position={[l.x, terrain.lakeLevel, l.z]} renderOrder={1} />
          <LilyPads terrain={terrain} lake={l} />
        </group>
      ))}
    </group>
  );
}

export function Ponds({ terrain }: { terrain: TerrainModel }) {
  const ponds = useMemo(
    () => terrain.ponds.map((p) => ({ p, geometry: waterGeometry(terrain, p.x, p.z, p.r * 1.35, p.level, 12) })),
    [terrain],
  );
  useEffect(() => () => ponds.forEach((p) => p.geometry.dispose()), [ponds]);
  return (
    <group>
      {ponds.map(({ p, geometry }) => (
        <mesh key={p.id} geometry={geometry} material={waterMaterial(p.kind)} position={[p.x, p.level, p.z]} renderOrder={1} />
      ))}
    </group>
  );
}

/** Floating lily pads (decorative) that bob gently on lakes, a few in flower. */
function LilyPads({ terrain, lake }: { terrain: TerrainModel; lake: TerrainModel['lakes'][number] }) {
  const ref = useRef<Group>(null);
  const pads = useMemo(() => {
    const rnd = hashRng(lake.id + 'lily');
    const out: { x: number; z: number; s: number; rot: number; flower: string | null }[] = [];
    let tries = 0;
    while (out.length < 16 && tries++ < 200) {
      const cluster = out.length % 4 === 0 ? { a: rnd() * Math.PI * 2 } : null;
      const a = cluster ? cluster.a : Math.atan2(out[out.length - 1]?.z ?? 0, out[out.length - 1]?.x ?? 1) + (rnd() - 0.5) * 0.5;
      const r = lake.r * (0.45 + rnd() * 0.4);
      const x = Math.cos(a) * r + (rnd() - 0.5) * 1.2;
      const z = Math.sin(a) * r + (rnd() - 0.5) * 1.2;
      if (terrain.lakeLevel - terrain.height(lake.x + x, lake.z + z) < 0.35) continue;
      out.push({ x, z, s: 0.28 + rnd() * 0.26, rot: rnd() * Math.PI * 2, flower: rnd() < 0.3 ? (rnd() < 0.5 ? '#ffd1e6' : '#fff8e8') : null });
    }
    return out;
  }, [lake, terrain]);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const t = clock.elapsedTime;
    g.children.forEach((c, i) => {
      c.position.y = terrain.lakeLevel + 0.02 + Math.sin(t * 1.2 + i * 1.7) * 0.012;
      c.rotation.y = pads[i].rot + Math.sin(t * 0.3 + i) * 0.08;
    });
  });
  return (
    <group ref={ref} position={[lake.x, 0, lake.z]}>
      {pads.map((p, i) => (
        <group key={i} position={[p.x, terrain.lakeLevel + 0.02, p.z]} scale={p.s}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <circleGeometry args={[1, 18, 0.35, Math.PI * 2 - 0.5]} />
            <meshStandardMaterial color={i % 3 ? '#4f9440' : '#5fa648'} roughness={0.55} side={DoubleSide} />
          </mesh>
          {p.flower && (
            <group position={[0.1, 0.12, 0.1]}>
              {Array.from({ length: 6 }).map((_, k) => (
                <mesh key={k} rotation={[0.9, (k / 6) * Math.PI * 2, 0]} position={[Math.cos((k / 6) * Math.PI * 2) * 0.14, 0, Math.sin((k / 6) * Math.PI * 2) * 0.14]}>
                  <coneGeometry args={[0.11, 0.34, 4]} />
                  <meshStandardMaterial color={p.flower!} roughness={0.6} />
                </mesh>
              ))}
              <mesh position={[0, 0.05, 0]}>
                <sphereGeometry args={[0.08, 8, 6]} />
                <meshStandardMaterial color="#ffd23f" emissive="#6b4a00" emissiveIntensity={0.3} />
              </mesh>
            </group>
          )}
        </group>
      ))}
    </group>
  );
}
