import { useMemo } from 'react';
import { BufferGeometry, Float32BufferAttribute } from 'three';
import type { WorldState } from '../shared/types';
import { Label } from './Label';

/** Lines from speaker to actual hearers for ~3s after a delivery. Never drawn for communication that did not happen. */
function DeliveryLines({ world }: { world: WorldState }) {
  const geo = useMemo(() => new BufferGeometry(), []);
  const pts: number[] = [];
  for (const d of world.deliveries) {
    const from = world.agents[d.from];
    if (!from || world.time - d.at > 3) continue;
    for (const id of d.to) {
      const to = world.agents[id];
      if (to) pts.push(from.position.x, 1.3, from.position.z, to.position.x, 1.3, to.position.z);
    }
  }
  geo.setAttribute('position', new Float32BufferAttribute(pts, 3));
  return (
    <lineSegments geometry={geo} frustumCulled={false}>
      <lineBasicMaterial color="#1baf7a" transparent opacity={0.9} />
    </lineSegments>
  );
}

export function CommsLayer({ world }: { world: WorldState }) {
  const recent = new Map<string, { content: string; channel: string }>();
  for (let i = world.utterances.length - 1; i >= 0; i--) {
    const u = world.utterances[i];
    if (world.time - u.at > 3.5) break;
    if (!recent.has(u.speaker) && (u.channel === 'speech' || u.channel === 'signal')) recent.set(u.speaker, u);
  }
  return (
    <>
      <DeliveryLines world={world} />
      {[...recent.entries()].map(([id, u]) => {
        const a = world.agents[id];
        if (!a) return null;
        const text = u.channel === 'signal' ? `🔊 ${u.content}` : `💬 ${u.content.length > 60 ? u.content.slice(0, 57) + '…' : u.content}`;
        return <Label key={id} position={[a.position.x, 3.1, a.position.z]} bg="rgba(255,255,255,0.95)" outline="#1baf7a" lines={[text]} dark />;
      })}
      {Object.values(world.agents).map((a) => {
        const g = a.gesture;
        if (!g || g.until <= world.time) return null;
        const ang = g.toward ? Math.atan2(g.toward.z - a.position.z, g.toward.x - a.position.x) : a.heading;
        return (
          <group key={a.id} position={[a.position.x, 0, a.position.z]}>
            {g.kind === 'point' && (
              <group rotation={[0, -ang, 0]}>
                <mesh position={[1.1, 1.1, 0]} rotation={[0, 0, -Math.PI / 2]}>
                  <coneGeometry args={[0.18, 0.5, 8]} />
                  <meshStandardMaterial color={a.color} emissive={a.color} emissiveIntensity={0.5} />
                </mesh>
                <mesh position={[0.6, 1.1, 0]} rotation={[0, 0, Math.PI / 2]}>
                  <cylinderGeometry args={[0.05, 0.05, 0.6, 6]} />
                  <meshStandardMaterial color={a.color} />
                </mesh>
              </group>
            )}
            <Label position={[0, 2.7, 0]} bg="rgba(74,58,167,0.9)" lines={[`✋ ${g.kind}`]} />
          </group>
        );
      })}
      {Object.values(world.marks).map((m) => (
        <group key={m.id} position={[m.position.x, 0.02, m.position.z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.35, 0.5, 6]} />
            <meshBasicMaterial color="#3a2f25" transparent opacity={Math.max(0.2, 1 - (world.time - m.at) / 240)} />
          </mesh>
          <Label position={[0, 0.5, 0]} bg="rgba(58,47,37,0.85)" lines={[`✎ ${m.glyph}`]} />
        </group>
      ))}
    </>
  );
}
