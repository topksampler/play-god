import { z } from 'zod';
import { HAZARDS, NODES } from './catalog';
import { CONFIG } from './config';
import type { HazardKind, NodeKind, WorldEdit } from './types';

const finite = z.number().finite();
export const Vec2Schema = z.object({ x: finite, z: finite });
const id = z.string().min(1).max(64);

export const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), target: Vec2Schema, sprint: z.boolean().optional() }),
  z.object({ type: z.literal('follow'), agentId: id }),
  z.object({ type: z.literal('gather'), nodeId: id }),
  z.object({ type: z.literal('eat'), itemId: id }),
  z.object({ type: z.literal('drink'), sourceId: id }),
  z.object({ type: z.literal('drop'), itemId: id }),
  z.object({ type: z.literal('pickup'), groundItemId: id }),
  z.object({ type: z.literal('give'), recipientId: id, itemId: id }),
  z.object({ type: z.literal('rest') }),
  z.object({ type: z.literal('inspect'), targetId: id }),
  z.object({ type: z.literal('say'), text: z.string().min(1).max(CONFIG.messageMaxChars) }),
  z.object({ type: z.literal('signal'), tokens: z.array(z.string().min(1).max(12)).min(1).max(CONFIG.maxSignalTokens) }),
  z.object({ type: z.literal('gesture'), gesture: z.enum(['point', 'beckon', 'wave', 'jump', 'crouch']), toward: Vec2Schema.optional() }),
  z.object({ type: z.literal('mark'), glyph: z.string().min(1).max(12) }),
  z.object({ type: z.literal('court'), agentId: id }),
  z.object({ type: z.literal('craft'), recipe: z.enum(['basket', 'torch']) }),
  z.object({
    type: z.literal('build'),
    structure: z.enum(['campfire', 'shelter', 'cache', 'sign']),
    text: z.string().max(CONFIG.signMaxChars).optional(),
  }),
  z.object({ type: z.literal('cook'), itemId: id }),
  z.object({ type: z.literal('deposit'), cacheId: id, itemId: id }),
  z.object({ type: z.literal('withdraw'), cacheId: id, itemId: id }),
  z.object({ type: z.literal('swat'), flyId: id }),
  z.object({ type: z.literal('wait') }),
]);

export const MemorySchema = z.object({
  notes: z.string().max(CONFIG.notesMaxChars),
  places: z.array(z.object({ label: z.string().max(40), x: finite, z: finite })).max(CONFIG.maxPlaces),
  beliefs: z
    .array(z.object({ appearance: z.string().max(80), verdict: z.enum(['safe', 'harmful', 'unknown']) }))
    .max(CONFIG.maxBeliefs),
});

export const DecisionSchema = z.object({
  plan: z.array(ActionSchema).min(1).max(CONFIG.maxPlanLength),
  memory: MemorySchema.optional(),
  intent: z.string().max(CONFIG.intentMaxChars).optional(),
});

/** The server validates observation shape loosely (it is only rendered into the prompt) but bounds its size. */
export const DecideRequestSchema = z.object({
  tier: z.enum(['fast', 'smart']),
  observation: z.record(z.string(), z.unknown()).refine((o) => JSON.stringify(o).length < 24000, 'observation too large'),
  memory: MemorySchema,
});

export const NODE_KINDS = Object.keys(NODES) as [NodeKind, ...NodeKind[]];

export const WorldEditSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('add_resource'), kind: z.enum(NODE_KINDS), position: Vec2Schema }),
  z.object({ type: z.literal('remove_resource'), nodeId: id }),
  z.object({ type: z.literal('add_obstacle'), shape: z.enum(['rock', 'boulder', 'tree']), position: Vec2Schema, radius: z.number().min(0.3).max(4) }),
  z.object({ type: z.literal('add_hazard'), kind: z.enum(Object.keys(HAZARDS) as [HazardKind, ...HazardKind[]]), position: Vec2Schema, radius: z.number().min(0.5).max(6) }),
  z.object({ type: z.literal('remove_hazard'), hazardId: id }),
  z.object({ type: z.literal('set_weather'), weather: z.enum(['clear', 'cloudy', 'rain', 'storm']), durationSec: z.number().min(10).max(600).optional() }),
  z.object({ type: z.literal('set_time_of_day'), timeOfDay: z.enum(['dawn', 'day', 'dusk', 'night']) }),
  z.object({ type: z.literal('spawn_agents'), count: z.number().int().min(1).max(10), controller: z.enum(['scripted', 'llm', 'fly']) }),
  z.object({ type: z.literal('kill_agent'), agentId: id }),
]);

/**
 * Natural-language God mode: the instruction plus a compact snapshot of actual world state (built client-side by
 * worldStatus), used to ground placement and to answer status questions.
 */
export const WorldCommandRequestSchema = z.object({
  text: z.string().trim().min(1).max(500),
  world: z
    .looseObject({ mode: z.enum(['agents', 'flies', 'mixed']) })
    .refine((w) => JSON.stringify(w).length < 24000, 'world snapshot too large'),
});
export type WorldCommandRequest = z.infer<typeof WorldCommandRequestSchema>;
export type WorldCommandResponse = { edits: WorldEdit[]; rejected: string[]; reply: string; model: string };

export type DecideRequest = z.infer<typeof DecideRequestSchema>;
export type HealthResponse = {
  llmConfigured: boolean;
  models: { fast: string; smart: string } | null;
  detail: string;
  /** True when the deployment requires an access code (PLAY_GOD_ACCESS_CODE) that this browser has not supplied. */
  locked?: boolean;
  /** Optional UI features switched on in the server environment (e.g. ENABLE_FLY_MODE=true). */
  features?: { flyMode: boolean };
};
