# Let's Play God

3D habitat (React Three Fiber, 80×80, 9 biomes) with autonomous agents driven by a real LLM (Claude Haiku 4.5 by default, Sonnet 5 as the "smart" tier; server-side) or a clearly labelled scripted baseline.

Agents have hunger, thirst, health and stamina; see only appearances (e.g. "red-capped mushrooms with white spots"), never true kinds; and must learn what is harmful from outcomes. Resources regrow, spread and wither; food spoils; day/night and weather change vision and drain.

Actions: move (optional sprint), follow, gather, eat, drink, drop, pickup, give, rest, inspect, say, craft (basket, torch), build (campfire, shelter, cache, sign), cook, deposit, withdraw, wait. Each LLM call returns a 1–3 step plan plus private memory (notes, places, beliefs).

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
| `ANTHROPIC_AGENT_MODEL` | Fast tier model; default `claude-haiku-4-5`. |
| `ANTHROPIC_SMART_MODEL` | Smart tier model; default `claude-sonnet-5`. |
| `ANTHROPIC_WORKSPACE_ID` | Sent as `anthropic-workspace-id` for keys not scoped to a workspace. Must belong to the same org as the key. |

Without `ANTHROPIC_API_KEY`, the SDK falls back to an `ant auth login` profile. `.env` is read at server start: restart `npm run dev` after editing it.
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
- Haiku 4.5 decisions take ~3–10 s; agents keep executing their current plan meanwhile.
- Haiku's minimum cacheable prompt is larger than the current system prompt, so prompt caching only applies on Sonnet.
- LLM output is non-deterministic; scripted mode is a development baseline, not an LLM.
- `/api/world-command` (natural-language God mode) is not implemented.
