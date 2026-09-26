import { describe, expect, it } from 'vitest';
import type { Action } from '../shared/types';
import { observe } from './observe';
import { REPLAY_WINDOW_SEC, createReplay } from './replay';
import { mulberry32 } from './rng';
import { createSimStore } from './store';

function setup() {
  const store = createSimStore({ rng: mulberry32(3) });
  let wall = 0;
  const replay = createReplay(store, { now: () => wall });
  const tick = (seconds: number) => {
    for (let i = 0; i < seconds * 20; i++) {
      wall += 50;
      store.tick(0.05);
    }
  };
  const plan = (actions: Action[]) => {
    const s = store.getLiveState();
    const seq = s.agents.a1.controller.requestSeq + 1;
    store.dispatch({ type: 'decisionStarted', agentId: 'a1', runId: s.runId, seq, observation: observe(s, 'a1') });
    store.dispatch({ type: 'decisionResult', agentId: 'a1', runId: s.runId, seq, decision: { plan: actions }, latencyMs: 1 });
  };
  return { store, replay, tick, plan };
}

describe('replay', () => {
  it('shows a past moment while the live world keeps running untouched', () => {
    const { store, replay, tick, plan } = setup();
    const start = store.getLiveState().agents.a1.position;
    plan([{ type: 'move', target: { x: start.x + 20, z: start.z } }]);
    tick(3);
    const t3 = store.getLiveState().time;
    const pos3 = { ...store.getLiveState().agents.a1.position };
    tick(4);

    replay.seek(t3);
    const view = replay.viewStore.getState();
    expect(view.time).toBeCloseTo(t3);
    expect(view.agents.a1.position.x).toBeCloseTo(pos3.x, 0);

    // Live keeps moving while the view stays put.
    const liveBefore = store.getLiveState().time;
    tick(2);
    expect(store.getLiveState().time).toBeGreaterThan(liveBefore + 1.9);
    expect(store.getLiveState().agents.a1.position.x).toBeGreaterThan(pos3.x + 1);
    expect(replay.viewStore.getState().time).toBeCloseTo(t3);
    // The view store always exposes the live world for commands.
    expect(replay.viewStore.getLiveState()).toBe(store.getLiveState());
  });

  it('plays forward and returns to live when it catches up', () => {
    const { store, replay, tick } = setup();
    tick(6);
    replay.seek(store.getLiveState().time - 3);
    replay.setRate(4);
    replay.setPlaying(true);
    tick(0.5);
    const vt = replay.getViewTime()!;
    expect(vt).toBeGreaterThan(store.getLiveState().time - 3); // advanced
    tick(3);
    expect(replay.getViewTime()).toBeNull(); // caught up → live
    expect(replay.viewStore.getState()).toBe(store.getLiveState());
  });

  it('keeps resources that were removed later, and past weather, in the past view', () => {
    const { store, replay, tick } = setup();
    tick(2);
    const t = store.getLiveState().time;
    const id = Object.keys(store.getLiveState().resources)[0];
    store.dispatch({ type: 'edit', source: 'test', edit: { type: 'remove_resource', nodeId: id } });
    store.dispatch({ type: 'edit', source: 'test', edit: { type: 'set_weather', weather: 'storm' } });
    tick(2);
    expect(store.getLiveState().resources[id]).toBeUndefined();
    replay.seek(t);
    expect(replay.viewStore.getState().resources[id]).toBeDefined();
    expect(replay.viewStore.getState().weather).toBe('clear');
    expect(replay.viewStore.getState().events.every((e) => e.at <= t)).toBe(true);
  });

  it('clamps to the recorded window, trims old frames and clears on reset', () => {
    const { store, replay, tick } = setup();
    tick(REPLAY_WINDOW_SEC + 30);
    const { start, end } = replay.range();
    expect(end - start).toBeLessThanOrEqual(REPLAY_WINDOW_SEC + 1);
    replay.seek(0);
    expect(replay.getViewTime()).toBeCloseTo(start);
    store.dispatch({ type: 'reset' });
    tick(0.1);
    expect(replay.getViewTime()).toBeNull();
    expect(replay.range().end - replay.range().start).toBeLessThan(1);
  });
});
