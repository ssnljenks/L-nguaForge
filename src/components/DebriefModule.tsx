import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {IlrFunctionKey} from '../data/ilrSpeakingLevels';
import type {
  AppendErrorEventsFn,
  DebriefReport,
  OpiRedoRecord,
  OpiSession,
  RoleplayDebriefResult,
  RoleplayScenarioPublic,
  TargetLanguage,
  VocabItem,
} from '../types';
import {filterItemsByLanguage, LANGUAGE_LABELS, resolveActiveSessionForLanguage} from '../utils/ilrLogic';
import {DebriefSessionView} from './debrief/DebriefSessionView';

interface DebriefModuleProps {
  language: TargetLanguage;
  sessions: OpiSession[];
  selectedSessionId: string;
  onSelectSession: (id: string) => void;
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
 * Past-session debriefs: picks the session for the current language and renders its debrief. State
 * that outlives one session (auto-analysis and auto-vocab bookkeeping, the audit toggle) lives here.
 */
export const DebriefModule: React.FC<DebriefModuleProps> = ({
  language,
  sessions,
  selectedSessionId,
  onSelectSession,
  onSaveVocab,
  ...sessionHandlers
}) => {
  const [showDetailedAudit, setShowDetailedAudit] = useState(false);
  const autoAnalyzedRef = useRef<Set<string>>(new Set());
  const autoSavedVocabRef = useRef<Set<string>>(new Set());

  const languageSessions = useMemo(() => filterItemsByLanguage(sessions, language), [sessions, language]);

  const activeSession = useMemo(
    () => resolveActiveSessionForLanguage(sessions, selectedSessionId, language),
    [sessions, selectedSessionId, language]
  );

  const wasAutoAnalyzed = useCallback((sessionId: string) => autoAnalyzedRef.current.has(sessionId), []);
  const markAutoAnalyzed = useCallback((sessionId: string) => {
    autoAnalyzedRef.current.add(sessionId);
  }, []);

  // Auto-add debrief vocabulary items to Vocab once per generated debrief
  useEffect(() => {
    if (!activeSession?.debrief) return;
    const key = `${activeSession.id}:${activeSession.debrief.generatedAt}`;
    if (autoSavedVocabRef.current.has(key)) return;
    const autoWords = activeSession.debrief.autoAddedVocab ?? [];
    if (autoWords.length === 0) return;
    autoSavedVocabRef.current.add(key);
    for (const item of autoWords) {
      onSaveVocab({
        term: item.term,
        englishConcept: item.englishConcept,
        contextSentence: item.contextSentence,
        registerTag: item.registerTag,
        category: item.category,
        language: activeSession.language,
        dialect: activeSession.dialect,
        ...(activeSession.domain ? {domain: activeSession.domain} : {}),
        source: 'opi',
      });
    }
  }, [activeSession, onSaveVocab]);

  if (!activeSession) {
    return (
      <div className="rounded-xl border border-[#23303E] bg-[#111922] p-10 text-center space-y-2">
        <h1 className="font-display text-xl font-semibold text-[#F8FAFC]">
          No Completed {LANGUAGE_LABELS[language]} Sessions Yet
        </h1>
        <p className="text-sm text-[#94A3B8]">
          Complete a {LANGUAGE_LABELS[language]} OPI call or PREP monologue to unlock your speaking debrief.
        </p>
      </div>
    );
  }

  return (
    <DebriefSessionView
      key={activeSession.id}
      activeSession={activeSession}
      languageSessions={languageSessions}
      onSelectSession={onSelectSession}
      wasAutoAnalyzed={wasAutoAnalyzed}
      markAutoAnalyzed={markAutoAnalyzed}
      showDetailedAudit={showDetailedAudit}
      onToggleDetailedAudit={() => setShowDetailedAudit((s) => !s)}
      onSaveVocab={onSaveVocab}
      {...sessionHandlers}
    />
  );
};
