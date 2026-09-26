import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import {
  BufferAttribute,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  IcosahedronGeometry,
  Matrix4,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Group,
  type Mesh,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type V3 = [number, number, number];

// ---------- shared geometry (built once for every fly) ----------

const UP = new Vector3(0, 1, 0);
function segment(a: V3, b: V3, r0: number, r1: number) {
  const va = new Vector3(...a);
  const vb = new Vector3(...b);
  const dir = vb.clone().sub(va);
  const g = new CylinderGeometry(r1, r0, dir.length(), 4, 1);
  const m = new Matrix4().compose(va.clone().add(vb).multiplyScalar(0.5), new Quaternion().setFromUnitVectors(UP, dir.normalize()), new Vector3(1, 1, 1));
  return g.applyMatrix4(m);
}

/** Leg = femur + tibia + tarsus, relative to the hip. Front legs reach forward, rear legs back. */
const LEG_SHAPES: [V3, V3, V3][] = [
  [[0.13, 0.11, 0.1], [0.22, -0.22, 0.22], [0.27, -0.24, 0.27]],
  [[0.17, 0.12, 0.01], [0.3, -0.22, 0.0], [0.36, -0.24, -0.01]],
  [[0.15, 0.11, -0.1], [0.26, -0.22, -0.26], [0.3, -0.24, -0.32]],
];
function legGeometry(i: number, side: 1 | -1): BufferGeometry {
  const [k, f, t] = LEG_SHAPES[i].map(([x, y, z]) => [x * side, y, z] as V3);
  return mergeGeometries([segment([0, 0, 0], k, 0.02, 0.016), segment(k, f, 0.014, 0.01), segment(f, t, 0.009, 0.006)])!;
}
const HIP_Z = [0.15, 0.09, 0.03];
const HIP_Y = 0.24;
const LEGS = ([1, -1] as const).flatMap((side) => [0, 1, 2].map((i) => ({ side, i, g: legGeometry(i, side), tripod: (i + (side === 1 ? 1 : 0)) % 2 })));

function stripedAbdomen() {
  const g = new SphereGeometry(1, 12, 14);
  g.rotateX(Math.PI / 2);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const light = new Color('#c9954f');
  const dark = new Color('#3b2412');
  for (let i = 0; i < p.count; i++) {
    const t = (1 - p.getZ(i)) / 2;
    const band = t > 0.18 && ((t * 5.2) % 1 > 0.5 || t > 0.9);
    const c = band ? dark : light;
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new BufferAttribute(col, 3));
  return g;
}

const G = {
  sphere: new SphereGeometry(1, 12, 10),
  eye: new IcosahedronGeometry(1, 1),
  abdomen: stripedAbdomen(),
  wing: new CircleGeometry(1, 14).rotateX(-Math.PI / 2).translate(0, 0, -1),
  antenna: new ConeGeometry(1, 1, 4).translate(0, 0.5, 0),
  proboscis: mergeGeometries([new CylinderGeometry(0.6, 1, 1, 5).translate(0, -0.5, 0), new SphereGeometry(1.4, 6, 4).scale(1, 0.12, 1).translate(0, -1, 0)])!,
  marker: new RingGeometry(0.36, 0.46, 28).rotateX(-Math.PI / 2),
};

const MAT = {
  thorax: new MeshStandardMaterial({ color: '#a8733a', roughness: 0.55, flatShading: true }),
  head: new MeshStandardMaterial({ color: '#b98446', roughness: 0.6, flatShading: true }),
  eye: new MeshStandardMaterial({ color: '#c1121f', roughness: 0.3, metalness: 0.1, flatShading: true, emissive: '#3a0005' }),
  abdomen: new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, flatShading: true }),
  wing: new MeshPhysicalMaterial({
    color: '#e6eef2',
    roughness: 0.15,
    transparent: true,
    opacity: 0.38,
    side: DoubleSide,
    depthWrite: false,
    iridescence: 1,
    iridescenceIOR: 1.35,
    iridescenceThicknessRange: [180, 520],
  }),
  leg: new MeshStandardMaterial({ color: '#3a2a1a', roughness: 0.7 }),
  antenna: new MeshStandardMaterial({ color: '#5a3d22', roughness: 0.7, flatShading: true }),
  proboscis: new MeshStandardMaterial({ color: '#7a5634', roughness: 0.6 }),
  dead: new MeshBasicMaterial({ color: '#666666', transparent: true, opacity: 0.6, depthWrite: false }),
};

const markerCache = new Map<string, MeshBasicMaterial>();
function markerMat(color: string) {
  let m = markerCache.get(color);
  if (!m) {
    m = new MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false });
    markerCache.set(color, m);
  }
  return m;
}

const damp = (a: number, b: number, k: number) => a + (b - a) * k;

/**
 * Stylised Drosophila facing +Z, standing on y=0, ~0.9 units long at scale 1.
 * 17 meshes; geometry and materials are shared across all flies. `color` tints the ground marker ring.
 */
export function FlyModel({ color, feeding, moving, dead, scale = 1 }: { color: string; feeding: boolean; moving: boolean; dead: boolean; scale?: number }) {
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const head = useRef<Group>(null);
  const prob = useRef<Mesh>(null);
  const wings = useRef<(Group | null)[]>([]);
  const legs = useRef<(Group | null)[]>([]);
  const st = useMemo(() => ({ phase: Math.random() * 10, t: Math.random() * 10, gait: 0, feed: 0, flip: dead ? 1 : 0 }), []); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const k = 1 - Math.exp(-dt * 8);
    st.t += dt;
    st.gait = damp(st.gait, moving && !dead ? 1 : 0, k);
    st.feed = damp(st.feed, feeding && !dead ? 1 : 0, k);
    st.flip = damp(st.flip, dead ? 1 : 0, k * 0.6);
    st.phase += dt * 16 * st.gait;

    const r = root.current;
    if (r) {
      r.rotation.z = st.flip * Math.PI;
      r.position.y = st.flip * 0.44;
    }
    const b = body.current;
    if (b) {
      b.position.y = Math.abs(Math.sin(st.phase)) * 0.012 * st.gait;
      b.rotation.x = 0.08 * st.feed;
    }
    const h = head.current;
    if (h) h.rotation.x = 0.35 * st.feed + Math.sin(st.t * 1.7) * 0.03 * (1 - st.flip);
    const p = prob.current;
    if (p) p.scale.set(0.022, 0.03 + 0.19 * st.feed, 0.022);

    const buzz = Math.sin(st.t * 55) * (0.03 + 0.05 * st.gait) * (1 - st.flip);
    for (let i = 0; i < 2; i++) {
      const w = wings.current[i];
      if (!w) continue;
      const side = i === 0 ? 1 : -1;
      w.rotation.y = -side * (0.22 + 0.9 * st.flip);
      w.rotation.z = side * (buzz + 0.05);
    }
    for (let i = 0; i < LEGS.length; i++) {
      const l = legs.current[i];
      if (!l) continue;
      const { side, tripod } = LEGS[i];
      const ph = st.phase + tripod * Math.PI;
      const swing = Math.sin(ph) * 0.32 * st.gait;
      const lift = Math.max(0, Math.cos(ph)) * 0.28 * st.gait;
      const curl = st.flip * 0.5 + Math.sin(st.t * 9 + i) * 0.08 * st.flip;
      l.rotation.y = swing * side;
      l.rotation.z = (lift + curl) * side;
    }
  });

  return (
    <group scale={scale} dispose={null}>
      <mesh geometry={G.marker} material={dead ? MAT.dead : markerMat(color)} position={[0, 0.012, -0.02]} />
      <group ref={root}>
        <group ref={body}>
          <mesh geometry={G.sphere} material={MAT.thorax} position={[0, 0.28, 0.09]} scale={[0.13, 0.12, 0.15]} castShadow />
          <mesh geometry={G.abdomen} material={MAT.abdomen} position={[0, 0.26, -0.17]} rotation={[-0.12, 0, 0]} scale={[0.14, 0.12, 0.26]} castShadow />
          <group ref={head} position={[0, 0.29, 0.22]}>
            <mesh geometry={G.sphere} material={MAT.head} position={[0, 0, 0.07]} scale={[0.1, 0.09, 0.08]} castShadow />
            <mesh geometry={G.eye} material={MAT.eye} position={[0.08, 0.01, 0.08]} scale={[0.055, 0.075, 0.068]} />
            <mesh geometry={G.eye} material={MAT.eye} position={[-0.08, 0.01, 0.08]} scale={[0.055, 0.075, 0.068]} />
            <mesh geometry={G.antenna} material={MAT.antenna} position={[0.025, 0.04, 0.14]} rotation={[0.75, 0, -0.35]} scale={[0.012, 0.13, 0.012]} />
            <mesh geometry={G.antenna} material={MAT.antenna} position={[-0.025, 0.04, 0.14]} rotation={[0.75, 0, 0.35]} scale={[0.012, 0.13, 0.012]} />
            <mesh ref={prob} geometry={G.proboscis} material={MAT.proboscis} position={[0, -0.06, 0.1]} rotation={[0.25, 0, 0]} scale={[0.022, 0.03, 0.022]} />
          </group>
          {[1, -1].map((side, i) => (
            <group
              key={side}
              ref={(g) => {
                wings.current[i] = g;
              }}
              position={[side * 0.045, 0.37, 0.1]}
              rotation={[0.08, 0, 0]}
            >
              <mesh geometry={G.wing} material={MAT.wing} scale={[0.11, 1, 0.21]} renderOrder={2} />
            </group>
          ))}
          {LEGS.map((l, i) => (
            <group
              key={i}
              ref={(g) => {
                legs.current[i] = g;
              }}
              position={[l.side * 0.06, HIP_Y, HIP_Z[l.i]]}
            >
              <mesh geometry={l.g} material={MAT.leg} castShadow />
            </group>
          ))}
        </group>
      </group>
    </group>
  );
}
