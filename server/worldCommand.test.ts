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

import { sanitizeObservation } from './observe';

describe('sanitizeObservation (observer output → grounded insights)', () => {
  it('drops unknown moment ids and ungrounded patterns, bounds text', () => {
    const out = sanitizeObservation(
      {
        insights: [
          { kind: 'pattern', headline: 'a3 warned a5', detail: 'x'.repeat(1000), momentIds: ['m1', 'm99'] },
          { kind: 'pattern', headline: 'invented', detail: 'no evidence', momentIds: ['m42'] },
          { kind: 'comparison', headline: 'more births than last run', detail: 'd', momentIds: [] },
        ],
        suggestion: { command: 'add red toxic mushrooms near a5', why: 'tests the warning' },
      },
      new Set(['m1', 'm2']),
    );
    expect(out.insights.map((i) => i.headline)).toEqual(['a3 warned a5', 'more births than last run']);
    expect(out.insights[0].momentIds).toEqual(['m1']);
    expect(out.insights[0].detail.length).toBeLessThanOrEqual(320);
    expect(out.suggestion?.command).toBe('add red toxic mushrooms near a5');
  });
});
