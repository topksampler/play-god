import { BIOMES } from '../shared/catalog';
import { CONFIG } from '../shared/config';
import type { Agent, StructureKind, TimeOfDay, WorldState } from '../shared/types';
import { dist } from './geometry';
import { biomeAt, traitMods } from './world';

/** 0..1 through the day cycle. */
export const dayPhase = (time: number) => (time % CONFIG.dayLengthSec) / CONFIG.dayLengthSec;

export function timeOfDay(time: number): TimeOfDay {
  const p = dayPhase(time);
  if (p < 0.5) return 'day';
  if (p < 0.6) return 'dusk';
  if (p < 0.9) return 'night';
  return 'dawn';
}

/** Daylight 0 (night) .. 1 (noon) for rendering. */
export function daylight(time: number): number {
  const p = dayPhase(time);
  if (p < 0.5) return 0.75 + 0.25 * Math.sin((p / 0.5) * Math.PI);
  if (p < 0.6) return 0.75 * (1 - (p - 0.5) / 0.1) + 0.1;
  if (p < 0.9) return 0.1;
  return 0.1 + 0.65 * ((p - 0.9) / 0.1);
}

export function nearStructure(state: WorldState, a: Agent, kind: StructureKind, radius: number) {
  return Object.values(state.structures).find(
    (s) => s.kind === kind && dist(s.position, a.position) <= radius && (kind !== 'campfire' || (s.litUntil ?? 0) > state.time),
  );
}

export function senseRadius(state: WorldState, a: Agent): number {
  let r = CONFIG.senseRadius * BIOMES[biomeAt(state, a.position)].visionMul * traitMods(a.traits).senseMul;
  const tod = timeOfDay(state.time);
  if (tod === 'night') {
    const lit = a.hasTorch || nearStructure(state, a, 'campfire', CONFIG.campfireRadius * 2);
    r *= lit ? CONFIG.torchNightVisionMultiplier : CONFIG.nightVisionMultiplier;
  } else if (tod === 'dusk' || tod === 'dawn') {
    r *= 0.8;
  }
  if (state.weather === 'storm') r *= CONFIG.stormVisionMultiplier;
  else if (state.weather === 'rain') r *= 0.85;
  return r;
}
