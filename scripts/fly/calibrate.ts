import { readFileSync, writeFileSync } from 'node:fs';
import { FlyBrainPool, type Circuit } from '../../src/controllers/fly/brain';

const circuit: Circuit = JSON.parse(readFileSync(new URL('../../public/fly/circuit.json', import.meta.url), 'utf8'));
const o = circuit.outputs;
const levels = [0, 10, 20, 35, 50, 70, 90, 120, 160, 210];
const FLIES = 6;
const out: Record<string, { hz: number[]; bias: number[] }> = {};

for (const odor of ['A', 'B']) {
  const bias: number[] = [];
  for (const hz of levels) {
    const pool = new FlyBrainPool(circuit, FLIES, 1.0);
    for (let f = 0; f < FLIES; f++) {
      pool.spawn(900 + f);
      pool.setInput(f, `odor${odor}_L`, hz);
      pool.setInput(f, `odor${odor}_R`, hz);
    }
    pool.run(300);
    pool.clearCounts();
    pool.run(2000);
    let d = 0;
    for (let f = 0; f < FLIES; f++) {
      d += pool.groupSpikes(f, o.DNa02_R) - pool.groupSpikes(f, o.DNa02_L);
      d += 0.5 * (pool.groupSpikes(f, o.DNa01_R) - pool.groupSpikes(f, o.DNa01_L));
    }
    bias.push(d / FLIES / 2);
    console.log(`odor ${odor} ${hz}Hz symmetric: bias (R-L) ${bias.at(-1)!.toFixed(1)} Hz`);
  }
  out[odor] = { hz: levels, bias };
}
writeFileSync(new URL('../../public/fly/calibration.json', import.meta.url), JSON.stringify(out));
