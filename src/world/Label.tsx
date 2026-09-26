import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { CanvasTexture, SRGBColorSpace, Vector3, type Sprite } from 'three';

/** World height per text line at close range. */
const LINE_H = 0.34;
/** Reference camera distance: between MIN_K and MAX_K times this, labels keep a constant on-screen size. */
const NEAR = 18;
/** Close up labels stop shrinking (so they never cover the model); far away they shrink with the scene. */
const MIN_K = 0.5;
const MAX_K = 2.8;
const tmp = new Vector3();

/** Billboard text label drawn to a canvas texture (no DOM overlay, safe to mount/unmount). */
export function Label({
  lines,
  position,
  bg = 'rgba(20,24,32,0.78)',
  outline,
}: {
  lines: string[];
  position: [number, number, number];
  bg?: string;
  outline?: string;
}) {
  const key = lines.join('\n') + bg + outline;
  const { texture, aspect } = useMemo(() => {
    const s = 3;
    const font = `600 ${14 * s}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    ctx.font = font;
    const padX = 8 * s;
    const padY = 4 * s;
    const lh = 18 * s;
    const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width)) + padX * 2);
    const h = lh * lines.length + padY * 2;
    canvas.width = w;
    canvas.height = h;
    const bw = outline ? 2.5 * s : 0;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(bw / 2, bw / 2, w - bw, h - bw, 7 * s);
    ctx.fill();
    if (outline) {
      ctx.strokeStyle = outline;
      ctx.lineWidth = bw;
      ctx.stroke();
    }
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3 * s;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.fillStyle = '#fff';
    lines.forEach((l, i) => {
      const y = padY + lh * (i + 0.5);
      ctx.strokeText(l, w / 2, y);
      ctx.fillText(l, w / 2, y);
    });
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    return { texture, aspect: w / h };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => () => texture.dispose(), [texture]);
  const ref = useRef<Sprite>(null);
  const height = LINE_H * lines.length + 0.12;
  useFrame(({ camera }) => {
    const sp = ref.current;
    if (!sp) return;
    sp.getWorldPosition(tmp);
    const k = Math.min(MAX_K, Math.max(MIN_K, camera.position.distanceTo(tmp) / NEAR));
    sp.scale.set(height * aspect * k, height * k, 1);
  });
  return (
    <sprite ref={ref} position={position} scale={[height * aspect, height, 1]} center={[0.5, 0]} renderOrder={10}>
      <spriteMaterial map={texture} depthTest={false} transparent />
    </sprite>
  );
}
