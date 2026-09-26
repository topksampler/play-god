/**
 * Summarise an exported run (Lab → Export run). Usage: npx tsx scripts/analyze-run.ts run1.json [run2.json …]
 * Everything is computed from recorded world truth; beliefs are scored against the true kinds behind appearances.
 */
import { readFileSync } from 'node:fs';
import { HAZARDS, NODES } from '../src/shared/catalog';

const HARMFUL_LOOKS = new Set<string>([
  NODES.toxic_mushroom_patch.appearance,
  NODES.toxic_water.appearance,
  ...Object.values(HAZARDS).map((h) => h.appearance),
]);
const SAFE_LOOKS = new Set<string>(
  Object.entries(NODES).filter(([k]) => k !== 'toxic_mushroom_patch' && k !== 'toxic_water').map(([, n]) => n.appearance),
);

type Run = {
  runId: string; seed: number; simTime: number; experiment: { commMode: string; traits: boolean; scarcity?: string; lexicon: string[] };
  agents: { id: string; status: string; stats: Record<string, number>; memory: { beliefs: { appearance: string; verdict: string }[] }; actionCounts: Record<string, { ok: number; fail: number }>; timeline: { kind: string }[] }[];
  utterances: { speaker: string; channel: string; content: string; hearers: string[]; context: string[] }[];
};

for (const file of process.argv.slice(2)) {
  const r: Run = JSON.parse(readFileSync(file, 'utf8'));
  const A = r.agents;
  const sum = (k: string) => A.reduce((n, a) => n + (a.stats[k] ?? 0), 0);
  let judged = 0, correct = 0, harmfulKnown = 0;
  for (const a of A) {
    for (const b of a.memory.beliefs) {
      if (b.verdict === 'unknown') continue;
      const truth = HARMFUL_LOOKS.has(b.appearance) ? 'harmful' : SAFE_LOOKS.has(b.appearance) ? 'safe' : null;
      if (!truth) continue;
      judged++;
      if (truth === b.verdict) correct++;
      if (truth === 'harmful' && b.verdict === 'harmful') harmfulKnown++;
    }
  }
  const byChannel: Record<string, number> = {};
  for (const u of r.utterances) byChannel[u.channel] = (byChannel[u.channel] ?? 0) + 1;
  const reached = r.utterances.filter((u) => u.hearers.length).length;
  const turns = A.reduce((n, a) => n + a.timeline.filter((e) => e.kind === 'turn').length, 0);
  const failed = A.reduce((n, a) => n + Object.values(a.actionCounts).reduce((m, c) => m + c.fail, 0), 0);
  const ok = A.reduce((n, a) => n + Object.values(a.actionCounts).reduce((m, c) => m + c.ok, 0), 0);
  console.log(`\n=== ${file}`);
  console.log(`condition: comm=${r.experiment.commMode} food=${r.experiment.scarcity ?? 'normal'} traits=${r.experiment.traits} seed=${r.seed} · ${A.length} agents · ${r.simTime.toFixed(0)} sim-s`);
  console.log(`survival: ${A.filter((a) => a.status !== 'dead').length}/${A.length} alive · meals ${sum('eaten')} · drinks ${sum('drank')} · poisonings ${sum('poisonings')} · damage ${sum('damageTaken').toFixed(0)} · built ${sum('built')}`);
  console.log(`decisions: ${turns} turns · actions ok ${ok} / failed ${failed} (${((failed / Math.max(1, ok + failed)) * 100).toFixed(0)}% fail)`);
  console.log(`beliefs: ${judged} judged, ${((correct / Math.max(1, judged)) * 100).toFixed(0)}% correct · ${harmfulKnown} correct 'harmful' beliefs`);
  console.log(`communication: ${r.utterances.length} acts (${Object.entries(byChannel).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}) · ${reached} reached someone`);
  for (const u of r.utterances.slice(0, 12)) console.log(`   ${u.speaker} [${u.channel}] "${u.content}" → ${u.hearers.join(',') || '-'} | ${u.context.join(' ')}`);
  if (r.utterances.length > 12) console.log(`   … ${r.utterances.length - 12} more`);
}
