# Emergence experiments

What this build can actually test, how, and the caveats. Everything here uses the live simulator; nothing is scripted to *look* emergent.

## Question

Starting from no shared language, can agents that only share a world (not a vocabulary) come to use signals, gestures, marks or observed behaviour in consistent, useful ways? And does that depend on the communication channel, trait heterogeneity or scarcity?

## Conditions (Lab → Experiment conditions → Start new run)

| Condition | What agents can do | Notes |
|---|---|---|
| `english` | `say` words, `gesture`, `mark` short text, `build sign` | Upper bound: pre-shared human language. |
| `proto` | `signal` 1–4 sounds from a per-run inventory of nonsense tokens (e.g. `zade papu`), `gesture`, `mark` a sound-shape | `say` fails. The simulator rejects any token not in the inventory. Each agent sees the inventory in its **own shuffled order**, so list position is not a shared code. The prompt states that sounds have no predefined meaning. |
| `silent` | `gesture` and `mark` only | No sound channel; only bodies and world traces. |
| traits on/off | each agent gets one of keen eyes / strong / swift / hardy | Tests whether specialisation or dependence emerges. |
| food: abundant / normal / scarce | scales food patch counts (×1.5 / ×1 / ×0.5) and regrowth (×1.6 / ×1 / ×0.4) | Scarcity is a classic driver of cooperation or competition. |

Every agent also perceives other agents' **observable behaviour**: what they are doing ("gathering dark blue berries", "drinking"), what they hold (labels, not truths), and any gesture (with a compass direction when pointing). This allows imitation and social learning without any language.

## Life cycle and mate choice

- **Lifespan** (immortal / 5 / 10 / 20 min): agents age from child (first 45 s after birth) to adult to elder (last 20%, drains faster), then die of old age. So the population persists **only through births**.
- **Births require mutual choice.** Both agents must `court` each other within 25 s while close (≤2.5 units). Both must be adults with energy ≥50 and health ≥50, and neither can be on its 90 s post-birth cooldown. Each parent pays 25 energy. A one-sided courtship **expires** and is logged as unreturned. When both choose each other but one can't reproduce, it is logged as `failed` with the reason.
- **Partner cues:** others' life stage, how healthy they look (healthy/tired/weak/hurt), apparent traits ("lean and quick"), and whether they are courting *you*. Exact vitals are not visible.
- **Offspring** inherit one parent's trait (15% mutation) and, under `inheritance: beliefs`, their parents' beliefs (cultural transmission). Otherwise they start with empty memory. They use the controller tier of one parent.
- **Prompt framing** (documented because it shapes behaviour): agents are told they age and die, that their kind survives only if new creatures are born, how a birth works, and that courting, accepting or refusing anyone is their choice. No partner preferences are suggested.
- **Measured:** courtship attempts and outcomes, selectivity (share of resolved courtships not returned), who courted whom and who was chosen, births, generations, deaths by cause, and a family tree (Lab → Life). The scripted control has a fixed rule (accept any courtship when fed; court the nearest healthy-looking adult), which serves as a non-selective baseline.

## Baseline per agent

At spawn the simulator records each agent's endowment (`agent.baseline`): controller/model tier, communication condition, traits, capacity, sight/speed/poison multipliers and starting vitals. It is shown at the top of the agent's **Growth** tab and included in exports.

## What is measured (world truth)

- **Utterances** (`state.utterances`): every speech/signal/gesture/mark, with the speaker, the hearers it actually reached, the speaker's position and a **context vector** of the speaker's real situation: `food-near`, `water-near`, `harmful-near`, `hazard-near`, `material-near`, `hurt`, `hungry`, `thirsty`, `carrying-food`, `agent-close`, `night`, `storm`. Agents never see these tags.
- **Symbol × situation table**: per sound (proto) or content word (English), counts per context and the **lift** = P(situation | symbol used) ÷ P(situation at any time). The base rate comes from sampling every living agent's situation every 5 s (`state.contextBase`), not from utterances. This is the first test of whether a symbol has acquired a consistent "meaning". The **users** column shows how many agents used it. **agree** is the share of users (with ≥2 uses) whose most over-represented situation matches the modal one: high agree means a *shared* convention, low means private idiolects.
- **Listener response**: each hearer's next decision within 20 s: replied, approached the speaker or the speaker's location, other, or no decision.
- **Growth**: per-agent vitals, discoveries, beliefs, places, messages, meals and distance every 5 s; world food/harmful/materials/patches/alive/structures.
- **Timelines**: per-agent turns (trigger → plan → intent), actions and outcomes, said/heard, memory diffs (belief and place changes), milestones and damage.
- **Export**: Lab → Export run (JSON) for offline analysis.

## Calibration (scripted control)

In `proto` mode the scripted baseline uses a **hand-coded** convention: the alphabetically-first sound means "food here", and hearers who see no food follow the speaker. Because this convention is planted by construction, it tests whether the metrics can detect a real code.

Result (seed 1337, 8 scripted agents, ~150 sim-seconds, run 2026-09-26):

| symbol | n | users | agree | food-near (base 35%) | agent-close (base 21%) |
|---|---|---|---|---|---|
| `deta` | 24 | 7 | 83% | 24/24 (lift ≈2.9) | 18/24 (lift ≈3.6) |

The `agent-close` association is expected: the control only signals when a peer is within 7 units. An earlier version computed base rates over utterances and **missed** this planted code (lift = 1 when one symbol dominates). That was fixed by sampling situations over time. Listener responses: 21% approached, 21% replied.

## Protocol suggestion

1. Fix a seed. Run `english`, `proto` and `silent` with 5–8 agents for the same sim duration (use the speed control). Repeat each condition 3+ times with different seeds.
2. Compare: survival (alive over time, deaths), poisonings, meals, belief accuracy (compare `memory.beliefs` to the truth kinds), symbol-context lift, cross-agent symbol consistency, and listener approach rates.
3. Intervene to test causality: remove food near a signalling agent, or add a toxic patch (God buttons). Does signalling change? Does it change listeners' behaviour?

## Caveats (report these with any result)

- **Shared priors.** All agents run the same model with the same system prompt. Similar outputs can come from shared training priors (Schelling points), not from in-world convention. Check whether associations appear only *after* interaction (plot over time) and differ across seeds and lexicons.
- **Private reasoning is still language.** In `proto`/`silent`, agents' private notes and reasoning are in English. Only the **in-world channel** is language-free. That is the variable being controlled.
- **Declared intent is not motive.** Plans, intents and beliefs are what the model output, not verified internal states.
- **Small samples.** Haiku agents communicate rarely unless it is useful. Lift values with n < 3 are hidden from shading for that reason.
- **LLM nondeterminism.** A fixed seed makes the world repeatable, not the agents. Compare repeated trials.
- Perception is radius-only (no occlusion). Gestures are seen by anyone whose sense radius covers the gesturer.

## Next steps (not built yet)

- Scripted control condition with a fixed hand-coded signal protocol, to calibrate the metrics.
- Scarcity sweep (regrowth multiplier) and a communication on/off toggle mid-run.
- Cross-agent consistency score (agreement of each symbol's dominant context across users) and topographic similarity.
- Imitation metric: whether an agent acts on the same appearance within N seconds of seeing another agent do so.
- Fruit-fly controller via a sensorimotor adapter (see CLAUDE.md fly track). It would use gestures and movement, not the language actions.
