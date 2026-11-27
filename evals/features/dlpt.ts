import {BriefService, type StoredBriefItem} from '../../server/briefService.ts';
import {readJson, spread} from '../lib/data.ts';
import {BudgetExceededError} from '../lib/llm.ts';
import {openHelper, pMap, runCase} from '../lib/harness.ts';
import {ask, arr, bool, num, str, Type} from '../lib/judge.ts';
import {excerpt, pct} from '../lib/stats.ts';
import type {CaseResult, Feature, FeatureResult} from '../lib/types.ts';

export interface DlptPassage {
  id: string;
  language: 'es' | 'pt';
  level: '2' | '2+' | '3';
  title: string;
  text: string;
}

const LETTERS = ['A', 'B', 'C', 'D'] as const;

export function buildItem(p: DlptPassage, mediaType: 'text' | 'audio' = 'text'): StoredBriefItem {
  return {
    id: p.id,
    title: p.title,
    sourceName: 'LinguaForge eval passage (original, CC0)',
    sourceUrl: 'https://example.invalid/eval',
    mediaType,
    language: p.language,
    dialectId: p.language === 'es' ? 'neutral_latam' : 'br_standard',
    publishedAt: '2026-01-01T00:00:00.000Z',
    ilrLevel: p.level,
    topic: 'society',
    orientationLine: `This passage is from a ${p.language === 'es' ? 'Spanish' : 'Portuguese'} local news item.`,
    summary: p.text.split('. ')[0] ?? p.title,
    matchingDomains: [],
    estimatedMinutes: 2,
    lengthLabel: '~1 min read',
    studyExcerpt: p.text,
    rawContent: mediaType === 'text' ? p.text : undefined,
    transcript: mediaType === 'audio' ? p.text : undefined,
    keyVocabulary: [],
    drillable: true,
  };
}

export function serviceWith(items: StoredBriefItem[]): BriefService {
  const svc = new BriefService();
  const cache = (svc as unknown as {cache: Map<string, StoredBriefItem>}).cache;
  for (const item of items) cache.set(item.id, item);
  return svc;
}

const letterOf = (v: unknown): number =>
  LETTERS.indexOf(str(v).trim().toUpperCase().charAt(0) as (typeof LETTERS)[number]);

export const dlpt: Feature = {
  id: 'dlpt',
  title: '4. DLPT item generation',
  plan: (opts) => {
    const n = spread(readJson<DlptPassage[]>('dlpt_passages.json'), opts.sample).length;
    const q = Math.round(n * 4.5);
    return [
      {label: 'item generation per passage', role: 'standard', calls: n, avgInTokens: 1300, avgOutTokens: 2600},
      {label: 'blind answerer per question', role: 'chat', calls: q, avgInTokens: 700, avgOutTokens: 350},
      {label: 'no-passage guesser per question', role: 'chat', calls: q, avgInTokens: 250, avgOutTokens: 200},
      {label: 'trap-tag judge per passage', role: 'chat', calls: n, avgInTokens: 2400, avgOutTokens: 1400},
    ];
  },
  async run(rt, opts): Promise<FeatureResult> {
    const passages = spread(readJson<DlptPassage[]>('dlpt_passages.json'), opts.sample);
    const svc = serviceWith(passages.map((p) => buildItem(p)));
    const cases: CaseResult[] = [];
    const stats = {
      generated: 0,
      rawItems: 0,
      passagesFailed: 0,
      disagree: 0,
      multi: 0,
      tagWrong: 0,
      tagChoices: 0,
      tagBad: 0,
      certainGuess: 0,
      guessRight: 0,
      guesses: 0,
      partlyKey: 0,
    };
    const examples: string[] = [];

    await pMap(passages, Math.min(opts.concurrency, 4), async (p) => {
      const gen = openHelper(rt, {feature: 'dlpt', itemId: p.id});
      let drill;
      try {
        drill = await svc.generateDrill(p.id, gen.generate);
      } catch (err) {
        if (err instanceof BudgetExceededError) {
          cases.push({id: `${p.id}#gen`, label: `${p.id} generation`, checks: [], notRun: err.message});
          return;
        }
        stats.passagesFailed++;
        cases.push({
          id: `${p.id}#gen`,
          label: `${p.id} generation`,
          checks: [{id: 'generation_valid', passed: false, detail: err instanceof Error ? err.message : String(err)}],
        });
        return;
      }
      const rawQs = arr(gen.records[0]?.raw.questions);
      stats.rawItems += rawQs.length;
      stats.generated += drill.questions.length;
      const rejected = rawQs.length - drill.questions.length;

      // One blind trap-tag judgement for the whole passage.
      let tagVerdict = new Map<string, {best: string; acceptable: boolean}>();
      try {
        const judgeGen = openHelper(rt, {feature: 'dlpt', itemId: `${p.id}:tags`});
        const listing = drill.questions
          .map(
            (q, qi) =>
              `Q${qi + 1}: ${q.question}\n  Correct answer: ${LETTERS[q.correctIndex]}) ${q.options[q.correctIndex]}\n` +
              (q.choices ?? [])
                .filter((c) => !c.isCorrect)
                .map((c) => `  ${c.label}) ${c.text} — claimed trap tag: ${c.trapType}`)
                .join('\n')
          )
          .join('\n\n');
        const res = await ask(judgeGen.generate, {
          role: 'judge',
          system: 'You are an expert DLPT item reviewer. Return JSON only.',
          contents: `Passage (${p.language === 'es' ? 'Spanish' : 'Portuguese'}):\n${p.text}\n\nTrap tag definitions:\n- mentioned_not_answer: repeats words from the passage but answers a different question\n- not_in_passage: introduces information that never appears in the passage\n- true_not_answer: is stated in the passage and true, but does not answer the question asked\n- wrong_detail: distorts a number, actor, cause, place or polarity that the passage states\n- over_inference: stretches beyond what the passage supports (extreme or unsupported conclusion)\n\nFor EVERY wrong choice below, decide which single tag fits best and whether the CLAIMED tag is an acceptable description of why the choice is wrong.\n\n${listing}`,
          schema: {
            type: Type.OBJECT,
            properties: {
              choices: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    question: {type: Type.INTEGER},
                    label: {type: Type.STRING},
                    bestTag: {type: Type.STRING},
                    claimedTagAcceptable: {type: Type.BOOLEAN},
                  },
                  required: ['question', 'label', 'bestTag', 'claimedTagAcceptable'],
                },
              },
            },
            required: ['choices'],
          },
        });
        tagVerdict = new Map(
          arr(res.choices).map((c) => {
            const r = c as Record<string, unknown>;
            return [
              `${num(r.question)}:${str(r.label).toUpperCase()}`,
              {best: str(r.bestTag), acceptable: bool(r.claimedTagAcceptable)},
            ] as const;
          })
        );
      } catch (err) {
        if (!(err instanceof BudgetExceededError)) throw err;
      }

      const questionCases = await Promise.all(
        drill.questions.map((q, qi) =>
          runCase(`${p.id}#q${qi + 1}`, `${p.id} Q${qi + 1} (${q.questionType ?? 'n/a'})`, async () => {
            const a = openHelper(rt, {feature: 'dlpt', itemId: `${p.id}:q${qi}:answer`});
            const g = openHelper(rt, {feature: 'dlpt', itemId: `${p.id}:q${qi}:guess`});
            const optionsText = q.options.map((o, i) => `${LETTERS[i]}) ${o}`).join('\n');
            const schemaVerdicts = {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {choice: {type: Type.STRING}, status: {type: Type.STRING}},
                required: ['choice', 'status'],
              },
            };
            const answer = await ask(a.generate, {
              role: 'judge',
              system: 'You are a test-taker with only the passage. Answer strictly from the passage. Return JSON only.',
              contents: `Passage:\n${p.text}\n\nQuestion: ${q.question}\n${optionsText}\n\nGive the single best answer letter. Then for EACH choice give status: "fully_supported" (the passage clearly supports it as an answer to this question), "partly_supported" (arguable), "unsupported", or "contradicted".`,
              schema: {
                type: Type.OBJECT,
                properties: {answer: {type: Type.STRING}, verdicts: schemaVerdicts},
                required: ['answer', 'verdicts'],
              },
            });
            const guess = await ask(g.generate, {
              role: 'judge',
              system:
                'You answer multiple-choice reading questions WITHOUT access to the passage, using only test-taking skill and world knowledge. Return JSON only.',
              contents: `You cannot see the passage. Question: ${q.question}\n${optionsText}\n\nPick the most likely answer. confidence: "guess" (no real basis), "plausible", or "certain" (the answer is inferable from the wording or common knowledge alone).`,
              schema: {
                type: Type.OBJECT,
                properties: {answer: {type: Type.STRING}, confidence: {type: Type.STRING}},
                required: ['answer', 'confidence'],
              },
            });

            const answered = letterOf(answer.answer);
            const verdicts = arr(answer.verdicts).map((v) => v as Record<string, unknown>);
            const fully = verdicts
              .filter((v) => str(v.status) === 'fully_supported')
              .map((v) => str(v.choice).toUpperCase().charAt(0));
            const partlyKey =
              verdicts.find((v) => str(v.choice).toUpperCase().startsWith(LETTERS[q.correctIndex]))?.status ===
              'partly_supported';
            const guessIdx = letterOf(guess.answer);
            const guessCertainRight = guessIdx === q.correctIndex && str(guess.confidence) === 'certain';
            stats.guesses++;
            if (guessIdx === q.correctIndex) stats.guessRight++;
            if (guessCertainRight) stats.certainGuess++;

            const wrong = (q.choices ?? []).filter((c) => !c.isCorrect);
            const tagIssues: string[] = [];
            for (const c of wrong) {
              const v = tagVerdict.get(`${qi + 1}:${c.label}`);
              stats.tagChoices++;
              if (v && !v.acceptable) {
                stats.tagBad++;
                tagIssues.push(`${c.label} tagged ${c.trapType}, judge says ${v.best}`);
              }
            }
            const agrees = answered === q.correctIndex;
            const single = fully.length <= 1;
            if (!agrees) stats.disagree++;
            if (!single) stats.multi++;
            if (partlyKey) stats.partlyKey++;
            if (tagIssues.length) stats.tagWrong++;
            if (!agrees || !single || tagIssues.length || guessCertainRight) {
              examples.push(
                `${p.id} Q${qi + 1} "${excerpt(q.question, 90)}" key=${LETTERS[q.correctIndex]}; answerer=${LETTERS[answered] ?? '?'}; fully supported=${fully.join(',') || 'none'}; ${tagIssues.join('; ')}${guessCertainRight ? '; guessable without passage' : ''}`
              );
            }
            return {
              checks: [
                {
                  id: 'answerer_agrees_with_key',
                  passed: agrees,
                  detail: agrees
                    ? undefined
                    : `key ${LETTERS[q.correctIndex]}, independent answer ${LETTERS[answered] ?? '?'}`,
                },
                {
                  id: 'single_defensible_answer',
                  passed: single,
                  detail: single ? undefined : `choices judged fully supported: ${fully.join(', ')}`,
                },
                {id: 'trap_tags_correct', passed: tagIssues.length === 0, detail: tagIssues.join('; ') || undefined},
                {
                  id: 'not_guessable_without_passage',
                  passed: !guessCertainRight,
                  detail: guessCertainRight ? 'blind guesser was "certain" and correct' : undefined,
                },
              ],
              example: `${p.id} Q${qi + 1}: ${excerpt(q.question, 120)} (key ${LETTERS[q.correctIndex]})`,
            };
          })
        )
      );
      cases.push(...questionCases);
      if (rejected > 0) {
        cases.push({
          id: `${p.id}#rejected`,
          label: `${p.id} items rejected by validateDlptQuestions`,
          checks: [
            {
              id: 'generator_items_valid',
              passed: false,
              detail: `${rejected} of ${rawQs.length} generated items were rejected server-side`,
            },
          ],
        });
      }
    });

    const run = cases.filter((c) => !c.notRun && c.id.includes('#q'));
    const bad = (id: string) => run.filter((c) => c.checks.find((k) => k.id === id && !k.passed)).length;
    return {
      id: 'dlpt',
      title: dlpt.title,
      cases: cases.sort((a, b) => a.id.localeCompare(b.id)),
      metrics: [
        {label: 'Passages / items generated (valid)', value: `${passages.length} / ${stats.generated}`},
        {
          label: 'Items rejected by server validator',
          value: `${stats.rawItems - stats.generated} of ${stats.rawItems} raw`,
        },
        {label: 'Independent answerer disagrees with key', value: `${bad('answerer_agrees_with_key')}/${run.length}`},
        {label: 'More than one choice defensible', value: `${bad('single_defensible_answer')}/${run.length}`},
        {label: 'Key only "partly supported" by answerer', value: `${stats.partlyKey}/${run.length}`},
        {
          label: 'Items with a wrong trap tag',
          value: `${bad('trap_tags_correct')}/${run.length} (${stats.tagBad}/${stats.tagChoices} choices)`,
        },
        {
          label: 'Guessable without the passage (certain + correct)',
          value: `${bad('not_guessable_without_passage')}/${run.length}`,
        },
        {
          label: 'Blind guesser accuracy (chance = 25%)',
          value: `${stats.guessRight}/${stats.guesses} (${pct(stats.guessRight, stats.guesses)})`,
        },
      ],
      thresholds: [
        {
          label: 'Independent answerer agrees with key >= 90%',
          passed: run.length > 0 && 1 - bad('answerer_agrees_with_key') / run.length >= 0.9,
          detail: pct(run.length - bad('answerer_agrees_with_key'), run.length),
        },
        {
          label: 'Single defensible answer >= 90%',
          passed: run.length > 0 && 1 - bad('single_defensible_answer') / run.length >= 0.9,
          detail: pct(run.length - bad('single_defensible_answer'), run.length),
        },
        {
          label: 'Blind guesser accuracy < 40%',
          passed: stats.guesses > 0 && stats.guessRight / stats.guesses < 0.4,
          detail: pct(stats.guessRight, stats.guesses),
        },
      ],
      nativeReview: [],
      notes: [
        'Passages are original (written for this suite), not real test items. Items are generated by the production BriefService.generateDrill and only items that survive the server validator are scored.',
        'The independent answerer, blind guesser and trap-tag judge use MODELS.chat, a different model from the MODELS.standard generator. "Defensible" = answerer marked the choice fully supported.',
      ],
      extraMarkdown: examples.length
        ? `#### Flagged items\n\n${examples
            .slice(0, 25)
            .map((e) => `- ${e}`)
            .join('\n')}`
        : '',
    };
  },
};
