import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  type DirectionalLight,
  type FogExp2,
  type Group,
  type HemisphereLight,
  IcosahedronGeometry,
  type LineSegments,
  type Mesh,
  type MeshStandardMaterial,
  ShaderMaterial,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from '../shared/config';
import type { Weather } from '../shared/types';
import { dayPhase, worldClock } from '../sim/environment';
import { mulberry32 } from '../sim/rng';
import { useSim } from '../sim/react';
import { ATMOS } from './atmosphere';
import { smoothstep } from './noise';

const C = (hex: string) => new Color(hex);
const ZENITH_DAY = C('#3c7fd6');
const HORIZON_DAY = C('#cfe6f3');
const ZENITH_SUNSET = C('#3b4f94');
const HORIZON_SUNSET = C('#f7a667');
const ZENITH_NIGHT = C('#0b1430');
const HORIZON_NIGHT = C('#2a3a66');
const OVERCAST_ZENITH = C('#8f9aa7');
const OVERCAST_HORIZON = C('#cbd2d8');
const STORM_ZENITH = C('#58616d');
const STORM_HORIZON = C('#8a939d');
const SUN_LOW = C('#ff9146');
const SUN_HIGH = C('#fff2dc');
const MOON = C('#9fb6ff');

/** Dev-only render offset for screenshots (never touches sim time). */
export const DEBUG_VIEW = { timeOffset: 0 };

const OVERCAST: Record<Weather, number> = { clear: 0, cloudy: 0.45, rain: 0.6, storm: 1 };
const FOG: Record<Weather, number> = { clear: 0.0031, cloudy: 0.0036, rain: 0.0045, storm: 0.0085 };
const WIND: Record<Weather, number> = { clear: 0.7, cloudy: 1, rain: 1.6, storm: 2.6 };
const CLOUDS: Record<Weather, number> = { clear: 9, cloudy: 26, rain: 34, storm: 40 };

/**
 * Sun elevation from the sim's day phase. Day = phase 0–0.5, dusk 0.5–0.6, night 0.6–0.9, dawn 0.9–1
 * (see sim/environment); the visual sun sets mid-dusk and rises mid-dawn so light matches sim vision.
 */
export function sunAt(time: number) {
  const p = dayPhase(time);
  const u = p > 0.78 ? p - 1 : p;
  const t = (u + 0.06) / 0.62; // 0 sunrise .. 1 sunset
  const arc = Math.PI * t;
  const elev = Math.sin(arc) * 1.08;
  const dir = new Vector3(Math.cos(arc), Math.sin(elev), 0.3 + 0.2 * Math.sin(arc)).normalize();
  return { dir, t };
}

const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const skyFragment = /* glsl */ `
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uMoonDir;
uniform float uNight; uniform float uOvercast; uniform float uFlash;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.5));
  col = mix(col, uHorizon, smoothstep(0.0, -0.04, h));
  float sd = max(dot(d, uSunDir), 0.0);
  float vis = (1.0 - uOvercast * 0.9) * smoothstep(-0.12, 0.03, uSunDir.y);
  col += uSunColor * (pow(sd, 1600.0) * 22.0 + pow(sd, 60.0) * 0.55 + pow(sd, 6.0) * 0.22) * vis;
  // Warm band along the horizon toward the sun at golden hour.
  float golden = (1.0 - smoothstep(0.0, 0.35, abs(uSunDir.y))) * (1.0 - uOvercast);
  col += uSunColor * golden * pow(sd, 2.0) * 0.35 * (1.0 - smoothstep(0.0, 0.35, h));
  float md = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.95, 0.94, 0.88) * (smoothstep(0.99955, 0.99975, md) * 2.2 + pow(md, 220.0) * 0.18) * uNight * (1.0 - uOvercast * 0.95);
  col += uFlash * vec3(0.55, 0.6, 0.78);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function SkyDome({ moonDir, flash }: { moonDir: Vector3; flash: { value: number } }) {
  const ref = useRef<Mesh>(null);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
        side: BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uZenith: ATMOS.uZenith,
          uHorizon: ATMOS.uHorizon,
          uSunDir: ATMOS.uSunDir,
          uSunColor: ATMOS.uSunColor,
          uNight: ATMOS.uNight,
          uOvercast: ATMOS.uOvercast,
          uMoonDir: { value: moonDir },
          uFlash: flash,
        },
      }),
    [moonDir, flash],
  );
  useFrame(({ camera }) => ref.current?.position.copy(camera.position));
  return (
    <mesh ref={ref} material={material} renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[900, 48, 24]} />
    </mesh>
  );
}

function Stars() {
  const ref = useRef<Group>(null);
  const { geometry, material } = useMemo(() => {
    const rnd = mulberry32(99);
    const n = 1800;
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const y = rnd() * 0.95 + 0.05;
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(a) * r * 850, y * 850, Math.sin(a) * r * 850], i * 3);
      size[i] = 1 + rnd() ** 3 * 3.2;
      phase[i] = rnd() * 40;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aSize', new BufferAttribute(size, 1));
    g.setAttribute('aPhase', new BufferAttribute(phase, 1));
    const m = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
      uniforms: { uTime: ATMOS.uTime, uNight: ATMOS.uNight, uOvercast: ATMOS.uOvercast, uDpr: { value: Math.min(2, window.devicePixelRatio) } },
      vertexShader: /* glsl */ `
        attribute float aSize; attribute float aPhase; uniform float uTime; uniform float uNight; uniform float uOvercast; uniform float uDpr;
        varying float vA;
        void main() {
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uDpr;
          vA = uNight * (1.0 - uOvercast) * (0.55 + 0.45 * sin(uTime * (1.5 + fract(aPhase) * 2.0) + aPhase));
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          gl_FragColor = vec4(vec3(0.9, 0.93, 1.0) * 1.4, smoothstep(0.5, 0.0, d) * vA);
        }`,
    });
    return { geometry: g, material: m };
  }, []);
  useFrame(({ camera }) => {
    if (!ref.current) return;
    ref.current.position.copy(camera.position);
    ref.current.visible = ATMOS.uNight.value > 0.02;
    ref.current.rotation.y = ATMOS.uTime.value * 0.002;
  });
  return (
    <group ref={ref}>
      <points geometry={geometry} material={material} renderOrder={-9} frustumCulled={false} />
    </group>
  );
}

function cloudGeometry(rnd: () => number) {
  const parts: BufferGeometry[] = [];
  const n = 4 + Math.floor(rnd() * 5);
  for (let i = 0; i < n; i++) {
    const r = 3.5 + rnd() * 5 * (1 - Math.abs(i - n / 2) / n);
    const g = new IcosahedronGeometry(r, 1);
    g.translate((i - n / 2) * 4.2 + rnd() * 2, rnd() * r * 0.5, (rnd() - 0.5) * r * 1.4);
    parts.push(g);
  }
  const merged = mergeGeometries(parts)!;
  const p = merged.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, Math.max(p.getY(i), -1.2));
  merged.scale(1, 0.62, 1);
  merged.computeVertexNormals();
  parts.forEach((g) => g.dispose());
  return merged;
}

function Clouds() {
  const store = useSim();
  const group = useRef<Group>(null);
  const matRef = useRef<MeshStandardMaterial>(null);
  const clouds = useMemo(() => {
    const rnd = mulberry32(4242);
    const variants = Array.from({ length: 7 }, () => cloudGeometry(rnd));
    return Array.from({ length: 40 }, (_, i) => {
      const a = rnd() * Math.PI * 2;
      const r = 40 + rnd() * 280;
      return {
        geometry: variants[i % variants.length],
        x: Math.cos(a) * r,
        z: Math.sin(a) * r,
        y: 52 + rnd() * 30,
        s: 0.8 + rnd() * 1.1,
        ry: rnd() * Math.PI,
        speed: 0.6 + rnd() * 0.8,
      };
    });
  }, []);
  const clear = useMemo(() => C('#ffffff'), []);
  const storm = useMemo(() => C('#5b626c'), []);
  const tint = useMemo(() => new Color(), []);
  useFrame((_, dt) => {
    const s = store.getState();
    const g = group.current;
    if (!g) return;
    const shown = CLOUDS[s.weather];
    const wind = ATMOS.uWind.value;
    g.children.forEach((c, i) => {
      c.visible = i < shown;
      c.position.x += dt * clouds[i].speed * wind * 1.2;
      if (c.position.x > 340) c.position.x -= 680;
    });
    if (matRef.current) {
      const oc = ATMOS.uOvercast.value;
      tint.copy(clear).lerp(storm, oc * 0.85);
      // Night and golden hour tint the clouds via the sky colours.
      tint.lerp(ATMOS.uHorizon.value, 0.25 + ATMOS.uNight.value * 0.5);
      matRef.current.color.copy(tint);
      matRef.current.emissive.copy(ATMOS.uHorizon.value).multiplyScalar(0.3 * (1 - ATMOS.uNight.value * 0.7));
    }
  });
  return (
    <group ref={group}>
      {clouds.map((c, i) => (
        <mesh key={i} geometry={c.geometry} position={[c.x, c.y, c.z]} scale={c.s} rotation={[0, c.ry, 0]}>
          <meshStandardMaterial ref={i === 0 ? matRef : undefined} attach="material" color="#ffffff" roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

/** Rain streaks around wherever the camera is looking; denser and more slanted in storms. */
function Rain() {
  const store = useSim();
  const ref = useRef<LineSegments>(null);
  const controls = useThree((s) => s.controls) as unknown as { target: Vector3 } | null;
  const N = 7000;
  const H = 26;
  const SPAN = 70;
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    const p = new Float32Array(N * 6);
    const rnd = mulberry32(7);
    for (let i = 0; i < N; i++) {
      const x = (rnd() - 0.5) * SPAN;
      const y = rnd() * H;
      const z = (rnd() - 0.5) * SPAN;
      p.set([x, y, z, x + 0.12, y + 0.8, z + 0.05], i * 6);
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
    if (controls) lines.position.set(controls.target.x, 0, controls.target.z);
    const arr = (geometry.attributes.position as BufferAttribute).array as Float32Array;
    const fall = (w === 'storm' ? 36 : 22) * dt;
    const drift = (w === 'storm' ? 5 : 1.5) * dt;
    const drops = w === 'storm' ? N : Math.floor(N * 0.55);
    geometry.setDrawRange(0, drops * 2);
    for (let i = 0; i < drops; i++) {
      const o = i * 6;
      arr[o + 1] -= fall;
      arr[o + 4] -= fall;
      arr[o] += drift;
      arr[o + 3] += drift;
      if (arr[o + 1] < 0) {
        arr[o + 1] += H;
        arr[o + 4] += H;
      }
      if (arr[o] > SPAN / 2) {
        arr[o] -= SPAN;
        arr[o + 3] -= SPAN;
      }
    }
    geometry.attributes.position.needsUpdate = true;
  });
  return (
    <lineSegments ref={ref} geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial color="#c9d8ec" transparent opacity={0.42} depthWrite={false} />
    </lineSegments>
  );
}

/** Occasional lightning bolt far off during storms (purely atmospheric). */
function Lightning({ flash }: { flash: { value: number } }) {
  const store = useSim();
  const ref = useRef<LineSegments>(null);
  const state = useRef({ until: 0, next: 4 });
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(40 * 6), 3));
    return g;
  }, []);
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const storm = store.getState().weather === 'storm';
    flash.value = Math.max(0, flash.value - dt * 6);
    if (storm && t > state.current.next) {
      state.current.next = t + 3 + Math.random() * 7;
      state.current.until = t + 0.22;
      flash.value = 1;
      const a = Math.random() * Math.PI * 2;
      const r = 90 + Math.random() * 120;
      let x = Math.cos(a) * r;
      let z = Math.sin(a) * r;
      let y = 90;
      const arr = (geometry.attributes.position as BufferAttribute).array as Float32Array;
      for (let i = 0; i < 40; i++) {
        const nx = x + (Math.random() - 0.5) * 6;
        const nz = z + (Math.random() - 0.5) * 6;
        const ny = y - 2.4;
        arr.set([x, y, z, nx, ny, nz], i * 6);
        x = nx;
        y = ny;
        z = nz;
      }
      geometry.attributes.position.needsUpdate = true;
    }
    if (ref.current) ref.current.visible = storm && t < state.current.until;
  });
  return (
    <lineSegments ref={ref} geometry={geometry} frustumCulled={false} visible={false}>
      <lineBasicMaterial color={[4, 4.2, 5]} toneMapped={false} />
    </lineSegments>
  );
}

/** Sky, sun/moon lighting, fog and weather, all driven from sim time/weather every frame. */
export function Atmosphere() {
  const store = useSim();
  const hemi = useRef<HemisphereLight>(null);
  const sun = useRef<DirectionalLight>(null);
  const moonDir = useMemo(() => new Vector3(), []);
  const flash = useMemo(() => ({ value: 0 }), []);
  const smooth = useRef({ overcast: 0, fog: FOG.clear, wind: WIND.clear });
  const tmp = useMemo(() => ({ z: new Color(), h: new Color(), s: new Color() }), []);
  const hemiGround = useMemo(() => C('#5e6b3c'), []);

  useFrame(({ scene, gl, clock }, dt) => {
    const s = store.getState();
    ATMOS.uTime.value = clock.elapsedTime;
    const k = 1 - Math.exp(-dt * 0.6);
    const sm = smooth.current;
    sm.overcast += (OVERCAST[s.weather] - sm.overcast) * k;
    sm.fog += (FOG[s.weather] - sm.fog) * k;
    sm.wind += (WIND[s.weather] - sm.wind) * k;
    ATMOS.uOvercast.value = sm.overcast;
    ATMOS.uWind.value = sm.wind;

    const { dir } = sunAt(worldClock(s) + DEBUG_VIEW.timeOffset);
    ATMOS.uSunDir.value.copy(dir);
    moonDir.set(-dir.x, Math.max(0.35, -dir.y), -dir.z * 0.6 + 0.3).normalize();
    const el = dir.y;
    const day = smoothstep(-0.14, 0.18, el);
    const golden = 1 - smoothstep(0.02, 0.4, Math.abs(el - 0.04));
    const night = 1 - smoothstep(-0.2, 0.02, el);
    ATMOS.uNight.value = night;

    // Sky colours: night → golden hour → day, then overcast.
    tmp.z.copy(ZENITH_NIGHT).lerp(ZENITH_DAY, day).lerp(ZENITH_SUNSET, golden * 0.55);
    tmp.h.copy(HORIZON_NIGHT).lerp(HORIZON_DAY, day).lerp(HORIZON_SUNSET, golden * 0.8);
    const oc = sm.overcast;
    if (oc > 0.01) {
      const storm = s.weather === 'storm' ? 1 : Math.max(0, oc - 0.6) * 1.5;
      const z = OVERCAST_ZENITH.clone().lerp(STORM_ZENITH, storm).multiplyScalar(0.25 + 0.75 * day);
      const h = OVERCAST_HORIZON.clone().lerp(STORM_HORIZON, storm).multiplyScalar(0.25 + 0.75 * day);
      tmp.z.lerp(z, oc * 0.9);
      tmp.h.lerp(h, oc * 0.9);
    }
    ATMOS.uZenith.value.copy(tmp.z);
    ATMOS.uHorizon.value.copy(tmp.h);
    tmp.s.copy(SUN_LOW).lerp(SUN_HIGH, smoothstep(0.05, 0.5, el));
    ATMOS.uSunColor.value.copy(tmp.s);

    const fog = scene.fog as FogExp2 | null;
    if (fog) {
      fog.color.copy(tmp.h);
      fog.density = sm.fog;
    }
    gl.setClearColor(tmp.h);

    const f = flash.value;
    if (sun.current) {
      const L = sun.current;
      const sunI = 2.9 * smoothstep(-0.02, 0.22, el) * (1 - oc * 0.35);
      const moonI = 1.5 * night * (1 - oc * 0.4);
      if (sunI >= moonI) {
        L.position.copy(dir).multiplyScalar(110);
        L.color.copy(tmp.s);
        L.intensity = sunI;
      } else {
        L.position.copy(moonDir).multiplyScalar(110);
        L.color.copy(MOON);
        L.intensity = moonI;
      }
      L.intensity += f * 1.5;
    }
    if (hemi.current) {
      hemi.current.color.copy(tmp.z).lerp(tmp.h, 0.5).lerp(C('#ffffff'), 0.2 * day).lerp(C('#5a6fa8'), night * 0.7);
      hemi.current.groundColor.copy(hemiGround).multiplyScalar(0.55 + 0.45 * day);
      hemi.current.intensity = 0.55 + 0.75 * day + f * 2.5 + night * 0.9 + oc * 0.95 * (0.4 + 0.6 * day);
    }
  });

  const shadowExtent = CONFIG.worldSize / 2 + 8;
  return (
    <>
      <fogExp2 attach="fog" args={['#cfe6f3', FOG.clear]} />
      <SkyDome moonDir={moonDir} flash={flash} />
      <Stars />
      <Clouds />
      <Rain />
      <Lightning flash={flash} />
      <hemisphereLight ref={hemi} args={['#dfefff', '#5e6b3c', 1]} />
      <directionalLight
        ref={sun}
        position={[40, 60, -30]}
        intensity={2.6}
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
        shadow-radius={2.5}
      >
        <orthographicCamera attach="shadow-camera" args={[-shadowExtent, shadowExtent, shadowExtent, -shadowExtent, 1, 260]} />
      </directionalLight>
    </>
  );
}
