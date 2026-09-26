import { CONFIG } from '../../shared/config';
import type { Agent, Vec2, WorldState } from '../../shared/types';
import { FLY_ODOR, ITEM_ODOR } from '../../sim/fly';
import type { FlySensors } from './body';

/** Antenna geometry in world units, relative to the fly's position and heading. */
export const ANTENNA = { forward: 0.3, side: 0.5 };

/** Taste contact persists this long after the simulator last reported it. */
const TASTE_HOLD_SEC = 0.15;

/** Apparent half-size of looming objects: a plan agent's body, and a swatting hand. */
const BODY_R = 0.4;
const HAND_R = 0.3;

/**
 * Odor concentration at a point: a sum of Gaussian plumes from food nodes that currently hold food, plus sweet food
 * carried by agents or lying on the ground. Radius-only: odor is not blocked by obstacles and there is no wind.
 */
export function odorAt(state: WorldState, odor: 'A' | 'B', x: number, z: number): number {
  const sigma = CONFIG.flyOdorSigma;
  const s2 = 2 * sigma * sigma;
  const cutoff = 3.5 * sigma;
  let c = 0;
  const plume = (p: Vec2, strength: number) => {
    const dx = x - p.x;
    const dz = z - p.z;
    if (Math.abs(dx) > cutoff || Math.abs(dz) > cutoff) return;
    c += strength * Math.exp(-(dx * dx + dz * dz) / s2);
  };
  for (const r of Object.values(state.resources)) {
    if (FLY_ODOR[r.kind] !== odor || r.units < 1) continue;
    plume(r.position, 0.4 + 0.6 * Math.min(1, r.units / r.maxUnits));
  }
  for (const a of Object.values(state.agents)) {
    if (a.fly || a.status === 'dead' || !a.items.length) continue;
    const n = a.items.filter((i) => ITEM_ODOR[i.kind] === odor).length;
    if (n) plume(a.position, CONFIG.carriedOdorStrength * Math.min(1, n / 2));
  }
  for (const g of Object.values(state.groundItems)) if (ITEM_ODOR[g.item.kind] === odor) plume(g.position, CONFIG.carriedOdorStrength);
  return c;
}

/**
 * What each compound eye sees looming: angular size θ = 2·atan(R/d) and expansion rate dθ/dt = 2R·v/(d²+R²) for
 * objects closing in on the fly, per eye (frontal objects reach both eyes; a rear blind spot reaches neither).
 */
export function looming(state: WorldState, a: Agent, vel: Map<string, Vec2>): { rate: [number, number]; size: [number, number] } {
  const rate: [number, number] = [0, 0];
  const size: [number, number] = [0, 0];
  const h = a.heading;
  const fx = Math.cos(h), fz = Math.sin(h);
  const rx = -Math.sin(h), rz = Math.cos(h);
  const self = a.fly && !a.fly.flight ? a.fly.speed : 0;
  const see = (ox: number, oz: number, R: number, vx: number, vz: number) => {
    const dx = ox - a.position.x;
    const dz = oz - a.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3 || d > CONFIG.flyLoomRange) return;
    const ang = Math.atan2((dx * rx + dz * rz) / d, (dx * fx + dz * fz) / d);
    if (Math.abs(ang) > Math.PI - CONFIG.flyBlindSpotRad) return;
    const closing = -((dx * (vx - fx * self) + dz * (vz - fz * self)) / d);
    const th = 2 * Math.atan(R / d);
    const dth = closing > 0 ? (2 * R * closing) / (d * d + R * R) : 0;
    const eyes = Math.abs(ang) < 0.3 ? [0, 1] : ang > 0 ? [1] : [0];
    for (const e of eyes) {
      rate[e] = Math.max(rate[e], dth);
      if (dth > 0) size[e] = Math.max(size[e], th);
    }
  };
  for (const o of Object.values(state.agents)) {
    if (o.fly || o.status === 'dead') continue;
    const v = vel.get(o.id) ?? { x: 0, z: 0 };
    see(o.position.x, o.position.z, BODY_R, v.x, v.z);
  }
  const t = a.fly?.threat;
  if (t && state.time >= t.start && state.time <= t.end) {
    // The hand sweeps from the swatter onto the fly at constant speed.
    const d0 = Math.max(0.2, Math.hypot(t.from.x - a.position.x, t.from.z - a.position.z));
    const ux = (t.from.x - a.position.x) / d0, uz = (t.from.z - a.position.z) / d0;
    const p = (state.time - t.start) / (t.end - t.start);
    const d = Math.max(0.05, d0 * (1 - p));
    const speed = d0 / (t.end - t.start);
    see(a.position.x + ux * d, a.position.z + uz * d, HAND_R, -ux * speed, -uz * speed);
  }
  return { rate, size };
}

/** Sound at each antenna: recent speech from plan agents and buzzing of other flies, falling off with distance. */
export function soundAt(state: WorldState, a: Agent): [number, number] {
  const out: [number, number] = [0, 0];
  const h = a.heading;
  const rx = -Math.sin(h), rz = Math.cos(h);
  const add = (p: Vec2, loud: number, scale: number) => {
    const dx = p.x - a.position.x;
    const dz = p.z - a.position.z;
    const d = Math.hypot(dx, dz);
    const level = loud / (1 + (d / scale) ** 2);
    const right = d > 1e-3 ? (dx * rx + dz * rz) / d : 0;
    out[0] += level * (1 - 0.5 * right);
    out[1] += level * (1 + 0.5 * right);
  };
  for (let i = state.utterances.length - 1; i >= 0; i--) {
    const u = state.utterances[i];
    if (state.time - u.at > 1) break;
    if ((u.channel !== 'speech' && u.channel !== 'signal') || Math.hypot(u.where.x - a.position.x, u.where.z - a.position.z) > CONFIG.flyHearSpeechRadius) continue;
    add(u.where, 1, 1.5);
  }
  for (const s of state.flySounds ?? []) {
    if (s.flyId === a.id || state.time - s.at > 0.5 || Math.hypot(s.where.x - a.position.x, s.where.z - a.position.z) > 2.5) continue;
    add(s.where, 0.3, 1);
  }
  return [Math.min(out[0], 1), Math.min(out[1], 1)];
}

/** What one fly's sense organs receive this tick. Uses only the fly's local surroundings, never global state. */
export function flySensors(state: WorldState, a: Agent, lastSentAt: number, vel: Map<string, Vec2> = new Map()): FlySensors {
  const h = a.heading;
  const ax = a.position.x + ANTENNA.forward * Math.cos(h);
  const az = a.position.z + ANTENNA.forward * Math.sin(h);
  const rx = Math.cos(h + Math.PI / 2) * ANTENNA.side;
  const rz = Math.sin(h + Math.PI / 2) * ANTENNA.side;
  const taste = a.fly?.lastTaste;
  const touching = taste && state.time - taste.at <= TASTE_HOLD_SEC;
  const loom = looming(state, a, vel);
  return {
    odorA: [odorAt(state, 'A', ax - rx, az - rz), odorAt(state, 'A', ax + rx, az + rz)],
    odorB: [odorAt(state, 'B', ax - rx, az - rz), odorAt(state, 'B', ax + rx, az + rz)],
    sugarContact: Boolean(touching && taste.sugar),
    bitterContact: Boolean(touching && taste.bitter),
    energy: a.energy,
    ateThisTick: Boolean(taste?.ate && taste.at > lastSentAt),
    loomRate: loom.rate,
    loomSize: loom.size,
    sound: soundAt(state, a),
  };
}
