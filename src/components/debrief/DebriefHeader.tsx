import React from 'react';
import {FileCheck2, Loader2} from 'lucide-react';
import type {OpiSession} from '../../types';
import {formatSecondsClock, getDialectInfo, getDomainInfo, LANGUAGE_LABELS} from '../../utils/ilrLogic';

interface DebriefHeaderProps {
  activeSession: OpiSession;
  languageSessions: OpiSession[];
  onSelectSession: (id: string) => void;
  hasCandidateSpeech: boolean;
  isAnalyzing: boolean;
  hasReport: boolean;
  onAnalyze: () => void;
  error: string | null;
}

/** Setup: session picker, (Re-)analyze, errors and the session meta strip. */
export const DebriefHeader: React.FC<DebriefHeaderProps> = ({
  activeSession,
  languageSessions,
  onSelectSession,
  hasCandidateSpeech,
  isAnalyzing,
  hasReport: report,
  onAnalyze: handleAnalyze,
  error,
}) => {
  const dialectInfo = getDialectInfo(activeSession.language, activeSession.dialect);
  return (
    <>
      {/* Header & Session Picker (Domain shown only for PREP monologues, never for general OPI or Role-play) */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-5 border-b border-[#23303E]">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-[#94A3B8]">
            Post-Call Debrief · {LANGUAGE_LABELS[activeSession.language]} ({dialectInfo.short})
            {activeSession.type === 'roleplay' && activeSession.roleplayScenario
              ? ` · Role-play Level ${activeSession.roleplayScenario.level}`
              : activeSession.type === 'prep_monologue' && activeSession.domain
                ? ` · ${getDomainInfo(activeSession.domain).shortLabel}`
                : ''}
          </p>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-[#F8FAFC]">
            Speaking Debrief
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2">
            <label htmlFor="debrief-session-select" className="text-xs text-[#94A3B8] whitespace-nowrap">
              Session
            </label>
            <select
              id="debrief-session-select"
              value={activeSession.id}
              onChange={(e) => onSelectSession(e.target.value)}
              className="min-h-[44px] rounded-lg border border-[#23303E] bg-[#111922] px-3 py-2 text-sm text-[#E6EDF3] focus:outline-none focus:border-[#D99B26] max-w-[260px]"
            >
              {languageSessions.map((s) => {
                const dial = getDialectInfo(s.language, s.dialect).short;
                const labelDetail = s.type === 'prep_monologue' && s.domain ? getDomainInfo(s.domain).shortLabel : dial;
                const typeLabel = s.type === 'prep_monologue' ? 'PREP' : s.type === 'roleplay' ? 'Role-play' : 'OPI';
                const dateStr = new Date(s.startedAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                });
                return (
                  <option key={s.id} value={s.id}>
                    {LANGUAGE_LABELS[s.language]} · {labelDetail} ({typeLabel} · {dateStr})
                  </option>
                );
              })}
            </select>
          </div>

          {hasCandidateSpeech && (
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              className="inline-flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-lg border border-[#2E4054] bg-[#16202B] text-xs font-medium text-[#E6EDF3] hover:bg-[#1E2C3A] disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {isAnalyzing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#D99B26]" />
              ) : (
                <FileCheck2 className="w-3.5 h-3.5 text-[#D99B26]" />
              )}
              <span>{isAnalyzing ? 'Analyzing…' : report ? 'Re-analyze' : 'Run Debrief'}</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-[#F87171]/40 bg-red-950/30 px-4 py-3 text-sm text-red-200"
        >
          {error}
        </div>
      )}

      {/* Session Meta Strip */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#94A3B8]">
        {activeSession.mode && (
          <>
            <span className="text-[#CBD5E1] font-medium">
              {activeSession.mode === 'exam' ? 'Exam mode' : 'Practice mode'}
            </span>
            <span aria-hidden="true">·</span>
          </>
        )}
        <span className="font-mono tabular-nums">Duration {formatSecondsClock(activeSession.durationSeconds)}</span>
        <span aria-hidden="true">·</span>
        <span className="font-mono tabular-nums">{activeSession.messages.length} turns</span>
      </div>
    </>
  );
};
