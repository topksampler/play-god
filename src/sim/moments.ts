import { HAZARDS, NODES } from '../shared/catalog';
import type { WorldState } from '../shared/types';

/**
 * Notable moments, extracted from what the simulator actually recorded (events, births, courtships, delivered
 * utterances, milestones, belief changes, positions). Nothing here is model-written: it is the factual story the
 * UI and the observer agent build on.
 */
export type MomentKind =
  | 'death' | 'birth' | 'poison' | 'sick' | 'courtship' | 'speech' | 'belief' | 'first' | 'gathering' | 'god' | 'weather'
  // Cross-species (mixed worlds: LLM agents + connectome flies)
  | 'swat' | 'escape' | 'nibble' | 'hatch';

export type Moment = {
  id: string;
  at: number;
  kind: MomentKind;
  agents: string[];
  title: string;
  /** 1 (background) … 3 (headline). */
  weight: 1 | 2 | 3;
};

export const MOMENT_ICON: Record<MomentKind, string> = {
  death: '✝', birth: '👶', poison: '🍄', sick: '🤢', courtship: '💗', speech: '💬', belief: '🧠', first: '✨',
  gathering: '👥', god: '⚡', weather: '🌦', swat: '🖐', escape: '💨', nibble: '🪰', hatch: '🐣',
};

const HARMFUL_LOOKS = new Set<string>([
  NODES.toxic_mushroom_patch.appearance,
  NODES.toxic_water.appearance,
  ...Object.values(HAZARDS).map((h) => h.appearance),
]);
const SAFE_LOOKS = new Set<string>(
  Object.entries(NODES).filter(([k]) => k !== 'toxic_mushroom_patch' && k !== 'toxic_water').map(([, n]) => n.appearance),
);
/** World truth for an appearance string, when it matches the catalog exactly. */
export const truthOf = (appearance: string): 'harmful' | 'safe' | null =>
  HARMFUL_LOOKS.has(appearance) ? 'harmful' : SAFE_LOOKS.has(appearance) ? 'safe' : null;

/** Milestones worth surfacing (the routine firsts — gather, meal, drink, rest — are left out). */
const NOTABLE_FIRSTS = /^(First words spoken|First structure built|First craft|First gift given|First cooked food|First item stored|First time following)/;
const MAX_MOMENTS = 300;
const GATHER_RADIUS = 4;
const GATHER_COOLDOWN = 60;

const short = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export type MomentTracker = {
  /** Scan the live state for anything new since the last call. Returns the full list, newest last. */
  update(state: WorldState): Moment[];
  list(): Moment[];
};

export function createMomentTracker(): MomentTracker {
  let runId = '';
  let moments: Moment[] = [];
  let n = 0;
  let lastEventSeq = 0;
  let birthsSeen = 0;
  let utterancesSeen = 0;
  let courtSeen = new Set<string>();
  let beliefs = new Map<string, Map<string, string>>();
  let milestonesSeen = new Map<string, number>();
  let lastGathering = new Map<string, number>();
  let poisonedLooks = new Set<string>();

  const add = (m: Omit<Moment, 'id'>) => {
    moments.push({ ...m, id: `m${++n}` });
    if (moments.length > MAX_MOMENTS) moments.shift();
  };

  const reset = (s: WorldState) => {
    runId = s.runId;
    moments = [];
    // A reopened earlier run ("loaded:…") rebuilds its story from the recorded history; a fresh run starts empty.
    const replayHistory = s.runId.startsWith('loaded:');
    lastEventSeq = replayHistory ? 0 : s.eventSeq;
    birthsSeen = replayHistory ? 0 : s.births.length;
    utterancesSeen = replayHistory ? 0 : s.utterances.length;
    courtSeen = new Set(replayHistory ? [] : s.courtships.flatMap((c) => [`${c.id}:${c.outcome}`, `pair:${c.from}:${c.to}`]));
    beliefs = new Map();
    milestonesSeen = new Map(Object.values(s.agents).map((a) => [a.id, replayHistory ? 0 : a.milestones.length]));
    lastGathering = new Map();
    poisonedLooks = new Set();
    // Existing beliefs are the baseline, not news.
    for (const a of Object.values(s.agents)) beliefs.set(a.id, new Map(a.memory.beliefs.map((b) => [b.appearance, b.verdict])));
  };

  function update(s: WorldState): Moment[] {
    if (s.runId !== runId) reset(s);

    // Events (the log is capped, so read incrementally by seq).
    for (const e of s.events) {
      if (e.seq <= lastEventSeq) continue;
      const who = e.agentId ? [e.agentId] : [];
      if (e.kind === 'death') add({ at: e.at, kind: 'death', agents: who, title: short(e.text.replace(/^✝\s*/, ''), 90), weight: 3 });
      else if (e.kind === 'hazard' && /poisoned by/.test(e.text)) {
        const first = !poisonedLooks.has(`${e.agentId}:${e.text}`);
        poisonedLooks.add(`${e.agentId}:${e.text}`);
        if (first) add({ at: e.at, kind: 'poison', agents: who, title: short(e.text.replace(/ \([a-z_]+\)$/, '')), weight: 2 });
      } else if (e.kind === 'hazard' && /got sick/.test(e.text)) add({ at: e.at, kind: 'sick', agents: who, title: short(e.text), weight: 2 });
      else if (e.kind === 'edit' && e.ok && /^\[God/.test(e.text)) add({ at: e.at, kind: 'god', agents: [], title: short(`You: ${e.text.replace(/^\[[^\]]*\]\s*/, '')}`), weight: 2 });
      else if (e.kind === 'weather') add({ at: e.at, kind: 'weather', agents: [], title: e.text, weight: 1 });
      // Cross-species encounters: agents swatting flies, flies escaping (their own Giant Fiber), spoiling food, hatching.
      else if (e.kind === 'action' && /^a\d+ swat: (swatted|missed)/.test(e.text)) {
        const fly = e.text.match(/\b(f\d+)\b/)?.[1];
        add({ at: e.at, kind: 'swat', agents: [...who, ...(fly ? [fly] : [])], title: short(e.text.replace(' swat: ', ' ')), weight: /swatted/.test(e.text) ? 3 : 2 });
      } else if (e.kind === 'action' && /took off .*away from a\d+/.test(e.text)) {
        add({ at: e.at, kind: 'escape', agents: [...who, e.text.match(/away from (a\d+)/)![1]], title: short(e.text.replace(/^🪰\s*/, '')), weight: 2 });
      } else if (e.kind === 'action' && /nibbled/.test(e.text)) add({ at: e.at, kind: 'nibble', agents: who, title: short(e.text.replace(/^🪰\s*/, '')), weight: 1 });
      else if (e.kind === 'spawn' && /hatched/.test(e.text)) add({ at: e.at, kind: 'hatch', agents: who, title: short(e.text.replace(/^🐣\s*/, '')), weight: 2 });
    }
    lastEventSeq = s.eventSeq;

    // Births (persistent list).
    for (const b of s.births.slice(birthsSeen)) {
      const child = s.agents[b.child];
      const inherited = child?.memory.beliefs.length ?? 0;
      add({
        at: b.at, kind: 'birth', agents: [b.child, ...b.parents],
        title: `${b.child} born to ${b.parents.join(' + ')}${inherited ? ` · inherits ${inherited} beliefs` : ''}`, weight: 3,
      });
    }
    birthsSeen = s.births.length;

    // Courtships: the first attempt between a pair, and every mutual acceptance.
    for (const c of s.courtships) {
      const key = `${c.id}:${c.outcome}`;
      if (courtSeen.has(key)) continue;
      courtSeen.add(key);
      if (c.outcome === 'mutual' || c.outcome === 'birth') add({ at: c.endedAt ?? c.at, kind: 'courtship', agents: [c.from, c.to], title: `${c.to} accepts ${c.from}`, weight: 3 });
      else if (c.outcome === 'pending' && !courtSeen.has(`pair:${c.from}:${c.to}`)) {
        courtSeen.add(`pair:${c.from}:${c.to}`);
        add({ at: c.at, kind: 'courtship', agents: [c.from, c.to], title: `${c.from} courts ${c.to}`, weight: 2 });
      }
    }

    // Delivered speech (only what someone actually heard).
    if (s.utterances.length < utterancesSeen) utterancesSeen = 0; // capped list rolled over
    for (const u of s.utterances.slice(utterancesSeen)) {
      if (!u.hearers.length || u.channel === 'gesture') continue;
      const verb = u.channel === 'mark' ? 'marks' : u.channel === 'signal' ? 'signals' : '→';
      add({ at: u.at, kind: 'speech', agents: [u.speaker, ...u.hearers], title: short(`${u.speaker} ${verb} ${u.hearers.join(', ')}: “${u.content}”`, 90), weight: 2 });
    }
    utterancesSeen = s.utterances.length;

    for (const a of Object.values(s.agents)) {
      // Notable firsts.
      const seen = milestonesSeen.get(a.id) ?? 0;
      for (const m of a.milestones.slice(seen)) {
        if (NOTABLE_FIRSTS.test(m.text)) add({ at: m.at, kind: 'first', agents: [a.id], title: short(`${a.id}: ${m.text}`), weight: 1 });
      }
      milestonesSeen.set(a.id, a.milestones.length);

      // Belief changes, scored against world truth where the appearance matches the catalog.
      const prev = beliefs.get(a.id);
      const now = new Map(a.memory.beliefs.map((b) => [b.appearance, b.verdict]));
      if (prev) {
        for (const [look, verdict] of now) {
          if (verdict === 'unknown' || prev.get(look) === verdict) continue;
          const truth = truthOf(look);
          const judged = truth ? (truth === verdict ? ' (correct)' : ' (wrong!)') : '';
          // Wrong beliefs are headlines; correctly spotting danger is notable; routine "X is safe" is background.
          const weight = truth && truth !== verdict ? 3 : verdict === 'harmful' ? 2 : 1;
          add({ at: s.time, kind: 'belief', agents: [a.id], title: short(`${a.id} now believes “${look}” is ${verdict}${judged}`, 90), weight });
        }
      }
      beliefs.set(a.id, now);
    }

    // Gatherings: 3+ living agents close together (per group, with a cooldown).
    const alive = Object.values(s.agents).filter((a) => a.status !== 'dead');
    for (const a of alive) {
      const group = alive.filter((b) => Math.hypot(b.position.x - a.position.x, b.position.z - a.position.z) <= GATHER_RADIUS).map((b) => b.id).sort();
      if (group.length < 3 || group[0] !== a.id) continue;
      const key = group.join(',');
      if (s.time - (lastGathering.get(key) ?? -Infinity) < GATHER_COOLDOWN) continue;
      lastGathering.set(key, s.time);
      add({ at: s.time, kind: 'gathering', agents: group, title: `${group.join(', ')} gathered together`, weight: 1 });
    }

    moments.sort((x, y) => x.at - y.at);
    return moments;
  }

  return { update, list: () => moments };
}

/** Runs saved before moments were stored keep "123s <title>" headline strings; turn them into citable moments (ids t0…). */
export function topMomentsAsMoments(top: string[]): Moment[] {
  return top.map((t, i) => ({
    id: `t${i}`,
    at: Number(t.match(/^(\d+)s/)?.[1] ?? 0),
    kind: /died/.test(t) ? 'death' : /born/.test(t) ? 'birth' : /believes/.test(t) ? 'belief' : /accepts|courts/.test(t) ? 'courtship' : 'first',
    agents: [...new Set(t.match(/\ba\d+\b/g) ?? [])].slice(0, 6),
    title: t.replace(/^\d+s /, ''),
    weight: 3,
  }));
}
