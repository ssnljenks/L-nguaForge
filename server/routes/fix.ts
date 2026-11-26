import {Type} from '@google/genai';
import type {Router} from 'express';
import {getTaxonomyEntry, normalizeErrorTaxonomyKey} from '../../src/data/errorTaxonomy.ts';
import type {FixPromptItem} from '../../src/types.ts';
import {MODELS} from '../config.ts';
import {handleAsync, UserFacingError} from '../errors.ts';
import {BUDGETS, ThinkingLevel} from '../gemini.ts';
import {asRecordArray, assertUnclassifiedText, resolveTrainingContext, sanitizeString} from '../validation.ts';
import type {RouteDeps} from './types.ts';

const FIX_DRILL_PROMPT_COUNT = 8;

export function registerFixRoutes(router: Router, {generate}: RouteDeps): void {
  // 1. Generate 8 short everyday-topic prompts that force the target structure
  router.post(
    '/fix/generate',
    handleAsync(async (req, res, signal) => {
      const {language, langName, dialectId, dialectLabel} = resolveTrainingContext(req.body);
      const rawKey = sanitizeString(req.body?.errorKey, 80);
      const errorKey = normalizeErrorTaxonomyKey(rawKey, language);

      if (!errorKey) {
        throw new UserFacingError(400, `Unknown or unsupported errorKey "${rawKey}" for ${langName}.`);
      }

      const entry = getTaxonomyEntry(errorKey);

      const data = await generate({
        model: MODELS.standard,
        contents: `You are a practical language drill coach creating a 2-minute targeted micro-drill in ${langName} (${dialectLabel}).

TARGET ERROR PATTERN TO FIX:
- Key: ${entry.key}
- Name: ${entry.label}
- Why it happens: ${entry.explanation}
- Target structure focus: ${entry.fixFocusHint}

STRICT RULES:
1. Generate EXACTLY ${FIX_DRILL_PROMPT_COUNT} short, punchy prompts in ${langName} (${dialectLabel}) that FORCE the learner to produce the target structure naturally in 1 spoken sentence.
   - Example for "si_clause_present_for_subjunctive": "¿Qué harías si ganaras la lotería mañana?"
   - Example for "futuro_do_subjuntivo": "O que você vai fazer quando tiver uma semana livre?"
   - Example for "por_para": "¿Por qué llegaste tarde hoy y para quién compraste ese café?"
   - Example for Gist/DLPT comprehension keys: give a concise 1–2 sentence ${langName} micro-statement + direct question testing that exact listening/fidelity habit (e.g. restate strictly without adding claims, or identify the exact detail without over-inferring).
2. EVERYDAY CIVILIAN TOPICS ONLY (food, travel, neighbors, weekend plans, rent, errands, weather, friends, work commute). NEVER military, defense, or tactical topics.
3. Keep each promptTarget brief (1–2 natural sentences, under 160 chars) so the learner can answer all ${FIX_DRILL_PROMPT_COUNT} prompts within 2 minutes.
4. For each prompt provide:
   - promptTarget: the short prompt in ${langName} (${dialectLabel}).
   - promptEnglishHint: crisp English gloss/cue (under 100 chars).
   - targetStructureHint: ultra-short 3–7 word reminder of the exact grammar/habit to hit (e.g. "si + -ra/-se, + -ría").`,
        thinkingLevel: ThinkingLevel.LOW,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            prompts: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  promptTarget: {type: Type.STRING},
                  promptEnglishHint: {type: Type.STRING},
                  targetStructureHint: {type: Type.STRING},
                },
                required: ['promptTarget', 'promptEnglishHint', 'targetStructureHint'],
              },
            },
          },
          required: ['prompts'],
        },
        emptyMessage: 'Empty response while generating 2-minute fix drill.',
        budget: BUDGETS.standard,
        signal,
      });

      const prompts: FixPromptItem[] = asRecordArray(data.prompts)
        .slice(0, FIX_DRILL_PROMPT_COUNT)
        .map((item, idx): FixPromptItem | null => {
          const promptTarget = sanitizeString(item.promptTarget, 260);
          if (!promptTarget) return null;
          return {
            id: `fix-${errorKey}-${idx + 1}`,
            promptTarget,
            promptEnglishHint: sanitizeString(item.promptEnglishHint, 180),
            targetStructureHint: sanitizeString(item.targetStructureHint, 120) || entry.label,
          };
        })
        .filter((x): x is FixPromptItem => x !== null);

      if (prompts.length === 0) {
        throw new UserFacingError(502, 'Could not generate fix drill prompts. Please try again.');
      }

      res.json({
        errorKey: entry.key,
        label: entry.label,
        explanation: entry.explanation,
        language,
        dialect: dialectId,
        prompts,
      });
    })
  );

  // 2. Grade a single prompt answer checking ONLY the target structure for instant feedback
  router.post(
    '/fix/grade',
    handleAsync(async (req, res, signal) => {
      const {language, langName, dialectLabel} = resolveTrainingContext(req.body);
      const rawKey = sanitizeString(req.body?.errorKey, 80);
      const errorKey = normalizeErrorTaxonomyKey(rawKey, language);
      const promptTarget = sanitizeString(req.body?.promptTarget, 400);
      const userAnswer = sanitizeString(req.body?.userAnswer, 1000);

      if (!errorKey) {
        throw new UserFacingError(400, `Unknown or unsupported errorKey "${rawKey}" for ${langName}.`);
      }
      if (!promptTarget || !userAnswer) {
        throw new UserFacingError(400, 'promptTarget and userAnswer are required.');
      }

      assertUnclassifiedText(promptTarget, userAnswer);

      const entry = getTaxonomyEntry(errorKey);

      const data = await generate({
        model: MODELS.chat,
        contents: `Grade this single 2-minute micro-drill response in ${langName} (${dialectLabel}).

TARGET STRUCTURE ONLY:
- Key: ${entry.key}
- Label: ${entry.label}
- Rule: ${entry.fixFocusHint}

PROMPT:
"${promptTarget}"

LEARNER ANSWER:
"${userAnswer}"

STRICT GRADING RULES:
1. Check ONLY whether the learner successfully used/followed "${entry.label}" (${entry.fixFocusHint}).
2. IGNORE unrelated typos, accent marks, minor gender/spelling slips, or vocabulary style UNLESS that is the target errorKey itself.
3. Return:
   - passed: true if the target structure/habit was used accurately; false if it was missed or misused.
   - matchedSpan: short verbatim snippet (2–8 words) copied from LEARNER ANSWER showing the exact phrase where they nailed or missed the target structure (e.g. "…habría escasez" or "si tengo dinero").
   - feedback: ultra-crisp 3–12 word feedback note explaining the check (e.g. "conditional used cleanly" or "use imperfect subjunctive (ganara) after si").
   - correction: if passed is false, provide ONE concise corrected version of their answer fixing ONLY the target structure; if passed is true, return empty string "".`,
        thinkingLevel: ThinkingLevel.LOW,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            passed: {type: Type.BOOLEAN},
            matchedSpan: {type: Type.STRING},
            feedback: {type: Type.STRING},
            correction: {type: Type.STRING},
          },
          required: ['passed', 'matchedSpan', 'feedback', 'correction'],
        },
        emptyMessage: 'Empty response while grading fix drill turn.',
        budget: BUDGETS.fast,
        signal,
      });

      const passed = Boolean(data.passed);
      const matchedSpan = sanitizeString(data.matchedSpan, 140) || userAnswer.slice(0, 60);
      const feedback =
        sanitizeString(data.feedback, 220) ||
        (passed ? `${entry.label} used accurately` : `Adjust to match ${entry.label}`);
      const correction = passed ? undefined : sanitizeString(data.correction, 300) || undefined;

      res.json({
        passed,
        matchedSpan,
        feedback,
        ...(correction ? {correction} : {}),
      });
    })
  );
}
