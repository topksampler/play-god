import { readFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { ObserveRequest, ObserveResponse } from '../src/shared/schemas';

// The observer is the one place where depth beats speed; default to the most capable model.
const observerModel = () => process.env.ANTHROPIC_OBSERVER_MODEL?.trim() || 'claude-opus-5-5';

/** Teammates' recorded pilot observations (docs/EMERGENCE.md), offered as extra cross-run evidence. */
const PILOT = (() => {
  try {
    const doc = readFileSync(new URL('../docs/EMERGENCE.md', import.meta.url), 'utf8');
    const i = doc.indexOf('## Pilot observations');
    return i < 0 ? '' : doc.slice(i, doc.indexOf('\n## ', i + 5) > 0 ? doc.indexOf('\n## ', i + 5) : undefined).slice(0, 3000);
  } catch {
    return '';
  }
})();

// Flat schema for structured output; sanitized below against the moments actually supplied.
const LlmOutput = z.object({
  insights: z.array(
    z.object({
      kind: z.enum(['pattern', 'comparison', 'question']),
      headline: z.string(),
      detail: z.string(),
      momentIds: z.array(z.string()),
    }),
  ),
  suggestion: z.object({ command: z.string(), why: z.string() }).nullable(),
});
type Out = z.infer<typeof LlmOutput>;

const SYSTEM = `You are a naturalist watching an artificial-life habitat from outside. Autonomous creatures forage, drink, learn which things are harmful only from outcomes, may talk, court, reproduce and die. There can be two species: LLM-driven agents (ids a1…) and fruit flies (ids f1…), each fly driven by its own spiking connectome circuit, not an LLM. Agents can see, hear and swat flies; a fly escapes only if its own Giant Fiber neuron fires in time; flies spoil food and lay eggs. A human "God" watches and can intervene.
You receive: the current run's recorded moments (each with an id, sim time in seconds, kind and agents), summary numbers, and summaries of earlier runs in this browser.
Moments come from the current run AND earlier runs: earlier-run moment ids look like "<runKey>|m12" and their titles start with [previous run] / [run N ago].
Surface 1-3 insights that would make a curious audience lean in. Focus on EMERGENT MULTI-AGENT and CROSS-SPECIES behaviour (agents vs flies: who hunts, who escapes, whether agents learn to guard food, whether flies thrive near agents): what happens because several creatures share a world — who talks to whom and whether warnings spread, copying or following, competition for food, clustering, courtship and pairing, knowledge passed to children, a creature ignoring what others learned, the same pattern recurring (or not) across runs. Prefer insights that span several creatures or several runs over single-creature trivia.
- pattern: a recurring or surprising multi-agent pattern, in this run or across runs.
- comparison: how runs differ (cite concrete numbers from the summaries).
- question: an open question the audience could test.
Rules: use only the supplied data. Every insight cites the ids of the moments it is about (momentIds; may be empty for pure comparisons). Say "may", "looks like" for interpretations: agent statements are evidence of what a model said, not of its motives, and one run cannot prove causation. Headline <= 90 characters, punchy and specific (creature ids like a3, numbers). Detail <= 240 characters. Never write moment ids (m12…) in the text: they go only in momentIds and become "Watch" buttons.
Optionally propose one intervention experiment as "suggestion": a plain-English God command using only these supported changes: weather (+duration), time of day, add/remove resources (berry bushes, fruit trees, mushrooms, red toxic mushrooms, water, toxic water, herbs, wood, stone), add hazards (thorns, mud, wasps, snakes, rockfall, leeches) or obstacles, spawn creatures. Place it relative to named creatures or compass directions. "why" says what it would test, in one sentence.`;

let client: Anthropic | null = null;
const getClient = () => {
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  // The observer writes longer, considered output than an agent turn; give it more time.
  return (client ??= new Anthropic({ timeout: 45000, maxRetries: 0, ...(workspace ? { defaultHeaders: { 'anthropic-workspace-id': workspace } } : {}) }));
};

/** Keeps only insights grounded in supplied moments (unknown ids are dropped) and bounds all text. */
export function sanitizeObservation(out: Out, knownIds: Set<string>): Omit<ObserveResponse, 'model'> {
  const insights = out.insights.slice(0, 3).map((i) => ({
    kind: i.kind,
    headline: i.headline.slice(0, 120),
    detail: i.detail.slice(0, 320),
    momentIds: i.momentIds.filter((id) => knownIds.has(id)).slice(0, 6),
  }))
    .filter((i) => i.headline.trim() && (i.momentIds.length > 0 || i.kind !== 'pattern'));
  const s = out.suggestion;
  return { insights, suggestion: s && s.command.trim() ? { command: s.command.slice(0, 200), why: s.why.slice(0, 200) } : null };
}

export async function observe(req: ObserveRequest): Promise<ObserveResponse> {
  const model = observerModel();
  const response = await getClient().messages.parse({
    model,
    max_tokens: 4000,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: model.includes('haiku') ? { format: zodOutputFormat(LlmOutput) } : { effort: 'low', format: zodOutputFormat(LlmOutput) },
    messages: [{ role: 'user', content: `Current run:\n${JSON.stringify(req.current)}\n\nRecorded moments (oldest first):\n${JSON.stringify(req.moments)}\n\nEarlier runs (newest first):\n${JSON.stringify(req.previous)}${PILOT ? `\n\nTeam pilot runs (recorded notes, n=1 per condition; cite as comparison, no moment ids):\n${PILOT}` : ''}` }],
  });
  if (response.stop_reason === 'refusal') throw new Error('model refused');
  if (response.stop_reason === 'max_tokens') throw new Error('observer output truncated');
  const out = response.parsed_output;
  if (!out) throw new Error('no structured output');
  return { ...sanitizeObservation(out, new Set(req.moments.map((m) => m.id))), model };
}
