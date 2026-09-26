import type { Circuit } from './brain';
import type { BiasCalibration, FlyMotor, FlySensors } from './body';
import type { WorkerIn, WorkerOut } from './worker';

export interface SwarmStatus {
  workers: number;
  neurons: number;
  flies: number;
  capacity: number;
  realtimeFactor: number;
  droppedTicks: number;
  lastError: string | null;
}

interface Shard {
  worker: Worker;
  flies: Set<string>;
  busy: boolean;
  wallMs: number;
}

export class FlySwarm {
  private shards: Shard[] = [];
  private shardOf = new Map<string, Shard>();
  private motors = new Map<string, FlyMotor>();
  private runId = 1;
  private tick = 0;
  private dropped = 0;
  private lastError: string | null = null;
  private perWorker: number;
  private neurons = 0;

  private constructor(perWorker: number) {
    this.perWorker = perWorker;
  }

  static async create(opts: { workers?: number; perWorker?: number } = {}): Promise<FlySwarm> {
    const workers = opts.workers ?? Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 2));
    const swarm = new FlySwarm(opts.perWorker ?? 5);
    const [circuit, calibration] = await Promise.all([
      fetch('/fly/circuit.json').then((r) => {
        if (!r.ok) throw new Error(`circuit download failed: HTTP ${r.status}`);
        return r.json() as Promise<Circuit>;
      }),
      fetch('/fly/calibration.json').then((r) => (r.ok ? (r.json() as Promise<BiasCalibration>) : null)).catch(() => null),
    ]);
    swarm.neurons = circuit.n;
    await Promise.all(Array.from({ length: workers }, () => swarm.addShard(circuit, calibration)));
    return swarm;
  }

  private addShard(circuit: Circuit, calibration: BiasCalibration | null): Promise<void> {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const shard: Shard = { worker, flies: new Set(), busy: false, wallMs: 0 };
    this.shards.push(shard);
    return new Promise((resolve, reject) => {
      worker.onmessage = (ev: MessageEvent<WorkerOut>) => {
        const msg = ev.data;
        if (msg.type === 'ready') resolve();
        else if (msg.type === 'motors') {
          shard.busy = false;
          shard.wallMs = msg.wallMs;
          if (msg.runId !== this.runId) return;
          for (const { id, m } of msg.motors) {
            if (!shard.flies.has(id)) continue;
            // An escape command must not be lost if a newer motor arrives before the simulator reads it.
            const prev = this.motors.get(id);
            this.motors.set(id, prev?.escape && !m.escape ? { ...m, escape: true } : m);
          }
        } else if (msg.type === 'error') {
          shard.busy = false;
          this.lastError = msg.error;
        } else if (msg.type === 'spawned' && !msg.ok) {
          this.lastError = msg.error ?? 'spawn failed';
          shard.flies.delete(msg.id);
          this.shardOf.delete(msg.id);
        }
      };
      worker.onerror = (e) => {
        this.lastError = e.message;
        reject(e);
      };
      worker.postMessage({ type: 'init', circuit, calibration, capacity: this.perWorker } satisfies WorkerIn);
    });
  }

  spawn(id: string, seed: number): boolean {
    const shard = this.shards.reduce<Shard | null>((best, s) => (s.flies.size < this.perWorker && (!best || s.flies.size < best.flies.size) ? s : best), null);
    if (!shard) {
      this.lastError = `fly capacity ${this.shards.length * this.perWorker} reached`;
      return false;
    }
    shard.flies.add(id);
    this.shardOf.set(id, shard);
    shard.worker.postMessage({ type: 'spawn', id, seed } satisfies WorkerIn);
    return true;
  }

  remove(id: string): void {
    const shard = this.shardOf.get(id);
    if (!shard) return;
    shard.flies.delete(id);
    this.shardOf.delete(id);
    this.motors.delete(id);
    if (!shard.flies.size) shard.wallMs = 0;
    shard.worker.postMessage({ type: 'remove', id } satisfies WorkerIn);
  }

  reset(): void {
    this.runId++;
    this.motors.clear();
    this.shardOf.clear();
    for (const s of this.shards) {
      s.flies.clear();
      s.busy = false;
      s.wallMs = 0;
      s.worker.postMessage({ type: 'reset' } satisfies WorkerIn);
    }
  }

  step(sensors: Map<string, FlySensors>): void {
    this.tick++;
    for (const shard of this.shards) {
      if (!shard.flies.size) continue;
      if (shard.busy) {
        this.dropped++;
        continue;
      }
      const batch: { id: string; s: FlySensors }[] = [];
      for (const id of shard.flies) {
        const s = sensors.get(id);
        if (s) batch.push({ id, s });
      }
      shard.busy = true;
      shard.worker.postMessage({ type: 'tick', runId: this.runId, tick: this.tick, sensors: batch } satisfies WorkerIn);
    }
  }

  /** Latest motor command; an escape flag is delivered once. */
  motor(id: string): FlyMotor | null {
    const m = this.motors.get(id);
    if (!m) return null;
    if (m.escape) this.motors.set(id, { ...m, escape: false });
    return m;
  }

  status(): SwarmStatus {
    const busiest = Math.max(1, ...this.shards.filter((s) => s.flies.size).map((s) => s.wallMs));
    return {
      workers: this.shards.length,
      neurons: this.neurons,
      flies: this.shardOf.size,
      capacity: this.shards.length * this.perWorker,
      realtimeFactor: 50 / busiest,
      droppedTicks: this.dropped,
      lastError: this.lastError,
    };
  }

  dispose(): void {
    for (const s of this.shards) s.worker.terminate();
  }
}
