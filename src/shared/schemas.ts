import { z } from 'zod';
import { CONFIG } from './config';

const finite = z.number().finite();
export const Vec2Schema = z.object({ x: finite, z: finite });
const id = z.string().min(1).max(64);

export const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), target: Vec2Schema }),
  z.object({ type: z.literal('take'), foodId: id }),
  z.object({ type: z.literal('eat') }),
  z.object({ type: z.literal('give'), recipientId: id }),
  z.object({ type: z.literal('say'), text: z.string().min(1).max(CONFIG.messageMaxChars) }),
  z.object({ type: z.literal('wait') }),
]);

export const DecisionSchema = z.object({
  action: ActionSchema,
  memory: z.string().max(CONFIG.memoryMaxChars).optional(),
  intent: z.string().max(CONFIG.intentMaxChars).optional(),
});

const actionType = z.enum(['move', 'take', 'eat', 'give', 'say', 'wait']);

export const ObservationSchema = z.object({
  runId: z.string().max(64),
  observedAt: finite,
  self: z.object({ id, position: Vec2Schema, energy: finite, inventory: z.number().int() }),
  bounds: z.object({ min: Vec2Schema, max: Vec2Schema }),
  visibleFood: z.array(z.object({ id, position: Vec2Schema, units: z.number().int() })).max(50),
  visibleAgents: z.array(z.object({ id, position: Vec2Schema })).max(50),
  visibleObstacles: z.array(z.object({ id, position: Vec2Schema, radius: finite })).max(50),
  messages: z
    .array(z.object({ id, senderId: id, text: z.string().max(CONFIG.messageMaxChars), sentAt: finite }))
    .max(CONFIG.inboxMax),
  recentOutcomes: z
    .array(z.object({ actionType, ok: z.boolean(), detail: z.string().max(300) }))
    .max(CONFIG.recentOutcomes),
});

export const DecideRequestSchema = z.object({
  observation: ObservationSchema,
  memory: z.string().max(CONFIG.memoryMaxChars),
});

export const WorldEditSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('add_food'), position: Vec2Schema, units: z.number().int().min(1).max(20) }),
  z.object({ type: z.literal('remove_food'), foodId: id }),
  z.object({
    type: z.literal('add_obstacle'),
    position: Vec2Schema,
    radius: z.number().min(0.3).max(4),
    shape: z.enum(['box', 'cylinder']),
  }),
  z.object({
    type: z.literal('spawn_agents'),
    count: z.number().int().min(1).max(CONFIG.maxAgents),
    controller: z.enum(['scripted', 'llm']),
  }),
]);

export type DecideRequest = z.infer<typeof DecideRequestSchema>;
export type HealthResponse = { llmConfigured: boolean; model: string | null; detail: string };
