import {Type} from '@google/genai';
import type {Router} from 'express';
import {MODELS} from '../config.ts';
import {handleAsync, UserFacingError} from '../errors.ts';
import {BUDGETS, ThinkingLevel} from '../gemini.ts';
import {clampNumber, formatTranscript, resolveTrainingContext, sanitizeString} from '../validation.ts';
import type {RouteDeps} from './types.ts';

export function registerOpiRoutes(router: Router, {generate}: RouteDeps): void {
  // Live OPI examiner turn
  router.post(
    '/opi/turn',
    handleAsync(async (req, res, signal) => {
      const {langName, dialectLabel, domainLabel} = resolveTrainingContext(req.body);
      const probeLevel = req.body?.probeLevel === 'level_3_probe' ? 'level_3_probe' : 'level_2_baseline';
      const elapsedSeconds = clampNumber(req.body?.elapsedSeconds, 0, 24 * 60 * 60, 0);
      const userMessage = sanitizeString(req.body?.userMessage, 2500);
      const isOpening = Boolean(req.body?.isOpening);

      if (!isOpening && !userMessage) {
        throw new UserFacingError(400, 'Candidate message is required.');
      }

      const systemInstruction = `You are a certified senior ILR Oral Proficiency Interview (OPI) examiner conducting an operational interview strictly in ${langName} (${dialectLabel} dialect) within the domain: ${domainLabel}.
Keep your examiner turn concise (2–4 natural sentences), authentic to the chosen regional dialect, and strictly in ${langName} (no English explanations inside examinerText).

PROBING PROTOCOL:
- Current target probe level: ${probeLevel === 'level_3_probe' ? 'ILR LEVEL 3 PROBE' : 'ILR LEVEL 2 BASELINE'} (elapsed ${elapsedSeconds}s).
- In LEVEL 2 BASELINE: Ask concrete narrative, procedural, or factual questions about operations, roles, timelines, or recent events in the domain. If the candidate struggled on the prior turn, smoothly step down to stabilize fluency.
- In LEVEL 3 PROBE: Push into abstract defense/diplomatic policy, systemic root causes, competing institutional priorities, or hypothetical ("what if" / counterfactual) scenarios that naturally elicit the imperfect subjunctive and conditional.
- Return nextProbeLevel ("level_2_baseline" or "level_3_probe") and a brief English probeReason explaining why you stayed at or shifted to that level.`;

      const transcriptBlock = formatTranscript(req.body?.history, {
        maxTurns: 14,
        maxCharsPerTurn: 1000,
        label: (role) => (role === 'examiner' ? 'EXAMINER' : 'CANDIDATE'),
      });

      const contents = isOpening
        ? `Begin the ILR OPI interview now with a warm, professional Level 2 Baseline opening greeting and your first concrete operational question in ${langName} (${dialectLabel}) about ${domainLabel}.`
        : `Conversation so far:\n${transcriptBlock}\n\nCANDIDATE'S LATEST RESPONSE:\n${userMessage}\n\nRespond naturally as the OPI examiner in ${langName}, advancing or backing off the probe smoothly according to candidate performance.`;

      const data = await generate({
        model: MODELS.standard,
        contents,
        systemInstruction,
        thinkingLevel: ThinkingLevel.LOW,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            examinerText: {type: Type.STRING},
            nextProbeLevel: {type: Type.STRING},
            probeReason: {type: Type.STRING},
          },
          required: ['examinerText', 'nextProbeLevel', 'probeReason'],
        },
        emptyMessage: 'Empty response from OPI examiner.',
        budget: BUDGETS.standard,
        signal,
      });

      const examinerText = sanitizeString(data.examinerText, 3000);
      if (!examinerText) {
        throw new UserFacingError(502, 'OPI examiner returned an empty response. Please try again.');
      }
      res.json({
        examinerText,
        probeLevel: data.nextProbeLevel === 'level_3_probe' ? 'level_3_probe' : 'level_2_baseline',
        probeReason: sanitizeString(data.probeReason, 500),
      });
    })
  );
}
