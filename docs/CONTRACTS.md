# Integration contracts

All types live in `src/shared/types.ts`, schemas in `src/shared/schemas.ts`. Request changes from Person A; do not redefine.

## Mutating the world
Only `store.dispatch(cmd: SimCommand)` (`src/sim/store.ts`). Commands apply at the next 20 Hz tick.
Useful commands: `pause`, `resume`, `reset`, `spawnAgents {count, controller}`, `setController`, `setDefaultController`, `edit {edit: WorldEdit, source}`.
`WorldEdit` = `add_food | remove_food | add_obstacle | spawn_agents` (validated by the sim).

## Reading
React: `useWorld()` (re-renders per tick) / `useSim().getState()` inside `useFrame`. Events: `state.events` (`SimEvent`).

## Ownership
| Owner | Files |
| --- | --- |
| A world/sim | `src/shared`, `src/sim`, `src/world`, `package.json`, entry points |
| B LLM/God | `src/controllers` (not fly), `server/`, God command panel |
| C population/UI | `src/ui` (except God panel), metrics, tests |

## Controller
`Controller.decide({observation, memory}, signal) → Promise<Decision>`. Register kinds in `src/controllers/index.ts`.
