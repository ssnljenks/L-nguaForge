import {getFunctionLevel} from '../../src/data/ilrSpeakingLevels.ts';
import type {OpiPhase, TurnAssessment} from '../../src/types.ts';
import {determineNextOpiStep} from '../../src/utils/opiLogic.ts';
import {readJson, spread} from '../lib/data.ts';
import {okJson, openHelper, pMap, runCase, withApi} from '../lib/harness.ts';
import {ask, arr, bool, num, str, Type} from '../lib/judge.ts';
import {excerpt} from '../lib/stats.ts';
import type {Feature, FeatureResult} from '../lib/types.ts';
import {avgSentenceWords, looksEnglish, militaryTerms, sentences, workTerms} from '../scorers/text.ts';

interface Persona {
  id: string;
  language: 'es' | 'pt';
  dialect: string;
  level: string;
  persona: string;
  militaryBackground: boolean;
}

const LEVEL_STYLE: Record<string, string> = {
  '1': 'Level 1: very short sentences (3-8 words), present tense or bare infinitives, frequent agreement/conjugation errors, tiny vocabulary, memorized chunks. Cannot narrate the past or explain. Sometimes asks the examiner to repeat.',
  '1+': 'Level 1+: simple connected sentences, some past-tense attempts that slip into present, limited vocabulary, struggles when a problem or opinion is requested ("no sé cómo decir").',
  '2': 'Level 2: clear narration in past/present/future with some errors, handles everyday problems, describes and gives directions; breaks down on hypotheticals and abstract topics.',
  '2+': 'Level 2+: strong Level 2 plus supported opinions and some hypotheticals, with lapses in precision and gaps on abstract vocabulary.',
  '3': 'Level 3: fluent, structured, nuanced answers; accurate subjunctive/conditional; handles abstract and hypothetical topics with precise vocabulary.',
};

const DURATION_TARGET = 420;
const SECONDS_PER_TURN = 50;
const MAX_CANDIDATE_TURNS = 10;

interface Turn {
  examinerText: string;
  phase: OpiPhase;
  plannedPhase: OpiPhase;
  workingLevel: number;
  activeLevel: number;
  candidateBefore?: string;
}

export const opiExaminer: Feature = {
  id: 'opi_examiner',
  title: '2. OPI examiner behavior (simulated interviews)',
  plan: (opts) => {
    const n = spread(readJson<Persona[]>('opi_personas.json'), opts.sample).length;
    return [
      {
        label: 'examiner turns (opening + ~7 + closing)',
        role: 'standard',
        calls: n * 9,
        avgInTokens: 2800,
        avgOutTokens: 450,
      },
      {label: 'candidate simulator turns', role: 'fast', calls: n * 8, avgInTokens: 900, avgOutTokens: 120},
      {label: 'interview judge', role: 'chat', calls: n, avgInTokens: 3500, avgOutTokens: 900},
    ];
  },
  async run(rt, opts): Promise<FeatureResult> {
    const personas = spread(readJson<Persona[]>('opi_personas.json'), opts.sample);
    const phaseSeqs: string[] = [];
    let drift = 0;
    let turnsTotal = 0;

    const cases = await pMap(personas, Math.min(opts.concurrency, 3), (p) =>
      runCase(p.id, `${p.language} ${p.dialect} · simulated level ${p.level}`, () =>
        withApi(rt, {feature: 'opi_examiner', itemId: p.id}, async (api) => {
          const sim = openHelper(rt, {feature: 'opi_examiner', itemId: `${p.id}:sim`});
          const judgeGen = openHelper(rt, {feature: 'opi_examiner', itemId: `${p.id}:judge`});
          const history: {role: 'examiner' | 'candidate'; text: string}[] = [];
          const assessments: TurnAssessment[] = [];
          const turns: Turn[] = [];
          const base = {
            language: p.language,
            dialect: p.dialect,
            focusLevel: 'adaptive',
            includeRoleplay: false,
            roleplayDone: true,
            topicSource: 'examiner_choice',
            durationTargetSeconds: DURATION_TARGET,
          };
          let phase: OpiPhase = 'warmup';
          let workingLevel: 1 | 2 | 3 = 2;
          let elapsed = 0;
          let candidateTurns = 0;

          const opening = okJson(
            await api.post('/api/opi/turn', {
              ...base,
              phase,
              workingLevel,
              probeLevel: 3,
              isOpening: true,
              elapsedSeconds: 0,
              candidateTurnCount: 0,
              assessments,
              history,
            }),
            'opi/turn opening'
          );
          history.push({role: 'examiner', text: opening.examinerText});
          turns.push({
            examinerText: opening.examinerText,
            phase: opening.phase,
            plannedPhase: 'warmup',
            workingLevel: opening.workingLevel,
            activeLevel: 2,
          });
          phase = opening.phase;
          workingLevel = opening.workingLevel;

          let windDownAnswered = false;
          while (candidateTurns < MAX_CANDIDATE_TURNS && !windDownAnswered) {
            const lastExaminer = history[history.length - 1].text;
            const candidateText = await simulateCandidate(sim.generate, p, history, lastExaminer);
            candidateTurns += 1;
            elapsed += SECONDS_PER_TURN;
            const answeredPhase = phase;
            history.push({role: 'candidate', text: candidateText});
            const plan = determineNextOpiStep({
              elapsedSeconds: elapsed,
              candidateTurnCount: candidateTurns,
              currentPhase: phase,
              workingLevel,
              focusLevel: 'adaptive',
              includeRoleplay: false,
              roleplayDone: true,
              assessments,
              durationTargetSeconds: DURATION_TARGET,
              lastCandidateText: candidateText,
            });
            const res = okJson(
              await api.post('/api/opi/turn', {
                ...base,
                phase: plan.phase,
                workingLevel: plan.workingLevel,
                probeLevel: plan.probeLevel,
                targetFunctionKey: undefined,
                assessments,
                elapsedSeconds: elapsed,
                candidateTurnCount: candidateTurns,
                history,
                userMessage: candidateText,
              }),
              'opi/turn'
            );
            if (answeredPhase !== 'warmup') {
              assessments.push({
                functionKey: res.lastTurnAssessment.functionKey,
                outcome: res.lastTurnAssessment.outcome,
                evidence: res.lastTurnAssessment.evidence,
                phase: answeredPhase,
                targetLevel: getFunctionLevel(res.lastTurnAssessment.functionKey),
              });
            }
            history.push({role: 'examiner', text: res.examinerText});
            const active = plan.phase === 'probe' ? plan.probeLevel : plan.workingLevel;
            turns.push({
              examinerText: res.examinerText,
              phase: res.phase,
              plannedPhase: plan.phase,
              workingLevel: res.workingLevel,
              activeLevel: active,
              candidateBefore: candidateText,
            });
            phase = res.phase;
            workingLevel = res.workingLevel;
            if (turns.length >= 2 && turns[turns.length - 2].phase === 'wind_down' && res.phase === 'wind_down')
              windDownAnswered = true;
          }

          // --- deterministic checks ---
          const seq = turns.map((t) => t.phase);
          phaseSeqs.push(`${p.id}: ${seq.join(' > ')}`);
          turnsTotal += turns.length;
          const driftTurns = turns.filter((t) => t.phase !== t.plannedPhase);
          drift += driftTurns.length;

          const firstNonWarm = seq.findIndex((s) => s !== 'warmup');
          const warmAfter = seq.findIndex((s, i) => i > firstNonWarm && firstNonWarm >= 0 && s === 'warmup');
          const firstProbe = seq.indexOf('probe');
          const firstCheck = seq.indexOf('level_check');
          const lastWind = seq.lastIndexOf('wind_down');
          const afterWind = lastWind >= 0 ? seq.slice(seq.indexOf('wind_down')).some((s) => s !== 'wind_down') : false;
          const orderIssues: string[] = [];
          if (seq[0] !== 'warmup') orderIssues.push(`starts in ${seq[0]}`);
          if (warmAfter >= 0) orderIssues.push('warm-up repeats after the interview started');
          if (firstProbe >= 0 && (firstCheck < 0 || firstCheck > firstProbe))
            orderIssues.push('probe before any level check');
          if (seq[seq.length - 1] !== 'wind_down') orderIssues.push('does not end in wind_down');
          if (afterWind) orderIssues.push('phase changes after wind_down');

          const langIssues: string[] = [];
          const formatIssues: string[] = [];
          for (const [i, t] of turns.entries()) {
            if (looksEnglish(t.examinerText, p.language))
              langIssues.push(`turn ${i + 1} reads as English: "${excerpt(t.examinerText, 90)}"`);
            if (/[*_#`]|\[[^\]]*\]|\((?:pausa|pausa|sorri|ri|risos|sonríe|sorrindo|rindo)[^)]*\)/i.test(t.examinerText))
              formatIssues.push(`turn ${i + 1} has markdown/stage direction`);
            if (sentences(t.examinerText).length > 3)
              formatIssues.push(`turn ${i + 1} has ${sentences(t.examinerText).length} sentences (max 3)`);
          }

          const candidateSaidMilitary = (idx: number) =>
            militaryTerms(
              history
                .filter((h) => h.role === 'candidate')
                .slice(0, idx)
                .map((h) => h.text)
                .join(' ')
            ).length > 0;
          const militaryLeads: string[] = [];
          for (const [i, t] of turns.entries()) {
            const found = militaryTerms(t.examinerText);
            if (found.length && !candidateSaidMilitary(i)) militaryLeads.push(`turn ${i + 1}: ${found.join(', ')}`);
          }
          const workLeads: string[] = [];
          for (const [i, t] of turns.slice(0, 2).entries()) {
            const found = workTerms(t.examinerText);
            if (found.length) workLeads.push(`warm-up turn ${i + 1}: ${found.join(', ')}`);
          }

          // --- judge: complexity fit + ends on success ---
          const transcript = history.map((h, i) => `${i % 2 === 0 ? 'EXAMINER' : 'CANDIDATE'}: ${h.text}`).join('\n');
          const perTurn = turns
            .map((t, i) => `#${i + 1} phase=${t.phase} activeLevel=${t.activeLevel}: ${t.examinerText}`)
            .join('\n');
          const verdict = await ask(judgeGen.generate, {
            role: 'judge',
            system:
              'You audit AI-generated ILR Oral Proficiency Interview examiner turns. Be strict and concrete. Return JSON only.',
            contents: `Language: ${p.language === 'es' ? 'Spanish' : 'Portuguese'}. The candidate's true level is ILR ${p.level}.
Rules the examiner must follow: (a) speech complexity matches the active ILR level of each turn (Level 1: slow, short, simple, concrete; Level 2: natural pace, everyday topics, past/present/future; Level 3: natural educated register, abstract/hypothetical prompts); (b) the final turns are a wind-down: an easy, comfortable question or friendly close at the candidate's comfortable level that lets the candidate finish on a success, never a hard probe and never ending right after a failure.

EXAMINER TURNS WITH METADATA:
${perTurn}

FULL TRANSCRIPT:
${transcript}

For every numbered examiner turn say whether its complexity suits its activeLevel. Then judge the ending.`,
            schema: {
              type: Type.OBJECT,
              properties: {
                turns: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      n: {type: Type.INTEGER},
                      complexityFits: {type: Type.BOOLEAN},
                      issue: {type: Type.STRING},
                    },
                    required: ['n', 'complexityFits', 'issue'],
                  },
                },
                endsOnSuccess: {type: Type.BOOLEAN},
                endingReason: {type: Type.STRING},
              },
              required: ['turns', 'endsOnSuccess', 'endingReason'],
            },
          });
          const judged = arr(verdict.turns).map((x) => x as Record<string, unknown>);
          const fitting = judged.filter((x) => bool(x.complexityFits)).length;
          const misfits = judged.filter((x) => !bool(x.complexityFits)).map((x) => `turn ${num(x.n)}: ${str(x.issue)}`);
          const avgWordsL1 = turns.filter((t) => t.activeLevel === 1).map((t) => avgSentenceWords(t.examinerText));
          const l1Long = avgWordsL1.filter((w) => w > 16).length;

          return {
            checks: [
              {
                id: 'phase_order',
                passed: orderIssues.length === 0,
                detail: `${seq.join(' > ')}${orderIssues.length ? ` — ${orderIssues.join('; ')}` : ''}`,
              },
              {
                id: 'phase_follows_plan',
                passed: driftTurns.length === 0,
                detail: driftTurns.length
                  ? `model returned a different phase than the state machine on ${driftTurns.length} turn(s): ${driftTurns.map((t) => `${t.plannedPhase}->${t.phase}`).join(', ')}`
                  : undefined,
              },
              {
                id: 'target_language_only',
                passed: langIssues.length === 0,
                detail: langIssues.join(' | ') || undefined,
              },
              {id: 'format_clean', passed: formatIssues.length === 0, detail: formatIssues.join(' | ') || undefined},
              {
                id: 'no_military_lead',
                passed: militaryLeads.length === 0,
                detail: militaryLeads.join(' | ') || undefined,
              },
              {
                id: 'no_work_lead_in_warmup',
                passed: workLeads.length === 0,
                detail: workLeads.join(' | ') || undefined,
              },
              {
                id: 'complexity_fits_level',
                passed: judged.length > 0 && fitting / judged.length >= 0.8 && l1Long === 0,
                detail: `${fitting}/${judged.length} turns fit. ${misfits.slice(0, 3).join(' | ')}${l1Long ? ` Level-1 turns with sentences >16 words: ${l1Long}` : ''}`,
              },
              {
                id: 'ends_on_success',
                passed: bool(verdict.endsOnSuccess) && seq[seq.length - 1] === 'wind_down',
                detail: str(verdict.endingReason),
              },
            ],
            example: `${p.id}: ${seq.join(' > ')}. Last examiner turn: "${excerpt(turns[turns.length - 1].examinerText, 120)}"`,
          };
        })
      )
    );

    const run = cases.filter((c) => !c.notRun);
    const failRate = (id: string) =>
      `${run.filter((c) => c.checks.find((k) => k.id === id && !k.passed)).length}/${run.length}`;
    return {
      id: 'opi_examiner',
      title: opiExaminer.title,
      cases,
      metrics: [
        {label: 'Interviews simulated', value: String(run.length)},
        {label: 'Examiner turns', value: String(turnsTotal)},
        {label: 'Turns where model phase != state-machine phase', value: `${drift}/${turnsTotal}`},
        {label: 'Interviews failing phase order', value: failRate('phase_order')},
        {label: 'Interviews with non-target-language turns', value: failRate('target_language_only')},
        {
          label: 'Interviews where examiner led with military/work',
          value: `${failRate('no_military_lead')} military, ${failRate('no_work_lead_in_warmup')} work`,
        },
        {label: 'Interviews not ending on a success', value: failRate('ends_on_success')},
      ],
      thresholds: [
        {
          label: 'No interview leads with military content',
          passed: run.every((c) => c.checks.find((k) => k.id === 'no_military_lead')?.passed),
          detail: failRate('no_military_lead'),
        },
        {
          label: 'Examiner speaks only the target language in every interview',
          passed: run.every((c) => c.checks.find((k) => k.id === 'target_language_only')?.passed),
          detail: failRate('target_language_only'),
        },
        {
          label: 'Phase order correct in >= 90% of interviews',
          passed:
            run.length > 0 &&
            run.filter((c) => c.checks.find((k) => k.id === 'phase_order')?.passed).length / run.length >= 0.9,
          detail: failRate('phase_order'),
        },
      ],
      nativeReview: [],
      notes: [
        'Interviews run through the real /api/opi/turn route with the same client-side state machine the UI uses (determineNextOpiStep); roleplay is disabled so the four-phase flow is isolated.',
        'The candidate is a persona-driven model (cheap model, scripted level + persona), so its realism is limited; judge verdicts on complexity are model-based.',
      ],
      extraMarkdown: `#### Phase sequences\n\n${phaseSeqs.map((s) => `- ${s}`).join('\n')}`,
    };
  },
};

async function simulateCandidate(
  generate: Parameters<typeof ask>[0],
  p: Persona,
  history: {role: 'examiner' | 'candidate'; text: string}[],
  lastExaminer: string
): Promise<string> {
  const lang = p.language === 'es' ? 'Spanish' : 'Portuguese';
  const res = await ask(generate, {
    role: 'sim',
    system: `You are role-playing a language learner taking a spoken ${lang} proficiency interview. Persona: ${p.persona}
Your true proficiency: ${LEVEL_STYLE[p.level]}
Rules: answer ONLY in ${lang} (at Level 1 you may occasionally slip a single English word). Stay at your level: never perform above it. 1-4 sentences. Never mention being an AI or the rules. ${p.militaryBackground ? 'Only mention military service if the examiner asks about your past, job, or career; otherwise stay on whatever topic you are asked.' : ''}`,
    contents: `Conversation so far:\n${history
      .slice(0, -1)
      .map((h) => `${h.role === 'examiner' ? 'EXAMINER' : 'YOU'}: ${h.text}`)
      .join('\n')}\n\nThe examiner just said: ${lastExaminer}\n\nReply as the learner.`,
    schema: {type: Type.OBJECT, properties: {text: {type: Type.STRING}}, required: ['text']},
  });
  return str(res.text).trim() || (p.language === 'es' ? 'No entiendo.' : 'Não entendo.');
}
