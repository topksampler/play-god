// CPU cost per simulated fly-second on this machine (one thread), for the current circuit.
import { readFileSync } from 'node:fs';
import { FlyBrainPool, type Circuit } from '../../src/controllers/fly/brain';
import { FlyBody, type FlySensors } from '../../src/controllers/fly/body';

const file = process.argv[2] ?? 'public/fly/circuit.json';
const circuit: Circuit = JSON.parse(readFileSync(file, 'utf8'));
const base: FlySensors = { odorA: [0, 0], odorB: [0, 0], sugarContact: false, bitterContact: false, energy: 60, ateThisTick: false };
for (const [label, s] of [['idle', base], ['near fruit odor', { ...base, odorA: [0.8, 0.6] as [number, number] }], ['feeding', { ...base, odorA: [1, 1] as [number, number], sugarContact: true }], ['looming', { ...base, loomRate: [2, 2] as [number, number], loomSize: [0.8, 0.8] as [number, number] }]] as const) {
  const pool = new FlyBrainPool(circuit, 5, 1.0);
  const flies = Array.from({ length: 5 }, (_, i) => new FlyBody(pool, 100 + i));
  const ticks = 40;
  const t0 = performance.now();
  for (let t = 0; t < ticks; t++) {
    pool.clearCounts();
    for (const f of flies) f.encode(s);
    pool.run(50);
    for (const f of flies) f.decode();
  }
  const ms = performance.now() - t0;
  console.log(`${file.split('/').pop()} n=${circuit.n} ${label.padEnd(16)} ${(ms / 5 / (ticks * 0.05)).toFixed(0)} ms CPU per fly-second`);
}
