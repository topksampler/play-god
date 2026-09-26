import type { FlyBrainPool } from './brain';

export interface FlySensors {
  odorA: [number, number];
  odorB: [number, number];
  sugarContact: boolean;
  bitterContact: boolean;
  energy: number;
  ateThisTick: boolean;
}

export interface FlyMotor {
  turnRate: number;
  speed: number;
  feeding: boolean;
  readout: {
    dna02: [number, number];
    dna01: [number, number];
    mn9: number;
    pam: number;
    ppl1: number;
    steer: number;
    valence: number;
    brainDriven: number;
  };
}

export interface FlyTraits {
  handedness: number;
  explorationGain: number;
}

export interface BiasCalibration {
  A: { hz: number[]; bias: number[] };
  B: { hz: number[]; bias: number[] };
}

function interp(t: { hz: number[]; bias: number[] }, x: number): number {
  const { hz, bias } = t;
  if (x <= hz[0]) return bias[0];
  for (let i = 1; i < hz.length; i++) {
    if (x <= hz[i]) return bias[i - 1] + ((bias[i] - bias[i - 1]) * (x - hz[i - 1])) / (hz[i] - hz[i - 1]);
  }
  return bias[bias.length - 1];
}

export const FLY_CONFIG = {
  tickMs: 50,
  maxOrnHz: 150,
  odorHalfSat: 0.35,
  gustatoryHz: 150,
  rewardHz: 120,
  rewardMs: 400,
  rateTauMs: 150,
  baselineTauMs: 6000,
  turnGain: 0.3,
  maxTurn: 4,
  walkSpeed: 1.6,
  feedThresholdHz: 30,
  valenceGain: 40,
  exploreSigma: 1.2,
  exploreTauMs: 800,
  odorCalmHz: 30,
};

function randn(): number {
  return Math.sqrt(-2 * Math.log(Math.random() + 1e-12)) * Math.cos(2 * Math.PI * Math.random());
}

export class FlyBody {
  static calibration: BiasCalibration | null = null;
  readonly slot: number;
  readonly traits: FlyTraits;
  private rates = { a02L: 0, a02R: 0, a01L: 0, a01R: 0, mn9: 0, pam: 0, ppl1: 0 };
  private baseline = 0;
  private baselineReady = false;
  private explore = 0;
  private rewardLeftMs = 0;
  private meanHz = { A: 0, B: 0 };
  private pool: FlyBrainPool;

  constructor(pool: FlyBrainPool, seed: number, traits?: Partial<FlyTraits>) {
    this.pool = pool;
    const slot = pool.spawn(seed);
    if (slot < 0) throw new Error('fly brain pool is full');
    this.slot = slot;
    this.traits = { handedness: randn() * 0.15, explorationGain: 0.7 + Math.random() * 0.6, ...traits };
  }

  encode(s: FlySensors): void {
    const c = FLY_CONFIG;
    const hunger = Math.min(Math.max(1 - s.energy / 100, 0), 1);
    const ornGain = 0.6 + 0.8 * hunger;
    const orn = (x: number) => c.maxOrnHz * ornGain * (x / (x + c.odorHalfSat));
    const f = this.slot;
    const aL = orn(s.odorA[0]), aR = orn(s.odorA[1]), bL = orn(s.odorB[0]), bR = orn(s.odorB[1]);
    this.meanHz = { A: (aL + aR) / 2, B: (bL + bR) / 2 };
    this.pool.setInput(f, 'odorA_L', aL);
    this.pool.setInput(f, 'odorA_R', aR);
    this.pool.setInput(f, 'odorB_L', bL);
    this.pool.setInput(f, 'odorB_R', bR);
    const sugarHz = s.sugarContact ? c.gustatoryHz * (0.4 + 0.6 * hunger) : 0;
    this.pool.setInput(f, 'sugar_L', sugarHz);
    this.pool.setInput(f, 'sugar_R', sugarHz);
    const bitterHz = s.bitterContact ? c.gustatoryHz : 0;
    this.pool.setInput(f, 'bitter_L', bitterHz);
    this.pool.setInput(f, 'bitter_R', bitterHz);
    if (s.ateThisTick) this.rewardLeftMs = c.rewardMs;
    this.pool.setInputNeurons(f, this.pool.circuit.mb.PAM, this.rewardLeftMs > 0 ? c.rewardHz : 0);
    this.rewardLeftMs = Math.max(0, this.rewardLeftMs - c.tickMs);
  }

  decode(): FlyMotor {
    const c = FLY_CONFIG;
    const { pool, slot } = this;
    const o = pool.circuit.outputs;
    const hz = (ids: number[]) => (pool.groupSpikes(slot, ids) * 1000) / c.tickMs / Math.max(ids.length, 1);
    const a = 1 - Math.exp(-c.tickMs / c.rateTauMs);
    const r = this.rates;
    r.a02L += a * (hz(o.DNa02_L) - r.a02L);
    r.a02R += a * (hz(o.DNa02_R) - r.a02R);
    r.a01L += a * (hz(o.DNa01_L) - r.a01L);
    r.a01R += a * (hz(o.DNa01_R) - r.a01R);
    r.mn9 += a * (hz(o.MN9) - r.mn9);
    r.pam += a * (hz(pool.circuit.mb.PAM) - r.pam);
    r.ppl1 += a * (hz(pool.circuit.mb.PPL1) - r.ppl1);

    const cal = FlyBody.calibration;
    const intrinsic = cal ? interp(cal.A, this.meanHz.A) + interp(cal.B, this.meanHz.B) : 0;
    const asym = r.a02R - r.a02L + 0.5 * (r.a01R - r.a01L) - intrinsic;
    if (!this.baselineReady) {
      this.baseline = cal ? 0 : asym;
      this.baselineReady = true;
    }
    this.baseline += (1 - Math.exp(-c.tickMs / c.baselineTauMs)) * (asym - this.baseline);
    const steer = asym - this.baseline;
    const valence = pool.valence(slot);
    const gain = Math.min(Math.max(1 + c.valenceGain * valence, -1.5), 2);
    const brainTurn = c.turnGain * gain * steer;

    const ou = Math.exp(-c.tickMs / c.exploreTauMs);
    const odorPresence = Math.min((this.meanHz.A + this.meanHz.B) / c.odorCalmHz, 1);
    const sigma = c.exploreSigma * this.traits.explorationGain * (1 - 0.85 * odorPresence);
    this.explore = this.explore * ou + Math.sqrt(1 - ou * ou) * randn() * sigma;
    const turnRate = Math.min(Math.max(brainTurn + this.explore + this.traits.handedness, -c.maxTurn), c.maxTurn);
    const feeding = r.mn9 > c.feedThresholdHz;
    const brainDriven = Math.abs(brainTurn) / (Math.abs(brainTurn) + Math.abs(this.explore + this.traits.handedness) + 1e-9);
    return {
      turnRate,
      speed: feeding ? 0 : c.walkSpeed,
      feeding,
      readout: { dna02: [r.a02L, r.a02R], dna01: [r.a01L, r.a01R], mn9: r.mn9, pam: r.pam, ppl1: r.ppl1, steer, valence, brainDriven },
    };
  }

  remove(): void {
    this.pool.kill(this.slot);
  }
}
