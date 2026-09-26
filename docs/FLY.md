# Connectome fruit flies

Each fly in fruit-fly mode is driven by its own copy of a spiking circuit extracted from the adult *Drosophila* whole-brain connectome. This note records exactly what is biological, what was changed, how it was validated, and what is a body-level rule.

## Sources

- Connectivity: FlyWire FAFB v783 (Dorkenwald et al. 2024; Schlegel et al. 2024), as packaged with the whole-brain LIF model of Shiu et al. 2024 (`Connectivity_783.parquet`, 15,091,983 edges, 138,639 neurons; https://github.com/philshiu/Drosophila_brain_model, MIT).
- Annotations: `Supplemental_file1_neuron_annotations.tsv` (https://github.com/flyconnectome/flywire_annotations), used for cell types, sides and transmitters.
- Neuron model and constants: Shiu et al. leaky integrate-and-fire (v₀ = v_reset = −52 mV, v_th = −45 mV, τ_m = 20 ms, τ_syn = 5 ms, refractory 2.2 ms, delay 1.8 ms, 0.275 mV per synapse, Poisson input kick 68.75 mV).

## Pipeline (`tools/fly`)

1. `lif_full.py` — an event-driven numpy reimplementation of the Shiu model for the whole 139K-neuron brain. **Check:** stimulating the 64 left sugar GRNs drives MN9 (Shiu's feeding motor neuron, FlyWire type CB0701) to 147 and 99 Hz, reproducing their key result.
2. `signs.py` — **synapse-sign corrections (our change).**
   - With the machine-predicted transmitters used by Shiu et al., one DM1 olfactory receptor neuron (ORN) at 30 Hz ignited about 10,000 neurons, so odor information was lost.
   - The cause is antennal-lobe local neurons predicted as serotonin or dopamine, which the model treats as excitatory. They fired at about 250 Hz.
   - Rules applied, in priority order:
     1. Literature transmitters (`known_nt`) override predictions.
     2. Kenyon cells are cholinergic, and so are sensory neurons predicted monoaminergic.
     3. Antennal-lobe local neurons predicted monoaminergic are GABAergic.
     4. Other monoaminergic synapses get zero fast weight: dopamine acts only through the plasticity rule.
     5. Sensory→sensory axo-axonic edges are removed.
   - After the fix, odor activates about 2,700 neurons, with about 9% of Kenyon cells active (sparse coding). Sugar still drives MN9.
3. `extract.py` — **activity-pruned subgraph.**
   - Runs the corrected whole brain under 22 stimulus conditions: odor A or B left, right or both at 40 and 150 Hz; odor paired with sugar or bitter; sugar alone; bitter alone.
   - Keeps every neuron that spiked in any condition, plus all readout and mushroom-body neurons: 5,966 neurons and 432,082 synapses, including 13,704 plastic KC→MBON synapses.
   - Also exports DAN→MBON compartment weights, and each MBON's approach/avoid sign from its transmitter (acetylcholine approach, glutamate avoid, following Aso et al. 2014).
   - Neurons that stayed silent in every tested condition cannot influence those conditions, so the pruned circuit matches the whole brain for tested stimuli. Untested combinations are an approximation.
4. `scripts/fly/calibrate.ts` — measures the circuit's intrinsic left/right DNa02 bias under equal odor on both sides, per odor intensity (see below).

## Validation (automated in `src/controllers/fly/fly.test.ts`)

- The JS brain (`brain.ts`) against the Python whole-brain reference over the 22 conditions: 17% mean relative rate error at dt = 0.1 ms and 27% at dt = 1 ms (the runtime setting), from single 0.5 s trials.
- The same laterality, MN9 and silent-baseline behaviors are reproduced.
- Tests:
  - No input: silence.
  - Sugar: MN9 above 30 Hz.
  - Bitter: MN9 silent.
  - Stronger odor on the right: DNa02 R−L shifts right, and vice versa.
  - Different noise seeds: different spike trains.
  - Reward paired with odor B: that fly's KC→MBON weights change and its valence rises above a naive fly's.

## From spikes to behavior (`body.ts`)

- **Senses → neurons:**
  - Odor concentration at the left and right antennae sets Poisson rates of the left/right ORNs of odor A glomeruli (DM1, DM4, DP1m, VA2, DM2, VM2) or odor B glomeruli (DA3, DC1, DL1, VA6, VM3), up to 150 Hz.
  - Touching sweet food or water drives the sugar/water GRNs; touching toxic mushrooms or water drives the bitter GRNs.
  - After a fly ingests food, PAM dopamine neurons receive 120 Hz input for 400 ms. **This reward delivery is an adapter rule:** in this model the sugar pathway alone does not reach the PAMs.
- **Neurons → body:**
  - Turning follows (R−L) DNa02 + ½·(R−L) DNa01 (Yang et al. 2024: turning is linear in the bilateral DNa02 difference), minus the calibrated intrinsic bias. The bias exists because the reconstructed connectome is not left/right symmetric; for odor A it runs from +23 Hz at low intensity to −95 Hz at high intensity.
  - The turn gain is scaled by the fly's learned valence.
  - The proboscis extends, and the fly stops and feeds, while MN9 exceeds 30 Hz.
- **Learning:** eligibility-trace three-factor rule on each fly's own KC→MBON weights: Δw = −η · e_KC · DA_compartment · w + slow recovery toward baseline. Valence is the transmitter-signed change in KC→MBON drive for the currently active Kenyon cells.

### Body-level rules (not neural)

- Walking speed (1.8 units/s while not feeding).
- Correlated exploratory turning noise, damped while odor is present.
- Per-fly handedness bias.
- Collision side-step around obstacles.
- Hunger scaling of ORN and GRN input rates (modeled on starvation-enhanced sensitivity; not fitted).
- Hazards are not sensed.

## Measured behavior

- **Headless chemotaxis** (6 flies starting 5 units from food, 30 s): with brain steering, 2/6 reached food and the mean distance was 6.6. With the brain turn gain set to 0 (same noise), 0/6 reached food and the mean distance was 9.7. This is a small sample and a weak effect.
- **Headless learning** (4 flies per group, 20 s training, 25 s probe): odor B paired with sugar raised valence to +0.15 and the flies stayed near odor B (mean distance 4.8). The odor-only and odor+bitter groups stayed at 10.5–11.0.
- **Aversive learning is not demonstrated:** bitter-paired flies end up like odor-only flies. Bitter does suppress feeding (MN9).
- **Browser:** the first fly finds and feeds on a nearby berry bush using its MN9 output.

## Escape, vision and hearing (mixed world)

The circuit also includes the looming-detector visual projection neurons LC4 (104) and LPLC2 (210) of each optic lobe, the Johnston's organ auditory neurons JO-A/JO-B (341), and the two Giant Fiber descending neurons (DNp01). `tools/fly/extract.py` adds looming and sound conditions to the pruning, which grew the circuit to 8,025 neurons and 629,218 synapses (13,865 plastic KC→MBON). The odor calibration was re-run and is essentially unchanged.

Whole-brain probe (`tools/fly/probe_escape.py`, 500 ms, Python LIF):
- Looming on the left eye at 200 Hz: GF_L 256 Hz, GF_R 148 Hz (ipsilateral dominance). 30 Hz already gives about 60 Hz in the GF.
- Looming on one side excites DNa02/DNa01 on the opposite side, so flies turn away from an approaching object without any added rule.
- Auditory JO input (150 Hz, both sides) reaches the right GF (78 Hz) but not the left. Left-only JO input: no GF activity. This asymmetry is what the connectome gives.
- GF is silent under all odor and taste conditions.

Runtime (`scripts/fly/escape.ts`; 8 flies; takeoff when GF fires ≥ 3 spikes in a 50 ms tick):
- No input for 10 s: 0/8 takeoffs. Odor: 0/8.
- A creature walking in to 1.3 units: 2/8. Sprinting: 8/8.
- A seen swat: 8/8 escape. A swat from the rear blind spot: 0/8.
- Speech 1 unit away: 8/8. Speech 3 units away: 0/8.

Body-level rules (not neural) in this layer:
- Looming geometry: angular size 2·atan(R/d) and expansion rate for approaching agents and a swatting hand, per eye, with a rear blind spot of ±20°. Encoding into LC4 (rate) and LPLC2 (size × speed) Hz.
- Sound level from recent speech and nearby fly buzzing.
- The GF spike threshold, the escape direction (away from the looming source), and the flight itself (1.2–2.4 s at 6 units/s over obstacles).
- Nibbling carried/dropped food (it rots sooner), egg laying on sweet food by well-fed flies, and hatching into flies with naive brains.
- The buzz sounds shown in bubbles ("BZZZT!", "suiii~"). Wingbeat buzz is physical; the words are playful, and flies have no voice.

PPL1 activity seen in flies near fruit comes from odor, not from looming (looming alone: 0 Hz), so there is no fear learning from threats.

## Performance

- 8,025-neuron circuit: about 390 ms of CPU per simulated second for a fly smelling food, about 50 ms for a fly smelling nothing, and about 240 ms while looming (Node, one core; `scripts/fly/bench-cpu.ts`). The earlier 5,966-neuron circuit took about 290 ms and 45 ms on the same machine.
- Previous measurement (5,966-neuron circuit): about 240 ms of CPU per simulated second for a fly smelling food, and about 25 ms for a fly smelling nothing.
- Cost is dominated by antennal-lobe local neurons at their firing ceiling.
- Adding spike-frequency adaptation to them was tried. It lowered their rates but not the total cost, and it degraded laterality, so it was not kept.
- The driver runs flies on up to 8 Web Workers (5 per worker). It slows the fly world when brains lag, rather than letting flies act on stale motor commands.

## Regenerating

See `tools/fly/README.md`. The public circuit (`public/fly/circuit.json`, 10 MB) and calibration are committed, so regeneration is optional.
