import React, {useCallback, useEffect, useRef, useState} from 'react';
import type {IlrBaseLevel, IlrFunctionKey} from '../../data/ilrSpeakingLevels';
import type {
  AppendErrorEventsFn,
  DebriefReport,
  OpiRedoRecord,
  OpiSession,
  RoleplayDebriefResult,
  RoleplayScenarioPublic,
  VocabItem,
} from '../../types';
import {getDialectInfo} from '../../utils/ilrLogic';
import {normalizeLevelFunctions} from '../../utils/opiLogic';
import {roleplayChecklistToAssessments} from '../../utils/opiRoleplay';
import {calculateOpiRating, resolvePrimaryRetryFunction} from '../../utils/opiRating';
import {gradeRoleplayDebrief, runSessionDebrief} from '../../services/api';
import {CeilingMomentCard} from './CeilingMomentCard';
import {DebriefHeader} from './DebriefHeader';
import {DebriefLevelCard} from './DebriefLevelCard';
import {DebriefPending} from './DebriefPending';
import {AccuracyNotesCard, AutoVocabCard, TargetedRetryCard} from './DebriefReportCards';
import {DiscourseAuditPanel} from './DiscourseAuditPanel';
import {LevelFunctionsGrid} from './LevelFunctionsGrid';
import {RoleplayDebriefCard} from './RoleplayDebriefCard';

interface DebriefSessionViewProps {
  activeSession: OpiSession;
  languageSessions: OpiSession[];
  onSelectSession: (id: string) => void;
  /** Auto-analysis runs once per session id, even if the view is remounted. */
  wasAutoAnalyzed: (sessionId: string) => boolean;
  markAutoAnalyzed: (sessionId: string) => void;
  showDetailedAudit: boolean;
  onToggleDetailedAudit: () => void;
  onSaveDebrief: (sessionId: string, report: DebriefReport) => void;
  onSaveRoleplayDebrief?: (sessionId: string, rpDebrief: RoleplayDebriefResult) => void;
  onSaveRedo?: (sessionId: string, record: OpiRedoRecord) => void;
  onSaveVocab: (item: Omit<VocabItem, 'id' | 'createdAt' | 'mastery' | 'reviewCount'>) => void;
  onAppendErrorEvents?: AppendErrorEventsFn;
  onStartTargetedRetry?: (functionKey: IlrFunctionKey) => void;
  onReplayRoleplayWithTwist?: (payload: {
    scenario: RoleplayScenarioPublic;
    hiddenGoal: string;
    complication: string;
  }) => void;
}

/**
 * One session's debrief: analysis (run), then the report (review). Mounted per session (keyed by
 * session id), so switching sessions starts with a clean error, clip, redo and saved-word state.
 */
export const DebriefSessionView: React.FC<DebriefSessionViewProps> = ({
  activeSession,
  languageSessions,
  onSelectSession,
  wasAutoAnalyzed,
  markAutoAnalyzed,
  showDetailedAudit,
  onToggleDetailedAudit,
  onSaveDebrief,
  onSaveRoleplayDebrief,
  onSaveRedo,
  onSaveVocab,
  onAppendErrorEvents,
  onStartTargetedRetry,
  onReplayRoleplayWithTwist,
}) => {
  const hasCandidateSpeech = activeSession.messages.some((m) => m.role === 'candidate' && m.text.trim().length > 0);

  // A freshly ended OPI or role-play with candidate speech and no debrief yet is analyzed automatically,
  // once per session: the view starts in the analyzing state and the effect below sends the request.
  const [autoAnalyzeOnMount] = useState(() => {
    const needsMainDebrief = !activeSession.debrief;
    const needsRpDebrief = Boolean(activeSession.roleplayScenario && !activeSession.roleplayDebrief);
    return (needsMainDebrief || needsRpDebrief) && hasCandidateSpeech && !wasAutoAnalyzed(activeSession.id);
  });
  const [isAnalyzing, setIsAnalyzing] = useState(autoAnalyzeOnMount);
  const [error, setError] = useState<string | null>(null);

  /** Sends the analysis requests; callers set the analyzing state first. */
  const runAnalysis = useCallback(async () => {
    try {
      const dialectInfo = getDialectInfo(activeSession.language, activeSession.dialect);
      let combinedAssessments = [...(activeSession.assessments ?? [])];

      // 1. If this session contains a role-play (standalone OR embedded inside OPI), grade its 3-item checklist & reveal twist
      if (activeSession.roleplayScenario && !activeSession.roleplayDebrief) {
        const sc = activeSession.roleplayScenario;
        const rpMsgs =
          activeSession.type === 'roleplay'
            ? activeSession.messages
            : activeSession.messages.filter((m) => m.phase === 'roleplay');
        const sourceMsgs = rpMsgs.length > 0 ? rpMsgs : activeSession.messages;
        const hasRpCandidateSpeech = sourceMsgs.some((m) => m.role === 'candidate' && m.text.trim().length > 0);
        if (hasRpCandidateSpeech) {
          const rpDebrief = await gradeRoleplayDebrief({
            scenarioId: sc.scenarioId,
            scenarioToken: sc.scenarioToken,
            language: activeSession.language,
            dialect: dialectInfo.id,
            level: sc.level,
            situationEnglish: sc.situationEnglish,
            learnerGoal: sc.learnerGoal,
            register: sc.register,
            characterRole: sc.characterRole,
            messages: sourceMsgs.map((m) => ({
              role: m.role,
              text: m.text,
              elapsedSeconds: m.elapsedSeconds,
            })),
          });
          onSaveRoleplayDebrief?.(activeSession.id, rpDebrief);
          if (rpDebrief.errors && rpDebrief.errors.length > 0) {
            onAppendErrorEvents?.(
              rpDebrief.errors.map((errItem) => ({
                key: errItem.key,
                source: 'roleplay',
                sessionId: activeSession.id,
                wrong: errItem.wrong,
                fix: errItem.fix,
                quote: errItem.quote,
                language: activeSession.language,
              }))
            );
          }
          combinedAssessments = [
            ...combinedAssessments,
            ...roleplayChecklistToAssessments(rpDebrief.level, rpDebrief.checklist),
          ];
        }
      } else if (activeSession.roleplayDebrief) {
        combinedAssessments = [
          ...combinedAssessments,
          ...roleplayChecklistToAssessments(
            activeSession.roleplayDebrief.level,
            activeSession.roleplayDebrief.checklist
          ),
        ];
      }

      // 2. Run main ILR debrief using combined assessments (including role-play checklist evidence)
      const report = await runSessionDebrief({
        language: activeSession.language,
        dialect: dialectInfo.id,
        sessionType: activeSession.type,
        ...(activeSession.type === 'prep_monologue' && activeSession.domain ? {domain: activeSession.domain} : {}),
        assessments: combinedAssessments,
        messages: activeSession.messages.map((m) => ({
          role: m.role,
          text: m.text,
          elapsedSeconds: m.elapsedSeconds,
        })),
      });
      onSaveDebrief(activeSession.id, report);
      if (report.errors && report.errors.length > 0) {
        onAppendErrorEvents?.(
          report.errors.map((errItem) => ({
            key: errItem.key,
            source: activeSession.type === 'roleplay' ? 'roleplay' : 'opi',
            sessionId: activeSession.id,
            wrong: errItem.wrong,
            fix: errItem.fix,
            quote: errItem.quote,
            language: activeSession.language,
          }))
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate ILR debrief.');
    } finally {
      setIsAnalyzing(false);
    }
  }, [activeSession, onAppendErrorEvents, onSaveDebrief, onSaveRoleplayDebrief]);

  const handleAnalyze = () => {
    setIsAnalyzing(true);
    setError(null);
    void runAnalysis();
  };

  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!autoAnalyzeOnMount || autoStartedRef.current) return;
    autoStartedRef.current = true;
    markAutoAnalyzed(activeSession.id);
    void runAnalysis();
  }, [autoAnalyzeOnMount, activeSession.id, markAutoAnalyzed, runAnalysis]);

  const report = activeSession.debrief;
  const rpDebrief = activeSession.roleplayDebrief;
  const combinedFallbackAssessments = rpDebrief
    ? [...(activeSession.assessments ?? []), ...roleplayChecklistToAssessments(rpDebrief.level, rpDebrief.checklist)]
    : (activeSession.assessments ?? []);
  const ratingFallback = calculateOpiRating(combinedFallbackAssessments);
  const gridLevel: IlrBaseLevel = report?.gridLevel ?? ratingFallback.gridLevel;
  const levelFunctions = report ? normalizeLevelFunctions(report.levelFunctions, gridLevel) : [];
  const accuracyNotes = report?.accuracyNotes?.length ? report.accuracyNotes : ratingFallback.accuracyNotes;
  const primaryRetryFn = report
    ? resolvePrimaryRetryFunction(levelFunctions, report.ceilingMoment?.failedFunction)
    : null;
  const ceiling = report?.ceilingMoment;
  const autoVocab = report?.autoAddedVocab ?? [];

  const displayRating = report?.estimatedIlr || ratingFallback.displayRating;
  const isLevel3Rating = displayRating === '3' || report?.floorLevel === 3;
  const floorLabel = report?.floorLevel ?? ratingFallback.floor;
  const ceilingLabel = report?.ceilingLevel !== undefined ? report.ceilingLevel : ratingFallback.ceiling;

  return (
    <div className="space-y-6 pb-24 md:pb-8">
      <DebriefHeader
        activeSession={activeSession}
        languageSessions={languageSessions}
        onSelectSession={onSelectSession}
        hasCandidateSpeech={hasCandidateSpeech}
        isAnalyzing={isAnalyzing}
        hasReport={Boolean(report)}
        onAnalyze={handleAnalyze}
        error={error}
      />

      {!report ? (
        <DebriefPending isAnalyzing={isAnalyzing} hasCandidateSpeech={hasCandidateSpeech} onAnalyze={handleAnalyze} />
      ) : (
        <div className="space-y-6">
          <DebriefLevelCard
            report={report}
            displayRating={displayRating}
            floorLabel={floorLabel}
            ceilingLabel={ceilingLabel}
            isLevel3Rating={isLevel3Rating}
          />

          {rpDebrief && (
            <RoleplayDebriefCard
              rpDebrief={rpDebrief}
              activeSession={activeSession}
              onReplayRoleplayWithTwist={onReplayRoleplayWithTwist}
            />
          )}

          {ceiling && (
            <CeilingMomentCard
              activeSession={activeSession}
              ceiling={ceiling}
              onSaveRedo={onSaveRedo}
              onAppendErrorEvents={onAppendErrorEvents}
            />
          )}

          <LevelFunctionsGrid gridLevel={gridLevel} floorLabel={floorLabel} levelFunctions={levelFunctions} />

          {accuracyNotes.length > 0 && (
            <AccuracyNotesCard accuracyNotes={accuracyNotes} floorLabel={floorLabel} gridLevel={gridLevel} />
          )}

          {autoVocab.length > 0 && <AutoVocabCard autoVocab={autoVocab} />}

          {primaryRetryFn && onStartTargetedRetry && (
            <TargetedRetryCard primaryRetryFn={primaryRetryFn} onStartTargetedRetry={onStartTargetedRetry} />
          )}

          <DiscourseAuditPanel
            report={report}
            activeSession={activeSession}
            showDetailedAudit={showDetailedAudit}
            onToggleDetailedAudit={onToggleDetailedAudit}
            onSaveVocab={onSaveVocab}
          />
        </div>
      )}
    </div>
  );
};
