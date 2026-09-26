import { describe, expect, it } from 'vitest';
import { toEdits } from './worldCommand';

const blank = {
  x: null, z: null, radius: null, resourceKind: null, hazardKind: null, obstacleShape: null, targetId: null,
  weather: null, durationSec: null, timeOfDay: null, count: null, controller: null,
} as const;

describe('toEdits (model output → allowlisted edits)', () => {
  it('converts valid items and reports invalid ones instead of applying them', () => {
    const { edits, rejected } = toEdits([
      { ...blank, type: 'set_weather', weather: 'storm', durationSec: 120 },
      { ...blank, type: 'set_time_of_day', timeOfDay: 'night' },
      { ...blank, type: 'add_resource', resourceKind: 'berry_bush', x: 20, z: -20 },
      { ...blank, type: 'add_resource', resourceKind: 'berry_bush' }, // no position
      { ...blank, type: 'remove_hazard' }, // no id
      { ...blank, type: 'set_weather', weather: 'rain', durationSec: 99999 }, // out of range
    ]);
    expect(edits).toEqual([
      { type: 'set_weather', weather: 'storm', durationSec: 120 },
      { type: 'set_time_of_day', timeOfDay: 'night' },
      { type: 'add_resource', kind: 'berry_bush', position: { x: 20, z: -20 } },
    ]);
    expect(rejected).toHaveLength(3);
  });

  it('caps the number of edits per command', () => {
    const many = Array.from({ length: 14 }, () => ({ ...blank, type: 'set_time_of_day' as const, timeOfDay: 'day' as const }));
    const { edits, rejected } = toEdits(many);
    expect(edits).toHaveLength(10);
    expect(rejected.at(-1)).toMatch(/4 edit\(s\) over the limit/);
  });
});
