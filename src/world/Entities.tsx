import { useFrame } from '@react-three/fiber';
import { memo, useRef, type ReactNode } from 'react';
import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  IcosahedronGeometry,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  SphereGeometry,
  type Group,
  type Material,
  type Mesh,
  type PointLight,
} from 'three';
import { HAZARDS, NODES } from '../shared/catalog';
import type { GroundItem, Hazard, ItemKind, Obstacle, ResourceNode, Structure } from '../shared/types';

type V3 = [number, number, number];
const PI = Math.PI;
const TAU = PI * 2;

/** Deterministic per-entity randomness so shapes stay stable across re-renders. */
function rng(seed: string) {
  let a = 2166136261;
  for (let i = 0; i < seed.length; i++) a = Math.imul(a ^ seed.charCodeAt(i), 16777619);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ring = (n: number, r: number, rand?: () => number, jitter = 0.3) =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / Math.max(1, n)) * TAU + (rand ? (rand() - 0.5) * jitter : 0);
    const rr = r * (rand ? 1 - jitter * 0.5 + rand() * jitter : 1);
    return [Math.cos(a) * rr, Math.sin(a) * rr] as const;
  });

// ---------- shared geometries (unit sized, scaled per mesh) ----------

function makeRock(seed: number, detail: number) {
  const g = new IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    let y = p.getY(i);
    const z = p.getZ(i);
    const n = 1 + 0.22 * Math.sin(x * 3.1 + seed) * Math.cos(z * 2.7 + seed * 1.3) + 0.12 * Math.sin(y * 4.3 + seed * 2.1);
    y *= 0.8;
    if (y < -0.3) y = -0.3 + (y + 0.3) * 0.2;
    p.setXYZ(i, x * n * (1 + 0.15 * Math.sin(seed)), y * n, z * n);
  }
  g.computeBoundingBox();
  const b = g.boundingBox!;
  g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  g.scale(1 / Math.max(-bb.min.x, bb.max.x), 1 / bb.max.y, 1 / Math.max(-bb.min.z, bb.max.z));
  g.computeVertexNormals();
  return g;
}

const G = {
  box: new BoxGeometry(1, 1, 1),
  cyl: new CylinderGeometry(1, 1, 1, 8),
  trunk: new CylinderGeometry(0.62, 1, 1, 7),
  cone: new ConeGeometry(1, 1, 7),
  cone4: new ConeGeometry(1, 1, 4),
  ico: new IcosahedronGeometry(1, 0),
  blob: new IcosahedronGeometry(1, 1),
  sphere: new SphereGeometry(1, 10, 8),
  bead: new SphereGeometry(1, 6, 5),
  dome: new SphereGeometry(1, 10, 5, 0, TAU, 0, PI / 2),
  disc: new CircleGeometry(1, 36).rotateX(-PI / 2),
  edge: new RingGeometry(0.93, 1, 40).rotateX(-PI / 2),
  rocks: [0.3, 2.1, 3.7, 5.2].map((s) => makeRock(s, 1)),
  pebbles: [1.1, 4.4, 6.3].map((s) => makeRock(s, 0)),
};

// ---------- shared materials ----------

const stdCache = new Map<string, MeshStandardMaterial>();
function mat(color: string, opacity = 1, roughness = 0.85, emissive?: string, emissiveIntensity = 1): MeshStandardMaterial {
  const key = `${color}|${opacity}|${roughness}|${emissive ?? ''}|${emissiveIntensity}`;
  let m = stdCache.get(key);
  if (!m) {
    m = new MeshStandardMaterial({ color, roughness, flatShading: true, transparent: opacity < 1, opacity });
    if (emissive) {
      m.emissive.set(emissive);
      m.emissiveIntensity = emissiveIntensity;
    }
    stdCache.set(key, m);
  }
  return m;
}

const basicCache = new Map<string, MeshBasicMaterial>();
function basic(color: string, opacity: number) {
  const key = `${color}|${opacity}`;
  let m = basicCache.get(key);
  if (!m) {
    m = new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: DoubleSide });
    basicCache.set(key, m);
  }
  return m;
}

/** Animated shimmer shared by every water surface; time is advanced once per frame from the material itself. */
const waterTime = { value: 0 };
function waterMaterial(color: string, opacity: number) {
  const m = new MeshStandardMaterial({ color, transparent: true, opacity, roughness: 0.12, metalness: 0.15 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = waterTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec2 vLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position.xz;\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vWPos;\nvarying vec2 vLocal;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float rad = length(vLocal);
        float w = sin(vWPos.x * 1.9 + uTime * 1.2) * sin(vWPos.z * 1.6 - uTime * 0.9) + 0.6 * sin((vWPos.x - vWPos.z) * 3.1 + uTime * 2.1);
        diffuseColor.rgb *= mix(0.62, 1.08, smoothstep(0.0, 0.95, rad));
        diffuseColor.rgb += vec3(0.55, 0.65, 0.7) * smoothstep(1.0, 1.55, w) * 0.35;
        diffuseColor.rgb += vec3(1.0) * smoothstep(0.9, 1.0, rad) * 0.16;`,
      );
  };
  m.onBeforeRender = () => {
    waterTime.value = performance.now() / 1000;
  };
  return m;
}

const WATER = {
  fresh: waterMaterial('#3f9fe0', 0.88),
  toxic: waterMaterial(NODES.toxic_water.color, 0.9),
  lake: waterMaterial('#2f7fbf', 0.9),
};

const PINE = ['#2e6b3a', '#3a7a3f', '#27593a', '#335f2c'];
const LEAF = ['#4f9a45', '#5eab4a', '#468a3c'];
const ROCK = ['#8a8f98', '#9a968c', '#7f858c', '#8f8779'];
const BOULDER = ['#7a7266', '#857a6a', '#6f6a62'];
const BARK = '#6b4a2f';

const ZERO: V3 = [0, 0, 0];
function M({ g, m, p = ZERO, s = 1, r = ZERO, cast = false, recv = false }: { g: BufferGeometry; m: Material; p?: V3; s?: V3 | number; r?: V3; cast?: boolean; recv?: boolean }) {
  return <mesh geometry={g} material={m} position={p} scale={s} rotation={r} castShadow={cast} receiveShadow={recv} />;
}

/** Fixed slots so remaining items do not jump around as units are consumed. */
const slots = (n: number, r: number, rand: () => number, jitter = 0.3) => ring(6, r, rand, jitter).slice(0, n);

// ---------- resources ----------

/** Low-poly silhouettes per resource kind; visible fruit count tracks available units. */
export const ResourceMesh = memo(function ResourceMesh({ node, units }: { node: ResourceNode; units: number }) {
  const def = NODES[node.kind];
  const { x, z } = node.position;
  const n = Math.min(units, 6);
  const dim = units < 1 ? 0.35 : 1;
  const rand = rng(node.id);
  const rotY = rand() * TAU;
  let body: ReactNode;
  switch (node.kind) {
    case 'berry_bush':
      body = (
        <>
          <M g={G.blob} m={mat('#3c7a36')} p={[0, 0.42, 0]} s={[0.72, 0.52, 0.68]} cast />
          <M g={G.blob} m={mat('#3b7d35')} p={[0.32, 0.38, 0.22]} s={0.4} cast />
          <M g={G.blob} m={mat('#285c2a')} p={[-0.3, 0.34, -0.24]} s={0.38} cast />
          {slots(n, 0.58, rand).map(([dx, dz], i) => (
            <M key={i} g={G.bead} m={mat(def.color, 1, 0.3, def.color, 0.25)} p={[dx, 0.62 + (i % 3) * 0.08, dz]} s={0.13} />
          ))}
        </>
      );
      break;
    case 'fruit_tree':
      body = (
        <>
          <M g={G.trunk} m={mat(BARK)} p={[0, 1.1, 0]} s={[0.22, 2.2, 0.22]} cast />
          <M g={G.blob} m={mat('#3e8e41')} p={[0, 2.75, 0]} s={[1.3, 1.0, 1.25]} cast />
          <M g={G.blob} m={mat('#4fa34a')} p={[0.25, 3.35, 0.1]} s={0.75} cast />
          <M g={G.blob} m={mat('#357a3a')} p={[-0.65, 2.45, 0.3]} s={0.62} cast />
          {slots(n, 1.18, rand).map(([dx, dz], i) => (
            <M key={i} g={G.bead} m={mat(def.color, 1, 0.45)} p={[dx, 2.15 + (i % 2) * 0.35, dz]} s={0.17} />
          ))}
        </>
      );
      break;
    case 'mushroom_patch':
    case 'toxic_mushroom_patch': {
      const toxic = node.kind === 'toxic_mushroom_patch';
      body = slots(Math.max(1, n), 0.34, rand).map(([dx, dz], i) => {
        const k = 0.75 + rand() * 0.5;
        return (
          <group key={i} position={[dx, 0, dz]} scale={k}>
            <M g={G.cyl} m={mat('#f1e3c8')} p={[0, 0.11, 0]} s={[0.05, 0.22, 0.05]} />
            <M g={G.dome} m={mat(def.color, dim, 0.6)} p={[0, 0.2, 0]} s={[0.17, 0.13, 0.17]} cast />
            {toxic && (
              <>
                <M g={G.bead} m={mat('#ffffff', dim)} p={[0.05, 0.315, 0.03]} s={0.03} />
                <M g={G.bead} m={mat('#ffffff', dim)} p={[-0.06, 0.3, -0.04]} s={0.026} />
              </>
            )}
          </group>
        );
      });
      break;
    }
    case 'fish_spot':
    case 'fresh_water':
    case 'toxic_water': {
      const toxic = node.kind === 'toxic_water';
      body = (
        <>
          <M g={G.disc} m={mat(toxic ? '#4f5a37' : '#8a7b5a')} p={[0, 0.015, 0]} s={1.35} recv />
          <mesh geometry={G.disc} material={toxic ? WATER.toxic : WATER.fresh} position={[0, 0.035, 0]} scale={1.1} receiveShadow />
          {ring(4, 1.25, rand, 0.8).map(([dx, dz], i) => (
            <M key={`p${i}`} g={G.pebbles[i % 3]} m={mat(ROCK[i % 4])} p={[dx, -0.02, dz]} s={[0.16, 0.1, 0.13]} />
          ))}
          {node.kind === 'fish_spot' &&
            slots(n, 0.5, rand).map(([dx, dz], i) => (
              <M key={i} g={G.ico} m={mat(def.color, 1, 0.3)} p={[dx, 0.045, dz]} r={[0, Math.atan2(dx, dz) + PI / 2, 0]} s={[0.07, 0.035, 0.18]} />
            ))}
          {toxic &&
            ring(3, 0.55, rand, 1).map(([dx, dz], i) => <M key={i} g={G.bead} m={mat('#b5d17a', 0.8, 0.3)} p={[dx, 0.05, dz]} s={0.05 + i * 0.015} />)}
          {node.kind === 'fresh_water' &&
            ring(2, 0.65, rand, 1).map(([dx, dz], i) => <M key={i} g={G.disc} m={mat('#5c9e3f')} p={[dx, 0.045, dz]} s={0.16 + i * 0.04} />)}
        </>
      );
      break;
    }
    case 'cactus':
      body = (
        <>
          <M g={G.cyl} m={mat('#4f8a3a')} p={[0, 0.6, 0]} s={[0.24, 1.2, 0.24]} cast />
          <M g={G.dome} m={mat('#4f8a3a')} p={[0, 1.2, 0]} s={0.24} cast />
          <M g={G.cyl} m={mat('#5a9a42')} p={[0.34, 0.55, 0]} r={[0, 0, PI / 2]} s={[0.09, 0.22, 0.09]} />
          <M g={G.cyl} m={mat('#5a9a42')} p={[0.45, 0.74, 0]} s={[0.09, 0.42, 0.09]} cast />
          <M g={G.cyl} m={mat('#5a9a42')} p={[-0.32, 0.75, 0]} r={[0, 0, PI / 2]} s={[0.08, 0.18, 0.08]} />
          <M g={G.cyl} m={mat('#5a9a42')} p={[-0.41, 0.88, 0]} s={[0.08, 0.3, 0.08]} cast />
          {slots(n, 0.17, rand).map(([dx, dz], i) => (
            <M key={i} g={G.bead} m={mat(def.color, 1, 0.4)} p={[dx, 1.36, dz]} s={0.08} />
          ))}
        </>
      );
      break;
    case 'honey_hive':
      body = (
        <>
          <M g={G.trunk} m={mat('#5d4037')} p={[0, 0.8, 0]} s={[0.48, 1.6, 0.48]} cast recv />
          <M g={G.cyl} m={mat('#a47b56')} p={[0, 1.61, 0]} s={[0.3, 0.03, 0.3]} />
          <M g={G.sphere} m={mat('#1d130c')} p={[0, 1.1, 0.34]} s={[0.17, 0.24, 0.08]} />
          <M g={G.blob} m={mat(def.color, 1, 0.3, '#6b4e00', 0.8)} p={[0, 0.82, 0.4]} s={[0.16 + n * 0.035, 0.2 + n * 0.03, 0.12]} />
          {n > 0 && <M g={G.cone} m={mat(def.color, 1, 0.3, '#6b4e00', 0.8)} p={[0, 0.55, 0.43]} r={[PI, 0, 0]} s={[0.05, 0.22, 0.05]} />}
        </>
      );
      break;
    case 'wood_pile':
      body = Array.from({ length: Math.max(1, n) }, (_, i) => {
        const layer = Math.floor(i / 3);
        const off = ((i % 3) - 1) * 0.2;
        const even = layer % 2 === 0;
        return (
          <M
            key={i}
            g={G.cyl}
            m={mat(i % 2 ? def.color : '#7a4f28', dim)}
            p={even ? [0, 0.09 + layer * 0.16, off] : [off, 0.09 + layer * 0.16, 0]}
            r={even ? [0, 0, PI / 2] : [PI / 2, 0, 0]}
            s={[0.08, 0.95, 0.08]}
            cast
          />
        );
      });
      break;
    case 'stone_pile':
      body = (
        <>
          {ring(Math.max(1, Math.min(n, 5)), 0.32, rand).map(([dx, dz], i) => (
            <M key={i} g={G.rocks[i % 4]} m={mat(i % 2 ? def.color : '#b0aca4', dim)} p={[dx, 0, dz]} r={[0, rand() * TAU, 0]} s={[0.2, 0.18, 0.17]} cast />
          ))}
          {n > 5 && <M g={G.rocks[1]} m={mat(def.color, dim)} p={[0, 0.12, 0]} s={[0.2, 0.16, 0.18]} cast />}
        </>
      );
      break;
    case 'herb_patch':
      body = ring(Math.max(2, n) + 1, 0.28, rand).map(([dx, dz], i) => (
        <group key={i} position={[dx, 0, dz]}>
          <M g={G.cyl} m={mat('#6b8f4e', dim)} p={[0, 0.1, 0]} s={[0.02, 0.2, 0.02]} />
          <M g={G.blob} m={mat(def.color, dim, 0.5)} p={[0, 0.22, 0]} s={[0.14, 0.12, 0.14]} r={[0, i, 0]} />
        </group>
      ));
      break;
    case 'moss_patch':
      body = (
        <>
          <M g={G.cyl} m={mat('#5a4030', dim)} p={[0, 0.16, 0]} r={[0, 0, PI / 2]} s={[0.16, 0.9, 0.16]} cast />
          <M g={G.dome} m={mat(def.color, dim, 1)} p={[0.05, 0.26, 0]} s={[0.38, 0.1, 0.18]} />
          {ring(Math.max(1, n), 0.38, rand).map(([dx, dz], i) => (
            <M key={i} g={G.dome} m={mat(i % 2 ? def.color : '#86c25e', dim, 1)} p={[dx, 0, dz]} s={[0.2, 0.08, 0.2]} />
          ))}
        </>
      );
      break;
    default:
      // fiber grass: tall tilted blades
      body = ring(Math.max(3, n) + 2, 0.26, rand, 0.6).map(([dx, dz], i) => {
        const h = 0.6 + rand() * 0.45;
        return (
          <M key={i} g={G.cone4} m={mat(i % 2 ? def.color : '#b3a04a', dim)} p={[dx, h / 2, dz]} r={[dz * 0.8, 0, -dx * 0.8]} s={[0.05, h, 0.05]} />
        );
      });
  }
  return (
    <group position={[x, 0, z]} rotation={[0, rotY, 0]} dispose={null}>
      {body}
    </group>
  );
});

// ---------- obstacles ----------

export const ObstacleMesh = memo(function ObstacleMesh({ o }: { o: Obstacle }) {
  const { x, z } = o.position;
  const rand = rng(o.id);
  const variant = Math.floor(rand() * 4);
  const rotY = rand() * TAU;
  let body: ReactNode;
  switch (o.shape) {
    case 'rock':
      body = (
        <group rotation={[0, rotY, 0]}>
          <M g={G.rocks[variant]} m={mat(ROCK[variant])} p={[0, -0.06, 0]} s={[o.radius, o.height, o.radius * 0.9]} cast recv />
          <M g={G.pebbles[variant % 3]} m={mat(ROCK[(variant + 1) % 4])} p={[o.radius * 0.95, -0.02, o.radius * 0.3]} s={[0.22, 0.16, 0.2]} />
        </group>
      );
      break;
    case 'boulder':
      body = (
        <group rotation={[0, rotY, 0]}>
          <M g={G.rocks[variant]} m={mat(BOULDER[variant % 3])} p={[0, -0.1, 0]} s={[o.radius, o.height, o.radius]} cast recv />
          <M g={G.rocks[(variant + 2) % 4]} m={mat(BOULDER[(variant + 1) % 3])} p={[-o.radius * 0.9, -0.05, o.radius * 0.5]} s={[o.radius * 0.35, o.height * 0.3, o.radius * 0.3]} cast />
        </group>
      );
      break;
    case 'tree': {
      const h = o.height;
      if (variant < 3) {
        const R = o.radius * 2.8;
        const c = PINE[variant];
        body = (
          <group rotation={[0, rotY, 0]}>
            <M g={G.trunk} m={mat(BARK)} p={[0, h * 0.225, 0]} s={[o.radius * 0.5, h * 0.45, o.radius * 0.5]} cast />
            <M g={G.cone} m={mat(c)} p={[0, h * 0.25 + h * 0.21, 0]} s={[R, h * 0.42, R]} cast />
            <M g={G.cone} m={mat(PINE[(variant + 1) % 4])} p={[0, h * 0.45 + h * 0.18, 0]} s={[R * 0.75, h * 0.36, R * 0.75]} cast />
            <M g={G.cone} m={mat(c)} p={[0, h * 0.62 + h * 0.19, 0]} s={[R * 0.48, h * 0.38, R * 0.48]} cast />
          </group>
        );
      } else {
        const R = o.radius * 2.4;
        body = (
          <group rotation={[0, rotY, 0]}>
            <M g={G.trunk} m={mat('#5b3a1e')} p={[0, h * 0.3, 0]} s={[o.radius * 0.5, h * 0.6, o.radius * 0.5]} cast />
            <M g={G.blob} m={mat(LEAF[0])} p={[0, h * 0.7, 0]} s={[R * 0.85, h * 0.28, R * 0.85]} cast />
            <M g={G.blob} m={mat(LEAF[1])} p={[R * 0.3, h * 0.86, R * 0.15]} s={R * 0.5} cast />
            <M g={G.blob} m={mat(LEAF[2])} p={[-R * 0.4, h * 0.62, -R * 0.25]} s={R * 0.5} cast />
          </group>
        );
      }
      break;
    }
    case 'log': {
      const L = o.halfLength ?? 1;
      const r = o.radius;
      body = (
        <group rotation={[0, -(o.angle ?? 0), 0]}>
          <M g={G.cyl} m={mat('#6d4c2f')} p={[0, r, 0]} r={[0, 0, PI / 2]} s={[r, L * 2, r]} cast recv />
          <M g={G.cyl} m={mat('#c9a26b')} p={[L + 0.01, r, 0]} r={[0, 0, PI / 2]} s={[r * 0.82, 0.03, r * 0.82]} />
          <M g={G.cyl} m={mat('#c9a26b')} p={[-L - 0.01, r, 0]} r={[0, 0, PI / 2]} s={[r * 0.82, 0.03, r * 0.82]} />
          <M g={G.dome} m={mat('#6f9e4a', 1, 1)} p={[L * 0.3, r * 1.85, 0]} s={[L * 0.35, r * 0.25, r * 0.7]} />
          <M g={G.cyl} m={mat('#5d4128')} p={[-L * 0.35, r * 1.7, r * 0.3]} r={[0.6, 0, 0.3]} s={[0.06, 0.5, 0.06]} />
        </group>
      );
      break;
    }
    case 'cliff': {
      const L = o.halfLength ?? 1;
      const w = (L * 2) / 3;
      const d = o.radius * 2;
      body = (
        <group rotation={[0, -(o.angle ?? 0), 0]}>
          {[0, 1, 2].map((i) => {
            const hh = o.height * (0.8 + rand() * 0.2);
            const cx = -L + w * (i + 0.5);
            const dd = d * (0.9 + rand() * 0.1);
            return (
              <group key={i} position={[cx, 0, 0]}>
                <M g={G.box} m={mat(i % 2 ? '#8d8272' : '#978b7a')} p={[0, hh / 2, 0]} s={[w * 1.001, hh, dd]} cast recv />
                <M g={G.box} m={mat('#76695a')} p={[0, hh * 0.42, 0]} s={[w * 1.01, hh * 0.1, dd * 1.02]} />
                <M g={G.box} m={mat('#7a9a55', 1, 1)} p={[0, hh + 0.04, 0]} s={[w * 0.96, 0.08, dd * 0.88]} recv />
              </group>
            );
          })}
        </group>
      );
      break;
    }
    case 'bush': {
      const R = o.radius;
      body = (
        <group rotation={[0, rotY, 0]}>
          <M g={G.blob} m={mat('#557a3a')} p={[0, 0.42, 0]} s={[R * 0.8, 0.5, R * 0.78]} cast />
          <M g={G.blob} m={mat('#62893f')} p={[R * 0.42, 0.34, R * 0.2]} s={[R * 0.5, 0.38, R * 0.5]} cast />
          <M g={G.blob} m={mat('#4a6e33')} p={[-R * 0.38, 0.32, -R * 0.3]} s={[R * 0.5, 0.35, R * 0.45]} cast />
        </group>
      );
      break;
    }
    case 'lake': {
      const R = o.radius;
      body = (
        <>
          <M g={G.disc} m={mat('#cdb98a', 1, 1)} p={[0, 0.012, 0]} s={R + 0.9} recv />
          <M g={G.disc} m={mat('#8a7b55', 1, 1)} p={[0, 0.022, 0]} s={R + 0.3} recv />
          <mesh geometry={G.disc} material={WATER.lake} position={[0, 0.04, 0]} scale={R} receiveShadow />
          {ring(7, R + 0.25, rand, 0.9).map(([dx, dz], i) => (
            <M key={i} g={G.cone4} m={mat(i % 2 ? '#6f8f3a' : '#8aa04a')} p={[dx, 0.35, dz]} r={[dz * 0.03, 0, -dx * 0.03]} s={[0.05, 0.7 + (i % 3) * 0.2, 0.05]} />
          ))}
          {ring(3, R * 0.6, rand, 1.2).map(([dx, dz], i) => (
            <M key={`l${i}`} g={G.disc} m={mat('#5c9e3f')} p={[dx, 0.05, dz]} s={0.3 + i * 0.08} />
          ))}
        </>
      );
      break;
    }
  }
  return (
    <group position={[x, 0, z]} dispose={null}>
      {body}
    </group>
  );
});

// ---------- hazards ----------

function Swarm({ radius }: { radius: number }) {
  const ref = useRef<Group>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 2.2;
  });
  const rand = rng(`swarm${radius}`);
  return (
    <group ref={ref}>
      {ring(6, radius * 0.4, rand, 1).map(([dx, dz], i) => (
        <M key={i} g={G.bead} m={mat('#ffd000', 1, 0.5, '#6b5a00', 0.6)} p={[dx, 0.8 + rand() * 0.8, dz]} s={0.06} />
      ))}
    </group>
  );
}

export const HazardMesh = memo(function HazardMesh({ h }: { h: Hazard }) {
  const def = HAZARDS[h.kind];
  const rand = rng(h.id);
  const spots = ring(5, h.radius * 0.55, rand, 1.2);
  let decor: ReactNode = null;
  switch (h.kind) {
    case 'thorns':
      decor = spots.map(([dx, dz], i) => (
        <group key={i} position={[dx, 0, dz]}>
          <M g={G.blob} m={mat('#3b4a2c')} p={[0, 0.12, 0]} s={[0.3, 0.18, 0.3]} />
          <M g={G.cone4} m={mat('#6a4c93')} p={[0.1, 0.3, 0]} r={[0, 0, -0.5]} s={[0.04, 0.35, 0.04]} />
          <M g={G.cone4} m={mat('#6a4c93')} p={[-0.08, 0.32, 0.05]} r={[0.3, 0, 0.5]} s={[0.04, 0.4, 0.04]} />
        </group>
      ));
      break;
    case 'mud':
      decor = spots.slice(0, 3).map(([dx, dz], i) => <M key={i} g={G.dome} m={mat('#3e2b1f', 1, 0.25)} p={[dx, 0.04, dz]} s={[0.3, 0.05, 0.24]} />);
      break;
    case 'wasps':
      decor = (
        <>
          <M g={G.sphere} m={mat('#b9a98a')} p={[0, 0.2, 0]} s={[0.22, 0.28, 0.22]} cast />
          <Swarm radius={h.radius} />
        </>
      );
      break;
    case 'snakes':
      decor = spots.map(([dx, dz], i) => <M key={i} g={G.cone4} m={mat('#b08968')} p={[dx, 0.22, dz]} r={[0, i, 0.2]} s={[0.12, 0.45, 0.12]} />);
      break;
    case 'rockfall':
      decor = spots.map(([dx, dz], i) => <M key={i} g={G.pebbles[i % 3]} m={mat(ROCK[i % 4])} p={[dx, 0, dz]} r={[0, i, 0]} s={[0.25, 0.2, 0.22]} cast />);
      break;
    case 'leeches':
      decor = spots.slice(0, 3).map(([dx, dz], i) => <M key={i} g={G.disc} m={mat('#1f2a20', 1, 0.2)} p={[dx, 0.055, dz]} s={0.35 + i * 0.1} />);
      break;
  }
  return (
    <group position={[h.position.x, 0, h.position.z]} dispose={null}>
      <M g={G.disc} m={basic(def.color, 0.3)} p={[0, 0.05, 0]} s={h.radius} />
      <M g={G.edge} m={basic(def.color, 0.65)} p={[0, 0.052, 0]} s={h.radius} />
      {decor}
    </group>
  );
});

// ---------- structures ----------

function Flame() {
  const flame = useRef<Mesh>(null);
  const inner = useRef<Mesh>(null);
  const light = useRef<PointLight>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const f = 1 + Math.sin(t * 13) * 0.08 + Math.sin(t * 23.7) * 0.06;
    flame.current?.scale.set(0.26 * (2 - f), 0.65 * f, 0.26 * (2 - f));
    inner.current?.scale.set(0.14, 0.4 * (2 - f), 0.14);
    if (light.current) light.current.intensity = 8 * f;
  });
  return (
    <>
      <mesh ref={flame} geometry={G.cone} material={mat('#ff7b00', 1, 1, '#ff4800', 2)} position={[0, 0.45, 0]} />
      <mesh ref={inner} geometry={G.cone} material={mat('#ffd35a', 1, 1, '#ffb000', 2.5)} position={[0, 0.36, 0]} />
      <pointLight ref={light} position={[0, 1, 0]} color="#ff9a3c" intensity={8} distance={10} />
    </>
  );
}

export function StructureMesh({ s, lit }: { s: Structure; lit: boolean }) {
  const { x, z } = s.position;
  let body: ReactNode;
  switch (s.kind) {
    case 'campfire':
      body = (
        <>
          {ring(7, 0.42).map(([dx, dz], i) => (
            <M key={i} g={G.pebbles[i % 3]} m={mat(ROCK[i % 4])} p={[dx, 0, dz]} s={[0.13, 0.12, 0.11]} r={[0, i, 0]} cast />
          ))}
          <M g={G.cyl} m={mat(lit ? '#3a2a1c' : '#6d4c2f')} p={[0, 0.1, 0]} r={[0, 0.5, PI / 2]} s={[0.06, 0.6, 0.06]} />
          <M g={G.cyl} m={mat(lit ? '#3a2a1c' : '#6d4c2f')} p={[0, 0.14, 0]} r={[0, -0.9, PI / 2]} s={[0.06, 0.6, 0.06]} />
          {lit ? <Flame /> : <M g={G.disc} m={mat('#2b2522')} p={[0, 0.02, 0]} s={0.3} />}
        </>
      );
      break;
    case 'shelter':
      body = (
        <>
          <M g={G.cone} m={mat('#9c6b3d')} p={[0, 1.1, 0]} s={[1.45, 2.2, 1.45]} cast recv />
          <M g={G.cone4} m={mat('#3b2a1a')} p={[0, 0.5, 1.12]} r={[-0.55, 0, 0]} s={[0.42, 1.0, 0.05]} />
          {[0, 2.1, 4.2].map((a, i) => (
            <M key={i} g={G.cyl} m={mat('#5d4128')} p={[Math.cos(a) * 0.1, 2.35, Math.sin(a) * 0.1]} r={[Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35]} s={[0.035, 0.6, 0.035]} />
          ))}
          <M g={G.cyl} m={mat('#c9a26b')} p={[0, 1.2, 0]} s={[0.68, 0.07, 0.68]} />
        </>
      );
      break;
    case 'cache':
      body = (
        <>
          <M g={G.box} m={mat('#a1887f')} p={[0, 0.3, 0]} s={[0.8, 0.6, 0.6]} cast recv />
          <M g={G.box} m={mat('#8d6e63')} p={[0, 0.66, 0]} s={[0.86, 0.12, 0.66]} cast />
          <M g={G.box} m={mat('#4e4a46', 1, 0.5)} p={[-0.25, 0.35, 0]} s={[0.06, 0.64, 0.62]} />
          <M g={G.box} m={mat('#4e4a46', 1, 0.5)} p={[0.25, 0.35, 0]} s={[0.06, 0.64, 0.62]} />
        </>
      );
      break;
    case 'sign':
      body = (
        <>
          <M g={G.box} m={mat('#6d4c2f')} p={[0, 0.55, 0]} s={[0.08, 1.1, 0.08]} cast />
          <M g={G.box} m={mat('#d7b98e')} p={[0, 1.02, 0.05]} s={[0.75, 0.38, 0.05]} cast />
          <M g={G.box} m={mat('#6d4c2f')} p={[0, 1.02, 0.08]} s={[0.55, 0.03, 0.01]} />
          <M g={G.box} m={mat('#6d4c2f')} p={[0, 0.95, 0.08]} s={[0.45, 0.03, 0.01]} />
        </>
      );
      break;
  }
  return (
    <group position={[x, 0, z]} rotation={[0, rng(s.id)() * TAU, 0]} dispose={null}>
      {body}
    </group>
  );
}

// ---------- ground items ----------

const ITEM_COLOR: Partial<Record<ItemKind, string>> = { cooked_mushroom: '#7a5230', cooked_fish: '#c07a3a', rotten_food: '#556b2f' };
for (const def of Object.values(NODES)) if (def.yields && !ITEM_COLOR[def.yields]) ITEM_COLOR[def.yields] = def.color;

export function GroundItemMesh({ g }: { g: GroundItem }) {
  const k = g.item.kind;
  const color = ITEM_COLOR[k] ?? '#e0c080';
  const pos: V3 = [g.position.x, 0, g.position.z];
  if (k === 'wood')
    return (
      <group position={pos} dispose={null}>
        <M g={G.cyl} m={mat(color)} p={[0, 0.07, 0]} r={[0, 0.7, PI / 2]} s={[0.07, 0.5, 0.07]} cast />
      </group>
    );
  if (k === 'stone')
    return (
      <group position={pos} dispose={null}>
        <M g={G.rocks[2]} m={mat(color)} s={[0.16, 0.14, 0.14]} cast />
      </group>
    );
  return (
    <group position={pos} dispose={null}>
      <M g={G.blob} m={mat(color, 1, 0.6)} p={[0, 0.1, 0]} s={[0.14, 0.11, 0.13]} cast />
      <M g={G.cone4} m={mat('#6b8f4e')} p={[0.03, 0.22, 0]} r={[0, 0, -0.4]} s={[0.03, 0.08, 0.03]} />
    </group>
  );
}
