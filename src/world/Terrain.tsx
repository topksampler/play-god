import { useEffect, useMemo, useRef } from 'react';
import { BufferAttribute, Color, InstancedMesh, Matrix4, PlaneGeometry, Quaternion, Vector3 } from 'three';
import type { BiomeKind, Obstacle } from '../shared/types';
import { obstacleDistance } from '../sim/geometry';
import { lerp, smoothstep } from './noise';
import type { TerrainModel } from './terrain-model';

/** Ground palettes: base, light patches, dark patches. Richer than the minimap's flat biome colours. */
const PALETTE: Record<BiomeKind, [string, string, string]> = {
  meadow: ['#78ad4f', '#9dc85f', '#5c9540'],
  forest: ['#4c7a36', '#5f8a3c', '#6b5634'],
  lake: ['#80b456', '#a2c76c', '#6a9a48'],
  highlands: ['#8f8a74', '#8c9a5e', '#a9a28c'],
  scrub: ['#d8b278', '#e2c28d', '#c08a58'],
  swamp: ['#4f6a3a', '#667a40', '#3a4c2e'],
};

const SAND = new Color('#d9c393');
const WET_SAND = new Color('#a8946a');
const BED_SHALLOW = new Color('#7c8f6a');
const BED_DEEP = new Color('#2f4a48');
const MUD_BED = new Color('#4d4630');
const GRASS_LOW = new Color('#6a9848');
const FOREST = new Color('#3b6533');
const ROCK = new Color('#7f786d');
const ROCK_DARK = new Color('#5f5b55');
const ROCK_LIGHT = new Color('#a39a8b');
const SNOW = new Color('#f3f6fa');
const SNOW_SHADE = new Color('#d5e0ee');

const palettes = Object.fromEntries(
  Object.entries(PALETTE).map(([k, v]) => [k, v.map((c) => new Color(c))]),
) as Record<BiomeKind, Color[]>;

/** Mountain / foothill colouring by altitude, slope and noise. */
function mountainColor(m: TerrainModel, x: number, z: number, h: number, ny: number, out: Color) {
  const { n2, fbm } = m.noise;
  const slope = 1 - ny;
  const nz = fbm(x / 9, z / 9, 3);
  out.copy(GRASS_LOW).lerp(FOREST, smoothstep(2, 9, h + nz * 3));
  const rockiness = Math.max(smoothstep(0.22, 0.42, slope), smoothstep(13, 20, h + nz * 5));
  const rock = ROCK.clone().lerp(n2(x / 5, z / 5) > 0 ? ROCK_LIGHT : ROCK_DARK, Math.abs(n2(x / 3, z / 3)) * 0.8);
  out.lerp(rock, rockiness);
  const snowLine = 23 + nz * 6;
  const snow = smoothstep(snowLine - 1.5, snowLine + 2, h) * (1 - smoothstep(0.45, 0.62, slope));
  if (snow > 0) out.lerp(slope > 0.3 ? SNOW_SHADE : SNOW, snow);
  return out;
}

function valleyColor(m: TerrainModel, x: number, z: number, out: Color, tmp: Color) {
  const { n2, fbm } = m.noise;
  out.setRGB(0, 0, 0);
  const patch = fbm(x / 7 + 3, z / 7 - 1, 3);
  const fine = n2(x * 0.9, z * 0.9) * 0.5 + n2(x * 2.3, z * 2.3) * 0.25;
  for (const { kind, w } of m.weights(x, z)) {
    const [c0, c1, c2] = palettes[kind];
    tmp.copy(c0);
    if (patch > 0) tmp.lerp(c1, smoothstep(0, 0.35, patch) * 0.8);
    else tmp.lerp(c2, smoothstep(0, -0.35, patch) * 0.75);
    out.r += tmp.r * w;
    out.g += tmp.g * w;
    out.b += tmp.b * w;
  }
  out.offsetHSL(0, 0, fine * 0.025);
  return out;
}

/** High-res valley floor + faceted mountain ring. Visual only; the sim is flat. */
export function Terrain({ model, obstacles, onClick }: { model: TerrainModel; obstacles: Obstacle[]; onClick: () => void }) {
  const aoKey = obstacles
    .filter((o) => o.shape !== 'lake' && o.shape !== 'bush')
    .map((o) => o.id)
    .join(',');

  const valley = useMemo(() => {
    const size = model.half * 2 + 12;
    const seg = 240;
    const g = new PlaneGeometry(size, size, seg, seg);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new Color();
    const tmp = new Color();
    const mc = new Color();
    const aoObs = obstacles.filter((o) => o.shape !== 'lake' && o.shape !== 'bush');
    const heights = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) heights[i] = model.height(pos.getX(i), pos.getZ(i));
    const row = seg + 1;
    const step = size / seg;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = heights[i];
      pos.setY(i, h);
      const ix = i % row;
      const iz = Math.floor(i / row);
      const hx = heights[iz * row + Math.min(seg, ix + 1)] - heights[iz * row + Math.max(0, ix - 1)];
      const hz = heights[Math.min(seg, iz + 1) * row + ix] - heights[Math.max(0, iz - 1) * row + ix];
      const ny = (2 * step) / Math.hypot(hx, hz, 2 * step);

      valleyColor(model, x, z, c, tmp);
      // Blend into the foothill colouring just past the fence.
      const edge = Math.max(Math.abs(x), Math.abs(z)) - model.half;
      if (edge > -1) c.lerp(mountainColor(model, x, z, h, ny, mc), smoothstep(-1, 5, edge));

      // Lake/pond beds and beaches.
      const water = model.lakes.some((l) => Math.hypot(x - l.x, z - l.z) < l.r + 2) || model.ponds.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 1.5);
      if (water) {
        const toxic = model.ponds.some((p) => p.kind === 'toxic_water' && Math.hypot(x - p.x, z - p.z) < p.r + 1.5);
        const level = model.ponds.find((p) => Math.hypot(x - p.x, z - p.z) < p.r + 1.5)?.level ?? model.lakeLevel;
        const above = h - level;
        if (above < 0.3) c.lerp(toxic ? MUD_BED : SAND, smoothstep(0.3, 0.12, above) * 0.9);
        if (above < 0.08) c.copy(toxic ? MUD_BED : WET_SAND).lerp(toxic ? MUD_BED : BED_SHALLOW, smoothstep(0.05, -0.3, above));
        if (above < -0.3) c.lerp(BED_DEEP, smoothstep(-0.3, -1.6, above));
      }

      // Cheap baked contact shadow around solid props, so they sit in the ground.
      let ao = 1;
      for (const o of aoObs) {
        if (Math.abs(o.position.x - x) > (o.halfLength ?? o.radius) + 3 || Math.abs(o.position.z - z) > (o.halfLength ?? o.radius) + 3) continue;
        const d = obstacleDistance(o, { x, z });
        ao *= 1 - (o.shape === 'cliff' ? 0.45 : 0.32) * Math.exp(-Math.max(0, d) / (o.shape === 'cliff' ? 1.4 : 0.7));
      }
      // Hollows read slightly darker, crests lighter.
      const cavity = lerp(0.9, 1.05, smoothstep(0.82, 1, ny));
      c.multiplyScalar(ao * cavity);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, aoKey]);

  const mountains = useMemo(() => {
    const size = 700;
    const seg = 200;
    const g = new PlaneGeometry(size, size, seg, seg);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    const inner = model.half + 5;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      // Inside the valley mesh: tuck vertices below it so the two meshes never z-fight.
      const hidden = Math.abs(x) < inner && Math.abs(z) < inner;
      pos.setY(i, model.height(x, z) - (hidden ? 1.5 : 0));
    }
    const ng = g.toNonIndexed();
    ng.computeVertexNormals();
    const p2 = ng.attributes.position;
    const n = ng.attributes.normal;
    const colors = new Float32Array(p2.count * 3);
    const c = new Color();
    for (let i = 0; i < p2.count; i += 3) {
      // Per-face colour (faceted low-poly look): centroid height/slope.
      const x = (p2.getX(i) + p2.getX(i + 1) + p2.getX(i + 2)) / 3;
      const y = (p2.getY(i) + p2.getY(i + 1) + p2.getY(i + 2)) / 3;
      const z = (p2.getZ(i) + p2.getZ(i + 1) + p2.getZ(i + 2)) / 3;
      mountainColor(model, x, z, y, n.getY(i), c);
      c.offsetHSL(0, 0, (model.noise.n2(x * 0.7, z * 0.7) * 0.5) * 0.03);
      for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (i + k) * 3);
    }
    ng.setAttribute('color', new BufferAttribute(colors, 3));
    g.dispose();
    return ng;
  }, [model]);

  useEffect(() => () => valley.dispose(), [valley]);
  useEffect(() => () => mountains.dispose(), [mountains]);

  return (
    <group>
      <mesh geometry={valley} receiveShadow onClick={onClick}>
        <meshStandardMaterial vertexColors roughness={0.96} metalness={0} />
      </mesh>
      <mesh geometry={mountains} receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.92} metalness={0} flatShading />
      </mesh>
      <Fence model={model} />
    </group>
  );
}

/** Rustic post-and-rail fence on the actual sim boundary. */
function Fence({ model }: { model: TerrainModel }) {
  const { posts, rails } = useMemo(() => {
    const h = model.half;
    const spacing = 2.5;
    const n = Math.round((h * 2) / spacing);
    const pts: Vector3[] = [];
    for (let side = 0; side < 4; side++) {
      for (let i = 0; i < n; i++) {
        const t = -h + i * spacing;
        const [x, z] = side === 0 ? [t, -h] : side === 1 ? [h, t] : side === 2 ? [-t, h] : [-h, -t];
        pts.push(new Vector3(x, model.height(x, z), z));
      }
    }
    return { posts: pts, rails: pts.map((p, i) => [p, pts[(i + 1) % pts.length]] as const) };
  }, [model]);

  const postRef = useRef<InstancedMesh>(null);
  const railRef = useRef<InstancedMesh>(null);
  useEffect(() => {
    const m = new Matrix4();
    const q = new Quaternion();
    const s = new Vector3();
    const up = new Vector3(0, 1, 0);
    const pm = postRef.current;
    if (pm) {
      posts.forEach((p, i) => {
        const tilt = Math.sin(i * 12.9898) * 0.06;
        q.setFromAxisAngle(new Vector3(1, 0, 1).normalize(), tilt);
        s.set(1, 0.9 + Math.abs(Math.sin(i * 78.233)) * 0.25, 1);
        m.compose(new Vector3(p.x, p.y + 0.5 * s.y - 0.05, p.z), q, s);
        pm.setMatrixAt(i, m);
      });
      pm.instanceMatrix.needsUpdate = true;
    }
    const rm = railRef.current;
    if (rm) {
      rails.forEach(([a, b], i) => {
        for (let k = 0; k < 2; k++) {
          const ya = a.y + (k ? 0.45 : 0.8);
          const yb = b.y + (k ? 0.45 : 0.8);
          const mid = new Vector3((a.x + b.x) / 2, (ya + yb) / 2, (a.z + b.z) / 2);
          const dir = new Vector3(b.x - a.x, yb - ya, b.z - a.z);
          const len = dir.length();
          q.setFromUnitVectors(up, dir.normalize());
          s.set(1, len, 1);
          m.compose(mid, q, s);
          rm.setMatrixAt(i * 2 + k, m);
        }
      });
      rm.instanceMatrix.needsUpdate = true;
    }
  }, [posts, rails]);

  return (
    <group>
      <instancedMesh ref={postRef} args={[undefined, undefined, posts.length]} castShadow receiveShadow>
        <cylinderGeometry args={[0.09, 0.12, 1, 6]} />
        <meshStandardMaterial color="#6e5440" roughness={0.95} flatShading />
      </instancedMesh>
      <instancedMesh ref={railRef} args={[undefined, undefined, rails.length * 2]} castShadow>
        <cylinderGeometry args={[0.045, 0.045, 1, 5]} />
        <meshStandardMaterial color="#86684c" roughness={0.95} flatShading />
      </instancedMesh>
    </group>
  );
}
