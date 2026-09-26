# Let's Play God — hackathon engineering instructions

## Mission and priorities

Build an interactive 3D habitat containing autonomous agents. Humans observe the actual world and intervene in it. Initially agents use LLM controllers. Later we investigate fruit fly neural controllers, natural-language world editing, and emergent multi-agent behavior.

This is a three-person hackathon project with a first demo due 45 minutes after implementation starts. The clock is an engineering budget, not a promise. Adapt to the actual time remaining. Do not start with a lengthy planning exercise.

**P0: a visible 3D world, one working LLM agent, and spawning 3–5 independent agents.**
**P1: nearby messaging, selection/inspection, and a few natural-language world edits.**
**P2: fruit fly controller integration, deeper emergence analysis, replay, richer terrain.**

Ship the P0 vertical slice before expanding scope. Never describe a placeholder, scripted behavior, or proposed integration as a working neural or LLM system.

## Working style

- Inspect the repository and existing instructions first. Preserve existing working code and compatible stack choices. Do not scaffold over an existing app.
- If the repository is empty, use the defaults below. Make routine implementation decisions and begin writing code without waiting for approval of a plan.
- Ask only about a genuine blocker that cannot be handled by a reversible assumption. Missing API credentials must not block the scene, simulator or labelled scripted controller.
- Keep the app runnable after each meaningful change. Report completed behavior, actual verification, blockers and the next integration boundary.
- Respect teammate ownership. Do not overwrite concurrent edits, reset their work, or make broad refactors while integration is in progress.
- If working alone, implement all P0 modules sequentially. If working alongside other Claude Code sessions, implement only the assigned role and agreed shared scaffolding.
- Use tools and dependencies already available. Check current official documentation if an API is uncertain. Do not invent package versions, model IDs or SDK methods.
- Do not publish, deploy, push to a remote, or change account settings unless requested. Do not use bypass-permission flags.



## First demo and acceptance gates

The demo story: open the world, watch one agent find and consume food, spawn additional independent agents, select an agent and inspect its observations/actions. If P1 is ready, show an actual delivered message and a human environmental intervention.

### Gate A — by approximately minute 20

- A 3D bounded world is visible, with food patches and obstacles.
- One agent has an ID, position, energy, inventory, observations and controller state.
- An actual LLM decision can produce movement toward food; simulator actions transfer food to inventory and eating restores energy.
- Smooth movement continues between decision requests. Rendering never waits for an LLM response.
- Errors are visible and contained; no browser crash on API failure.
- A second agent can be constructed without resetting the first.



### Gate B — by minute 45

- Spawn 1 and Spawn 3 controls work, subject to a default maximum of 5 agents.
- Spawned agents have independent IDs, memory, inboxes, targets and pending requests.
- Several agents remain active for a 60-second rehearsal without state corruption.
- Food cannot be collected twice or become negative. Obstacle and boundary collision checks work.
- Pause, resume and reset are reliable. Reset invalidates old asynchronous decisions.
- Controller type, pending/error status and important outcomes are visible.
- README documents exact run commands, environment configuration and known limitations.
- The production build/typecheck passes; record exactly which checks actually ran.

Do not claim Gate A is complete if only scripted mode works. Deliver that mode as an explicitly labelled partial result while finishing the LLM path.

## Suggested implementation schedule


| Time      | Work                                                                                          |
| --------- | --------------------------------------------------------------------------------------------- |
| 0–5 min   | Inspect/scaffold; agree shared types, module ownership and launch command.                    |
| 5–20 min  | Person A: world/simulation. Person B: controller/API. Person C: spawning/UI. Integrate early. |
| 20 min    | Exercise Gate A. If broken, finish the vertical slice before branching.                       |
| 20–35 min | Stabilize P0. Begin bounded P1 additions and independent fruit fly feasibility work.          |
| 35–40 min | Merge, check multiple agents, failure handling and reset.                                     |
| 40–45 min | Freeze features, rehearse and fix only demo blockers.                                         |




## Stack defaults for an empty repository

- TypeScript throughout; React + Vite for the browser; Three.js through React Three Fiber and Drei for 3D.
- A small Node/Express server for Anthropic API calls, with the official `@anthropic-ai/sdk` and runtime schema validation, for example Zod.
- A single browser-side simulation store with explicit command dispatch and subscriptions. Use the existing store library if present; otherwise keep it simple.
- For this demo, one browser session owns one world. Shared multiplayer browser sessions, databases and authentication are out of scope.
- Browser calls same-origin `/api/decide` and `/api/world-command`; use a development proxy to the Node server. No WebSocket is necessary for this architecture.
- One documented development command starts client and server. Keep the repository's existing package manager and lockfile; otherwise use npm.
- No photorealistic asset download, rigid-body engine, pathfinding framework, agent framework, vector database, or microservice architecture for P0.



## Module boundaries and team ownership

Suggested layout; adapt names to an existing repository without breaking these boundaries:

```text
src/shared/             types, runtime schemas, default configuration
src/sim/                world store, stepping, observation, commands, events
src/world/              3D scene, agent/object meshes, camera, selection
src/controllers/        controller interface, scripted/LLM adapters, scheduler
src/ui/                 spawn controls, inspector, event feed, God command panel
server/                 LLM routes, provider integration, request validation
docs/                   demo checklist, experiment notes, integration contracts
```


| Owner                     | Before first checkpoint                                 | After checkpoint                                     | Owned modules                                             |
| ------------------------- | ------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------- |
| A: world / fruit fly      | World state, simulation, rendering, interactions        | Stabilize world; investigate fruit fly adapter       | `src/sim`, `src/world`, future `src/controllers/fly`      |
| B: LLM / God mode         | Controller interface, scheduler, LLM server integration | Natural-language command parsing and validated edits | `src/controllers` except fly, `server`, God command panel |
| C: population / emergence | Spawn wiring, inspector, event feed, integration checks | Messaging UI, population metrics, experiments        | Remaining `src/ui`, metrics, relevant tests               |


Person A is the default integration owner for app entry points, shared types, package configuration and lockfiles. Publish initial contracts immediately. Other owners request minimal shared changes; do not independently redefine contracts. Create typed stubs only for unavailable teammate boundaries and label them clearly. Everyone is responsible for getting Gate A working.

Use separate branches/worktrees when the team already has that workflow. Merge small slices; do not spend the deadline establishing elaborate Git automation. If sessions share a directory, enforce file ownership strictly.

## World and agent model

- Render in 3D; movement is on the X/Z ground plane in P0. Agents may be simple distinct low-poly creatures or capsules.
- Default habitat: 30×30 world units, 3 food patches, 4 box/cylinder obstacles and one initial agent. Place the first agent near visible, reachable food.
- Suggested configurable values: sense radius 8, communication radius 6, interaction distance 1.5, speed 2 units/second, energy 100, inventory capacity 3.
- Slow energy drain makes resource use visible without killing the demo immediately. Clamp energy to [0,100]. At zero, show an exhausted agent rather than silently deleting it.
- A food unit is either in a patch or one agent's inventory until eaten. Eating consumes one carried unit and restores a configurable amount of energy.
- Use bounded spawn sampling to avoid obstacle/agent overlap. If no valid spot is found, reject visibly rather than looping indefinitely.
- A single authoritative world state holds agents, food, obstacles, simulation time, run ID and event sequence.
- An agent has its own controller kind, memory, inbox, movement target, status and pending decision metadata. Model weights/provider access may be shared; mutable agent state must not be.
- World truth, observations and agent-reported intent are separate. The inspector labels them separately.



## Contracts: define once and share

The following is the intended shape, not a requirement to copy it blindly into an incompatible existing codebase:

```ts
type Vec2 = { x: number; z: number };
type ControllerKind = 'scripted' | 'llm' | 'fly';
type Action =
  | { type: 'move'; target: Vec2 }
  | { type: 'take'; foodId: string }
  | { type: 'eat' }
  | { type: 'give'; recipientId: string }
  | { type: 'say'; text: string }
  | { type: 'wait' };
type Decision = { action: Action; memory?: string; intent?: string };
type Observation = {
  runId: string; observedAt: number;
  self: { id: string; position: Vec2; energy: number; inventory: number };
  bounds: { min: Vec2; max: Vec2 };
  visibleFood: { id: string; position: Vec2; units: number }[];
  visibleAgents: { id: string; position: Vec2 }[];
  visibleObstacles: { id: string; position: Vec2; radius: number }[];
  messages: { id: string; senderId: string; text: string; sentAt: number }[];
  recentOutcomes: { actionType: Action['type']; ok: boolean; detail: string }[];
};
interface Controller {
  kind: ControllerKind;
  decide(input: { observation: Observation; memory: string },
    signal: AbortSignal): Promise<Decision>;
}
```

Define runtime schemas alongside these types. `intent` is an optional short declared goal, not a request for hidden chain-of-thought or a verified explanation. Memory is bounded and private to that agent. Do not return full world state to controllers by convenience.

Movement targets may be any valid point within known arena bounds, allowing exploration. Interactions with IDs must satisfy simulator rules; guessed or inaccessible IDs do not grant access. P0 perception can be radius-only: state that limitation explicitly. Add occlusion later if time permits.

## Simulation and asynchronous control

- Advance simulation using a fixed timestep, for example 20 Hz; interpolate/render independently. Cap accumulated catch-up time after a tab stall.
- Start with approximately one decision per agent every 3 seconds, at most one outstanding per agent, with a global concurrency limit of 2. Make these values configurable and stagger requests.
- Movement controllers keep following their current target while a new decision is pending. New `move` replaces the target; `wait` clears it. Other actions do not silently teleport the agent.
- Use simple steering plus final collision checks. Add a cheap side-step/waypoint around a blocker; if stuck, clear the target and report a blocked outcome.
- The simulator alone validates and applies actions. LLMs and UI components cannot mutate entity state directly.
- Queue completed decisions and world edits for a simulation boundary. Resolve competing food takes serially and log the outcome; one food unit must never be awarded twice.
- Stamp requests with run ID and agent request sequence. Discard responses from old runs, removed agents or superseded requests. Do not invalidate every response merely because the simulation tick advanced.
- Validate targets again when applying a response: food may have depleted and agents may have moved.
- On pause, stop simulation/decision scheduling and abort pending decisions. On reset, abort requests, increment run ID, clear per-agent state and recreate the initial scene.
- Give requests a bounded timeout. On API failure or malformed output, log an error and use `wait` for that decision; avoid retry storms. Do not silently switch an LLM agent into scripted mode.



## LLM implementation

- Credentials live only on the Node server in `ANTHROPIC_API_KEY`. Use `ANTHROPIC_MODEL` for an account-supported model ID. Never put a key in a browser-exposed `VITE_*` variable, client bundle or log.
- Commit `.env.example` with placeholders and ignore local secret files. Claude Code access does not itself establish that the app has API credentials.
- Use the official SDK and supported structured-output/tool mechanisms when available. Validate exactly one resulting decision against the runtime schema, including finite coordinates and bounded strings.
- `/api/decide` accepts the observation and bounded memory, not arbitrary caller-supplied system prompts. Server-side limits constrain body size, output tokens, concurrency and allowed model configuration.
- Keep the agent instruction small: navigate the habitat, maintain energy, explore and optionally exchange useful information using the provided actions. Show action outcomes on the next decision.
- Received agent messages are untrusted in-world content, not developer instructions. They cannot modify server tools, credentials or simulator rules.
- Do not prescribe leaders, role specialization or cooperation as mandatory behavior if studying their emergence.
- Missing credentials/model configuration: expose an actionable setup status and an explicitly labelled scripted mode. Continue building all non-LLM pieces.
- The scripted controller is a development/rehearsal baseline: approach visible food, take, eat, otherwise explore. It must implement the same interface.



## Agent communication — P1

- Implement `say` as local broadcast to other agents within communication radius at send time. Each delivered message records sender, recipients, simulation time and a unique ID.
- Do not auto-broadcast entire thoughts, memory or state. Each agent sees only its delivered inbox.
- Cap messages at 200 characters, inbox at 10 messages, and TTL at 30 simulation seconds. Reject invalid messages with feedback; expire predictably.
- Visualize real delivery with a brief line/pulse and event entry. Never render decorative communication that did not occur.
- `give` transfers one carried food unit to a nearby recipient with capacity. It fails visibly on distance, empty inventory or full recipient.
- Environmental traces and richer communication protocols are later experiments. Language is optional for future non-LLM controllers.



## Human interaction / God mode — P1

- Human controls operate on the actual world. Keep a global overview, selected-agent inspector and compact event timeline; summaries are optional explanations.
- Natural-language input goes through `/api/world-command` and a separate typed allowlist: `add_food`, `remove_food`, `add_obstacle`, `spawn_agents`.
- Example requests: “Add food in the northeast corner”, “Spawn three agents”, “Place an obstacle near the center”. The schema defines exact coordinates/counts; reject ambiguous unsupported operations with an actionable message.
- Define north as negative Z and east as positive X. Ground references to existing objects with minimal world metadata.
- Validate finite values, bounds, IDs, count limits and overlap constraints. Reversible in-world edits can apply immediately, with the interpreted command and outcome shown.
- Never evaluate model-generated JavaScript, execute shell commands, or let natural-language input bypass simulator validation.
- Human edits enter the same command queue and event log. Agents learn about changes through subsequent permitted observations; human omniscience does not become agent omniscience.
- If time is short, ship direct Add Food / Add Obstacle buttons first. Clearly label buttons and any rule-based parser; do not call them LLM God mode.



## Fruit fly track — after the base loop works

- The recent MaleCNS connectome is structural data, not automatically a runnable pretrained agent. Flybody is a separate body/control project. Verify the exact chosen asset and its license, runtime and capabilities.
- Time-box initial feasibility to 10 minutes: locate an executable model/checkpoint, confirm inference requirements, identify observations/actions, and run the smallest isolated smoke test if feasible.
- Record real download size, dependencies, supported behavior and successful execution evidence. If blocked, document the missing piece and return to the shared demo.
- Design a sensory/motor adapter; never route natural-language prompts directly into a biological network or claim an LLM imitation is a fruit fly controller.
- Controllers may have different action capabilities and update rates. A future neural controller can use a lower-level motor interface while optional language/resource actions remain unsupported.
- Do not require the future model to output the LLM action schema natively. Share the world boundary through adapters, not a false promise of plug-and-play compatibility.
- Do not train a network, download a full connectome or install a large physics stack on the P0 critical path.



## Emergence track — after independent agents work

- First expose measured counts: food eaten, energy, distance traveled, delivered messages and close encounters. Avoid invented cooperation/intelligence scores.
- Add communication on/off and food scarcity controls as experimental conditions later. Keep environment seeds and controller settings with each run.
- A repeatable simulation seed does not make LLM output deterministic. Compare repeated trials rather than attributing causality to one run.
- Agent declarations are evidence of what the model said, not proof of its internal motive. Event links establish sequence and access to information; causal claims need interventions.
- Do not script clustering or leadership and present it as emergent. Report the policy, reward/instructions, rules and intervention used.



## Visual experience

- Make the world dominate the screen. Use a small side panel for spawn/pause/reset, selected-agent state and current controller status.
- Use distinct agent colors plus readable IDs, visible food quantities, restrained movement trails and selectable meshes.
- Ensure a useful initial camera view, orbit/zoom controls and legible status text. Prefer simple geometry with polished lighting to expensive assets.
- Clearly distinguish actual actions/outcomes from optional agent-declared intent. Do not show fabricated neural activity, message lines or biological fidelity.



## Minimal verification and handoff

- Test the high-risk pure logic: duplicate resource collection, invalid target/range, inventory transfer, message delivery radius/TTL, agent-state isolation and stale response rejection after reset.
- Exercise pause/reset with an in-flight mocked response. Confirm an API timeout cannot freeze rendering or crash the world.
- Run available typecheck/build checks and one 60-second browser smoke test with 5 agents. Inspect browser/server errors. Do not claim unexecuted checks passed.
- A scripted-only smoke test does not validate real LLM integration. Separately verify at least one actual provider response when credentials exist.
- End each handoff with changed modules, how to run, exact checks performed, known gaps and teammate-facing interface changes.
- Document reproducible demo steps in `docs/DEMO.md`; do not spend time building full event replay or recording infrastructure for P0.



## Official reference starting points

- Claude Code project memory: [https://code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory)
- Anthropic TypeScript SDK: [https://github.com/anthropics/anthropic-sdk-typescript](https://github.com/anthropics/anthropic-sdk-typescript)
- SDK documentation: [https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript)
- Future fruit fly assets: [https://male-cns.janelia.org/](https://male-cns.janelia.org/) and [https://github.com/TuragaLab/flybody](https://github.com/TuragaLab/flybody)

These are verification entry points, not required dependencies. Start building the agreed vertical slice now.

---



# Bootstrap prompts — operator reference

The following prompts are for the human teammates to paste into their respective Claude Code sessions. They are examples, not additional simultaneous assignments.

Put `CLAUDE.md` in the project root. Launch Claude Code from that directory, then paste the initial prompt below. This file provides prompts; it does not contain an implemented app.

## Initial prompt — integration session

```text
Read CLAUDE.md and inspect this repository. We are three people at a hackathon and have approximately 45 minutes for our first demo. Begin implementing now; do not stop at a plan or ask me to approve routine choices.

The non-negotiable demo is a real 3D environment with food and obstacles, one working LLM-controlled agent, and controls to spawn 3–5 independent agents. The first checkpoint is one agent perceiving food, moving to it, taking it and eating it. Build that complete loop before expanding scope.

First, preserve any existing stack and work. If this is an empty repo, use the defaults in CLAUDE.md. Create the smallest runnable scaffold, shared types/runtime schemas and module boundaries so three teammates can work independently. Use the same contracts for observations, actions, controllers, world edits and events. Avoid unnecessary dependencies.

You are the integration owner and Person A: world/simulation/rendering. Own the shared contracts, app entry points and package/lockfile changes. Provide typed integration stubs for Person B's controller/API modules and Person C's UI modules, then keep your implementation inside your ownership boundaries. Do not launch additional coding agents or assume the other teammates are already running.

Immediately provide the two short teammate handoffs: exact file ownership, exports they must implement and how to run the scaffold. Then continue implementing your world; do not wait for their work to start. If I tell you I am working alone, take responsibility for all modules sequentially instead.

Implement a simple low-poly habitat, collision-aware ground movement, food/inventory/energy rules, bounded spawning and one authoritative simulation store. Use a clearly labelled scripted controller to keep integration runnable until Person B supplies the real LLM path. Keep all LLM calls off the rendering loop and keys on the server. Show missing credentials explicitly; never fake LLM operation.

Target the one-agent checkpoint at minute 20 and the 3–5-agent demo at minute 45, adjusting for actual elapsed time. Once the base works, integrate nearby messaging and the natural-language world editor if ready. Fruit fly work is initially a time-boxed compatibility investigation, not a prerequisite for the demo.

Keep the app runnable. Run meaningful simulation checks, typecheck/build and a browser smoke test if the environment permits. Finish with exact launch instructions, verified behavior, remaining blockers and a short demo sequence. Start by inspecting the repo, then create the scaffold and implement the first working slice.
```



## Person B prompt — LLM agent, then God mode

Use this after the integration owner publishes the scaffold and contracts. Work in your own branch/worktree, or enforce the assigned file boundaries in a shared directory.

```text
Read CLAUDE.md and the existing shared contracts. I am Person B: LLM controller and later natural-language God mode. Other teammates own the world and population UI. Implement only src/controllers (excluding fly), server, and the agreed God command panel. Request shared type/entry-point/package changes from the integration owner rather than rewriting them.

First implement Controller.decide, a labelled scripted baseline, and the real server-side Anthropic path. Use ANTHROPIC_API_KEY and ANTHROPIC_MODEL only on the server. Return one runtime-validated action plus bounded optional memory/declared intent. Each agent must have independent state. Keep one outstanding decision per agent, bounded global concurrency, timeouts and stale-response rejection using run IDs/request sequences. API failures must produce visible status and a safe wait action without freezing simulation or silently changing controller type.

Use local observations, delivered messages and action feedback; do not give every agent global world state. Confirm a real LLM response when credentials are available. If missing, finish the server/configuration and report the precise setup requirement while leaving scripted mode usable.

After one real agent works, add a natural-language world-command route for add_food, remove_food, add_obstacle and spawn_agents. Parse into the shared allowlisted schema; simulator validation owns execution. Show interpreted commands and outcomes. No arbitrary code execution or browser secrets.

Time-box work to the demo deadline. Report exact exports/integration requirements, checks run and blockers. Start with the working one-agent LLM path, not advanced orchestration.
```



## Person C prompt — population and emergence

```text
Read CLAUDE.md and the shared contracts. I am Person C: population UI and multi-agent observability, later emergence experiments. Other teammates own the simulator/rendering and LLM/server. Implement the assigned UI/metrics/test modules; do not redefine shared types or mutate world state outside the shared command API.

First wire Spawn 1, Spawn 3, Pause, Resume and Reset to simulator commands, with a default maximum of 5 agents and clear failure/status feedback. Build a compact selected-agent inspector and event panel. Ensure each agent has its own ID, memory, inbox, movement target and pending-request status. Keep spawning from resetting existing agents.

Integrate early with the scripted baseline, then verify the real LLM path when available. Show controller labels and API errors accurately. Verify resource contention, independent state, repeated spawn and reset during an outstanding request. Do not block on decorative UI.

After the base demo works, expose actual local say-message delivery in the UI, with sender/recipient/time and brief visual feedback through the renderer's agreed API. Track simple measured behavior: food eaten, energy, delivered messages and close encounters. Do not invent intelligence/cooperation scores or script behavior and label it emergent.

Write a short demo checklist and record exact verification performed. Communication toggles, repeated-trial comparisons and deeper analytics come after the stable 3–5-agent demo. Start by wiring the shared spawn API and inspector.
```



## Launch and handoff checklist

1. Share one scaffold/contracts commit before diverging. One person owns package and lockfile changes.
2. Let the implementer document the actual install/run commands; this packet does not assume the app already exists.
3. Supply the runtime API key and a supported model through the server environment, never through a public client variable or chat transcript.
4. Confirm the real one-agent loop before claiming the first checkpoint. Label scripted fallback honestly.
5. Stop feature work with five minutes remaining. Rehearse the exact demo and record a backup manually if practical.

After the demo, Person A continues fruit fly feasibility/integration; Person B continues human interventions; Person C continues multi-agent experiments. All use the same world, observations/actions and recorded outcomes.