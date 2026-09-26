import { useEffect, useMemo } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';

/** Billboard text label drawn to a canvas texture (no DOM overlay, safe to mount/unmount). */
export function Label({
  lines,
  position,
  bg = 'rgba(20,24,32,0.78)',
  outline,
  dark,
}: {
  lines: string[];
  position: [number, number, number];
  bg?: string;
  outline?: string;
  /** Dark text (for light bubbles). */
  dark?: boolean;
}) {
  const key = lines.join('\n') + bg + outline + dark;
  const { texture, aspect } = useMemo(() => {
    const scale = 2;
    const font = `${13 * scale}px system-ui, sans-serif`;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    ctx.font = font;
    const pad = 6 * scale;
    const lh = 16 * scale;
    const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2);
    const h = lh * lines.length + pad;
    canvas.width = w;
    canvas.height = h;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 6 * scale);
    ctx.fill();
    if (outline) {
      ctx.strokeStyle = outline;
      ctx.lineWidth = 3 * scale;
      ctx.stroke();
    }
    ctx.font = font;
    ctx.fillStyle = dark ? '#0b0b0b' : '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, w / 2, pad / 2 + lh * (i + 0.5)));
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return { texture, aspect: w / h };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => () => texture.dispose(), [texture]);
  const height = 0.32 * lines.length + 0.1;
  return (
    <sprite position={position} scale={[height * aspect, height, 1]} renderOrder={10}>
      <spriteMaterial map={texture} depthTest={false} transparent />
    </sprite>
  );
}
