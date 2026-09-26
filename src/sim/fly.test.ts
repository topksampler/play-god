import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlyMotor } from '../controllers/fly/body';
import { startFlyDriver } from '../controllers/fly/driver';
import { flySensors } from '../controllers/fly/sensing';
import type { FlySwarm } from '../controllers/fly/swarm';
import { startScheduler } from '../controllers/scheduler';
import { CONFIG } from '../shared/config';
import type { Controller, FlyReadout, SimCommand, WorldState } from '../shared/types';
import { mulberry32 } from './rng';
import { applyCommand, stepWorld } from './step';
import { createSimStore } from './store';
import { addNode, createInitialWorld } from './world';

const rng = mulberry32(7);
let n = 1;
const apply = (s: WorldState, c: SimCommand) => applyCommand(s, c, rng, () => `run-f${++n}`);
const readout: FlyReadout = { dna02: [0, 0], dna01: [0, 0], mn9: 0, pam: 0, ppl1: 0, steer: 0, valence: 0, brainDriven: 0 };
const motor = (s: WorldState, agentId: string, m: Partial<{ turnRate: number; speed: number; feeding: boolean }>) =>
  apply(s, { type: 'flyMotors', runId: s.runId, motors: [{ agentId, turnRate: 0, speed: 0, feeding: false, readout, ...m }] });
const run = (s: WorldState, seconds: number) => {
  for (let i = 0; i < seconds * 20; i++) stepWorld(s, 0.05, rng);
};

function flyWorld(): WorldState {
  const s = createInitialWorld('r-fly', 'scripted', { mode: 'flies' });
  s.resources = {};
  s.hazards = {};
  s.obstacles = {};
  s.agents.f1.position = { x: 0, z: 0 };
  s.agents.f1.heading = 0;
  s.time = 10;
  return s;
}

describe('fly mode world', () => {
  it('starts with one connectome fly and keeps plan agents and flies apart', () => {
    const s = flyWorld();
    expect(Object.keys(s.agents)).toEqual(['f1']);
    expect(s.agents.f1.controller.kind).toBe('fly');
    expect(s.agents.f1.fly?.brainStatus).toBe('loading');
    apply(s, { type: 'spawnAgents', count: 2, controller: 'scripted' });
    expect(Object.keys(s.agents)).toHaveLength(1);
    apply(s, { type: 'spawnAgents', count: 3, controller: 'fly' });
    expect(Object.keys(s.agents)).toHaveLength(4);
    apply(s, { type: 'setController', agentId: 'f1', controller: 'llm' });
    expect(s.agents.f1.controller.kind).toBe('fly');
  });

  it('caps the fly population at the brain capacity', () => {
    const s = flyWorld();
    apply(s, { type: 'flyCapacity', capacity: 3 });
    apply(s, { type: 'spawnAgents', count: 10, controller: 'fly' });
    expect(Object.keys(s.agents)).toHaveLength(3);
    expect(s.events.at(-1)?.text).toMatch(/max 3 flies/);
  });

  it('reset keeps the mode unless told otherwise, and agent mode keeps its controller preference', () => {
    let s = flyWorld();
    s = apply(s, { type: 'reset' });
    expect(s.mode).toBe('flies');
    expect(s.agents.f1).toBeDefined();
    s = apply(s, { type: 'reset', mode: 'agents' });
    expect(s.mode).toBe('agents');
    expect(s.agents.a1.fly).toBeNull();
    expect(s.defaultController).toBe('scripted');
  });
});

describe('fly body', () => {
  it('stands still until its brain produces a motor command, then walks by it', () => {
    const s = flyWorld();
    run(s, 1);
    expect(s.agents.f1.position).toEqual({ x: 0, z: 0 });
    motor(s, 'f1', { speed: 1.5 });
    run(s, 1);
    expect(s.agents.f1.position.x).toBeGreaterThan(1);
  });

  it('ignores motor commands from an old run', () => {
    const s = flyWorld();
    apply(s, { type: 'flyMotors', runId: 'old-run', motors: [{ agentId: 'f1', turnRate: 1, speed: 1.5, feeding: false, readout }] });
    expect(s.agents.f1.fly?.motorAt).toBeNull();
  });

  it('clamps non-finite or extreme motor values', () => {
    const s = flyWorld();
    motor(s, 'f1', { speed: Number.NaN, turnRate: 1e9 });
    expect(s.agents.f1.fly?.speed).toBe(0);
    expect(s.agents.f1.fly?.turnRate).toBe(6);
  });

  it('cannot walk through a rock', () => {
    const s = flyWorld();
    s.obstacles.o1 = { id: 'o1', shape: 'rock', position: { x: 2, z: 0 }, radius: 1, height: 1, solid: true };
    motor(s, 'f1', { speed: 1.5 });
    for (let i = 0; i < 80; i++) {
      stepWorld(s, 0.05, rng);
      const d = Math.hypot(s.agents.f1.position.x - 2, s.agents.f1.position.z);
      expect(d).toBeGreaterThanOrEqual(1 + CONFIG.flyRadius - 1e-6);
      if (i % 20 === 0) motor(s, 'f1', { speed: 1.5 });
    }
  });

  it('feeds only while the proboscis is extended, one unit per feeding bout, never below zero', () => {
    const s = flyWorld();
    const r = addNode(s, 'berry_bush', { x: 0.5, z: 0 });
    s.resources[r].units = 2;
    s.resources[r].regrowPerMin = 0;
    s.agents.f1.energy = 20;
    run(s, 3);
    expect(s.resources[r].units).toBe(2);
    expect(s.agents.f1.fly?.lastTaste?.sugar).toBe(true);
    for (let i = 0; i < 10; i++) {
      motor(s, 'f1', { feeding: true });
      run(s, 1);
    }
    expect(s.resources[r].units).toBeGreaterThanOrEqual(0);
    expect(s.resources[r].units).toBeLessThan(1);
    expect(s.agents.f1.stats.eaten).toBe(2);
    expect(s.agents.f1.energy).toBeGreaterThan(20);
  });

  it('tastes toxic mushrooms as bitter and is poisoned if it eats them anyway', () => {
    const s = flyWorld();
    addNode(s, 'toxic_mushroom_patch', { x: 0.5, z: 0 });
    motor(s, 'f1', { feeding: true });
    run(s, 2);
    expect(s.agents.f1.fly?.lastTaste?.bitter).toBe(true);
    expect(s.agents.f1.poisonedUntil).toBeGreaterThan(s.time);
  });

  it('senses odor more strongly on the antenna nearer the food, and only nearby food', () => {
    const s = flyWorld();
    addNode(s, 'berry_bush', { x: 2, z: 2 });
    const near = flySensors(s, s.agents.f1, -Infinity);
    expect(near.odorA[1]).toBeGreaterThan(near.odorA[0]);
    expect(near.odorB).toEqual([0, 0]);
    s.agents.f1.position = { x: -30, z: -30 };
    expect(flySensors(s, s.agents.f1, -Infinity).odorA).toEqual([0, 0]);
  });
});

describe('fly integration', () => {
  afterEach(() => vi.useRealTimers());

  it('the LLM scheduler never asks a fly for a plan', async () => {
    vi.useFakeTimers();
    const store = createSimStore({ rng });
    store.dispatch({ type: 'reset', mode: 'flies' });
    store.tick(0.05);
    const decide = vi.fn();
    const stop = startScheduler(store, { resolve: () => ({ kind: 'llm', decide } as unknown as Controller), pollMs: 10 });
    await vi.advanceTimersByTimeAsync(200);
    stop();
    expect(decide).not.toHaveBeenCalled();
  });

  it('driver sends sensors, applies motors, and resets brains when the run changes', async () => {
    vi.useFakeTimers();
    const store = createSimStore({ rng });
    store.dispatch({ type: 'reset', mode: 'flies' });
    store.tick(0.05);
    const spawned: string[] = [];
    let resets = 0;
    const m: FlyMotor = { turnRate: 0.5, speed: 1, feeding: false, readout };
    const fake = {
      spawn: (id: string) => (spawned.push(id), true),
      remove: () => {},
      reset: () => void resets++,
      step: vi.fn(),
      motor: () => m,
      status: () => ({ workers: 1, flies: spawned.length, capacity: 4, realtimeFactor: 2, droppedTicks: 0, lastError: null }),
      dispose: () => {},
    } as unknown as FlySwarm;
    const stop = startFlyDriver(store, { tickMs: 50, create: async () => fake });
    await vi.advanceTimersByTimeAsync(120);
    store.tick(0.05);
    expect(spawned).toEqual(['f1']);
    expect(store.getState().flyCapacity).toBe(4);
    expect(store.getState().agents.f1.fly?.speed).toBe(1);
    expect((fake.step as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0].has('f1')).toBe(true);
    store.dispatch({ type: 'reset' });
    store.tick(0.05);
    await vi.advanceTimersByTimeAsync(60);
    expect(resets).toBeGreaterThan(0);
    expect(spawned).toEqual(['f1', 'f1']);
    stop();
  });
});
