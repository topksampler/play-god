# Demo script

Start: `npm run dev`, open http://localhost:5173. For real LLM agents, `.env` must hold `ANTHROPIC_API_KEY` (the panel says which mode is active).

## Part 1: LLM agents (2 min)

1. The camera opens on the central meadow; `a1` stands next to a berry bush. Click it to open the inspector: world truth, controller status, the exact observation it was shown, and its declared intent and memory, each labelled separately.
2. Watch it gather and eat. The feed logs every outcome.
3. Click **Spawn 3**. Each new agent has its own id, memory, inbox and pending request.
4. God mode (🌍 World tab): type "add fruit trees near a1" (LLM), or use the direct buttons (+berries, storm). The interpreted edits and their outcomes are shown.
5. Pause, Resume, Reset. Reset starts run-2 and discards in-flight decisions.

## Part 2: fruit flies (2 min)

1. Click **Fruit flies (connectome)**. The brain status line shows workers and capacity. `f1` starts near a berry bush.
2. Click `f1`: DNa02 left/right steering rates, MN9 and dopamine rates come from its own 5,966-neuron circuit. When it reaches the bush, MN9 rises above 30 Hz, the proboscis extends and "f1 fed on …" appears in the feed.
3. **Spawn 10 flies** twice. Every fly has its own spike noise and its own plastic synapses. If the HUD shows "sim speed < 1×", the brains are the bottleneck and the world slows to stay in step.
4. Add "+brown shrooms" near a fly. If it feeds there, it gets a PAM dopamine reward paired with odor B, and its "learned odor valence" rises while flies that never fed on mushrooms stay near 0.
5. Explain what is biological and what is body-level (docs/FLY.md): steering, feeding and learning come from spikes; walking speed and exploratory noise are rules.

## Checks performed before a demo

`npm run typecheck`, `npm test`, `npm run build`, plus a 60 s browser rehearsal via `node scripts/browser-smoke.mjs` in both modes.
