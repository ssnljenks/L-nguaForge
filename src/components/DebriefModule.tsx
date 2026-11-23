import React, {useEffect, useMemo, useState} from 'react';
import {ArrowRight, BookmarkPlus, Check, FileCheck2, Loader2} from 'lucide-react';
import type {DebriefReport, OpiSession, TargetLanguage, VocabItem} from '../types';
import {
  filterItemsByLanguage,
  formatSecondsClock,
  getDialectInfo,
  getDomainInfo,
  LANGUAGE_LABELS,
  resolveActiveSessionForLanguage,
} from '../utils/ilrLogic';
import {runSessionDebrief} from '../services/api';

interface DebriefModuleProps {
  language: TargetLanguage;
  sessions: OpiSession[];
  selectedSessionId: string;
  onSelectSession: (id: string) => void;
  onSaveDebrief: (sessionId: string, report: DebriefReport) => void;
  onSaveVocab: (item: Omit<VocabItem, 'id' | 'createdAt' | 'mastery' | 'reviewCount'>) => void;
}

export const DebriefModule: React.FC<DebriefModuleProps> = ({
  language,
  sessions,
  selectedSessionId,
  onSelectSession,
  onSaveDebrief,
  onSaveVocab,
}) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedKeys, setSavedKeys] = useState<Record<string, boolean>>({});

  const languageSessions = useMemo(() => filterItemsByLanguage(sessions, language), [sessions, language]);

  const activeSession = useMemo(
    () => resolveActiveSessionForLanguage(sessions, selectedSessionId, language),
    [sessions, selectedSessionId, language]
  );

  useEffect(() => {
    setError(null);
    setSavedKeys({});
  }, [language]);

  const handleAnalyze = async () => {
    if (!activeSession) return;
    setIsAnalyzing(true);
    setError(null);
    try {
      const dialectInfo = getDialectInfo(activeSession.language, activeSession.dialect);
      const domainInfo = getDomainInfo(activeSession.domain);
      const report = await runSessionDebrief({
        language: activeSession.language,
        dialect: dialectInfo.id,
        domain: domainInfo.id,
        messages: activeSession.messages.map((m) => ({role: m.role, text: m.text})),
      });
      onSaveDebrief(activeSession.id, report);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate ILR debrief.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSaveConnector = (connector: string, upgradedSentence: string, idx: number) => {
    if (!activeSession) return;
    const key = `conn-${idx}-${connector}`;
    onSaveVocab({
      term: connector,
      englishConcept: `High-register ILR 2+ connector (from debrief upgrade)`,
      contextSentence: upgradedSentence,
      registerTag: 'ILR 2+ Connector',
      category: 'High-Register Connectors',
      language: activeSession.language,
      dialect: activeSession.dialect,
      domain: activeSession.domain,
    });
    setSavedKeys((prev) => ({...prev, [key]: true}));
  };

  if (!activeSession) {
    return (
      <div className="rounded-xl border border-[#23303E] bg-[#111922] p-10 text-center space-y-2">
        <h1 className="text-xl font-semibold text-[#F8FAFC]">No Completed {LANGUAGE_LABELS[language]} Sessions Yet</h1>
        <p className="text-sm text-[#94A3B8]">
          Complete a {LANGUAGE_LABELS[language]} OPI conversation or PREP monologue to unlock ILR Discourse Audit and
          Level 2 → 2+ Upgrades.
        </p>
      </div>
    );
  }

  const dialectInfo = getDialectInfo(activeSession.language, activeSession.dialect);
  const domainInfo = getDomainInfo(activeSession.domain);
  const report = activeSession.debrief;

  return (
    <div className="space-y-6">
      {/* Header & Session Picker */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-5 border-b border-[#23303E]">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-[#94A3B8]">
            Post-Session Diagnostic · Thinking Level: Medium · Discourse &amp; Register Upgrades
          </p>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#F8FAFC]">
            ILR Debrief &amp; Level 2 → 2+ Upgrader
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="debrief-session-select" className="text-xs text-[#94A3B8] whitespace-nowrap">
              Session
            </label>
            <select
              id="debrief-session-select"
              value={activeSession.id}
              onChange={(e) => onSelectSession(e.target.value)}
              className="min-h-[42px] rounded-lg border border-[#23303E] bg-[#111922] px-3 py-2 text-sm text-[#E6EDF3] focus:outline-none focus:border-[#D99B26] max-w-[260px]"
            >
              {languageSessions.map((s) => {
                const dom = getDomainInfo(s.domain).shortLabel;
                const dateStr = new Date(s.startedAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                });
                return (
                  <option key={s.id} value={s.id}>
                    {LANGUAGE_LABELS[s.language]} · {dom} ({s.type === 'prep_monologue' ? 'PREP' : 'OPI'} · {dateStr})
                  </option>
                );
              })}
            </select>
          </div>

          <button
            type="button"
            onClick={handleAnalyze}
            disabled={isAnalyzing}
            className="flex items-center gap-2 px-4 py-2.5 min-h-[42px] rounded-lg bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileCheck2 className="w-4 h-4" />}
            <span>
              {isAnalyzing ? 'Auditing Transcript…' : report ? 'Re-Run Diagnostic Audit' : 'Run Diagnostic Debrief'}
            </span>
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-500/40 bg-red-950/30 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {/* Session Context Summary Line */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#94A3B8]">
        <span>
          {LANGUAGE_LABELS[activeSession.language]} ({dialectInfo.label})
        </span>
        <span aria-hidden="true">·</span>
        <span>{domainInfo.label}</span>
        <span aria-hidden="true">·</span>
        <span className="font-mono tabular-nums">Duration {formatSecondsClock(activeSession.durationSeconds)}</span>
        <span aria-hidden="true">·</span>
        <span className="font-mono tabular-nums">{activeSession.messages.length} turns</span>
      </div>

      {!report ? (
        <div className="rounded-xl border border-[#23303E] bg-[#111922] p-8 space-y-5">
          <div className="space-y-1.5 max-w-2xl">
            <h2 className="text-lg font-semibold text-[#F8FAFC]">Session Ready for ILR Diagnostic Grading</h2>
            <p className="text-sm text-[#94A3B8] leading-relaxed">
              Run the one-click diagnostic debrief to evaluate paragraph cohesion (Point–Reason–Example–Pivot),
              subjunctive control, time-frame stability, and natural Level 2 → 2+ rewrites.
            </p>
          </div>

          <button
            type="button"
            onClick={handleAnalyze}
            disabled={isAnalyzing}
            className="inline-flex items-center gap-2 px-5 py-2.5 min-h-[44px] rounded-lg bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] disabled:opacity-50 transition-colors"
          >
            {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileCheck2 className="w-4 h-4" />}
            <span>{isAnalyzing ? 'Running ILR Debrief…' : 'Run Diagnostic Debrief'}</span>
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* 1. Executive ILR Rating & Discourse/Time-Frame Audit */}
          <section className="rounded-xl border border-[#23303E] bg-[#111922] p-5 sm:p-6 space-y-6">
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
              <div className="space-y-1.5 max-w-3xl">
                <p className="text-xs text-[#94A3B8]">Estimated Functional Proficiency</p>
                <h2 className="text-2xl font-bold text-[#F8FAFC]">{report.estimatedIlr}</h2>
                <p className="text-sm text-[#CBD5E1] leading-relaxed">{report.summaryAssessment}</p>
              </div>
            </div>

            {/* PREP Cohesion Scores (4 clean metric columns, no card-in-card nesting) */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-5 pt-5 border-t border-[#23303E]">
              {[
                {label: 'Point (Thesis)', value: report.discourseAudit.pointScore},
                {label: 'Reason (Systemic)', value: report.discourseAudit.reasonScore},
                {label: 'Example (Concrete)', value: report.discourseAudit.exampleScore},
                {label: 'Pivot / Conclusion', value: report.discourseAudit.pivotScore},
              ].map((metric) => (
                <div key={metric.label} className="space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs text-[#94A3B8]">{metric.label}</span>
                    <span className="font-mono text-sm font-semibold text-[#F8FAFC] tabular-nums">
                      {metric.value}/100
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-[#1C2836] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#D99B26]"
                      style={{width: `${Math.max(0, Math.min(100, metric.value))}%`}}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Discourse & Time-Frame Audit Prose */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-5 border-t border-[#23303E]">
              <div className="space-y-1">
                <h3 className="text-xs font-semibold text-[#E6EDF3]">Paragraph Cohesion</h3>
                <p className="text-sm text-[#94A3B8] leading-relaxed">{report.discourseAudit.cohesionNotes}</p>
              </div>
              <div className="space-y-1">
                <h3 className="text-xs font-semibold text-sky-300">Subjunctive &amp; Conditional Control</h3>
                <p className="text-sm text-[#94A3B8] leading-relaxed">{report.discourseAudit.subjunctiveControl}</p>
              </div>
              <div className="space-y-1">
                <h3 className="text-xs font-semibold text-amber-300">Time-Frame Stability</h3>
                <p className="text-sm text-[#94A3B8] leading-relaxed">{report.discourseAudit.timeFrameStability}</p>
              </div>
            </div>
          </section>

          {/* 2. Natural 2+ Rewriter */}
          <section className="rounded-xl border border-[#23303E] bg-[#111922] p-5 sm:p-6 space-y-5">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-[#F8FAFC]">Natural ILR 2+ Rewriter</h2>
              <p className="text-sm text-[#94A3B8]">
                Actual Level 2 utterances from your transcript upgraded into crisp, natural high-register phrasing.
              </p>
            </div>

            <div className="divide-y divide-[#23303E]">
              {report.naturalUpgrades.map((item, idx) => (
                <div key={idx} className="py-5 first:pt-1 last:pb-1 space-y-3">
                  <div className="grid grid-cols-1 lg:grid-cols-11 gap-4 items-center">
                    <div className="lg:col-span-5 space-y-1">
                      <span className="text-xs font-medium text-[#7D8FA3]">What You Said (Level 2)</span>
                      <p className="text-sm text-[#CBD5E1] leading-relaxed">&ldquo;{item.originalLevel2}&rdquo;</p>
                    </div>

                    <div className="hidden lg:flex lg:col-span-1 justify-center text-[#D99B26]">
                      <ArrowRight className="w-4 h-4" />
                    </div>

                    <div className="lg:col-span-5 space-y-1">
                      <span className="text-xs font-medium text-emerald-400">Natural ILR 2+ Upgrade</span>
                      <p className="text-sm font-medium text-[#F8FAFC] leading-relaxed">
                        &ldquo;{item.upgradedLevel2Plus}&rdquo;
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <p className="text-xs text-[#94A3B8] max-w-2xl">{item.whyItUpgrades}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      {item.connectorsUsed.map((conn) => {
                        const key = `conn-${idx}-${conn}`;
                        const isSaved = Boolean(savedKeys[key]);
                        return (
                          <button
                            key={conn}
                            type="button"
                            onClick={() => handleSaveConnector(conn, item.upgradedLevel2Plus, idx)}
                            disabled={isSaved}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[#2E4054] bg-[#16202B] text-xs font-medium text-[#E6EDF3] hover:border-[#D99B26] disabled:opacity-60 transition-colors"
                          >
                            {isSaved ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <BookmarkPlus className="w-3 h-3 text-[#D99B26]" />
                            )}
                            <span>{conn}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 3. Recommended Next Drill */}
          <section className="rounded-xl border border-[#23303E] bg-[#111922] p-5 sm:p-6 space-y-1.5">
            <h2 className="text-sm font-semibold text-[#F8FAFC]">Recommended Next Drill</h2>
            <p className="text-sm text-[#94A3B8] leading-relaxed">{report.nextDrillRecommendation}</p>
          </section>
        </div>
      )}
    </div>
  );
};
