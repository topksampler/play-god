import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FlyBrainPool, type Circuit } from './brain';
import { FlyBody, type BiasCalibration, type FlySensors } from './body';

const circuit: Circuit = JSON.parse(readFileSync('public/fly/circuit.json', 'utf8'));
const calibration: BiasCalibration = JSON.parse(readFileSync('public/fly/calibration.json', 'utf8'));
const o = circuit.outputs;

function run(pool: FlyBrainPool, ms: number) {
  pool.clearCounts();
  pool.run(ms);
}

const quiet: FlySensors = { odorA: [0, 0], odorB: [0, 0], sugarContact: false, bitterContact: false, energy: 30, ateThisTick: false };

describe('connectome circuit', () => {
  it('is the pruned FlyWire v783 subgraph with readouts and plastic KC→MBON synapses', () => {
    expect(circuit.n).toBe(circuit.rootIds.length);
    expect(circuit.pre.length).toBe(circuit.w.length);
    expect(circuit.plastic.length).toBeGreaterThan(1000);
    for (const k of ['DNa02_L', 'DNa02_R', 'DNa01_L', 'DNa01_R', 'MN9']) expect(o[k].length).toBeGreaterThan(0);
    for (const e of circuit.plastic.slice(0, 50)) {
      expect(circuit.cellClass[circuit.pre[e]]).toBe('Kenyon_Cell');
      expect(circuit.cellClass[circuit.post[e]]).toBe('MBON');
    }
  });

  it('is silent without input and drives MN9 (proboscis motor neuron) from sugar GRNs, as in Shiu et al.', () => {
    const pool = new FlyBrainPool(circuit, 2, 1.0);
    const a = pool.spawn(1);
    const b = pool.spawn(2);
    pool.setInput(b, 'sugar_L', 150);
    pool.setInput(b, 'sugar_R', 150);
    run(pool, 500);
    let silent = 0;
    for (let i = 0; i < circuit.n; i++) silent += pool.spikeCount[a * circuit.n + i];
    expect(silent).toBe(0);
    expect(pool.groupSpikes(b, o.MN9) * 2 / o.MN9.length).toBeGreaterThan(30);
  });

  it('bitter taste does not drive MN9', () => {
    const pool = new FlyBrainPool(circuit, 1, 1.0);
    const f = pool.spawn(3);
    pool.setInput(f, 'bitter_L', 150);
    pool.setInput(f, 'bitter_R', 150);
    run(pool, 500);
    expect(pool.groupSpikes(f, o.MN9)).toBeLessThan(3);
  });

  it('left vs right odor shifts DNa02 asymmetry in the ipsilateral direction', () => {
    let shift = 0;
    for (const seed of [11, 12, 13]) {
      const pool = new FlyBrainPool(circuit, 2, 1.0);
      const l = pool.spawn(seed);
      const r = pool.spawn(seed + 100);
      pool.setInput(l, 'odorA_L', 150);
      pool.setInput(l, 'odorA_R', 60);
      pool.setInput(r, 'odorA_L', 60);
      pool.setInput(r, 'odorA_R', 150);
      run(pool, 1000);
      const asym = (f: number) => pool.groupSpikes(f, o.DNa02_R) - pool.groupSpikes(f, o.DNa02_L);
      shift += asym(r) - asym(l);
    }
    expect(shift).toBeGreaterThan(0);
  });
});

describe('individual flies', () => {
  it('share wiring but not state: identical input with different noise seeds gives different spikes', () => {
    const pool = new FlyBrainPool(circuit, 2, 1.0);
    const a = pool.spawn(21);
    const b = pool.spawn(22);
    for (const f of [a, b]) pool.setInput(f, 'odorA_L', 80);
    run(pool, 300);
    const counts = (f: number) => Array.from(pool.spikeCount.subarray(f * circuit.n, (f + 1) * circuit.n));
    expect(counts(a)).not.toEqual(counts(b));
  });

  it('learns individually: reward paired with an odor changes only that fly’s KC→MBON weights and raises its valence', () => {
    const pool = new FlyBrainPool(circuit, 2, 1.0);
    FlyBody.calibration = calibration;
    const trained = new FlyBody(pool, 31);
    const naive = new FlyBody(pool, 32);
    const P = pool.plasticCount;
    for (let t = 0; t < 60; t++) {
      trained.encode({ ...quiet, odorB: [0.8, 0.8], sugarContact: true, ateThisTick: t % 10 === 0 });
      naive.encode({ ...quiet, odorB: [0.8, 0.8] });
      pool.clearCounts();
      pool.run(50);
      trained.decode();
      naive.decode();
    }
    const changed = (f: number) => {
      let n = 0;
      for (let k = 0; k < P; k++) if (Math.abs(pool.plasticW[f * P + k] - pool.plasticW0[k]) > 1e-6) n++;
      return n;
    };
    expect(changed(trained.slot)).toBeGreaterThan(100);
    const probe = (b: FlyBody) => {
      b.encode({ ...quiet, odorB: [0.8, 0.8] });
      return b;
    };
    probe(trained);
    probe(naive);
    pool.clearCounts();
    pool.run(200);
    expect(pool.valence(trained.slot)).toBeGreaterThan(pool.valence(naive.slot) + 0.01);
  });

  it('feeds (MN9 above threshold) while tasting sugar and walks otherwise', () => {
    const pool = new FlyBrainPool(circuit, 1, 1.0);
    const fly = new FlyBody(pool, 41);
    let feeding = false;
    for (let t = 0; t < 12; t++) {
      fly.encode({ ...quiet, sugarContact: true });
      pool.clearCounts();
      pool.run(50);
      feeding = fly.decode().feeding;
    }
    expect(feeding).toBe(true);
    for (let t = 0; t < 20; t++) {
      fly.encode(quiet);
      pool.clearCounts();
      pool.run(50);
      feeding = fly.decode().feeding;
    }
    expect(feeding).toBe(false);
  });

  it('escape: looming on LC4/LPLC2 fires its own Giant Fiber (DNp01) and commands takeoff; no looming, no takeoff', () => {
    for (const k of ['GF_L', 'GF_R']) expect(o[k]).toHaveLength(1);
    for (const k of ['lc4_L', 'lc4_R', 'lplc2_L', 'lplc2_R', 'aud_L', 'aud_R']) expect(circuit.inputs[k].length).toBeGreaterThan(30);
    const pool = new FlyBrainPool(circuit, 2, 1.0);
    const calm = new FlyBody(pool, 61);
    const threatened = new FlyBody(pool, 62);
    let calmEscapes = 0;
    let firstEscape = -1;
    for (let t = 0; t < 40; t++) {
      calm.encode({ ...quiet, odorA: [0.6, 0.6] });
      threatened.encode({ ...quiet, loomRate: t >= 20 ? [3, 3] : [0, 0], loomSize: t >= 20 ? [1, 1] : [0, 0] });
      pool.clearCounts();
      pool.run(50);
      if (calm.decode().escape) calmEscapes++;
      if (threatened.decode().escape && firstEscape < 0) firstEscape = t;
    }
    expect(calmEscapes).toBe(0);
    expect(firstEscape).toBeGreaterThanOrEqual(20);
    expect(firstEscape).toBeLessThan(24);
  });

  it('looming on one eye excites the Giant Fiber on that side more (ipsilateral)', () => {
    const pool = new FlyBrainPool(circuit, 1, 1.0);
    const f = pool.spawn(71);
    pool.setInput(f, 'lc4_L', 120);
    pool.setInput(f, 'lplc2_L', 120);
    run(pool, 300);
    expect(pool.groupSpikes(f, o.GF_L)).toBeGreaterThan(pool.groupSpikes(f, o.GF_R));
  });

  it('kills and respawns slots cleanly', () => {
    const pool = new FlyBrainPool(circuit, 1, 1.0);
    const f = pool.spawn(51);
    expect(pool.spawn(52)).toBe(-1);
    pool.kill(f);
    expect(pool.spawn(53)).toBe(f);
  });
});
