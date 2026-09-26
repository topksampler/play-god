/**
 * Framework-agnostic API handlers, shared by the local Express server (server/index.ts) and the
 * Netlify Function (netlify/functions/api.ts). Credentials stay server-side.
 */
import Anthropic from '@anthropic-ai/sdk';
import { DecideRequestSchema, type HealthResponse, WorldCommandRequestSchema } from '../src/shared/schemas';
import { credentialSource, decide, modelFor } from './anthropic';
import { interpretWorldCommand } from './worldCommand';

export type ApiResult = { status: number; body: unknown };

// Fruit-fly (connectome) mode is hidden unless ENABLE_FLY_MODE=true|1 in the server environment.
const flyModeEnabled = () => /^(1|true|yes|on)$/i.test(process.env.ENABLE_FLY_MODE?.trim() ?? '');

/**
 * Optional shared access code for public deployments (PLAY_GOD_ACCESS_CODE). When set, LLM routes require the
 * header `x-access-code`, so a public URL cannot be used to spend the Anthropic account's credits.
 */
const accessCode = () => process.env.PLAY_GOD_ACCESS_CODE?.trim() || null;
const unlocked = (headers: Headers) => !accessCode() || headers.get('x-access-code') === accessCode();
const LOCKED: ApiResult = { status: 401, body: { error: 'access code required: enter it in the panel (set by PLAY_GOD_ACCESS_CODE on the server)' } };

const MAX_CONCURRENT = 4;
let active = 0;
let commandActive = 0;

const apiError = (e: unknown) => (e instanceof Anthropic.APIError ? `API ${e.message}`.slice(0, 300) : (e as Error).message);

export function health(headers: Headers): ApiResult {
  const source = credentialSource();
  const models = { fast: modelFor('fast'), smart: modelFor('smart') };
  const locked = !unlocked(headers);
  const body: HealthResponse = !source
    ? { llmConfigured: false, models, detail: 'No Anthropic credentials on the server. Set ANTHROPIC_API_KEY in .env (or the host environment) or run `ant auth login`, then restart.' }
    : locked
      ? { llmConfigured: false, models, detail: 'LLM agents are locked on this deployment: enter the access code.', locked: true }
      : { llmConfigured: true, models, detail: `LLM ready via ${source} (fast ${models.fast}, smart ${models.smart})` };
  return { status: 200, body: { ...body, features: { flyMode: flyModeEnabled() } } };
}

export async function decideRoute(body: unknown, headers: Headers): Promise<ApiResult> {
  if (!credentialSource()) return { status: 503, body: { error: 'LLM not configured: no Anthropic credentials on server' } };
  if (!unlocked(headers)) return LOCKED;
  const parsed = DecideRequestSchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: 'invalid decide request' } };
  if (active >= MAX_CONCURRENT) return { status: 429, body: { error: 'server busy' } };
  active++;
  const t0 = Date.now();
  try {
    const { decision, model, usage, dropped } = await decide(parsed.data);
    const self = (parsed.data.observation as { self?: { id?: string } }).self;
    console.log(
      `[decide] ${self?.id ?? '?'} ${model} → ${decision.plan.map((p) => p.type).join(',')} ` +
        `${dropped ? `(dropped ${dropped} malformed) ` : ''}(${Date.now() - t0}ms, in ${usage.input} out ${usage.output} cache r${usage.cacheRead}/w${usage.cacheWrite})`,
    );
    return { status: 200, body: decision };
  } catch (e) {
    console.warn(`[decide] error: ${apiError(e)}`);
    return { status: 502, body: { error: apiError(e) } };
  } finally {
    active--;
  }
}

// Natural-language God mode: the model may only emit allowlisted WorldEdits (or answer status questions from the
// supplied snapshot); the browser simulator validates and applies edits.
export async function worldCommandRoute(body: unknown, headers: Headers): Promise<ApiResult> {
  if (!credentialSource()) return { status: 503, body: { error: 'LLM not configured: set ANTHROPIC_API_KEY on the server to use natural-language God mode (the direct God buttons still work)' } };
  if (!unlocked(headers)) return LOCKED;
  const parsed = WorldCommandRequestSchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: `invalid world-command request: ${parsed.error.issues[0]?.message ?? 'bad request'}` } };
  if (commandActive >= 2) return { status: 429, body: { error: 'server busy — wait for the previous command' } };
  commandActive++;
  const t0 = Date.now();
  try {
    const result = await interpretWorldCommand(parsed.data);
    console.log(
      `[world-command] "${parsed.data.text.slice(0, 60)}" ${result.model} → ${result.edits.map((e) => e.type).join(',') || 'reply only'}` +
        `${result.rejected.length ? ` (rejected ${result.rejected.length})` : ''} (${Date.now() - t0}ms)`,
    );
    return { status: 200, body: result };
  } catch (e) {
    console.warn(`[world-command] error: ${apiError(e)}`);
    return { status: 502, body: { error: apiError(e) } };
  } finally {
    commandActive--;
  }
}
