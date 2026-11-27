import {loadOpiTranscripts, spread, type OpiTranscript} from '../lib/data.ts';
import {okJson, pMap, runCase, withApi} from '../lib/harness.ts';
import {collectStrings, excerpt, pct} from '../lib/stats.ts';
import type {Feature, FeatureResult} from '../lib/types.ts';
import {containsNorm, militaryTerms} from '../scorers/text.ts';

const ORDER = ['0+', '1', '1+', '2', '2+', '3'];
const rank = (r: string): number => ORDER.indexOf(String(r).trim());

export const opiRating: Feature = {
  id: 'opi_rating',
  title: '1. OPI rating (debrief path)',
  plan: (opts) => [
    {
      label: 'debrief/analyze per transcript',
      role: 'standard',
      calls: spread(loadOpiTranscripts(), opts.sample).length,
      avgInTokens: 5500,
      avgOutTokens: 2200,
    },
  ],
  async run(rt, opts): Promise<FeatureResult> {
    const items = spread(loadOpiTranscripts(), opts.sample);
    const detail: {t: OpiTranscript; got: string; rationale: string; military: string[]; candidateRaised: string[]}[] =
      [];

    const cases = await pMap(items, opts.concurrency, (t) =>
      runCase(t.id, `${t.language} expected ${t.expected}${t.tags.length ? ` (${t.tags.join(', ')})` : ''}`, () =>
        withApi(rt, {feature: 'opi_rating', itemId: t.id}, async (api) => {
          const messages = t.turns.map((turn, i) => ({role: turn.role, text: turn.text, elapsedSeconds: i * 35}));
          const res = okJson(
            await api.post('/api/debrief/analyze', {
              language: t.language,
              dialect: t.dialect,
              sessionType: 'opi',
              messages,
            }),
            'debrief/analyze'
          );
          const got = String(res.estimatedIlr);
          const transcriptText = t.turns.map((x) => x.text).join('\n');
          const outputText = collectStrings({...res, generatedAt: undefined}).join('\n');
          const outTerms = militaryTerms(outputText);
          const inTerms = new Set(militaryTerms(transcriptText));
          const injected = outTerms.filter((x) => !inTerms.has(x));
          const raised = outTerms.filter((x) => inTerms.has(x));
          detail.push({
            t,
            got,
            rationale: String(res.oneLineRationale ?? ''),
            military: injected,
            candidateRaised: raised,
          });

          const cm = res.ceilingMoment as {candidateUtterance?: string; problemSpan?: string} | undefined;
          const candidateText = t.turns
            .filter((x) => x.role === 'candidate')
            .map((x) => x.text)
            .join('\n');
          const groundedQuote = !cm?.candidateUtterance || containsNorm(candidateText, cm.candidateUtterance);
          const groundedSpan =
            !cm?.problemSpan || !cm.candidateUtterance || containsNorm(cm.candidateUtterance, cm.problemSpan);
          const diff = Math.abs(rank(got) - rank(t.expected));
          return {
            checks: [
              {
                id: 'rating_exact',
                passed: diff === 0,
                detail: `expected ${t.expected}, got ${got} (${diff} step(s) ${rank(got) > rank(t.expected) ? 'high' : 'low'})`,
              },
              {
                id: 'no_military_injected',
                passed: injected.length === 0,
                detail: injected.length ? `debrief introduced: ${injected.join(', ')}` : undefined,
              },
              {
                id: 'ceiling_quote_grounded',
                passed: groundedQuote && groundedSpan,
                detail: groundedQuote
                  ? 'problemSpan not inside candidateUtterance'
                  : `ceiling quote not found in transcript: "${excerpt(cm?.candidateUtterance ?? '', 80)}"`,
              },
            ],
            example: `${t.id}: expected ${t.expected}, got ${got}. ${excerpt(String(res.oneLineRationale ?? ''), 140)}`,
          };
        })
      )
    );

    const run = detail;
    const n = run.length;
    const steps = run.map((d) => Math.abs(rank(d.got) - rank(d.t.expected)));
    const exact = steps.filter((s) => s === 0).length;
    const off1 = steps.filter((s) => s === 1).length;
    const off2 = steps.filter((s) => s === 2).length;
    const off3 = steps.filter((s) => s >= 3).length;
    const over = run.filter((d) => rank(d.got) > rank(d.t.expected)).length;
    const under = run.filter((d) => rank(d.got) < rank(d.t.expected)).length;
    const militaryFlags = run.filter((d) => d.military.length > 0);

    const levels = ['1', '1+', '2', '2+', '3'];
    const matrix = [
      `| expected \\ got | ${[...ORDER].join(' | ')} |`,
      `|---|${ORDER.map(() => '---').join('|')}|`,
      ...levels.map(
        (e) =>
          `| **${e}** | ${ORDER.map((g) => run.filter((d) => d.t.expected === e && d.got === g).length || '·').join(' | ')} |`
      ),
    ].join('\n');
    const misses = run
      .filter((d) => d.got !== d.t.expected)
      .sort((a, b) => Math.abs(rank(b.got) - rank(b.t.expected)) - Math.abs(rank(a.got) - rank(a.t.expected)))
      .map(
        (d) =>
          `| ${d.t.id} | ${d.t.expected} | ${d.got} | ${d.t.tags.join(', ') || '—'} | ${excerpt(d.rationale, 110).replace(/\|/g, '/')} |`
      );
    const tricky = run.filter((d) => d.t.tags.length > 0);

    return {
      id: 'opi_rating',
      title: opiRating.title,
      cases,
      metrics: [
        {label: 'Exact agreement', value: `${exact}/${n} (${pct(exact, n)})`},
        {label: 'Off by one step', value: `${off1}/${n} (${pct(off1, n)})`},
        {label: 'Off by two steps', value: `${off2}/${n} (${pct(off2, n)})`},
        {label: 'Off by three or more', value: `${off3}/${n}`},
        {label: 'Over-rated / under-rated', value: `${over} / ${under}`},
        {label: 'Tricky cases exact', value: `${tricky.filter((d) => d.got === d.t.expected).length}/${tricky.length}`},
        {label: 'Debriefs injecting military/domain content', value: `${militaryFlags.length}/${n}`},
      ],
      thresholds: [
        {label: 'Exact agreement >= 60%', passed: n > 0 && exact / n >= 0.6, detail: pct(exact, n)},
        {label: 'Within one step >= 90%', passed: n > 0 && (exact + off1) / n >= 0.9, detail: pct(exact + off1, n)},
        {
          label: 'No debrief introduces military/domain content',
          passed: militaryFlags.length === 0,
          detail: `${militaryFlags.length} flagged`,
        },
      ],
      nativeReview: [],
      notes: [
        'Expected levels are the author\'s judgment of each scripted transcript (see rationale lines in evals/data/opi_transcripts_*.txt); a certified rater should confirm the two "tricky" 2/2+ boundary cases (es-08, es-12).',
        'Rating comes from the production path: the model returns floorLevel/levelFunctions and calculateOpiRating() derives the displayed level. Military terms already present in the candidate transcript are not flagged (es-14).',
      ],
      extraMarkdown: [
        '#### Confusion matrix',
        '',
        matrix,
        '',
        misses.length
          ? '#### Misses (worst first)\n\n| id | expected | got | tags | model rationale |\n|---|---|---|---|---|\n' +
            misses.join('\n')
          : '',
        militaryFlags.length
          ? '\n#### Military/domain content introduced by the debrief\n\n' +
            militaryFlags.map((d) => `- ${d.t.id}: ${d.military.join(', ')}`).join('\n')
          : '',
        run.some((d) => d.candidateRaised.length)
          ? '\n_Candidate-raised terms (not flagged):_ ' +
            run
              .filter((d) => d.candidateRaised.length)
              .map((d) => `${d.t.id}: ${d.candidateRaised.join(', ')}`)
              .join('; ')
          : '',
      ].join('\n'),
    };
  },
};
