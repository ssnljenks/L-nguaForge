import {Type} from '@google/genai';
import type {Router} from 'express';
import {MODELS} from '../config.ts';
import {handleAsync, UserFacingError} from '../errors.ts';
import {BUDGETS, ThinkingLevel} from '../gemini.ts';
import {
  asRecord,
  asRecordArray,
  clampScore,
  formatTranscript,
  resolveTrainingContext,
  sanitizeString,
  sanitizeStringArray,
} from '../validation.ts';
import type {RouteDeps} from './types.ts';

export function registerDebriefRoutes(router: Router, {generate}: RouteDeps): void {
  // Post-session ILR debrief & natural 2+ rewriter
  router.post(
    '/debrief/analyze',
    handleAsync(async (req, res, signal) => {
      const {langName, dialectLabel, domainLabel} = resolveTrainingContext(req.body);
      const messages = asRecordArray(req.body?.messages).slice(-30);

      const hasCandidateSpeech = messages.some((m) => m.role === 'candidate' && sanitizeString(m.text, 1200));
      if (!hasCandidateSpeech) {
        throw new UserFacingError(400, 'No candidate speech found in this session to analyze.');
      }

      const fullTranscript = formatTranscript(messages, {
        maxTurns: 30,
        maxCharsPerTurn: 1200,
        label: (role) => (role === 'examiner' ? 'EXAMINER' : 'CANDIDATE'),
      });

      const report = await generate({
        model: MODELS.standard,
        contents: `Perform a rigorous ILR OPI post-session diagnostic debrief for a military linguist speaking ${langName} (${dialectLabel}) in the domain "${domainLabel}".

SESSION TRANSCRIPT:
${fullTranscript}

REQUIREMENTS:
1. estimatedIlr: Realistic ILR rating (e.g., "ILR 2", "ILR 2+", "ILR 3").
2. discourseAudit: Score Point, Reason, Example, and Pivot (0–100 integers) based on PREP paragraph cohesion; provide crisp assessments of cohesionNotes, subjunctiveControl, and timeFrameStability.
3. naturalUpgrades: Pick up to 3 actual casual/Level 2 sentences the CANDIDATE said and rewrite each into natural, non-robotic ILR 2+ ${langName} (${dialectLabel}) using authentic high-register connectors. Quote the candidate's actual utterance in originalLevel2.
4. nextDrillRecommendation: One concrete actionable drill for the next session.`,
        thinkingLevel: ThinkingLevel.MEDIUM,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            estimatedIlr: {type: Type.STRING},
            summaryAssessment: {type: Type.STRING},
            discourseAudit: {
              type: Type.OBJECT,
              properties: {
                pointScore: {type: Type.INTEGER},
                reasonScore: {type: Type.INTEGER},
                exampleScore: {type: Type.INTEGER},
                pivotScore: {type: Type.INTEGER},
                cohesionNotes: {type: Type.STRING},
                subjunctiveControl: {type: Type.STRING},
                timeFrameStability: {type: Type.STRING},
              },
              required: [
                'pointScore',
                'reasonScore',
                'exampleScore',
                'pivotScore',
                'cohesionNotes',
                'subjunctiveControl',
                'timeFrameStability',
              ],
            },
            naturalUpgrades: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  originalLevel2: {type: Type.STRING},
                  upgradedLevel2Plus: {type: Type.STRING},
                  connectorsUsed: {type: Type.ARRAY, items: {type: Type.STRING}},
                  whyItUpgrades: {type: Type.STRING},
                },
                required: ['originalLevel2', 'upgradedLevel2Plus', 'connectorsUsed', 'whyItUpgrades'],
              },
            },
            nextDrillRecommendation: {type: Type.STRING},
          },
          required: [
            'estimatedIlr',
            'summaryAssessment',
            'discourseAudit',
            'naturalUpgrades',
            'nextDrillRecommendation',
          ],
        },
        emptyMessage: 'Empty response from ILR debrief.',
        budget: BUDGETS.standard,
        signal,
      });

      const summaryAssessment = sanitizeString(report.summaryAssessment, 2000);
      if (!summaryAssessment) {
        throw new UserFacingError(502, 'ILR debrief came back empty. Please try again.');
      }
      const audit = asRecord(report.discourseAudit);
      res.json({
        estimatedIlr: sanitizeString(report.estimatedIlr, 40) || 'Unrated',
        summaryAssessment,
        discourseAudit: {
          pointScore: clampScore(audit.pointScore),
          reasonScore: clampScore(audit.reasonScore),
          exampleScore: clampScore(audit.exampleScore),
          pivotScore: clampScore(audit.pivotScore),
          cohesionNotes: sanitizeString(audit.cohesionNotes, 1200),
          subjunctiveControl: sanitizeString(audit.subjunctiveControl, 1200),
          timeFrameStability: sanitizeString(audit.timeFrameStability, 1200),
        },
        naturalUpgrades: asRecordArray(report.naturalUpgrades)
          .slice(0, 3)
          .map((item) => ({
            originalLevel2: sanitizeString(item.originalLevel2, 1200),
            upgradedLevel2Plus: sanitizeString(item.upgradedLevel2Plus, 1200),
            connectorsUsed: sanitizeStringArray(item.connectorsUsed, 8, 80),
            whyItUpgrades: sanitizeString(item.whyItUpgrades, 800),
          }))
          .filter((item) => Boolean(item.originalLevel2 && item.upgradedLevel2Plus)),
        nextDrillRecommendation: sanitizeString(report.nextDrillRecommendation, 1000),
        generatedAt: new Date().toISOString(),
      });
    })
  );
}
