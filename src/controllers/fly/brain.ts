export interface Circuit {
  source: string;
  params: { v_0: number; v_rst: number; v_th: number; t_mbr: number; tau: number; t_rfc: number; t_dly: number; w_syn: number; f_poi: number };
  n: number;
  rootIds: string[];
  cellType: string[];
  cellClass: string[];
  side: string[];
  pre: number[];
  post: number[];
  w: number[];
  plastic: number[];
  inputs: Record<string, number[]>;
  outputs: Record<string, number[]>;
  mb: Record<string, number[]>;
  danToMbon?: { dan: number; mbon: number; count: number }[];
  mbonSign?: Record<string, number>;
  reference?: { cond: Record<string, number>; out: Record<string, number>; n_active: number }[];
}

export interface PlasticityConfig {
  eta: number;
  recovery: number;
  eligibilityTauMs: number;
  maxRatio: number;
}

const DEFAULT_PLASTICITY: PlasticityConfig = { eta: 0.02, recovery: 0.0005, eligibilityTauMs: 1500, maxRatio: 2 };

export class FlyBrainPool {
  readonly n: number;
  readonly capacity: number;
  readonly dtMs: number;
  readonly circuit: Circuit;
  readonly alive: Uint8Array;
  readonly spikeCount: Uint16Array;
  readonly plasticW: Float32Array;
  readonly plasticW0: Float32Array;
  step = 0;

  private rowPtr: Int32Array;
  private col: Int32Array;
  private wt: Float32Array;
  private pRowPtr: Int32Array;
  private pCol: Int32Array;
  private pSlot: Int32Array;
  private nk: number;
  private v: Float32Array;
  private g: Float32Array;
  private rfcUntil: Int32Array;
  private rate: Float32Array;
  private awake: Uint8Array;
  private noRfc: Uint8Array;
  private ring: Float32Array;
  private ringLen: number;
  private delaySteps: number;
  private rfcSteps: number;
  private aV: number;
  private aG: number;
  private kVG: number;
  private kick: number;
  private rng: Uint32Array;
  private inputGroups: Map<string, Int32Array> = new Map();
  private plasticPre: Int32Array;
  private plasticPost: Int32Array;
  private kcIndex: Int32Array;
  private eligibility: Float32Array;
  private mbonIndex: Int32Array;
  private mbonDopamine: { dans: Int32Array; weights: Float32Array }[];
  private plasticity: PlasticityConfig;

  constructor(circuit: Circuit, capacity: number, dtMs = 0.5, plasticity: Partial<PlasticityConfig> = {}) {
    const p = circuit.params;
    this.circuit = circuit;
    this.n = circuit.n;
    this.capacity = capacity;
    this.dtMs = dtMs;
    this.plasticity = { ...DEFAULT_PLASTICITY, ...plasticity };
    const n = this.n;
    const E = circuit.pre.length;

    const plasticOf = new Int32Array(E).fill(-1);
    circuit.plastic.forEach((e, k) => (plasticOf[e] = k));
    const order = Array.from({ length: E }, (_, i) => i).sort((a, b) => circuit.pre[a] - circuit.pre[b]);
    const stat = order.filter((e) => plasticOf[e] < 0);
    const plas = order.filter((e) => plasticOf[e] >= 0);
    this.rowPtr = new Int32Array(n + 1);
    this.col = Int32Array.from(stat, (e) => circuit.post[e]);
    this.wt = Float32Array.from(stat, (e) => circuit.w[e]);
    for (const e of stat) this.rowPtr[circuit.pre[e] + 1]++;
    this.pRowPtr = new Int32Array(n + 1);
    this.pCol = Int32Array.from(plas, (e) => circuit.post[e]);
    this.pSlot = Int32Array.from(plas, (e) => plasticOf[e]);
    for (const e of plas) this.pRowPtr[circuit.pre[e] + 1]++;
    for (let i = 0; i < n; i++) {
      this.rowPtr[i + 1] += this.rowPtr[i];
      this.pRowPtr[i + 1] += this.pRowPtr[i];
    }

    const P = circuit.plastic.length;
    this.plasticPre = new Int32Array(P);
    this.plasticPost = new Int32Array(P);
    const w0 = new Float32Array(P);
    circuit.plastic.forEach((e, k) => {
      this.plasticPre[k] = circuit.pre[e];
      this.plasticPost[k] = circuit.post[e];
      w0[k] = circuit.w[e];
    });
    this.plasticW0 = w0;
    this.plasticW = new Float32Array(capacity * P);

    const kcs = new Int32Array(n).fill(-1);
    let nk = 0;
    circuit.cellClass.forEach((c, i) => { if (c === 'Kenyon_Cell') kcs[i] = nk++; });
    this.kcIndex = kcs;
    this.nk = nk;
    this.eligibility = new Float32Array(capacity * nk);

    const mbons = new Int32Array(n).fill(-1);
    const mbonList = circuit.mb.MBON ?? [];
    mbonList.forEach((m, k) => (mbons[m] = k));
    this.mbonIndex = mbons;
    this.mbonDopamine = mbonList.map((m) => {
      const links = (circuit.danToMbon ?? []).filter((l) => l.mbon === m);
      const total = links.reduce((s, l) => s + l.count, 0) || 1;
      return { dans: Int32Array.from(links.map((l) => l.dan)), weights: Float32Array.from(links.map((l) => l.count / total)) };
    });

    this.v = new Float32Array(capacity * n);
    this.g = new Float32Array(capacity * n);
    this.rfcUntil = new Int32Array(capacity * n);
    this.rate = new Float32Array(capacity * n);
    this.awake = new Uint8Array(capacity * n);
    this.spikeCount = new Uint16Array(capacity * n);
    this.noRfc = new Uint8Array(n);
    for (const [name, ids] of Object.entries(circuit.inputs)) {
      this.inputGroups.set(name, Int32Array.from(ids));
      for (const i of ids) this.noRfc[i] = 1;
    }
    this.delaySteps = Math.max(1, Math.round(p.t_dly / dtMs));
    this.rfcSteps = Math.max(1, Math.round(p.t_rfc / dtMs));
    this.ringLen = this.delaySteps + 1;
    this.ring = new Float32Array(this.ringLen * capacity * n);
    this.aV = Math.exp(-dtMs / p.t_mbr);
    this.aG = Math.exp(-dtMs / p.tau);
    this.kVG = (p.tau * (Math.exp(-dtMs / p.t_mbr) - Math.exp(-dtMs / p.tau))) / (p.t_mbr - p.tau);
    this.kick = p.w_syn * p.f_poi;
    this.rng = new Uint32Array(capacity);
    this.alive = new Uint8Array(capacity);
  }

  get plasticCount(): number {
    return this.plasticW0.length;
  }

  spawn(seed: number): number {
    const f = this.alive.indexOf(0);
    if (f < 0) return -1;
    const n = this.n;
    this.alive[f] = 1;
    this.v.fill(this.circuit.params.v_0, f * n, (f + 1) * n);
    this.g.fill(0, f * n, (f + 1) * n);
    this.rfcUntil.fill(0, f * n, (f + 1) * n);
    this.rate.fill(0, f * n, (f + 1) * n);
    this.awake.fill(0, f * n, (f + 1) * n);
    for (let s = 0; s < this.ringLen; s++) this.ring.fill(0, (s * this.capacity + f) * n, (s * this.capacity + f + 1) * n);
    this.plasticW.set(this.plasticW0, f * this.plasticCount);
    const nk = this.nk;
    this.eligibility.fill(0, f * nk, (f + 1) * nk);
    this.rng[f] = (seed * 2654435761) >>> 0 || 1;
    return f;
  }

  kill(f: number): void {
    this.alive[f] = 0;
  }

  setInput(f: number, group: string, hz: number): void {
    const ids = this.inputGroups.get(group);
    if (!ids) throw new Error(`unknown input group ${group}`);
    const base = f * this.n;
    for (let k = 0; k < ids.length; k++) {
      this.rate[base + ids[k]] = hz;
      if (hz > 0) this.awake[base + ids[k]] = 1;
    }
  }

  setInputNeurons(f: number, ids: ArrayLike<number>, hz: number): void {
    const base = f * this.n;
    for (let k = 0; k < ids.length; k++) {
      this.rate[base + ids[k]] = hz;
      if (hz > 0) this.awake[base + ids[k]] = 1;
    }
  }

  clearCounts(): void {
    this.spikeCount.fill(0);
  }

  groupSpikes(f: number, ids: ArrayLike<number>): number {
    const base = f * this.n;
    let s = 0;
    for (let k = 0; k < ids.length; k++) s += this.spikeCount[base + ids[k]];
    return s;
  }

  run(ms: number): void {
    const steps = Math.round(ms / this.dtMs);
    for (let s = 0; s < steps; s++) this.tick();
    this.learn(ms);
  }

  private tick(): void {
    const { n, capacity, v, g, rfcUntil, rate, ring, awake, rowPtr, col, wt, pRowPtr, pCol, pSlot, plasticW, noRfc, spikeCount, kcIndex, eligibility, alive, rng } = this;
    const { v_0, v_rst, v_th } = this.circuit.params;
    const aV = this.aV, aG = this.aG, kVG = this.kVG, kick = this.kick, step = this.step, rfcSteps = this.rfcSteps;
    const pScale = this.dtMs * 1e-3 * 4294967296;
    const slotNow = step % this.ringLen;
    const slotOut = (step + this.delaySteps) % this.ringLen;
    const P = this.plasticCount;
    const nk = this.nk;
    for (let f = 0; f < capacity; f++) {
      if (!alive[f]) continue;
      const base = f * n;
      const rIn = (slotNow * capacity + f) * n;
      const rOut = (slotOut * capacity + f) * n;
      const pBase = f * P;
      const eBase = f * nk;
      let x = rng[f];
      for (let i = 0; i < n; i++) {
        const idx = base + i;
        const inc = ring[rIn + i];
        if (!awake[idx] && inc === 0) continue;
        const gi = g[idx] + inc;
        ring[rIn + i] = 0;
        if (rfcUntil[idx] > step) { g[idx] = gi; continue; }
        let vi = v_0 + (v[idx] - v_0) * aV + gi * kVG;
        const gn = gi * aG;
        g[idx] = gn;
        const r = rate[idx];
        awake[idx] = r > 0 || gn > 1e-4 || gn < -1e-4 || vi - v_0 > 1e-3 || vi - v_0 < -1e-3 ? 1 : 0;
        if (r > 0) {
          x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
          if ((x >>> 0) < r * pScale) vi += kick;
        }
        if (vi > v_th) {
          vi = v_rst;
          g[idx] = 0;
          if (!noRfc[i]) rfcUntil[idx] = step + rfcSteps;
          awake[idx] = 1;
          spikeCount[idx]++;
          const kc = kcIndex[i];
          if (kc >= 0) eligibility[eBase + kc] += 1;
          for (let e = rowPtr[i], end = rowPtr[i + 1]; e < end; e++) ring[rOut + col[e]] += wt[e];
          for (let e = pRowPtr[i], end = pRowPtr[i + 1]; e < end; e++) ring[rOut + pCol[e]] += plasticW[pBase + pSlot[e]];
        }
        v[idx] = vi;
      }
      rng[f] = x >>> 0;
    }
    this.step++;
  }

  private learn(ms: number): void {
    const P = this.plasticCount;
    if (!P) return;
    const nk = this.nk;
    const decay = Math.exp(-ms / this.plasticity.eligibilityTauMs);
    const { eta, recovery, maxRatio } = this.plasticity;
    const seconds = ms / 1000;
    for (let f = 0; f < this.capacity; f++) {
      if (!this.alive[f]) continue;
      const base = f * this.n;
      const da = this.mbonDopamine.map(({ dans, weights }) => {
        let s = 0;
        for (let k = 0; k < dans.length; k++) s += weights[k] * this.spikeCount[base + dans[k]];
        return s / seconds;
      });
      const eBase = f * nk;
      const pBase = f * P;
      for (let k = 0; k < P; k++) {
        const kc = this.kcIndex[this.plasticPre[k]];
        const m = this.mbonIndex[this.plasticPost[k]];
        const w0 = this.plasticW0[k];
        let w = this.plasticW[pBase + k];
        const e = kc >= 0 ? this.eligibility[eBase + kc] : 0;
        const d = m >= 0 ? da[m] : 0;
        w += (-eta * e * d * w + recovery * (w0 - w)) * seconds;
        this.plasticW[pBase + k] = Math.min(Math.max(w, 0), w0 * maxRatio);
      }
      for (let k = 0; k < nk; k++) this.eligibility[eBase + k] *= decay;
    }
  }

  valence(f: number, kcRates?: Float32Array): number {
    const sign = this.circuit.mbonSign ?? {};
    const P = this.plasticCount;
    const base = f * this.n;
    let num = 0, den = 0;
    for (let k = 0; k < P; k++) {
      const pre = this.plasticPre[k];
      const post = this.plasticPost[k];
      const s = sign[post] ?? 0;
      if (!s) continue;
      const act = kcRates ? kcRates[pre] : this.spikeCount[base + pre];
      if (!act) continue;
      const w0 = this.plasticW0[k];
      num += s * (this.plasticW[f * P + k] - w0) * act;
      den += w0 * act;
    }
    return den > 0 ? num / den : 0;
  }
}
