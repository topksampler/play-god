import { FlyBrainPool, type Circuit } from './brain';
import { FlyBody, FLY_CONFIG, type BiasCalibration, type FlyMotor, type FlySensors } from './body';

export type WorkerIn =
  | { type: 'init'; circuit: Circuit; calibration: BiasCalibration | null; capacity: number }
  | { type: 'spawn'; id: string; seed: number }
  | { type: 'remove'; id: string }
  | { type: 'reset' }
  | { type: 'tick'; runId: number; tick: number; sensors: { id: string; s: FlySensors }[] };

export type WorkerOut =
  | { type: 'ready'; neurons: number; synapses: number; plastic: number }
  | { type: 'spawned'; id: string; ok: boolean; error?: string }
  | { type: 'motors'; runId: number; tick: number; wallMs: number; motors: { id: string; m: FlyMotor }[] }
  | { type: 'error'; error: string };

let pool: FlyBrainPool | null = null;
const bodies = new Map<string, FlyBody>();
let settings: { circuit: Circuit; capacity: number } | null = null;

const post = (msg: WorkerOut) => (self as unknown as Worker).postMessage(msg);

self.onmessage = (ev: MessageEvent<WorkerIn>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      FlyBody.calibration = msg.calibration;
      settings = { circuit: msg.circuit, capacity: msg.capacity };
      pool = new FlyBrainPool(msg.circuit, msg.capacity, 1.0);
      post({ type: 'ready', neurons: msg.circuit.n, synapses: msg.circuit.pre.length, plastic: msg.circuit.plastic.length });
    } else if (!pool || !settings) {
      post({ type: 'error', error: 'worker not initialised' });
    } else if (msg.type === 'spawn') {
      try {
        bodies.set(msg.id, new FlyBody(pool, msg.seed));
        post({ type: 'spawned', id: msg.id, ok: true });
      } catch (e) {
        post({ type: 'spawned', id: msg.id, ok: false, error: String(e) });
      }
    } else if (msg.type === 'remove') {
      bodies.get(msg.id)?.remove();
      bodies.delete(msg.id);
    } else if (msg.type === 'reset') {
      bodies.clear();
      pool = new FlyBrainPool(settings.circuit, settings.capacity, 1.0);
    } else if (msg.type === 'tick') {
      const t0 = performance.now();
      pool.clearCounts();
      for (const { id, s } of msg.sensors) bodies.get(id)?.encode(s);
      pool.run(FLY_CONFIG.tickMs);
      const motors: { id: string; m: FlyMotor }[] = [];
      for (const { id } of msg.sensors) {
        const b = bodies.get(id);
        if (b) motors.push({ id, m: b.decode() });
      }
      post({ type: 'motors', runId: msg.runId, tick: msg.tick, wallMs: performance.now() - t0, motors });
    }
  } catch (e) {
    post({ type: 'error', error: e instanceof Error ? e.message : String(e) });
  }
};
