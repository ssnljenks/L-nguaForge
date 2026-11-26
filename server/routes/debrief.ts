import {Type} from '@google/genai';
import type {Router} from 'express';
import {
  getAccuracyDescriptors,
  getFunctionLevel,
  getFunctionSpec,
  type IlrBaseLevel,
  type IlrFunctionKey,
} from '../../src/data/ilrSpeakingLevels.ts';
import type {IlrFunctionCheck, OpiAccuracyNote, TurnAssessment} from '../../src/types.ts';
import {normalizeVocabCategory} from '../../src/utils/ilrLogic.ts';
import {
  normalizeIlrFunctionKey,
  normalizeIlrFunctionRating,
  normalizeLevelFunctions,
  normalizeOpiPhase,
  normalizeTurnOutcome,
} from '../../src/utils/opiLogic.ts';
import {
  buildLevelFunctionChecks,
  calculateOpiRating,
  formatFunctionListForPrompt,
  HIGHER_LEVELS_NOT_RATED_NOTE,
} from '../../src/utils/opiRating.ts';
import {MODELS} from '../config.ts';
import {buildErrorReportingInstruction, extractReportedErrors, REPORTED_ERRORS_SCHEMA} from '../errorReporting.ts';
import {handleAsync, UserFacingError} from '../errors.ts';
import {BUDGETS, ThinkingLevel} from '../gemini.ts';
import {
  asRecord,
  asRecordArray,
  assertUnclassifiedText,
  clampNumber,
  clampScore,
  resolveTrainingContext,
  sanitizeString,
  sanitizeStringArray,
} from '../validation.ts';
import type {RouteDeps} from './types.ts';

function formatClock(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function sanitizeClientAssessments(raw: unknown): TurnAssessment[] {
  return asRecordArray(raw)
    .slice(-50)
    .filter((item) => typeof item.functionKey === 'string' && item.functionKey.trim().length > 0)
    .map((item) => {
      const fk = normalizeIlrFunctionKey(item.functionKey);
      const spec = getFunctionSpec(fk);
      return {
        functionKey: fk,
        outcome: normalizeTurnOutcome(item.outcome),
        evidence: sanitizeString(item.evidence, 300),
        phase: item.phase ? normalizeOpiPhase(item.phase) : 'level_check',
        targetLevel:
          item.targetLevel === 1 || item.targetLevel === 2 || item.targetLevel === 3
            ? (item.targetLevel as IlrBaseLevel)
            : (spec?.level ?? 2),
      };
    });
}

function mergeFunctionEvidence(
  baseChecks: readonly IlrFunctionCheck[],
  rawModelChecks: unknown,
  gridLevel: IlrBaseLevel
): IlrFunctionCheck[] {
  const modelByKey = new Map<IlrFunctionKey, {status?: string; note: string; evidence: string[]}>();
  for (const item of asRecordArray(rawModelChecks)) {
    const key = normalizeIlrFunctionKey(item.functionKey ?? item.id ?? item.label, gridLevel);
    if (getFunctionLevel(key) !== gridLevel) continue;
    modelByKey.set(key, {
      status: typeof item.status === 'string' ? item.status : undefined,
      note: sanitizeString(item.note, 260),
      evidence: sanitizeStringArray(item.evidence, 4, 240),
    });
  }

  return baseChecks.map((check) => {
    const fromModel = modelByKey.get(check.functionKey);
    if (!fromModel) return check;
    const combinedEvidence = Array.from(new Set([...(check.evidence ?? []), ...fromModel.evidence])).filter(Boolean);
    return {
      ...check,
      note: fromModel.note || check.note,
      ...(combinedEvidence.length > 0 ? {evidence: combinedEvidence} : {}),
    };
  });
}

export function registerDebriefRoutes(router: Router, {generate}: RouteDeps): void {
  // Post-session ILR debrief: Floor/Ceiling/Plus rating (0+..3), ceiling moment, next-level 6-function grid, accuracy notes, and auto-vocab
  router.post(
    '/debrief/analyze',
    handleAsync(async (req, res, signal) => {
      const {language, langName, dialectLabel, domainLabel} = resolveTrainingContext(req.body);
      const sessionType =
        req.body?.sessionType === 'prep_monologue'
          ? 'prep_monologue'
          : req.body?.sessionType === 'roleplay'
            ? 'roleplay'
            : 'opi';
      const messages = asRecordArray(req.body?.messages).slice(-32);
      const clientAssessments = sanitizeClientAssessments(req.body?.assessments);

      const hasCandidateSpeech = messages.some((m) => m.role === 'candidate' && sanitizeString(m.text, 1200));
      if (!hasCandidateSpeech) {
        throw new UserFacingError(400, 'No candidate speech found in this session to analyze.');
      }

      const transcriptLines: string[] = [];
      let fallbackSeconds = 0;
      for (const m of messages) {
        const text = sanitizeString(m.text, 1200);
        if (!text) continue;
        const sec =
          typeof m.elapsedSeconds === 'number' && Number.isFinite(m.elapsedSeconds)
            ? Math.max(0, Math.round(m.elapsedSeconds))
            : fallbackSeconds;
        fallbackSeconds = Math.max(fallbackSeconds + 25, sec + 15);
        const speaker = m.role === 'examiner' ? 'EXAMINER' : 'CANDIDATE';
        transcriptLines.push(`[${formatClock(sec)} | ${sec}s] ${speaker}: ${text}`);
      }
      const fullTranscript = transcriptLines.join('\n');

      assertUnclassifiedText(fullTranscript);

      const ratedClientAssessments = clientAssessments.filter((a) => a.phase !== 'warmup');
      const ratingEnginePreview = ratedClientAssessments.length > 0 ? calculateOpiRating(ratedClientAssessments) : null;

      const assessmentContextBlock =
        ratedClientAssessments.length > 0
          ? `\nPER-TURN EXAMINER ASSESSMENTS CAPTURED DURING CALL:\n${ratedClientAssessments
              .map((a) => `- [${a.functionKey}] ${a.outcome.toUpperCase()}: ${a.evidence}`)
              .join(
                '\n'
              )}\nComputed Floor/Ceiling baseline: ${ratingEnginePreview?.displayRating} (Floor ${ratingEnginePreview?.floor}, Next-level grid: Level ${ratingEnginePreview?.gridLevel}).`
          : '';

      const scopeHeader =
        sessionType === 'prep_monologue'
          ? `Perform a rigorous ILR diagnostic debrief (practice estimate, not an official rating) for a ${langName} (${dialectLabel}) monologue on "${domainLabel}".`
          : sessionType === 'roleplay'
            ? `Perform a rigorous everyday civilian ILR role-play diagnostic debrief (practice estimate, not an official rating) for a speaker using ${langName} (${dialectLabel}). Do NOT assume or inject military topics.`
            : `Perform a rigorous general ILR Oral Proficiency Interview (OPI) post-session diagnostic debrief (practice estimate, not an official rating) for a speaker using ${langName} (${dialectLabel}). Do NOT assume or inject military topics unless the candidate raised them.`;

      const targetGridHint = ratingEnginePreview ? ratingEnginePreview.gridLevel : 3;
      const targetAccuracyDescriptors = getAccuracyDescriptors(
        ratingEnginePreview ? ratingEnginePreview.accuracyLevel : targetGridHint
      );

      const report = await generate({
        model: MODELS.standard,
        contents: `${scopeHeader}

SESSION TRANSCRIPT (with elapsed timestamps):
${fullTranscript}${assessmentContextBlock}

ILR LEVEL 1 FUNCTIONS:
${formatFunctionListForPrompt(1)}

ILR LEVEL 2 FUNCTIONS:
${formatFunctionListForPrompt(2)}

ILR LEVEL 3 FUNCTIONS:
${formatFunctionListForPrompt(3)}

REQUIREMENTS:
1. estimatedIlr: Practice estimate string strictly within "0+", "1", "1+", "2", "2+", or "3" (do NOT rate above 3; if sustained at Level 3, use "3").
2. floorLevel: integer 0 | 1 | 2 | 3 (highest level where all tested functions were sustained across turns).
3. oneLineRationale: One crisp sentence explaining floor + where breakdowns occurred (max 180 chars).
4. summaryAssessment: 2–3 sentences summarizing strengths and primary linguistic ceiling.
5. ceilingMoment: Pinpoint the SINGLE clearest breakdown / ceiling moment from the CANDIDATE's turns:
   - timestampSeconds: integer elapsed seconds from the candidate turn's [MM:SS | Xs] tag.
   - examinerPrompt: preceding examiner prompt.
   - candidateUtterance: exact quote of the candidate's utterance from the transcript.
   - problemSpan: exact substring inside candidateUtterance where breakdown occurred.
   - fix: natural higher-level correction in ${langName} (${dialectLabel}).
   - failedFunction: valid functionKey from the Level 1, Level 2, or Level 3 lists above (e.g. "l3_hypothesize").
   - explanation: 1 concise English sentence explaining what broke down.
6. levelFunctions: Evaluate ALL 6 functions for Level ${targetGridHint} using exact functionKey strings:
${formatFunctionListForPrompt(targetGridHint)}
   Each item MUST include { functionKey, status ("met" | "partly" | "not_met"), note, evidence: [brief candidate quote or observation] }.
7. accuracyNotes: Evaluate these ILR accuracy descriptors for Level ${ratingEnginePreview?.accuracyLevel ?? targetGridHint}:
${targetAccuracyDescriptors.map((d) => `- ${d}`).join('\n')}
   Each item: { descriptor, observation, status ("strength" | "watch" | "gap") }.
8. autoAddedVocab: 2–4 high-value ${langName} (${dialectLabel}) expressions or formal connectors from your fixes/upgrades (avoid artificial military jargon for general OPI).
9. discourseAudit: Point, Reason, Example, Pivot (0–100 integers) + cohesionNotes, subjunctiveControl, timeFrameStability.
10. naturalUpgrades: Up to 3 candidate sentences rewritten into natural higher-register ${langName} (${dialectLabel}).
11. nextDrillRecommendation: One concrete actionable next drill.
12. ${buildErrorReportingInstruction(language, ['grammar', 'register', 'opi_function'])}`,
        thinkingLevel: ThinkingLevel.MEDIUM,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            estimatedIlr: {type: Type.STRING},
            floorLevel: {type: Type.INTEGER},
            oneLineRationale: {type: Type.STRING},
            summaryAssessment: {type: Type.STRING},
            ceilingMoment: {
              type: Type.OBJECT,
              properties: {
                timestampSeconds: {type: Type.INTEGER},
                examinerPrompt: {type: Type.STRING},
                candidateUtterance: {type: Type.STRING},
                problemSpan: {type: Type.STRING},
                fix: {type: Type.STRING},
                failedFunction: {type: Type.STRING},
                explanation: {type: Type.STRING},
              },
              required: [
                'timestampSeconds',
                'examinerPrompt',
                'candidateUtterance',
                'problemSpan',
                'fix',
                'failedFunction',
                'explanation',
              ],
            },
            levelFunctions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  functionKey: {type: Type.STRING},
                  status: {type: Type.STRING},
                  note: {type: Type.STRING},
                  evidence: {type: Type.ARRAY, items: {type: Type.STRING}},
                },
                required: ['functionKey', 'status', 'note', 'evidence'],
              },
            },
            accuracyNotes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  descriptor: {type: Type.STRING},
                  observation: {type: Type.STRING},
                  status: {type: Type.STRING},
                },
                required: ['descriptor', 'observation', 'status'],
              },
            },
            autoAddedVocab: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  term: {type: Type.STRING},
                  englishConcept: {type: Type.STRING},
                  contextSentence: {type: Type.STRING},
                  registerTag: {type: Type.STRING},
                  category: {type: Type.STRING},
                },
                required: ['term', 'englishConcept', 'contextSentence', 'registerTag', 'category'],
              },
            },
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
            errors: REPORTED_ERRORS_SCHEMA,
          },
          required: [
            'estimatedIlr',
            'floorLevel',
            'oneLineRationale',
            'summaryAssessment',
            'ceilingMoment',
            'levelFunctions',
            'accuracyNotes',
            'autoAddedVocab',
            'discourseAudit',
            'naturalUpgrades',
            'nextDrillRecommendation',
            'errors',
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
      const rawCeiling = asRecord(report.ceilingMoment);
      const failedFunctionKey = normalizeIlrFunctionKey(rawCeiling.failedFunction, targetGridHint);
      const failedSpec = getFunctionSpec(failedFunctionKey);
      const candidateUtterance = sanitizeString(rawCeiling.candidateUtterance, 1600);

      const ceilingMoment = candidateUtterance
        ? {
            timestampSeconds: Math.round(clampNumber(rawCeiling.timestampSeconds, 0, 24 * 60 * 60, 0)),
            examinerPrompt: sanitizeString(rawCeiling.examinerPrompt, 1200),
            candidateUtterance,
            problemSpan: sanitizeString(rawCeiling.problemSpan, 600),
            fix: sanitizeString(rawCeiling.fix, 1200),
            failedFunction: failedFunctionKey,
            failedFunctionLabel: failedSpec?.label ?? 'Hypothesize',
            explanation: sanitizeString(rawCeiling.explanation, 600),
          }
        : undefined;

      // Determine authoritative rating via rating engine when assessments exist, or from model levelFunctions
      const rawModelFns = report.levelFunctions ?? report.level3Functions;
      let finalRating = ratingEnginePreview;
      if (!finalRating) {
        const modelFloor =
          report.floorLevel === 0 || report.floorLevel === 1 || report.floorLevel === 2 || report.floorLevel === 3
            ? (report.floorLevel as 0 | 1 | 2 | 3)
            : undefined;
        const syntheticGrid: IlrBaseLevel =
          modelFloor === undefined ? 3 : modelFloor >= 3 ? 3 : ((modelFloor + 1) as IlrBaseLevel);
        const normalizedModelFns = normalizeLevelFunctions(rawModelFns, syntheticGrid);
        const syntheticAssessments: TurnAssessment[] = [];
        if (modelFloor && modelFloor >= 1) {
          for (const check of buildLevelFunctionChecks(modelFloor as IlrBaseLevel, [])) {
            syntheticAssessments.push({
              functionKey: check.functionKey,
              outcome: 'sustained',
              evidence: 'Sustained baseline reported in session debrief.',
              phase: 'level_check',
              targetLevel: modelFloor as IlrBaseLevel,
            });
          }
        }
        for (const fn of normalizedModelFns) {
          syntheticAssessments.push({
            functionKey: fn.functionKey,
            outcome: fn.status === 'met' ? 'sustained' : fn.status === 'partly' ? 'partial' : 'breakdown',
            evidence: fn.evidence?.[0] ?? fn.note,
            phase: 'probe',
            targetLevel: syntheticGrid,
          });
        }
        finalRating = calculateOpiRating(syntheticAssessments);
      }

      const mergedFunctions = mergeFunctionEvidence(finalRating.functionChecks, rawModelFns, finalRating.gridLevel).map(
        (fn) => {
          if (ratingEnginePreview) return fn;
          const matchingRaw = asRecordArray(rawModelFns).find(
            (item) =>
              normalizeIlrFunctionKey(item.functionKey ?? item.id ?? item.label, finalRating.gridLevel) ===
              fn.functionKey
          );
          return matchingRaw ? {...fn, status: normalizeIlrFunctionRating(matchingRaw.status)} : fn;
        }
      );

      const modelAccuracy = asRecordArray(report.accuracyNotes);
      const accuracyNotes: OpiAccuracyNote[] = finalRating.accuracyNotes.map((baseNote) => {
        const matched = modelAccuracy.find(
          (m) => sanitizeString(m.descriptor, 120).toLowerCase() === baseNote.descriptor.toLowerCase()
        );
        if (!matched) return baseNote;
        const st = sanitizeString(matched.status, 20).toLowerCase();
        const status: OpiAccuracyNote['status'] =
          st === 'strength' || st === 'gap' || st === 'watch' ? st : baseNote.status;
        return {
          descriptor: baseNote.descriptor,
          observation: sanitizeString(matched.observation, 280) || baseNote.observation,
          status,
        };
      });

      const autoAddedVocab = asRecordArray(report.autoAddedVocab)
        .slice(0, 5)
        .map((item) => ({
          term: sanitizeString(item.term, 140),
          englishConcept: sanitizeString(item.englishConcept, 240),
          contextSentence: sanitizeString(item.contextSentence, 500),
          registerTag: sanitizeString(item.registerTag, 80) || 'ILR 2+ Upgrade',
          category: normalizeVocabCategory(sanitizeString(item.category, 80)),
        }))
        .filter((item) => Boolean(item.term));

      res.json({
        estimatedIlr: finalRating.displayRating,
        floorLevel: finalRating.floor,
        ceilingLevel: finalRating.ceiling,
        gridLevel: finalRating.gridLevel,
        ...(finalRating.ratingNote || finalRating.displayRating === '3'
          ? {ratingNote: finalRating.ratingNote ?? HIGHER_LEVELS_NOT_RATED_NOTE}
          : {}),
        oneLineRationale:
          sanitizeString(report.oneLineRationale, 300) || finalRating.rationale || summaryAssessment.slice(0, 200),
        summaryAssessment,
        ...(ceilingMoment ? {ceilingMoment} : {}),
        levelFunctions: mergedFunctions,
        accuracyNotes,
        autoAddedVocab,
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
        errors: extractReportedErrors(report.errors, language),
        generatedAt: new Date().toISOString(),
      });
    })
  );
}
