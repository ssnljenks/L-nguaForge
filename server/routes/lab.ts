import {randomUUID} from 'crypto';
import {Type} from '@google/genai';
import type {Router} from 'express';
import {MODELS} from '../config.ts';
import {buildErrorReportingInstruction, extractReportedErrors, REPORTED_ERRORS_SCHEMA} from '../errorReporting.ts';
import {handleAsync, UserFacingError} from '../errors.ts';
import {BUDGETS, ThinkingLevel} from '../gemini.ts';
import {
  asRecord,
  assertUnclassifiedText,
  clampNumber,
  clampScore,
  resolveTrainingContext,
  sanitizeString,
  sanitizeStringArray,
} from '../validation.ts';
import type {RouteDeps} from './types.ts';
import {createUntrustedFence} from '../untrustedContent.ts';

export function registerLabRoutes(router: Router, {generate}: RouteDeps): void {
  // PREP monologue prompt generator
  router.post(
    '/lab/prep-prompt',
    handleAsync(async (req, res, signal) => {
      const {language, langName, dialectLabel, domainId, workFocus, topicLabel} = resolveTrainingContext(req.body);
      // Military/work framing only with Work focus ON (REVIEW H-3).
      const topicScope = workFocus ? `for the work domain "${topicLabel}"` : `on ${topicLabel}`;

      const data = await generate({
        model: MODELS.standard,
        contents: `Create one realistic ILR 2+/3 OPI abstract or hypothetical monologue prompt in ${langName} (${dialectLabel}) ${topicScope}.
The prompt should be answerable in 90 seconds using the PREP structure (Point -> Reason -> Example -> Pivot/Conclusion) and naturally invite subjunctive/conditional structures.
Provide the prompt in ${langName}, an English summary, and 4 recommended high-register connectors in ${langName}.`,
        thinkingLevel: ThinkingLevel.LOW,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            promptTarget: {type: Type.STRING},
            promptEnglish: {type: Type.STRING},
            recommendedConnectors: {type: Type.ARRAY, items: {type: Type.STRING}},
          },
          required: ['promptTarget', 'promptEnglish', 'recommendedConnectors'],
        },
        emptyMessage: 'Empty response from PREP prompt generator.',
        budget: BUDGETS.standard,
        signal,
      });

      const promptTarget = sanitizeString(data.promptTarget, 1500);
      if (!promptTarget) {
        throw new UserFacingError(502, 'PREP prompt generator returned an empty prompt. Please try again.');
      }
      res.json({
        id: `prep-${randomUUID()}`,
        language,
        domain: domainId,
        promptTarget,
        promptEnglish: sanitizeString(data.promptEnglish, 1500),
        recommendedConnectors: sanitizeStringArray(data.recommendedConnectors, 6, 120),
      });
    })
  );

  // PREP monologue grader
  router.post(
    '/lab/grade-prep',
    handleAsync(async (req, res, signal) => {
      const {langName, dialectLabel} = resolveTrainingContext(req.body);
      const promptTarget = sanitizeString(req.body?.promptTarget, 1000);
      const transcript = sanitizeString(req.body?.transcript, 3500);
      const durationSeconds = clampNumber(req.body?.durationSeconds, 0, 600, 90);

      if (!transcript) {
        throw new UserFacingError(400, 'Record or enter your monologue transcript before grading.');
      }
      assertUnclassifiedText(promptTarget, transcript);
      const fence = createUntrustedFence();

      const data = await generate({
        model: MODELS.standard,
        contents: `Grade this 90-second PREP monologue (actual duration: ${durationSeconds}s) in ${langName} (${dialectLabel}).
${fence.notice}
PROMPT: ${promptTarget}
CANDIDATE MONOLOGUE:
${fence.wrap('MONOLOGUE', transcript)}

Evaluate Point (0:00–0:15), Reason (0:15–0:40), Example (0:40–1:10), and Pivot/Conclusion (1:10–1:30), plus subjunctive/conditional control and provide one polished ILR 2+/3 closing pivot sentence in ${langName}.`,
        thinkingLevel: ThinkingLevel.MEDIUM,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            estimatedIlr: {type: Type.STRING},
            structureScore: {type: Type.INTEGER},
            phaseFeedback: {
              type: Type.OBJECT,
              properties: {
                point: {type: Type.STRING},
                reason: {type: Type.STRING},
                example: {type: Type.STRING},
                pivot: {type: Type.STRING},
              },
              required: ['point', 'reason', 'example', 'pivot'],
            },
            subjunctiveNote: {type: Type.STRING},
            upgradedConclusion: {type: Type.STRING},
          },
          required: ['estimatedIlr', 'structureScore', 'phaseFeedback', 'subjunctiveNote', 'upgradedConclusion'],
        },
        emptyMessage: 'Empty response from PREP grader.',
        budget: BUDGETS.standard,
        signal,
      });

      const phase = asRecord(data.phaseFeedback);
      res.json({
        estimatedIlr: sanitizeString(data.estimatedIlr, 40) || 'Unrated',
        structureScore: clampScore(data.structureScore),
        phaseFeedback: {
          point: sanitizeString(phase.point, 800),
          reason: sanitizeString(phase.reason, 800),
          example: sanitizeString(phase.example, 800),
          pivot: sanitizeString(phase.pivot, 800),
        },
        subjunctiveNote: sanitizeString(data.subjunctiveNote, 800),
        upgradedConclusion: sanitizeString(data.upgradedConclusion, 800),
      });
    })
  );

  // Consecutive interpretation briefing generator
  router.post(
    '/lab/interp-briefing',
    handleAsync(async (req, res, signal) => {
      const {language, langName, dialectId, dialectLabel, domainId, workFocus, topicLabel} = resolveTrainingContext(
        req.body
      );
      // Military/diplomatic framing only with Work focus ON (REVIEW H-3).
      const briefingScope = workFocus
        ? `military/diplomatic briefing clip (75–105 words) in ${langName} (${dialectLabel}) for consecutive interpretation practice in the domain "${topicLabel}".
Example speaker: a Colonel, Naval Attaché, or Joint Staff Deputy addressing a visiting foreign delegation. Include 3–4 concrete operational details (numbers, timelines, unit coordination, policy caveats)`
        : `public announcement or news briefing clip (75–105 words) in ${langName} (${dialectLabel}) for consecutive interpretation practice on ${topicLabel}.
Example speaker: a city official, company spokesperson, or university director addressing journalists or visitors. Include 3–4 concrete details (numbers, dates, places, conditions or caveats)`;

      const data = await generate({
        model: MODELS.standard,
        contents: `Write a realistic 25-to-45 second spoken ${briefingScope} that require disciplined idea-chunking notes. Also list 4 keyFacts in English.`,
        thinkingLevel: ThinkingLevel.LOW,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            speakerRole: {type: Type.STRING},
            scenarioTitle: {type: Type.STRING},
            briefingText: {type: Type.STRING},
            estimatedSeconds: {type: Type.INTEGER},
            keyFacts: {type: Type.ARRAY, items: {type: Type.STRING}},
          },
          required: ['speakerRole', 'scenarioTitle', 'briefingText', 'estimatedSeconds', 'keyFacts'],
        },
        emptyMessage: 'Empty response from briefing generator.',
        budget: BUDGETS.standard,
        signal,
      });

      const briefingText = sanitizeString(data.briefingText, 2500);
      if (!briefingText) {
        throw new UserFacingError(502, 'Briefing generator returned an empty briefing. Please try again.');
      }
      res.json({
        id: `interp-${randomUUID()}`,
        language,
        dialect: dialectId,
        domain: domainId,
        speakerRole: sanitizeString(data.speakerRole, 200),
        scenarioTitle: sanitizeString(data.scenarioTitle, 200),
        briefingText,
        estimatedSeconds: clampNumber(data.estimatedSeconds, 10, 120, 35),
        keyFacts: sanitizeStringArray(data.keyFacts, 6, 300),
      });
    })
  );

  // Consecutive interpretation grader
  router.post(
    '/lab/grade-interp',
    handleAsync(async (req, res, signal) => {
      const {language, langName, workFocus} = resolveTrainingContext(req.body);
      const briefingText = sanitizeString(req.body?.briefingText, 2500);
      const candidateRendition = sanitizeString(req.body?.candidateRendition, 2500);
      const chunkNotes = sanitizeString(req.body?.chunkNotes, 1500);
      const direction =
        req.body?.direction === 'en_to_target' ? 'English to Target Language' : 'Target Language to English';

      if (!briefingText || !candidateRendition) {
        throw new UserFacingError(400, 'Briefing source and your interpretation rendition are required.');
      }
      assertUnclassifiedText(briefingText, candidateRendition, chunkNotes);

      const data = await generate({
        model: MODELS.standard,
        contents: `Grade this consecutive ${workFocus ? 'military/diplomatic ' : ''}interpretation (${direction}, source language: ${langName}).

SOURCE BRIEFING:
${briefingText}

CANDIDATE CHUNKING NOTES:
${chunkNotes || '(None entered)'}

CANDIDATE RENDITION:
${candidateRendition}

Score fidelityScore (0–100) and registerScore (0–100), list capturedPoints, list any missedOrDistorted numbers/caveats/facts, give concise terminologyFeedback, supply a crisp diplomatic modelRendition, and report any specific errors:
${buildErrorReportingInstruction(language, ['grammar', 'register', 'gist'])}`,
        thinkingLevel: ThinkingLevel.MEDIUM,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            fidelityScore: {type: Type.INTEGER},
            registerScore: {type: Type.INTEGER},
            capturedPoints: {type: Type.ARRAY, items: {type: Type.STRING}},
            missedOrDistorted: {type: Type.ARRAY, items: {type: Type.STRING}},
            terminologyFeedback: {type: Type.STRING},
            modelRendition: {type: Type.STRING},
            errors: REPORTED_ERRORS_SCHEMA,
          },
          required: [
            'fidelityScore',
            'registerScore',
            'capturedPoints',
            'missedOrDistorted',
            'terminologyFeedback',
            'modelRendition',
            'errors',
          ],
        },
        emptyMessage: 'Empty response from interpretation grader.',
        budget: BUDGETS.standard,
        signal,
      });

      res.json({
        fidelityScore: clampScore(data.fidelityScore),
        registerScore: clampScore(data.registerScore),
        capturedPoints: sanitizeStringArray(data.capturedPoints, 10, 400),
        missedOrDistorted: sanitizeStringArray(data.missedOrDistorted, 10, 400),
        terminologyFeedback: sanitizeString(data.terminologyFeedback, 1500),
        modelRendition: sanitizeString(data.modelRendition, 3000),
        errors: extractReportedErrors(data.errors, language),
      });
    })
  );
}
