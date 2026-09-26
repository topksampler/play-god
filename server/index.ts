import 'dotenv/config';
import express, { type Request } from 'express';
import { credentialSource, modelFor } from './anthropic';
import { type ApiResult, decideRoute, health, observeRoute, worldCommandRoute } from './routes';

// Local development server. In production (Netlify) the same handlers run as a function: netlify/functions/api.ts.
const app = express();
// The observer sends several runs of recorded moments.
app.use(express.json({ limit: '256kb' }));

const headersOf = (req: Request) => new Headers(Object.entries(req.headers).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : [])) as [string, string][]);
const send = (res: express.Response, r: ApiResult) => res.status(r.status).json(r.body);

app.get('/api/health', (req, res) => send(res, health(headersOf(req))));
app.post('/api/decide', async (req, res) => send(res, await decideRoute(req.body, headersOf(req))));
app.post('/api/world-command', async (req, res) => send(res, await worldCommandRoute(req.body, headersOf(req))));
app.post('/api/observe', async (req, res) => send(res, await observeRoute(req.body, headersOf(req))));

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => {
  console.log(`[server] listening on :${port} — ${credentialSource() ? `LLM via ${credentialSource()} (fast ${modelFor('fast')})` : 'no Anthropic credentials (scripted only)'}`);
});
