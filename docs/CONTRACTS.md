# Integration contracts

All types live in `src/shared/types.ts`, schemas in `src/shared/schemas.ts`. Change them in one place; do not redefine.

## Mutating the world
Only `store.dispatch(cmd: SimCommand)` (`src/sim/store.ts`). Commands apply at the next 20 Hz tick.

- **World control:** `pause`, `resume`, `reset {seed?, mode?}`. `mode` is `'agents' | 'flies'`; reset keeps the current mode unless one is given.
- **Population:** `spawnAgents {count, controller, tier?}`, `setController`, `setDefaultController`.
  - Plan controllers (`scripted`, `llm`) only exist in agents mode; `fly` only in flies mode.
  - A fly body cannot switch to a plan controller.
- **Edits:** `edit {edit: WorldEdit, source}`, where `WorldEdit` = `add_resource | remove_resource | add_obstacle | add_hazard | set_weather | spawn_agents`, validated by the simulator.
- **Decisions:** `decisionStarted` / `decisionResult` / `decisionError`, stamped with runId + seq.
  - A result is applied only if its request is still pending.
  - If the new plan starts with the action already running, that action continues instead of restarting.
- **Flies:** `flyMotors {runId, motors}` (from `controllers/fly/driver.ts` only), `flyCapacity {capacity}`, `flyBrainError`.
  - Motor values are clamped.
  - Commands from old runs are ignored.

The store also exposes `getTimeScale()`/`setTimeScale()`. The fly driver lowers the time scale when brains cannot keep up.

## Reading
- React: `useWorld()` re-renders per tick, `useWorldThrottled(ms)` at most every `ms`, and `useSim().getState()` inside `useFrame`.
- Events: `state.events` (`SimEvent`).
- Fly brain status: `flyDriverStatus()`.

## Controllers
- `Controller.decide({observation, memory, tier}, signal) → Promise<Decision>`. Register kinds in `src/controllers/index.ts`.
- `decisionDue(state, agent)` in `scheduler.ts` is the single rule for when an agent is asked for a plan; the headless benchmark uses the same rule.
- Flies are not plan controllers. Their low-level interface:
  - Senses: `FlySensors`, the odor at each antenna plus taste.
  - Output: `FlyMotor`, with turn rate, speed, feeding and spike readouts.
