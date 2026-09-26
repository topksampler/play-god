import { z } from 'zod';
import { CONFIG } from './config';

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
  z.object({ type: z.literal('craft'), recipe: z.enum(['basket', 'torch']) }),
  z.object({
    type: z.literal('build'),
    structure: z.enum(['campfire', 'shelter', 'cache', 'sign']),
    text: z.string().max(CONFIG.signMaxChars).optional(),
  }),
  z.object({ type: z.literal('cook'), itemId: id }),
  z.object({ type: z.literal('deposit'), cacheId: id, itemId: id }),
  z.object({ type: z.literal('withdraw'), cacheId: id, itemId: id }),
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

export const WorldEditSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('add_resource'), kind: z.string(), position: Vec2Schema }),
  z.object({ type: z.literal('remove_resource'), nodeId: id }),
  z.object({ type: z.literal('add_obstacle'), shape: z.enum(['rock', 'boulder', 'tree']), position: Vec2Schema, radius: z.number().min(0.3).max(4) }),
  z.object({ type: z.literal('add_hazard'), kind: z.enum(['thorns', 'mud', 'wasps', 'snakes', 'rockfall', 'leeches']), position: Vec2Schema, radius: z.number().min(0.5).max(6) }),
  z.object({ type: z.literal('set_weather'), weather: z.enum(['clear', 'cloudy', 'rain', 'storm']) }),
  z.object({ type: z.literal('spawn_agents'), count: z.number().int().min(1).max(CONFIG.maxAgents), controller: z.enum(['scripted', 'llm']) }),
]);

export type DecideRequest = z.infer<typeof DecideRequestSchema>;
export type HealthResponse = { llmConfigured: boolean; models: { fast: string; smart: string } | null; detail: string };
