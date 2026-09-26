/**
 * Netlify Function (modern Request/Response API) serving /api/* in production with the same handlers as the
 * local Express server. Set ANTHROPIC_API_KEY (and optionally ANTHROPIC_WORKSPACE_ID, ANTHROPIC_AGENT_MODEL,
 * ANTHROPIC_SMART_MODEL, PLAY_GOD_ACCESS_CODE, ENABLE_FLY_MODE) in the Netlify site's environment variables.
 */
import { type ApiResult, decideRoute, health, worldCommandRoute } from '../../server/routes';

const MAX_BODY = 64 * 1024;
const json = (r: ApiResult) => new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });

async function readJson(req: Request): Promise<unknown | ApiResult> {
  const text = await req.text();
  if (text.length > MAX_BODY) return { status: 413, body: { error: 'request too large' } };
  try {
    return JSON.parse(text);
  } catch {
    return { status: 400, body: { error: 'invalid JSON' } };
  }
}
const isResult = (x: unknown): x is ApiResult => typeof x === 'object' && x !== null && 'status' in x && 'body' in x && Object.keys(x).length === 2;

export default async (req: Request): Promise<Response> => {
  const path = new URL(req.url).pathname;
  if (path === '/api/health' && req.method === 'GET') return json(health(req.headers));
  if (req.method !== 'POST') return json({ status: 405, body: { error: 'method not allowed' } });
  const body = await readJson(req);
  if (isResult(body)) return json(body);
  if (path === '/api/decide') return json(await decideRoute(body, req.headers));
  if (path === '/api/world-command') return json(await worldCommandRoute(body, req.headers));
  return json({ status: 404, body: { error: 'not found' } });
};

export const config = { path: ['/api/health', '/api/decide', '/api/world-command'] };
