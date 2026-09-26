import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { CapsuleGeometry, Color, ConeGeometry, MeshStandardMaterial, SphereGeometry, type Group } from 'three';

// ---------- shared geometry / static materials ----------

const G = {
  body: new CapsuleGeometry(0.32, 0.22, 4, 12),
  belly: new SphereGeometry(1, 12, 10),
  head: new SphereGeometry(0.3, 14, 12),
  eye: new SphereGeometry(0.085, 10, 8),
  pupil: new SphereGeometry(0.045, 8, 6),
  nose: new SphereGeometry(0.045, 8, 6),
  ear: new ConeGeometry(0.09, 0.2, 5),
  arm: new CapsuleGeometry(0.075, 0.26, 3, 8),
  leg: new CapsuleGeometry(0.085, 0.16, 3, 8),
  foot: new SphereGeometry(1, 8, 6),
};
const EYE = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.3 });
const PUPIL = new MeshStandardMaterial({ color: '#141414', roughness: 0.2 });

const damp = (a: number, b: number, k: number) => a + (b - a) * k;

/**
 * Low-poly critter facing +Z in its local frame, ~1.42 units tall, footprint radius ~0.45.
 * 17 meshes. Walk cycle when `moving`, sitting/breathing when `resting`, lying on its side (grey) when `dead`.
 * `speed` scales the walk-cycle rate (1 = normal walk).
 */
export function CreatureModel({ color, dead, resting, moving, speed = 1 }: { color: string; dead: boolean; resting: boolean; moving: boolean; speed?: number }) {
  const mats = useMemo(() => {
    const base = new Color(dead ? '#7c7c7c' : color);
    const std = (c: Color) => new MeshStandardMaterial({ color: c, roughness: 0.7, flatShading: true });
    return {
      body: std(base),
      belly: std(base.clone().lerp(new Color('#ffffff'), 0.5)),
      dark: std(base.clone().lerp(new Color('#000000'), 0.35)),
      nose: std(base.clone().lerp(new Color('#3a1a1a'), 0.6)),
    };
  }, [color, dead]);
  useEffect(
    () => () => {
      for (const m of Object.values(mats)) m.dispose();
    },
    [mats],
  );

  const root = useRef<Group>(null);
  const torso = useRef<Group>(null);
  const head = useRef<Group>(null);
  const eyes = useRef<Group>(null);
  const armL = useRef<Group>(null);
  const armR = useRef<Group>(null);
  const legL = useRef<Group>(null);
  const legR = useRef<Group>(null);
  const st = useMemo(() => ({ phase: 0, t: Math.random() * 10, walk: 0, rest: 0, dead: dead ? 1 : 0, nextBlink: 2 + Math.random() * 3 }), []); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const k = 1 - Math.exp(-dt * 7);
    st.t += dt;
    st.dead = damp(st.dead, dead ? 1 : 0, k * 0.7);
    st.rest = damp(st.rest, resting && !dead ? 1 : 0, k);
    st.walk = damp(st.walk, moving && !dead && !resting ? 1 : 0, k);
    st.phase += dt * 9 * speed * st.walk;
    const alive = 1 - st.dead;
    const s = Math.sin(st.phase);
    const breath = Math.sin(st.t * (2.2 - st.rest * 0.8)) * (0.02 + st.rest * 0.02) * alive;

    const r = root.current;
    if (r) {
      r.position.y = Math.abs(s) * 0.06 * st.walk - 0.26 * st.rest + 0.36 * st.dead;
      r.position.x = 0.72 * st.dead;
      r.rotation.z = (Math.PI / 2) * st.dead;
    }
    const tr = torso.current;
    if (tr) {
      tr.rotation.x = 0.1 * st.walk - 0.06 * st.rest;
      tr.rotation.z = Math.sin(st.phase) * 0.05 * st.walk;
      tr.scale.set(1 + breath, 1 - breath * 0.5, 1 + breath);
    }
    const h = head.current;
    if (h) {
      h.rotation.y = Math.sin(st.t * 0.7) * 0.3 * (1 - st.walk) * alive * (1 - st.rest * 0.6);
      h.rotation.x = 0.18 * st.rest - 0.05 * st.walk;
      h.rotation.z = Math.sin(st.phase * 0.5) * 0.04 * st.walk + 0.12 * st.rest * Math.sin(st.t * 0.5);
    }
    const e = eyes.current;
    if (e) {
      let open = 1 - st.rest * 0.65;
      if (st.t > st.nextBlink) {
        open = 0.1;
        if (st.t > st.nextBlink + 0.12) st.nextBlink = st.t + 2.5 + Math.random() * 3;
      }
      e.scale.y = damp(open, 0.12, st.dead);
    }
    const swing = s * 0.7 * st.walk;
    if (legL.current) legL.current.rotation.x = swing - 1.45 * st.rest;
    if (legR.current) legR.current.rotation.x = -swing - 1.45 * st.rest;
    if (armL.current) {
      armL.current.rotation.x = -swing * 0.85 - 0.55 * st.rest;
      armL.current.rotation.z = -0.12 - 0.9 * st.dead;
    }
    if (armR.current) {
      armR.current.rotation.x = swing * 0.85 - 0.55 * st.rest;
      armR.current.rotation.z = 0.12 + 0.9 * st.dead;
    }
  });

  return (
    <group dispose={null}>
      <group ref={root}>
        <group ref={legL} position={[0.15, 0.36, 0]}>
          <mesh geometry={G.leg} material={mats.body} position={[0, -0.14, 0]} castShadow />
          <mesh geometry={G.foot} material={mats.dark} position={[0, -0.3, 0.05]} scale={[0.11, 0.065, 0.17]} castShadow />
        </group>
        <group ref={legR} position={[-0.15, 0.36, 0]}>
          <mesh geometry={G.leg} material={mats.body} position={[0, -0.14, 0]} castShadow />
          <mesh geometry={G.foot} material={mats.dark} position={[0, -0.3, 0.05]} scale={[0.11, 0.065, 0.17]} castShadow />
        </group>
        <group ref={torso} position={[0, 0.36, 0]}>
          <mesh geometry={G.body} material={mats.body} position={[0, 0.38, 0]} castShadow />
          <mesh geometry={G.belly} material={mats.belly} position={[0, 0.34, 0.2]} scale={[0.23, 0.28, 0.13]} />
          <group ref={armL} position={[0.34, 0.62, 0]}>
            <mesh geometry={G.arm} material={mats.body} position={[0, -0.19, 0]} castShadow />
          </group>
          <group ref={armR} position={[-0.34, 0.62, 0]}>
            <mesh geometry={G.arm} material={mats.body} position={[0, -0.19, 0]} castShadow />
          </group>
          <group ref={head} position={[0, 0.77, 0]}>
            <mesh geometry={G.head} material={mats.body} castShadow />
            <mesh geometry={G.ear} material={mats.dark} position={[0.17, 0.25, -0.02]} rotation={[0, 0, -0.4]} castShadow />
            <mesh geometry={G.ear} material={mats.dark} position={[-0.17, 0.25, -0.02]} rotation={[0, 0, 0.4]} castShadow />
            <mesh geometry={G.nose} material={mats.nose} position={[0, -0.04, 0.29]} />
            <group ref={eyes} position={[0, 0.05, 0]}>
              <mesh geometry={G.eye} material={EYE} position={[0.11, 0, 0.24]} />
              <mesh geometry={G.eye} material={EYE} position={[-0.11, 0, 0.24]} />
              <mesh geometry={G.pupil} material={PUPIL} position={[0.11, 0, 0.31]} />
              <mesh geometry={G.pupil} material={PUPIL} position={[-0.11, 0, 0.31]} />
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}
