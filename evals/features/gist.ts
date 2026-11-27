import type {StoredBriefItem} from '../../server/briefService.ts';
import {readJson, spread} from '../lib/data.ts';
import {pMap, runCase, openHelper} from '../lib/harness.ts';
import {excerpt, pct} from '../lib/stats.ts';
import type {Feature, FeatureResult} from '../lib/types.ts';
import {containsNorm, norm, tokenOverlap} from '../scorers/text.ts';
import {serviceWith} from './dlpt.ts';

export interface GistPassage {
  id: string;
  language: 'es' | 'pt';
  transcript: string;
  orientationLine: string;
}

export interface Planted {
  type: 'addition' | 'distortion' | 'omission';
  span?: string;
  sourceSentence?: string;
  keyTerms?: string[];
}

export interface GistSummary {
  id: string;
  passageId: string;
  summary: string;
  planted: Planted[];
}

export function gistItem(p: GistPassage): StoredBriefItem {
  return {
    id: p.id,
    title: p.id,
    sourceName: 'LinguaForge eval passage (original, CC0)',
    sourceUrl: 'https://example.invalid/eval',
    mediaType: 'audio',
    language: p.language,
    dialectId: p.language === 'es' ? 'neutral_latam' : 'br_standard',
    publishedAt: '2026-01-01T00:00:00.000Z',
    ilrLevel: '2',
    topic: 'society',
    orientationLine: p.orientationLine,
    summary: p.transcript.split('. ')[0] ?? p.id,
    matchingDomains: [],
    estimatedMinutes: 1,
    lengthLabel: '~1 min audio',
    studyExcerpt: p.transcript,
    transcript: p.transcript,
    keyVocabulary: [],
    drillable: true,
  };
}

/** A returned learnerSpan "hits" a planted span when they share most tokens or one contains the other. */
export function spanHits(returned: string, planted: string): boolean {
  if (!returned.trim() || !planted.trim()) return false;
  return (
    containsNorm(returned, planted) ||
    containsNorm(planted, returned) ||
    (tokenOverlap(planted, returned) >= 0.6 && tokenOverlap(returned, planted) >= 0.4)
  );
}

export function omissionHits(f: {description: string; sourceQuote: string}, p: Planted): boolean {
  const sentence = p.sourceSentence ?? '';
  if (sentence && (tokenOverlap(sentence, f.sourceQuote) >= 0.5 || tokenOverlap(f.sourceQuote, sentence) >= 0.6))
    return true;
  const hay = norm(`${f.description} ${f.sourceQuote}`);
  return (p.keyTerms ?? []).some((k) => hay.includes(norm(k)));
}

export const gist: Feature = {
  id: 'gist',
  title: '5. Gist grading (planted additions/omissions/distortions)',
  plan: (opts) => [
    {
      label: 'gist grade per learner summary',
      role: 'standard',
      calls: spread(readJson<{summaries: GistSummary[]}>('gist_cases.json').summaries, opts.sample).length,
      avgInTokens: 1500,
      avgOutTokens: 900,
    },
  ],
  async run(rt, opts): Promise<FeatureResult> {
    const data = readJson<{passages: GistPassage[]; summaries: GistSummary[]}>('gist_cases.json');
    const summaries = spread(data.summaries, opts.sample);
    const svc = serviceWith(data.passages.map(gistItem));
    const passageById = new Map(data.passages.map((p) => [p.id, p]));

    const tally = {
      addition: {planted: 0, caught: 0, caughtAny: 0},
      distortion: {planted: 0, caught: 0, caughtAny: 0},
      omission: {planted: 0, caught: 0, caughtAny: 0},
      falseAlarms: 0,
      flagged: 0,
      faithful: 0,
      faithfulFlagged: 0,
      spanInvalid: 0,
      spans: 0,
      quoteInvalid: 0,
      quotes: 0,
    };
    const missed: string[] = [];
    const falseAlarmExamples: string[] = [];

    const cases = await pMap(summaries, opts.concurrency, (s) =>
      runCase(
        s.id,
        `${s.passageId} · planted: ${s.planted.map((p) => p.type).join(', ') || 'none (faithful)'}`,
        async () => {
          const passage = passageById.get(s.passageId)!;
          const h = openHelper(rt, {feature: 'gist', itemId: s.id});
          const result = await svc.gradeGist(s.passageId, s.summary, h.generate);
          const adds = result.additions;
          const dists = result.distortions;
          const oms = result.omissions;
          const checks = [];

          const plantedSpans = s.planted.filter((p) => p.type !== 'omission' && p.span).map((p) => p.span!);
          for (const p of s.planted) {
            if (p.type === 'omission') {
              tally.omission.planted++;
              const hit = oms.some((o) => omissionHits(o, p));
              if (hit) {
                tally.omission.caught++;
                tally.omission.caughtAny++;
              } else missed.push(`${s.id} omission not reported: "${excerpt(p.sourceSentence ?? '', 90)}"`);
              checks.push({
                id: 'omission_detected',
                passed: hit,
                detail: hit ? undefined : `planted omission not listed: "${excerpt(p.sourceSentence ?? '', 80)}"`,
              });
              continue;
            }
            const bucket = tally[p.type];
            bucket.planted++;
            const inType = (p.type === 'addition' ? adds : dists).some((f) => spanHits(f.learnerSpan ?? '', p.span!));
            const inAny = [...adds, ...dists].some((f) => spanHits(f.learnerSpan ?? '', p.span!));
            if (inType) bucket.caught++;
            if (inAny) bucket.caughtAny++;
            if (!inType)
              missed.push(
                `${s.id} ${p.type} not flagged as ${p.type}: "${excerpt(p.span!, 90)}"${inAny ? ' (flagged under the other category)' : ''}`
              );
            checks.push({
              id: `${p.type}_detected`,
              passed: inType,
              detail: inType
                ? undefined
                : `planted ${p.type} "${excerpt(p.span!, 80)}" ${inAny ? 'was flagged but in the wrong category' : 'was not flagged'}`,
            });
          }

          // False alarms: flagged additions/distortions that do not overlap any planted span.
          const alarms = [...adds, ...dists].filter(
            (f) => !plantedSpans.some((sp) => spanHits(f.learnerSpan ?? '', sp))
          );
          tally.flagged += adds.length + dists.length;
          tally.falseAlarms += alarms.length;
          if (s.planted.length === 0) {
            tally.faithful++;
            if (alarms.length) tally.faithfulFlagged++;
          }
          for (const a of alarms.slice(0, 2))
            falseAlarmExamples.push(`${s.id}: flagged "${excerpt(a.learnerSpan ?? a.description, 90)}"`);
          checks.push({
            id: 'no_false_alarms',
            passed: alarms.length === 0,
            detail: alarms.length
              ? `unplanted flags: ${alarms.map((a) => `"${excerpt(a.learnerSpan ?? a.description, 70)}"`).join('; ')}`
              : undefined,
          });

          // Grounding of what the grader returned.
          for (const f of [...adds, ...dists]) {
            tally.spans++;
            if (f.learnerSpan && !containsNorm(s.summary, f.learnerSpan)) tally.spanInvalid++;
          }
          for (const f of [...adds, ...dists, ...oms]) {
            tally.quotes++;
            if (f.sourceQuote && !containsNorm(passage.transcript, f.sourceQuote)) tally.quoteInvalid++;
          }
          const ungrounded = [...adds, ...dists].filter(
            (f) => f.learnerSpan && !containsNorm(s.summary, f.learnerSpan)
          );
          checks.push({
            id: 'spans_verbatim',
            passed: ungrounded.length === 0,
            detail: ungrounded.length
              ? `learnerSpan not found in summary: "${excerpt(ungrounded[0].learnerSpan ?? '', 70)}"`
              : undefined,
          });
          return {checks, example: `${s.id}: "${excerpt(s.summary, 130)}"`};
        }
      )
    );

    const addRate = tally.addition.planted ? tally.addition.caught / tally.addition.planted : 0;
    const planted = tally.addition.planted + tally.distortion.planted + tally.omission.planted;
    const caught = tally.addition.caught + tally.distortion.caught + tally.omission.caught;
    const alarmRate = tally.flagged ? tally.falseAlarms / tally.flagged : 0;
    return {
      id: 'gist',
      title: gist.title,
      cases,
      metrics: [
        {
          label: 'Additions caught (as additions)',
          value: `${tally.addition.caught}/${tally.addition.planted} (${pct(tally.addition.caught, tally.addition.planted)})`,
        },
        {label: 'Additions caught in any category', value: `${tally.addition.caughtAny}/${tally.addition.planted}`},
        {
          label: 'Distortions caught (as distortions)',
          value: `${tally.distortion.caught}/${tally.distortion.planted} (${pct(tally.distortion.caught, tally.distortion.planted)})`,
        },
        {
          label: 'Omissions caught',
          value: `${tally.omission.caught}/${tally.omission.planted} (${pct(tally.omission.caught, tally.omission.planted)})`,
        },
        {label: 'Overall detection', value: `${caught}/${planted} (${pct(caught, planted)})`},
        {
          label: 'False alarms (unplanted addition/distortion flags)',
          value: `${tally.falseAlarms} of ${tally.flagged} flags (${pct(tally.falseAlarms, tally.flagged)})`,
        },
        {label: 'Faithful summaries wrongly flagged', value: `${tally.faithfulFlagged}/${tally.faithful}`},
        {
          label: 'Fabricated learnerSpan / sourceQuote',
          value: `${tally.spanInvalid}/${tally.spans} spans, ${tally.quoteInvalid}/${tally.quotes} quotes not verbatim`,
        },
      ],
      thresholds: [
        {
          label: 'Additions caught >= 90%',
          passed: tally.addition.planted > 0 && addRate >= 0.9,
          detail: pct(tally.addition.caught, tally.addition.planted),
        },
        {
          label: 'False-alarm share of flags <= 15%',
          passed: alarmRate <= 0.15,
          detail: pct(tally.falseAlarms, tally.flagged),
        },
        {
          label: 'No faithful summary flagged',
          passed: tally.faithfulFlagged === 0,
          detail: `${tally.faithfulFlagged}/${tally.faithful}`,
        },
      ],
      nativeReview: [],
      notes: [
        'Planted errors are marked by exact span in evals/data/gist_cases.json; every other claim in each summary was written to be supported by the transcript, so unplanted flags count as false alarms.',
        'A flag matches a planted span by token overlap on learnerSpan; omissions match on the quoted source sentence or key terms. "Caught as" requires the right category.',
      ],
      extraMarkdown: [
        missed.length ? `#### Missed plants\n\n${missed.map((m) => `- ${m}`).join('\n')}` : '',
        falseAlarmExamples.length ? `\n#### False alarms\n\n${falseAlarmExamples.map((m) => `- ${m}`).join('\n')}` : '',
      ].join('\n'),
    };
  },
};
