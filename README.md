# Let's Play God

3D habitat (React Three Fiber, 80×80, 9 biomes) with autonomous agents driven by a real LLM (Claude Haiku 4.5 by default, Sonnet 5 as the "smart" tier; server-side) or a clearly labelled scripted baseline.

Agents have hunger, thirst, health and stamina; see only appearances (e.g. "red-capped mushrooms with white spots"), never true kinds; and must learn what is harmful from outcomes. Resources regrow, spread and wither; food spoils; day/night and weather change vision and drain.

Actions: move (optional sprint), follow, gather, eat, drink, drop, pickup, give, rest, inspect, say, craft (basket, torch), build (campfire, shelter, cache, sign), cook, deposit, withdraw, wait. Each LLM call returns a 1–3 step plan plus private memory (notes, places, beliefs).

## Two modes

Toggle **LLM agents / Fruit flies (connectome)** at the top of the side panel (switching starts a fresh world in that mode).

- **LLM agents** — everything above.
- **Fruit flies (connectome)**: each fly runs its own spiking circuit of 5,966 neurons and 432K synapses from the FlyWire adult *Drosophila* connectome, pruned from the Shiu et al. whole-brain LIF model.
  - Odor at its two antennae steers it through the DNa02/DNa01 descending neurons.
  - Tasting sugar drives MN9, the proboscis motor neuron, so it feeds.
  - Dopamine-gated plasticity in its own mushroom body makes it learn from what it tastes.
  - Sweet fruit smells of "odor A"; both mushroom kinds smell of "odor B", with brown ones sweet and red ones bitter.
  - Spawn 1/5/10 flies, up to the brain-worker capacity. Click a fly for its live spike readouts.
  - Brains run in Web Workers. When they cannot keep up, the world slows down (shown in the HUD) so no fly acts on stale motor commands.
  - Full details, the validation, and exactly which parts are body-level rules rather than neural: [docs/FLY.md](docs/FLY.md). No API key needed.

## God mode

- **Natural language (LLM):** e.g. "put fruit trees in the northeast corner". The server model may only emit allowlisted edits (`add_resource`, `remove_resource`, `add_obstacle`, `add_hazard`, `set_weather`, `spawn_agents`). The browser simulator validates and applies them, and each outcome shows in the event feed. Needs `ANTHROPIC_API_KEY`.
- **Direct buttons** (World tab; not LLM): weather, +berries, +fruit tree, +water, +brown/toxic mushrooms, +thorns near the selected creature.

## Run

```bash
npm install
cp .env.example .env   # set ANTHROPIC_API_KEY (and ANTHROPIC_WORKSPACE_ID if your key is not workspace-scoped)
npm run dev            # server :8787 + client http://localhost:5173 (proxies /api)
```

Checks: `npm run typecheck`, `npm test`, `npm run build`.
Fly brain fidelity and speed: `npx tsx scripts/fly/smoke.ts`. Browser smoke test (headless Chrome, no extra dependencies): `node scripts/browser-smoke.mjs steps.json`. Rebuilding the fly circuit from FlyWire data: [tools/fly/README.md](tools/fly/README.md).

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
- `server` — Express `/api/health`, `/api/decide`, `/api/world-command` (natural-language God mode, `server/worldCommand.ts`).
- `src/controllers/fly` — connectome brain (`brain.ts`), sensory/motor adapter (`body.ts`), world sensing, Web Worker pool (`worker.ts`, `swarm.ts`), sim bridge (`driver.ts`). Fly bodies: `src/sim/fly.ts`. Model: `src/world/FlyModel.tsx`. Circuit data: `public/fly/`.

## Known limitations

- Perception is radius-only (no occlusion). Obstacles collide as circles (boxes slightly larger visually).
- Haiku 4.5 decisions take ~3–10 s; agents keep executing their current plan meanwhile.
- Haiku's minimum cacheable prompt is larger than the current system prompt, so prompt caching only applies on Sonnet.
- LLM output is non-deterministic; scripted mode is a development baseline, not an LLM.
- Fly brains are CPU-bound: about 0.25 CPU-s per simulated second for a fly near food, about 10× less for a fly smelling nothing. On a 6-core laptop, about 20 food-seeking flies run in real time; more slow the fly world down.
- Fly odor is Gaussian plumes (no wind, not blocked by obstacles). Flies do not sense hazards. Walking speed and exploratory turning noise are body-level rules (see docs/FLY.md).
