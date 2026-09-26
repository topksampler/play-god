import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import express from 'express';
import { DecideRequestSchema, type HealthResponse } from '../src/shared/schemas';
import { decide, hasKey, model } from './anthropic';

const app = express();
app.use(express.json({ limit: '64kb' }));

const MAX_CONCURRENT = 4;
let active = 0;

app.get('/api/health', (_req, res) => {
  const body: HealthResponse = hasKey()
    ? { llmConfigured: true, model: model(), detail: `LLM ready (${model()})` }
    : { llmConfigured: false, model: null, detail: 'ANTHROPIC_API_KEY not set on the server. Add it to .env and restart.' };
  res.json(body);
});

app.post('/api/decide', async (req, res) => {
  if (!hasKey()) return res.status(503).json({ error: 'LLM not configured: ANTHROPIC_API_KEY missing on server' });
  const parsed = DecideRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid decide request' });
  if (active >= MAX_CONCURRENT) return res.status(429).json({ error: 'server busy' });
  active++;
  const t0 = Date.now();
  try {
    const decision = await decide(parsed.data);
    console.log(`[decide] ${parsed.data.observation.self.id} → ${decision.action.type} (${Date.now() - t0}ms)`);
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

// Person B: natural-language world editing goes here (allowlisted WorldEdit, sim validates).
app.post('/api/world-command', (_req, res) => {
  res.status(501).json({ error: 'world-command not implemented yet' });
});

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => {
  console.log(`[server] listening on :${port} — ${hasKey() ? `LLM model ${model()}` : 'no ANTHROPIC_API_KEY (scripted only)'}`);
});
