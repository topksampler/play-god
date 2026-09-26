// Escape experiments on the browser runtime: looming (LC4/LPLC2) and sound (JO-A/B) → Giant Fiber → takeoff command.
// Usage: npx tsx scripts/fly/escape.ts
import { readFileSync } from 'node:fs';
import { FlyBrainPool, type Circuit } from '../../src/controllers/fly/brain';
import { FlyBody, FLY_CONFIG, type BiasCalibration, type FlySensors } from '../../src/controllers/fly/body';

const circuit: Circuit = JSON.parse(readFileSync(new URL('../../public/fly/circuit.json', import.meta.url), 'utf8'));
FlyBody.calibration = JSON.parse(readFileSync(new URL('../../public/fly/calibration.json', import.meta.url), 'utf8')) as BiasCalibration;
const FLIES = 8;
const base: FlySensors = { odorA: [0, 0], odorB: [0, 0], sugarContact: false, bitterContact: false, energy: 70, ateThisTick: false };

/** Runs `ticks` 50 ms brain ticks; returns per fly the first tick index that produced an escape (or -1). */
function trial(label: string, sensorsAt: (tick: number) => Partial<FlySensors>, ticks: number) {
  const pool = new FlyBrainPool(circuit, FLIES, 1.0);
  const bodies = Array.from({ length: FLIES }, (_, i) => new FlyBody(pool, 4000 + i));
  const first = new Array(FLIES).fill(-1);
  for (let t = 0; t < ticks; t++) {
    pool.clearCounts();
    for (const b of bodies) b.encode({ ...base, ...sensorsAt(t) });
    pool.run(FLY_CONFIG.tickMs);
    bodies.forEach((b, i) => {
      if (b.decode().escape && first[i] < 0) first[i] = t;
    });
  }
  const esc = first.filter((x) => x >= 0);
  const lat = esc.length ? (esc.reduce((s, x) => s + x, 0) / esc.length) * FLY_CONFIG.tickMs : NaN;
  console.log(`${label.padEnd(48)} escaped ${esc.length}/${FLIES}  mean latency ${Number.isNaN(lat) ? '—' : `${lat.toFixed(0)} ms`}`);
}

// Angular geometry as sensing.ts computes it for an object of half-size R at distance d closing at v.
const loom = (R: number, d: number, v: number) => ({ rate: (2 * R * v) / (d * d + R * R), size: 2 * Math.atan(R / d) });
const eye = (l: { rate: number; size: number }, side: 0 | 1 | 2): Partial<FlySensors> => ({
  loomRate: [side !== 1 ? l.rate : 0, side !== 0 ? l.rate : 0],
  loomSize: [side !== 1 ? l.size : 0, side !== 0 ? l.size : 0],
});

const THRESHOLDS = process.argv[2] ? process.argv[2].split(',').map(Number) : [FLY_CONFIG.gfEscapeSpikes];
for (const k of THRESHOLDS) {
console.log(`--- escape when GF spikes per 50 ms tick >= ${k}`);
(FLY_CONFIG as { gfEscapeSpikes: number }).gfEscapeSpikes = k;
trial('no input (false alarms over 10 s)', () => ({}), 200);
trial('odor A both antennae (10 s)', () => ({ odorA: [0.8, 0.8] }), 200);
// A creature walking (2.2 u/s) or sprinting (4.4 u/s) in from 4 units until it stops at swat reach (1.3).
for (const v of [2.2, 4.4]) {
  trial(`creature approaches at ${v} u/s to 1.3 u, then stands (left eye)`, (t) => {
    const d = 4 - v * t * 0.05;
    return d > 1.3 ? eye(loom(0.4, d, v), 0) : {};
  }, 30);
}
// Swat: hand (R 0.3) sweeps 1.3 units in 0.25 s. Report the escape tick: before tick 5 (250 ms) minus pipeline delay escapes.
const swat = (t: number) => {
  const p = Math.min(1, (t * 0.05) / 0.25);
  return p < 1 ? eye(loom(0.3, Math.max(0.05, 1.3 * (1 - p)), 1.3 / 0.25), 2) : {};
};
trial('swat, hand seen (both eyes), 0.25 s strike', swat, 8);
trial('swat from the rear blind spot', () => ({}), 8);
trial('speech 1 unit away (sound 0.7 both)', () => ({ sound: [0.7, 0.7] }), 20);
trial('speech 3 units away (sound 0.2 both)', () => ({ sound: [0.2, 0.2] }), 20);
trial('buzz of a fly 1 unit away (sound 0.15)', () => ({ sound: [0.15, 0.15] }), 20);
}
