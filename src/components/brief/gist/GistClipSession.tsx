import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Loader2} from 'lucide-react';
import type {
  AppendErrorEventsFn,
  BriefItem,
  DrillHistoryEntry,
  GistGradeResult,
  MissionConfig,
  RecordErrorLogFn,
  VocabItem,
} from '../../../types';
import {gradeBriefGist} from '../../../services/api';
import {buildGistErrorLogEntries, countSummarySentences, GIST_TIMER_SECONDS} from '../../../utils/gistLogic';
import type {SaveVocabFn} from '../../../hooks/useWordLookup';
import {createId} from '../../../utils/ids';
import {ModalBody, ModalFooter} from '../modalLayout';
import {GistListenStage} from './GistListenStage';
import {GistResultStage} from './GistResultStage';
import {GistWriteStage} from './GistWriteStage';

type GistStage = 'listen' | 'write' | 'grading' | 'result';

interface GistClipSessionProps {
  activeClip: BriefItem;
  config: MissionConfig;
  vocabItems: VocabItem[];
  hasNextClip: boolean;
  onNextClip: () => void;
  onClose: () => void;
  onLogHistory: (entry: DrillHistoryEntry) => void;
  onRecordErrorLog: RecordErrorLogFn;
  onAppendErrorEvents?: AppendErrorEventsFn;
  onSaveVocab: SaveVocabFn;
}

/**
 * One clip's gist drill: listen once -> 60 s summary -> grading -> result. Mounted per clip (keyed by
 * clip id), so "Next clip" starts from a clean slate without resetting state by hand.
 */
export const GistClipSession: React.FC<GistClipSessionProps> = ({
  activeClip,
  config,
  vocabItems,
  hasNextClip,
  onNextClip,
  onClose,
  onLogHistory,
  onRecordErrorLog,
  onAppendErrorEvents,
  onSaveVocab,
}) => {
  const [stage, setStage] = useState<GistStage>('listen');

  // 60-second summary state
  const [secondsLeft, setSecondsLeft] = useState(GIST_TIMER_SECONDS);
  const [summaryText, setSummaryText] = useState('');
  const [submittedSummary, setSubmittedSummary] = useState('');
  const [grade, setGrade] = useState<GistGradeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoSubmitted, setAutoSubmitted] = useState(false);

  const submittingRef = useRef(false);
  const summaryRef = useRef('');

  const sentenceCount = useMemo(() => countSummarySentences(summaryText), [summaryText]);

  const submitGist = useCallback(
    async (triggeredByTimer: boolean) => {
      if (submittingRef.current) return;
      submittingRef.current = true;

      const textToGrade = summaryRef.current.trim();
      setSubmittedSummary(textToGrade);
      setAutoSubmitted(triggeredByTimer);
      setError(null);
      setStage('grading');

      try {
        const result = await gradeBriefGist({
          briefId: activeClip.id,
          summary: textToGrade,
        });
        setGrade(result);
        setStage('result');

        // Log additions/omissions/distortions to both legacy hook and unified Phase 8 error store
        const errorEntries = buildGistErrorLogEntries(activeClip, result);
        if (errorEntries.length > 0) {
          onRecordErrorLog(errorEntries);
        }

        const gistSessionId = createId('gist-sess');
        const unifiedEvents: Parameters<AppendErrorEventsFn>[0] =
          result.errors && result.errors.length > 0
            ? result.errors.map((errItem) => ({
                key: errItem.key,
                source: 'gist',
                sessionId: gistSessionId,
                wrong: errItem.wrong,
                fix: errItem.fix,
                quote: errItem.quote,
                language: activeClip.language,
              }))
            : [
                ...result.additions.map((f) => ({
                  key: 'addition' as const,
                  source: 'gist' as const,
                  sessionId: gistSessionId,
                  wrong: f.learnerSpan || f.description,
                  fix: `Stick strictly to source: "${f.sourceQuote}"`,
                  quote: f.sourceQuote,
                  language: activeClip.language,
                })),
                ...result.omissions.map((f) => ({
                  key: 'omission' as const,
                  source: 'gist' as const,
                  sessionId: gistSessionId,
                  wrong: `Omitted: ${f.description}`,
                  fix: `Include fact: "${f.sourceQuote}"`,
                  quote: f.sourceQuote,
                  language: activeClip.language,
                })),
                ...result.distortions.map((f) => ({
                  key: 'distortion' as const,
                  source: 'gist' as const,
                  sessionId: gistSessionId,
                  wrong: f.learnerSpan || f.description,
                  fix: `Align with source: "${f.sourceQuote}"`,
                  quote: f.sourceQuote,
                  language: activeClip.language,
                })),
              ];

        if (unifiedEvents.length > 0) {
          onAppendErrorEvents?.(unifiedEvents);
        }

        // Log to drill history
        const historyEntry: DrillHistoryEntry = {
          id: createId('hist-gist'),
          module: 'brief_gist',
          language: activeClip.language,
          dialect: activeClip.dialectId,
          domain: activeClip.matchingDomains?.[0] || 'general_policy',
          completedAt: new Date().toISOString(),
          summary: `Gist drill (${result.keyDetails.found}/${result.keyDetails.total} details, ${result.additions.length} additions) on "${activeClip.title.slice(0, 36)}"`,
          scoreLabel: `Main point: ${result.mainPoint}`,
        };
        onLogHistory(historyEntry);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to grade your gist right now.');
        setStage('write');
      } finally {
        submittingRef.current = false;
      }
    },
    [activeClip, onAppendErrorEvents, onLogHistory, onRecordErrorLog]
  );

  // 60-second countdown timer during the 'write' stage — auto-submits at 0:00
  useEffect(() => {
    if (stage !== 'write') return;
    if (secondsLeft <= 0) {
      void submitGist(true);
      return;
    }

    const timerId = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(timerId);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [stage, secondsLeft, submitGist]);

  const handleBeginSummary = () => {
    setSecondsLeft(GIST_TIMER_SECONDS);
    setError(null);
    setStage('write');
  };

  return (
    <>
      {stage === 'listen' && (
        <GistListenStage clip={activeClip} onBeginSummary={handleBeginSummary} onCancel={onClose} />
      )}

      {stage === 'write' && (
        <GistWriteStage
          secondsLeft={secondsLeft}
          summaryText={summaryText}
          sentenceCount={sentenceCount}
          error={error}
          onChangeSummary={(next) => {
            summaryRef.current = next;
            setSummaryText(next);
          }}
          onSubmit={() => void submitGist(false)}
        />
      )}

      {stage === 'grading' && (
        <>
          <ModalBody>
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-[#94A3B8]">
              <Loader2 className="w-7 h-7 animate-spin text-[#D99B26]" />
              <p className="text-sm font-medium text-[#F8FAFC]">Checking fidelity against the source transcript…</p>
              <p className="text-xs text-[#7D8FA3]">Scanning for additions, omissions, and distortions</p>
            </div>
          </ModalBody>
          <ModalFooter>
            <span className="text-xs text-[#94A3B8]">Comparing against source transcript…</span>
          </ModalFooter>
        </>
      )}

      {stage === 'result' && grade && (
        <GistResultStage
          clip={activeClip}
          grade={grade}
          submittedSummary={submittedSummary}
          autoSubmitted={autoSubmitted}
          config={config}
          vocabItems={vocabItems}
          onSaveVocab={onSaveVocab}
          hasNextClip={hasNextClip}
          onNextClip={onNextClip}
          onDone={onClose}
        />
      )}
    </>
  );
};
