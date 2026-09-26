import type { TimelineKind } from '../shared/types';

/** Timeline kinds: fixed categorical order (reference palette), plus a shape so identity is never colour-alone. */
export const KIND_STYLE: Record<TimelineKind, { color: string; label: string; glyph: string }> = {
  turn: { color: '#52514e', label: 'decision', glyph: '│' },
  action: { color: '#2a78d6', label: 'action', glyph: '●' },
  said: { color: '#1baf7a', label: 'said', glyph: '◆' },
  heard: { color: '#1baf7a', label: 'heard', glyph: '◇' },
  memory: { color: '#4a3aa7', label: 'memory', glyph: '■' },
  milestone: { color: '#eda100', label: 'milestone', glyph: '★' },
  hurt: { color: '#eb6834', label: 'hurt', glyph: '✕' },
  error: { color: '#e34948', label: 'error', glyph: '⚠' },
};
export const KINDS = Object.keys(KIND_STYLE) as TimelineKind[];
