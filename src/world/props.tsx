import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { BufferAttribute, type BufferGeometry, CanvasTexture, Color, type Group, IcosahedronGeometry } from 'three';
import { makeNoise } from './noise';

/** Shared procedural-geometry helpers for world props (rocks, foliage, bark). */
const N = makeNoise(90210);

/**
 * Displace a non-indexed geometry by a smooth function of each vertex's original position, so duplicated
 * vertices (shared corners) move identically and the surface stays closed. Then recompute faceted normals.
 */
export function displace(g: BufferGeometry, amount: number, freq: number, seed: number, flattenBelow?: number) {
  const ng = g.index ? g.toNonIndexed() : g;
  const p = ng.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const n = N.n3(x * freq + seed, y * freq - seed * 0.7, z * freq + seed * 1.3) + 0.5 * N.n3(x * freq * 2.3 - seed, y * freq * 2.3, z * freq * 2.3);
    const k = 1 + n * amount;
    p.setXYZ(i, x * k, flattenBelow !== undefined ? Math.max(y * k, flattenBelow) : y * k, z * k);
  }
  ng.computeVertexNormals();
  if (ng !== g) g.dispose();
  return ng;
}

/** Colour each face from its (flat) normal and centroid: callback returns the face colour. */
export function paintFaces(g: BufferGeometry, pick: (ny: number, cy: number, cx: number, cz: number, i: number) => Color) {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i += 3) {
    const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
    const cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    const cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    const ny = (n.getY(i) + n.getY(i + 1) + n.getY(i + 2)) / 3;
    const c = pick(ny, cy, cx, cz, i / 3);
    for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (i + k) * 3);
  }
  g.setAttribute('color', new BufferAttribute(col, 3));
  return g;
}

export const faceNoise = (x: number, y: number, z: number, f = 1) => N.n3(x * f, y * f, z * f);

export type RockLook = { base: string; light: string; dark: string; top?: string; topAmount?: number; strata?: boolean };

export const ROCK_LOOKS: Record<string, RockLook> = {
  granite: { base: '#8c8d8c', light: '#a9a8a2', dark: '#6c6d6f', top: '#9aa36c', topAmount: 0.12 },
  mossy: { base: '#83847e', light: '#9d9c94', dark: '#63655f', top: '#6a9636', topAmount: 0.75 },
  swampy: { base: '#6f7168', light: '#848679', dark: '#53564d', top: '#5d8a34', topAmount: 0.9 },
  sandstone: { base: '#bb8a5c', light: '#d4a773', dark: '#91633f', strata: true },
};

/** A closed, lumpy low-poly rock with faceted colour, optional moss/lichen on upward faces. */
export function rockGeometry(seed: number, look: RockLook, detail = 1, lump = 0.28) {
  const g = displace(new IcosahedronGeometry(1, detail), lump, 0.9, seed, -0.55);
  const base = new Color(look.base);
  const light = new Color(look.light);
  const dark = new Color(look.dark);
  const top = look.top ? new Color(look.top) : null;
  const c = new Color();
  return paintFaces(g, (ny, cy, cx, cz) => {
    const n = faceNoise(cx + seed, cy, cz, 1.7);
    c.copy(base).lerp(n > 0 ? light : dark, Math.min(1, Math.abs(n) * 1.4));
    if (look.strata) c.lerp(Math.sin(cy * 9 + n) > 0.2 ? light : dark, 0.35);
    c.multiplyScalar(0.82 + 0.25 * Math.max(0, ny) + (cy < -0.3 ? -0.12 : 0));
    if (top && ny > 0.45 && faceNoise(cx * 2 + seed, cy * 2, cz * 2) > 0.45 - (look.topAmount ?? 0.3) * 1.2) c.copy(top).offsetHSL(0, 0, n * 0.05);
    return c;
  });
}

/** Lumpy foliage blob coloured darker underneath and sun-kissed on top. */
export function foliageGeometry(seed: number, dark: string, mid: string, light: string, detail = 1, lump = 0.22) {
  const g = displace(new IcosahedronGeometry(1, detail), lump, 1.3, seed);
  const d = new Color(dark);
  const m = new Color(mid);
  const l = new Color(light);
  const c = new Color();
  return paintFaces(g, (ny, cy, cx, cz) => {
    const t = Math.min(1, Math.max(0, (cy + 0.9) / 1.8 + ny * 0.25));
    c.copy(d).lerp(m, Math.min(1, t * 1.6));
    if (t > 0.6) c.lerp(l, (t - 0.6) * 1.8);
    c.offsetHSL(0, 0, faceNoise(cx + seed, cy, cz, 2.2) * 0.04);
    return c;
  });
}

export function Sway({ children, amount = 0.05, speed = 1.2, seed = 0 }: { children: React.ReactNode; amount?: number; speed?: number; seed?: number }) {
  const ref = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime * speed + seed * 10;
    ref.current.rotation.z = Math.sin(t) * amount;
    ref.current.rotation.x = Math.cos(t * 0.7) * amount * 0.6;
  });
  return <group ref={ref}>{children}</group>;
}

let radial: CanvasTexture | null = null;
/** Soft radial falloff (white centre → black edge) used as an alphaMap for ground decals. */
export function radialTexture() {
  if (radial) return radial;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  // Opaque greyscale: alphaMap samples the green channel.
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, '#fff');
  g.addColorStop(0.55, '#d9d9d9');
  g.addColorStop(1, '#000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  radial = new CanvasTexture(c);
  return radial;
}
