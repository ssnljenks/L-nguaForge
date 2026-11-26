import React, {useState} from 'react';
import {ArrowRight, BookmarkPlus, Check, ChevronDown, ChevronUp} from 'lucide-react';
import type {DebriefReport, OpiSession, VocabItem} from '../../types';

interface DiscourseAuditPanelProps {
  report: DebriefReport;
  activeSession: OpiSession;
  showDetailedAudit: boolean;
  onToggleDetailedAudit: () => void;
  onSaveVocab: (item: Omit<VocabItem, 'id' | 'createdAt' | 'mastery' | 'reviewCount'>) => void;
}

/** Expandable discourse audit (PREP scores, cohesion notes) and natural upgrades with savable connectors. */
export const DiscourseAuditPanel: React.FC<DiscourseAuditPanelProps> = ({
  report,
  activeSession,
  showDetailedAudit,
  onToggleDetailedAudit,
  onSaveVocab,
}) => {
  const [savedKeys, setSavedKeys] = useState<Record<string, boolean>>({});

  const handleSaveConnector = (connector: string, upgradedSentence: string, idx: number) => {
    const key = `conn-${idx}-${connector}`;
    onSaveVocab({
      term: connector,
      englishConcept: 'High-register connector (from debrief upgrade)',
      contextSentence: upgradedSentence,
      registerTag: 'High-Register Connector',
      category: 'High-Register Connectors',
      language: activeSession.language,
      dialect: activeSession.dialect,
      ...(activeSession.domain ? {domain: activeSession.domain} : {}),
      source: 'opi',
    });
    setSavedKeys((prev) => ({...prev, [key]: true}));
  };

  return (
    <div className="rounded-xl border border-[#23303E] bg-[#111922] overflow-hidden">
      <button
        type="button"
        onClick={onToggleDetailedAudit}
        aria-expanded={showDetailedAudit}
        className="w-full px-5 py-4 min-h-[52px] flex items-center justify-between gap-3 text-left hover:bg-[#141E29] transition-colors"
      >
        <div>
          <p className="text-sm font-semibold text-[#F8FAFC]">Full Discourse Audit &amp; Natural Upgrades</p>
          <p className="text-xs text-[#94A3B8]">
            PREP cohesion scores, subjunctive &amp; time-frame notes, and sentence upgrades
          </p>
        </div>
        {showDetailedAudit ? (
          <ChevronUp className="w-4 h-4 text-[#94A3B8] shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-[#94A3B8] shrink-0" />
        )}
      </button>

      {showDetailedAudit && (
        <div className="px-5 pb-6 pt-2 border-t border-[#23303E] space-y-6">
          <p className="text-sm text-[#CBD5E1] leading-relaxed">{report.summaryAssessment}</p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-4 border-t border-[#23303E]">
            <div className="space-y-1">
              <h3 className="text-xs font-semibold text-[#E6EDF3]">Paragraph Cohesion</h3>
              <p className="text-sm text-[#94A3B8] leading-relaxed">{report.discourseAudit.cohesionNotes}</p>
            </div>
            <div className="space-y-1">
              <h3 className="text-xs font-semibold text-[#7DD3FC]">Subjunctive &amp; Conditional Control</h3>
              <p className="text-sm text-[#94A3B8] leading-relaxed">{report.discourseAudit.subjunctiveControl}</p>
            </div>
            <div className="space-y-1">
              <h3 className="text-xs font-semibold text-amber-300">Time-Frame Stability</h3>
              <p className="text-sm text-[#94A3B8] leading-relaxed">{report.discourseAudit.timeFrameStability}</p>
            </div>
          </div>

          {report.naturalUpgrades.length > 0 && (
            <div className="pt-4 border-t border-[#23303E] divide-y divide-[#23303E]">
              {report.naturalUpgrades.map((item, idx) => (
                <div key={item.originalLevel2} className="py-4 first:pt-0 last:pb-0 space-y-2.5">
                  <div className="grid grid-cols-1 lg:grid-cols-11 gap-3 items-center">
                    <div className="lg:col-span-5 space-y-1">
                      <span className="text-xs font-medium text-[#7D8FA3]">What You Said</span>
                      <p className="text-sm text-[#CBD5E1] leading-relaxed">&ldquo;{item.originalLevel2}&rdquo;</p>
                    </div>
                    <div className="hidden lg:flex lg:col-span-1 justify-center text-[#D99B26]">
                      <ArrowRight className="w-4 h-4" />
                    </div>
                    <div className="lg:col-span-5 space-y-1">
                      <span className="text-xs font-medium text-emerald-400">Natural Higher-Register Upgrade</span>
                      <p className="text-sm font-medium text-[#F8FAFC] leading-relaxed">
                        &ldquo;{item.upgradedLevel2Plus}&rdquo;
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-[#94A3B8] max-w-2xl">{item.whyItUpgrades}</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {item.connectorsUsed.map((conn) => {
                        const key = `conn-${idx}-${conn}`;
                        const isSaved = Boolean(savedKeys[key]);
                        return (
                          <button
                            key={conn}
                            type="button"
                            onClick={() => handleSaveConnector(conn, item.upgradedLevel2Plus, idx)}
                            disabled={isSaved}
                            className="inline-flex items-center gap-1.5 min-h-[44px] px-2.5 py-1 rounded-md border border-[#2E4054] bg-[#16202B] text-xs font-medium text-[#E6EDF3] hover:border-[#D99B26] disabled:opacity-60 transition-colors"
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
          )}
        </div>
      )}
    </div>
  );
};
