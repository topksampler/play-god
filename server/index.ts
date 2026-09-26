import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import express from 'express';
import { DecideRequestSchema, type HealthResponse, WorldCommandRequestSchema } from '../src/shared/schemas';
import { credentialSource, decide, modelFor } from './anthropic';
import { interpretWorldCommand } from './worldCommand';

// Fruit-fly (connectome) mode is hidden unless ENABLE_FLY_MODE=true|1 in the server environment.
const flyModeEnabled = () => /^(1|true|yes|on)$/i.test(process.env.ENABLE_FLY_MODE?.trim() ?? '');

const app = express();
app.use(express.json({ limit: '64kb' }));

const MAX_CONCURRENT = 4;
let active = 0;

app.get('/api/health', (_req, res) => {
  const source = credentialSource();
  const models = { fast: modelFor('fast'), smart: modelFor('smart') };
  const body: HealthResponse = source
    ? { llmConfigured: true, models, detail: `LLM ready via ${source} (fast ${models.fast}, smart ${models.smart})` }
    : { llmConfigured: false, models, detail: 'No Anthropic credentials on the server. Set ANTHROPIC_API_KEY in .env or run `ant auth login`, then restart.' };
  res.json({ ...body, features: { flyMode: flyModeEnabled() } });
});

app.post('/api/decide', async (req, res) => {
  if (!credentialSource()) return res.status(503).json({ error: 'LLM not configured: no Anthropic credentials on server' });
  const parsed = DecideRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid decide request' });
  if (active >= MAX_CONCURRENT) return res.status(429).json({ error: 'server busy' });
  active++;
  const t0 = Date.now();
  try {
    const { decision, model, usage, dropped } = await decide(parsed.data);
    const self = (parsed.data.observation as { self?: { id?: string } }).self;
    console.log(
      `[decide] ${self?.id ?? '?'} ${model} → ${decision.plan.map((p) => p.type).join(',')} ` +
        `${dropped ? `(dropped ${dropped} malformed) ` : ''}(${Date.now() - t0}ms, in ${usage.input} out ${usage.output} cache r${usage.cacheRead}/w${usage.cacheWrite})`,
    );
    res.json(decision);
  } catch (e) {
    const msg =
      e instanceof Anthropic.APIError ? `API ${e.message}`.slice(0, 300) : (e as Error).message;
    console.warn(`[decide] error: ${msg}`);
    res.status(502).json({ error: msg });
  } finally {
    active--;
  }
});

// Natural-language God mode: the model may only emit allowlisted WorldEdits (or answer status questions from the
// supplied snapshot); the browser simulator validates and applies edits.
let commandActive = 0;
app.post('/api/world-command', async (req, res) => {
  if (!credentialSource()) return res.status(503).json({ error: 'LLM not configured: set ANTHROPIC_API_KEY on the server to use natural-language God mode (the direct God buttons still work)' });
  const parsed = WorldCommandRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: `invalid world-command request: ${parsed.error.issues[0]?.message ?? 'bad request'}` });
  if (commandActive >= 2) return res.status(429).json({ error: 'server busy — wait for the previous command' });
  commandActive++;
  const t0 = Date.now();
  try {
    const result = await interpretWorldCommand(parsed.data);
    console.log(
      `[world-command] "${parsed.data.text.slice(0, 60)}" ${result.model} → ${result.edits.map((e) => e.type).join(',') || 'reply only'}` +
        `${result.rejected.length ? ` (rejected ${result.rejected.length})` : ''} (${Date.now() - t0}ms)`,
    );
    res.json(result);
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `API ${e.message}`.slice(0, 300) : (e as Error).message;
    console.warn(`[world-command] error: ${msg}`);
    res.status(502).json({ error: msg });
  } finally {
    commandActive--;
  }
});

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => {
  console.log(`[server] listening on :${port} — ${credentialSource() ? `LLM via ${credentialSource()} (fast ${modelFor('fast')})` : 'no Anthropic credentials (scripted only)'}`);
});
