# Let's Play God

A 3D habitat (React Three Fiber, 80×80, 9 biomes) with two populations you can play god over:

- **LLM agents**: plan-based creatures driven by a real LLM on the server (Claude Haiku 4.5 by default, Sonnet 5 as the "smart" tier). Without credentials they run a clearly labelled scripted baseline.
- **Fruit flies (connectome)**: each fly runs its own spiking neural circuit of 5,966 neurons and 432K synapses taken from the FlyWire adult *Drosophila* connectome. Odor steers it, sugar makes it feed, and dopamine-gated plasticity in its own mushroom body makes it learn from what it tastes. See [docs/FLY.md](docs/FLY.md).

Switch between them with the **LLM agents / Fruit flies** toggle at the top of the side panel; switching starts a fresh world in that mode.

## Run

```bash
npm install
cp .env.example .env   # set ANTHROPIC_API_KEY (and ANTHROPIC_WORKSPACE_ID if your key is not workspace-scoped)
npm run dev            # server :8787 + client http://localhost:5173 (proxies /api)
```

Checks: `npm run typecheck`, `npm test`, `npm run build`.
Agent survival benchmark (headless, real simulator and scheduler rules): `npx tsx scripts/agent-bench.mts 1,2,3,4,5 600 5 [latencySec]`.
Fly brain fidelity and speed: `npx tsx scripts/fly/smoke.ts`. In-browser worker benchmark: open `http://localhost:5173/tools/fly/bench/index.html?flies=20&odor=0.6` while `npm run dev` is running.
Browser smoke test (headless Chrome, no extra dependencies): `node scripts/browser-smoke.mjs steps.json` (see the header comment in that script).

## Environment (server only — never `VITE_*`)

| Var | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Required for LLM agents and natural-language God mode. Without it the UI shows a warning, agents use the SCRIPTED baseline, and the God command box is disabled (direct God buttons still work). |
| `ANTHROPIC_AGENT_MODEL` | Fast tier model; default `claude-haiku-4-5`. Also used for natural-language God mode. |
| `ANTHROPIC_SMART_MODEL` | Smart tier model; default `claude-sonnet-5`. |
| `ANTHROPIC_WORKSPACE_ID` | Sent as `anthropic-workspace-id` for keys not scoped to a workspace. Must belong to the same org as the key. |
| `PORT` | Server port (default 8787). |

Without `ANTHROPIC_API_KEY`, the SDK falls back to an `ant auth login` profile. `.env` is read at server start: restart `npm run dev` after editing it. Fruit-fly mode needs no credentials.

## LLM agents

Agents have hunger, thirst, health and stamina. They see only appearances (for example "red-capped mushrooms with white spots"), never true kinds, and must learn what is harmful from outcomes. Resources regrow, spread and wither; food spoils; day/night and weather change vision and drain.

Actions: move (optional sprint), follow, gather, eat, drink, drop, pickup, give, rest, inspect, say, craft (basket, torch), build (campfire, shelter, cache, sign), cook, deposit, withdraw, wait. Each LLM call returns a 1–3 step plan plus private memory (notes, places, beliefs).

Movement uses grid A* around solid obstacles and prefers routes that avoid hazard patches. Each observation carries the reason for the decision, how old each outcome is, and the agent's remembered places with distance and bearing. Malformed plan steps are dropped individually, and memory is merged rather than replaced.

## Fruit flies

- Spawn 1/5/10 flies (up to the brain-worker capacity, 40 on an 8-worker machine). Click a fly to see its live spike readouts: DNa02/DNa01 steering, MN9 proboscis motor neuron, PAM/PPL1 dopamine, and its learned odor valence.
- Sweet fruit (berry bushes, fruit trees, honey, cactus) smells of "odor A"; both mushroom kinds smell of "odor B". Brown mushrooms taste sweet, red ones taste bitter. A fly that is rewarded on odor B learns to approach it; others do not. Individual experience makes individual flies.
- Brains run in Web Workers at 1 ms resolution. When they cannot keep up with real time, the whole fly world runs in slow motion (shown in the HUD) so every fly stays in step with its brain.

## God mode

- **Natural language (LLM):** type e.g. "put fruit trees in the northeast corner" or "start a storm". The server model may only emit allowlisted edits (`add_resource`, `remove_resource`, `add_obstacle`, `add_hazard`, `set_weather`, `spawn_agents`). The browser simulator validates and applies them, and each outcome appears in the event feed.
- **Direct buttons** (not LLM): weather, add berries, water, brown or toxic mushrooms, fruit tree, thorns near the selected creature.

## Architecture

- `src/shared` — types, Zod schemas, config (contracts).
- `src/sim` — authoritative store, 20 Hz fixed step, command queue, observation, spawning, path planning (`path.ts`), fly bodies (`fly.ts`).
- `src/world` — 3D scene; renders from the store and never mutates it. `Creature.tsx` and `FlyModel.tsx` are procedural models.
- `src/controllers` — `Controller` interface, scripted and LLM adapters, scheduler (one outstanding decision per agent, global limit 3, 25 s timeout, runId/seq stale rejection).
- `src/controllers/fly` — connectome brain (`brain.ts`), sensory/motor adapter (`body.ts`), world sensing (`sensing.ts`), Web Worker pool (`worker.ts`, `swarm.ts`), sim bridge (`driver.ts`).
- `src/ui` — side panel (mode, pause/reset/spawn, inspectors, God command) and event feed.
- `server` — Express `/api/health`, `/api/decide`, `/api/world-command`.
- `public/fly` — extracted circuit (`circuit.json`) and bias calibration.
- `tools/fly` — Python pipeline that builds the circuit from FlyWire data ([tools/fly/README.md](tools/fly/README.md)).

## Known limitations

- Perception is radius-only (no occlusion). Fly odor is Gaussian plumes with no wind or obstacle blocking.
- Haiku 4.5 decisions take roughly 3–10 s. Agents finish their current action meanwhile but can idle between plans.
- LLM output is non-deterministic; scripted mode is a development baseline, not an LLM.
- Fly brains are CPU-bound: about 0.25 CPU-seconds per simulated second for a fly near food, about 10× less for a fly smelling nothing. On a 6-core laptop, about 20 food-seeking flies run in real time; more flies slow the fly world down.
- Fly walking speed, exploratory turning noise, obstacle side-stepping and the hunger gain on sensory input are body-level rules, not neural. Hazards are not sensed by the fly circuit. See [docs/FLY.md](docs/FLY.md) for everything that is and is not the connectome.
