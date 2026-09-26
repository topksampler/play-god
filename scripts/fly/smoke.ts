import { readFileSync } from 'node:fs';
import { FlyBrainPool, type Circuit } from '../../src/controllers/fly/brain';

const circuit: Circuit = JSON.parse(readFileSync(new URL('../../public/fly/circuit.json', import.meta.url), 'utf8'));
console.log(`circuit: ${circuit.n} neurons, ${circuit.pre.length} synapses, ${circuit.plastic.length} plastic`);

function runCond(dt: number, cond: Record<string, number>, seed: number) {
  const pool = new FlyBrainPool(circuit, 1, dt);
  const f = pool.spawn(seed);
  for (const [k, hz] of Object.entries(cond)) pool.setInput(f, k, hz);
  pool.clearCounts();
  const steps = Math.round(500 / dt);
  for (let s = 0; s < steps; s++) (pool as any).tick();
  const out: Record<string, number> = {};
  for (const [k, ids] of Object.entries(circuit.outputs)) out[k] = pool.groupSpikes(f, ids) * 2;
  return out;
}

const keys = ['DNa02_L', 'DNa02_R', 'DNa01_L', 'DNa01_R', 'MN9'];
for (const dt of [0.1, 0.5, 1.0]) {
  let err = 0, tot = 0;
  const t0 = performance.now();
  for (const ref of circuit.reference!) {
    const out = runCond(dt, ref.cond, 7);
    for (const k of keys) { err += Math.abs(out[k] - ref.out[k]); tot += ref.out[k]; }
    if (dt === 0.5) console.log(JSON.stringify(ref.cond).padEnd(44), keys.map((k) => `${k}=${out[k]}/${ref.out[k]}`).join(' '));
  }
  console.log(`dt=${dt}ms: mean abs rate error ${(err / (circuit.reference!.length * keys.length)).toFixed(1)} Hz, relative ${(err / tot * 100).toFixed(0)}%  (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
}

for (const N of [1, 10, 50]) {
  for (const dt of [0.5, 1.0]) {
    const pool = new FlyBrainPool(circuit, N, dt);
    for (let i = 0; i < N; i++) {
      const f = pool.spawn(i + 1);
      pool.setInput(f, i % 2 ? 'odorA_L' : 'odorA_R', 80);
    }
    const t0 = performance.now();
    for (let k = 0; k < 20; k++) pool.run(50);
    const wall = (performance.now() - t0) / 1000;
    console.log(`N=${N} dt=${dt}: 1.0s bio in ${wall.toFixed(2)}s wall -> realtime factor ${(1 / wall).toFixed(2)}x, per-fly ${(wall / N * 1000).toFixed(1)}ms per bio second`);
  }
}
