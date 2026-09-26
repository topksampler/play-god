# Let's Play God

3D habitat (React Three Fiber) with autonomous agents driven by a real LLM (Anthropic API, server-side) or a clearly labelled scripted baseline.

## Run

```bash
npm install
cp .env.example .env   # set ANTHROPIC_API_KEY (and ANTHROPIC_WORKSPACE_ID if your key is not workspace-scoped)
npm run dev            # server :8787 + client http://localhost:5173 (proxies /api)
```

Checks: `npm run typecheck`, `npm test`, `npm run build`.

## Environment (server only — never `VITE_*`)

| Var | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Required for LLM agents. Without it the UI shows a warning and agents use the SCRIPTED baseline. |
| `ANTHROPIC_MODEL` | Model ID; default `claude-opus-5`. |
| `ANTHROPIC_WORKSPACE_ID` | Sent as `anthropic-workspace-id` for keys not scoped to a workspace. |
| `PORT` | Server port (default 8787). |

## Architecture

- `src/shared` — types, Zod schemas, config (contracts; owner A).
- `src/sim` — authoritative store, 20 Hz fixed step, command queue, observation, spawning.
- `src/world` — 3D scene; renders from store, never mutates it.
- `src/controllers` — `Controller` interface, scripted + LLM adapters, scheduler (1 outstanding/agent, global limit 2, 20 s timeout, runId/seq stale rejection).
- `src/ui` — side panel (pause/reset/spawn/inspector) and event feed.
- `server` — Express `/api/health`, `/api/decide`, stub `/api/world-command` (501).

## Known limitations

- Perception is radius-only (no occlusion). Obstacles collide as circles (boxes slightly larger visually).
- Food does not regrow yet; the default map runs out after ~1 min with 5 agents.
- LLM output is non-deterministic; scripted mode is a development baseline, not an LLM.
- `/api/world-command` (natural-language God mode) is not implemented.
