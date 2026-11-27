import {getTutorById} from '../../src/data/tutors.ts';
import {readJson} from '../lib/data.ts';
import {okJson, openHelper, pMap, runCase, withApi} from '../lib/harness.ts';
import {ask, bool, str, Type} from '../lib/judge.ts';
import {excerpt, pct} from '../lib/stats.ts';
import type {CaseResult, Check, Feature, FeatureResult} from '../lib/types.ts';
import {DIALECTS, matches, slangDensity} from '../scorers/dialects.ts';
import {containsNorm, looksEnglish} from '../scorers/text.ts';

interface Conv {
  id: string;
  tutorId: string;
  slangLevel: 0 | 1 | 2 | 3 | 4;
  learnerTurns: string[];
  recast: {correct: string; note: string} | null;
  kind: 'recast' | 'slang0' | 'slang4' | 'lecture_bait';
}

const LECTURE_RE =
  /\b(se dice|se escribe|lo correcto es|la forma correcta|debes decir|deberías decir|no se dice|es incorrecto|está mal|gramática|conjug\w*|la regla|el error|corrección|o correto é|a forma correta|deveria dizer|deves dizer|não se diz|diz-se|a regra|gramática|the correct|you should say|you should use|mistake|grammar|actually,? it'?s)\b/i;
const EXAM_RE = /\b(ILR|puntaje|puntuación|score|rating|examen|exam|pontuação|nível ILR|floor|ceiling)\b/i;

interface ConvOutcome {
  replies: string[];
  caseResult: CaseResult;
  unsure: string[];
}

/** --sample N keeps the first ceil(N/5) tutors (all five conversations each) so slang pairs stay intact. */
function selectConvs(sample: number): Conv[] {
  const all = readJson<Conv[]>('talk_conversations.json');
  if (sample <= 0) return all;
  const tutors = [...new Set(all.map((c) => c.tutorId))].slice(0, Math.max(1, Math.ceil(sample / 5)));
  return all.filter((c) => tutors.includes(c.tutorId));
}

export const talkDialect: Feature = {
  id: 'talk_dialect',
  title: '6. Talk dialect authenticity (7 tutors × 5 conversations)',
  plan: (opts) => {
    const convs = selectConvs(opts.sample);
    const turns = convs.reduce((n, c) => n + c.learnerTurns.length, 0);
    return [
      {label: 'tutor replies (chat/turn)', role: 'chat', calls: turns, avgInTokens: 1700, avgOutTokens: 450},
      {
        label: 'per-conversation judge + slang-pair judge',
        role: 'chat',
        calls: convs.filter((c) => c.kind !== 'slang0' && c.kind !== 'slang4').length + Math.floor(convs.length / 5),
        avgInTokens: 1800,
        avgOutTokens: 400,
      },
    ];
  },
  async run(rt, opts): Promise<FeatureResult> {
    const convs = selectConvs(opts.sample);
    const tutorIds = [...new Set(convs.map((c) => c.tutorId))];
    const nativeFlags: string[] = [];
    const slangTable: string[] = [];
    const cases: CaseResult[] = [];
    let slangPairs = 0;
    let slangPairsOk = 0;

    await pMap(tutorIds, Math.min(opts.concurrency, 4), async (tutorId) => {
      const spec = DIALECTS[tutorId];
      const tutor = getTutorById(tutorId)!;
      const mine = convs.filter((c) => c.tutorId === tutorId);
      const outcomes = new Map<string, ConvOutcome>();

      await Promise.all(
        mine.map(async (c) => {
          const result = await runCase(c.id, `${tutor.name} (${spec.label}) · ${c.kind} · slang ${c.slangLevel}`, () =>
            withApi(rt, {feature: 'talk_dialect', itemId: c.id}, async (api) => {
              const history: {role: 'user' | 'assistant'; text: string}[] = [];
              const replies: string[] = [];
              const notes: string[] = [];
              const pickedUpBad: string[] = [];
              for (const line of c.learnerTurns) {
                const res = okJson(
                  await api.post('/api/chat/turn', {
                    language: tutor.language,
                    dialect: tutor.dialectId,
                    tutorId,
                    sceneId: 'just_chatting',
                    slangLevel: c.slangLevel,
                    correctionMode: 'recast',
                    history,
                    userMessage: line,
                  }),
                  'chat/turn'
                );
                history.push({role: 'user', text: line}, {role: 'assistant', text: res.replyText});
                replies.push(res.replyText);
                if (res.recastNote) notes.push(res.recastNote);
                for (const p of res.pickedUp ?? []) if (!containsNorm(res.replyText, p.term)) pickedUpBad.push(p.term);
              }
              const joined = replies.join('\n');
              const required = spec.required.flatMap((r) => matches(joined, r.patterns));
              const forbidden = spec.forbidden.flatMap((f) =>
                matches(joined, f.patterns).map((m) => `${f.name}: "${m}"`)
              );
              const english = replies.filter((r) => looksEnglish(r, tutor.language));
              const lecture = joined.match(LECTURE_RE);
              const checks: Check[] = [
                {
                  id: 'dialect_markers_present',
                  passed: required.length >= spec.minRequired,
                  detail: `${required.length}/${spec.minRequired} required markers (${[...new Set(required)].slice(0, 6).join(', ') || 'none'})`,
                },
                {
                  id: 'no_wrong_variety_forms',
                  passed: forbidden.length === 0,
                  detail: forbidden.slice(0, 4).join('; ') || undefined,
                },
                {
                  id: 'target_language_only',
                  passed: english.length === 0,
                  detail: english.map((e) => excerpt(e, 80)).join(' | ') || undefined,
                },
                {id: 'no_exam_language', passed: !EXAM_RE.test(joined), detail: joined.match(EXAM_RE)?.[0]},
                {
                  id: 'picked_up_terms_grounded',
                  passed: pickedUpBad.length === 0,
                  detail: pickedUpBad.length ? `pickedUp terms not in reply: ${pickedUpBad.join(', ')}` : undefined,
                },
              ];
              const unsure: string[] = [];
              if (c.kind === 'recast' || c.kind === 'lecture_bait') {
                checks.push({
                  id: 'no_lecturing_regex',
                  passed: !lecture,
                  detail: lecture ? `metalinguistic phrase: "${lecture[0]}"` : undefined,
                });
                if (c.recast) {
                  const modeled = new RegExp(c.recast.correct, 'iu').test(joined);
                  checks.push({
                    id: 'recast_models_local_form',
                    passed: modeled,
                    detail: modeled ? undefined : `${c.recast.note}; no match for /${c.recast.correct}/ in reply`,
                  });
                }
                const judge = openHelper(rt, {feature: 'talk_dialect', itemId: `${c.id}:judge`});
                const transcript = history
                  .map((h) => `${h.role === 'user' ? 'LEARNER' : tutor.name.toUpperCase()}: ${h.text}`)
                  .join('\n');
                const v = await ask(judge.generate, {
                  role: 'judge',
                  system:
                    'You audit an AI language tutor persona for recasting behavior and dialect authenticity. Be strict. Return JSON only.',
                  contents: `Tutor persona: ${tutor.name}, from ${tutor.city} (${tutor.regionTag}), correction style = "recast as you go": when the learner slips, the tutor should naturally echo the corrected or local form inside the reply, WITHOUT interrupting, explaining grammar, or lecturing.
Learner lines may contain deliberate errors. Transcript:
${transcript}

Answer: learnerMadeError (did the learner make at least one error), recastedNaturally (true if the tutor modeled the correct/local form in passing; null if no learner error), lectured (true if the tutor explained a rule, named the mistake, or used corrective metalanguage), englishUsedByTutor, dialectAuthentic ("yes" | "mostly" | "no" | "unsure") for ${tutor.regionTag} ${tutor.language === 'es' ? 'Spanish' : 'Portuguese'} wording and register, and unsureNotes (anything only a native speaker of this variety could confirm; empty if none).`,
                  schema: {
                    type: Type.OBJECT,
                    properties: {
                      learnerMadeError: {type: Type.BOOLEAN},
                      recastedNaturally: {type: Type.BOOLEAN},
                      lectured: {type: Type.BOOLEAN},
                      englishUsedByTutor: {type: Type.BOOLEAN},
                      dialectAuthentic: {type: Type.STRING},
                      unsureNotes: {type: Type.STRING},
                    },
                    required: [
                      'learnerMadeError',
                      'recastedNaturally',
                      'lectured',
                      'englishUsedByTutor',
                      'dialectAuthentic',
                      'unsureNotes',
                    ],
                  },
                });
                checks.push({
                  id: 'recasts_without_lecturing',
                  passed: !bool(v.lectured) && (!bool(v.learnerMadeError) || v.recastedNaturally !== false),
                  detail: `lectured=${bool(v.lectured)}, recasted=${String(v.recastedNaturally)}`,
                });
                if (['no', 'unsure'].includes(str(v.dialectAuthentic)) || str(v.unsureNotes))
                  unsure.push(
                    `${c.id}: judge dialect="${str(v.dialectAuthentic)}" ${excerpt(str(v.unsureNotes), 160)}`
                  );
              }
              outcomes.set(c.id, {replies, caseResult: {id: c.id, label: '', checks}, unsure});
              return {
                checks,
                example: `${c.id}: learner "${excerpt(c.learnerTurns[c.learnerTurns.length - 1], 70)}" → ${tutor.name}: "${excerpt(replies[replies.length - 1], 140)}"`,
              };
            })
          );
          cases.push(result);
          const o = outcomes.get(c.id);
          if (o) nativeFlags.push(...o.unsure);
        })
      );

      // Slang 0 vs slang 4 pair (same learner lines).
      const c0 = mine.find((c) => c.kind === 'slang0');
      const c4 = mine.find((c) => c.kind === 'slang4');
      const o0 = c0 && outcomes.get(c0.id);
      const o4 = c4 && outcomes.get(c4.id);
      if (c4 && o0 && o4) {
        const caseRef = cases.find((x) => x.id === c4.id)!;
        try {
          const d0 = slangDensity(o0.replies.join(' '), spec);
          const d4 = slangDensity(o4.replies.join(' '), spec);
          const flip = tutorId.length % 2 === 0;
          const [X, Y] = flip ? [o4, o0] : [o0, o4];
          const judge = openHelper(rt, {feature: 'talk_dialect', itemId: `${tutorId}:slangpair`});
          const v = await ask(judge.generate, {
            role: 'judge',
            system: 'You compare two replies from the same tutor persona. Return JSON only.',
            contents: `Two tutor replies to the same learner lines (${tutor.regionTag}). Which uses noticeably MORE local slang / colloquial street register? Replies X:\n${X.replies.join('\n')}\n\nReplies Y:\n${Y.replies.join('\n')}`,
            schema: {
              type: Type.OBJECT,
              properties: {moreSlang: {type: Type.STRING}, reason: {type: Type.STRING}},
              required: ['moreSlang', 'reason'],
            },
          });
          const picked = str(v.moreSlang).trim().toUpperCase();
          const judged4 = (picked === 'X' && X === o4) || (picked === 'Y' && Y === o4);
          const ok = judged4 && d4 > d0;
          slangPairs++;
          if (ok) slangPairsOk++;
          slangTable.push(
            `| ${tutor.name} | ${(d0 * 100).toFixed(1)}% | ${(d4 * 100).toFixed(1)}% | ${judged4 ? 'slang 4' : picked === 'X' || picked === 'Y' ? 'slang 0' : 'same'} | ${ok ? 'yes' : '**no**'} |`
          );
          caseRef.checks.push({
            id: 'slang_0_vs_4_differs',
            passed: ok,
            detail: `lexicon density ${(d0 * 100).toFixed(1)}% → ${(d4 * 100).toFixed(1)}%; judge says more slang: ${judged4 ? 'level 4' : picked}. ${excerpt(str(v.reason), 100)}`,
          });
        } catch (err) {
          caseRef.checks.push({
            id: 'slang_0_vs_4_differs',
            passed: false,
            detail: `not evaluated: ${(err as Error).message}`,
          });
        }
      }
      for (const n of spec.nativeReview) nativeFlags.push(`${tutor.name} (${spec.label}): ${n}`);
    });

    const run = cases.filter((c) => !c.notRun);
    const failing = (id: string) => run.filter((c) => c.checks.some((k) => k.id === id && !k.passed)).length;
    const having = (id: string) => run.filter((c) => c.checks.some((k) => k.id === id)).length;
    const uniqueFlags = [...new Set(nativeFlags)];
    return {
      id: 'talk_dialect',
      title: talkDialect.title,
      cases: cases.sort((a, b) => a.id.localeCompare(b.id)),
      metrics: [
        {
          label: 'Conversations with required dialect markers',
          value: `${run.length - failing('dialect_markers_present')}/${run.length}`,
        },
        {label: 'Conversations with wrong-variety forms', value: `${failing('no_wrong_variety_forms')}/${run.length}`},
        {label: 'Slang 0 vs 4 clearly differs', value: `${slangPairsOk}/${slangPairs} tutors`},
        {
          label: 'Recast conversations lecturing or not recasting',
          value: `${failing('recasts_without_lecturing')}/${having('recasts_without_lecturing')}`,
        },
        {label: 'Lecturing phrases (regex)', value: `${failing('no_lecturing_regex')}/${having('no_lecturing_regex')}`},
        {label: 'English replies', value: `${failing('target_language_only')}/${run.length}`},
      ],
      thresholds: [
        {
          label: 'Dialect markers present in >= 90% of conversations',
          passed: run.length > 0 && 1 - failing('dialect_markers_present') / run.length >= 0.9,
          detail: pct(run.length - failing('dialect_markers_present'), run.length),
        },
        {
          label: 'No wrong-variety forms',
          passed: failing('no_wrong_variety_forms') === 0,
          detail: `${failing('no_wrong_variety_forms')} conversations`,
        },
        {
          label: 'Slang 4 differs from slang 0 for every tutor',
          passed: slangPairs > 0 && slangPairsOk === slangPairs,
          detail: `${slangPairsOk}/${slangPairs}`,
        },
        {
          label: 'Recasts happen without lecturing >= 90%',
          passed:
            having('recasts_without_lecturing') > 0 &&
            1 - failing('recasts_without_lecturing') / having('recasts_without_lecturing') >= 0.9,
          detail: pct(
            having('recasts_without_lecturing') - failing('recasts_without_lecturing'),
            having('recasts_without_lecturing')
          ),
        },
      ],
      nativeReview: [
        'ALL dialect verdicts above are automated pattern checks plus a model judge; none is a native-speaker judgment.',
        ...uniqueFlags,
      ],
      notes: [
        'Uses the typed /api/chat/turn route, which shares buildTalkSystemPrompt with the live voice session. Voice-only behavior (accent, cadence, sheísmo, aspirated -s) is not covered.',
        "Marker lists are in evals/scorers/dialects.ts and are the suite author's working knowledge: have a native speaker vet them before treating a failure as a tutor bug.",
      ],
      extraMarkdown: slangTable.length
        ? `#### Slang level 0 vs 4\n\n| tutor | lexicon density @0 | @4 | judge: more slang | differs |\n|---|---|---|---|---|\n${slangTable.join('\n')}`
        : '',
    };
  },
};
