import {ERROR_TAXONOMY_MAP, normalizeErrorTaxonomyKey} from '../../src/data/errorTaxonomy.ts';
import {readJson, spread} from '../lib/data.ts';
import {okJson, pMap, runCase, withApi} from '../lib/harness.ts';
import {arr, str} from '../lib/judge.ts';
import {excerpt, pct} from '../lib/stats.ts';
import type {Feature, FeatureResult} from '../lib/types.ts';
import {tokenOverlap} from '../scorers/text.ts';

interface Sentence {
  id: string;
  language: 'es' | 'pt';
  dialect: string;
  examinerPrompt: string;
  sentence: string;
  expected: string[];
  note: string;
}

export const errorTaxonomy: Feature = {
  id: 'error_taxonomy',
  title: '7. Error taxonomy mapping (30 labeled learner sentences)',
  plan: (opts) => [
    {
      label: 'debrief/analyze per sentence',
      role: 'standard',
      calls: spread(readJson<Sentence[]>('taxonomy_sentences.json'), opts.sample).length,
      avgInTokens: 2600,
      avgOutTokens: 1800,
    },
  ],
  async run(rt, opts): Promise<FeatureResult> {
    const items = spread(readJson<Sentence[]>('taxonomy_sentences.json'), opts.sample);
    const confusion: string[] = [];
    const t = {
      withError: 0,
      hit: 0,
      clean: 0,
      cleanFlagged: 0,
      returned: 0,
      spurious: 0,
      rawKeys: 0,
      rawInvalid: 0,
      languageMismatch: 0,
    };
    const invalid: string[] = [];

    const cases = await pMap(items, opts.concurrency, (s) =>
      runCase(s.id, `${s.language} expects ${s.expected.join('|') || 'no error'}`, () =>
        withApi(rt, {feature: 'error_taxonomy', itemId: s.id}, async (api) => {
          const messages = [
            {role: 'examiner', text: s.examinerPrompt, elapsedSeconds: 0},
            {role: 'candidate', text: s.sentence, elapsedSeconds: 20},
          ];
          const res = okJson(
            await api.post('/api/debrief/analyze', {
              language: s.language,
              dialect: s.dialect,
              sessionType: 'opi',
              messages,
            }),
            'debrief/analyze'
          );
          const returned = (res.errors ?? []) as {key: string; wrong: string; quote: string}[];
          const raw = arr(api.records[0]?.raw.errors).map((e) => e as Record<string, unknown>);
          const rawBad = raw.filter((e) => normalizeErrorTaxonomyKey(e.key, s.language) === null);
          t.rawKeys += raw.length;
          t.rawInvalid += rawBad.length;
          for (const b of rawBad) invalid.push(`${s.id}: model emitted "${str(b.key)}" (dropped by server)`);

          // Errors that point at this sentence (the transcript contains only this learner line).
          const mine = returned.filter(
            (e) => tokenOverlap(e.quote || e.wrong, s.sentence) >= 0.3 || tokenOverlap(e.wrong, s.sentence) >= 0.5
          );
          const keys = [...new Set(mine.map((e) => e.key))];
          t.returned += mine.length;
          if (s.expected.length === 0) {
            t.clean++;
            if (mine.length > 0) t.cleanFlagged++;
            return {
              checks: [
                {
                  id: 'clean_sentence_not_flagged',
                  passed: mine.length === 0,
                  detail: mine.length ? `flagged as ${keys.join(', ')}: "${excerpt(mine[0].wrong, 70)}"` : undefined,
                },
                {
                  id: 'keys_valid',
                  passed: rawBad.length === 0,
                  detail: rawBad.length ? `invalid keys: ${rawBad.map((b) => str(b.key)).join(', ')}` : undefined,
                },
              ],
              example: `${s.id}: "${s.sentence}" flagged ${keys.join(', ')}`,
            };
          }
          t.withError++;
          const hit = keys.some((k) => s.expected.includes(k));
          if (hit) t.hit++;
          const spurious = mine.filter((e) => !s.expected.includes(e.key));
          t.spurious += spurious.length;
          confusion.push(
            `| ${s.id} | ${s.expected.join(', ')} | ${keys.join(', ') || '—'} | ${hit ? 'hit' : '**miss**'} |`
          );
          const wrongLang = mine.filter(
            (e) =>
              ERROR_TAXONOMY_MAP[e.key as keyof typeof ERROR_TAXONOMY_MAP]?.language !== 'both' &&
              ERROR_TAXONOMY_MAP[e.key as keyof typeof ERROR_TAXONOMY_MAP]?.language !== s.language
          );
          t.languageMismatch += wrongLang.length;
          return {
            checks: [
              {
                id: 'expected_key_returned',
                passed: hit,
                detail: hit
                  ? undefined
                  : `expected ${s.expected.join(' or ')}, got ${keys.join(', ') || 'no error for this sentence'}`,
              },
              {
                id: 'no_unrelated_keys',
                passed:
                  spurious.length === 0 ||
                  (hit &&
                    spurious.every(
                      (e) =>
                        !['grammar', 'register'].includes(
                          ERROR_TAXONOMY_MAP[e.key as keyof typeof ERROR_TAXONOMY_MAP]?.category
                        )
                    )),
                detail: spurious.length ? `also returned: ${spurious.map((e) => e.key).join(', ')}` : undefined,
              },
              {
                id: 'keys_valid',
                passed: rawBad.length === 0,
                detail: rawBad.length ? `invalid keys: ${rawBad.map((b) => str(b.key)).join(', ')}` : undefined,
              },
            ],
            example: `${s.id}: "${s.sentence}" expected ${s.expected.join('|')}, got ${keys.join(', ') || 'none'}`,
          };
        })
      )
    );

    return {
      id: 'error_taxonomy',
      title: errorTaxonomy.title,
      cases,
      metrics: [
        {
          label: 'Sentences with an error: expected key returned',
          value: `${t.hit}/${t.withError} (${pct(t.hit, t.withError)})`,
        },
        {label: 'Clean sentences wrongly flagged', value: `${t.cleanFlagged}/${t.clean}`},
        {
          label: 'Returned errors with an unexpected key',
          value: `${t.spurious}/${t.returned} (${pct(t.spurious, t.returned)})`,
        },
        {label: 'Keys the model invented (dropped by the server)', value: `${t.rawInvalid}/${t.rawKeys}`},
      ],
      thresholds: [
        {
          label: 'Expected key returned >= 80%',
          passed: t.withError > 0 && t.hit / t.withError >= 0.8,
          detail: pct(t.hit, t.withError),
        },
        {label: 'No clean sentence flagged', passed: t.cleanFlagged === 0, detail: `${t.cleanFlagged}/${t.clean}`},
        {label: 'No invented keys', passed: t.rawInvalid === 0, detail: `${t.rawInvalid}`},
      ],
      nativeReview: [],
      notes: [
        'Each labeled sentence is graded alone through the production /api/debrief/analyze path (one learner turn). Raw model keys are captured before server sanitising so invented keys are visible.',
        'Labels are single-answer by construction; a sentence containing a second incidental slip would count the extra key as unrelated, so sentences were written with one clear error each. Labels for t26 and t27 (register) depend on the stated context and merit a native check.',
      ],
      extraMarkdown: [
        `#### Expected vs returned\n\n| id | expected | returned | |\n|---|---|---|---|\n${confusion.join('\n')}`,
        invalid.length ? `\n#### Invented keys\n\n${invalid.map((i) => `- ${i}`).join('\n')}` : '',
      ].join('\n'),
    };
  },
};
