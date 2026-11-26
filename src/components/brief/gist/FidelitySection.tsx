import React from 'react';
import {Quote} from 'lucide-react';
import type {GistFinding} from '../../../types';

interface FidelitySectionProps {
  title: string;
  subtitle: string;
  findings: GistFinding[];
  accent: 'red' | 'amber' | 'sky';
  testId: string;
}

export const FidelitySection: React.FC<FidelitySectionProps> = ({title, subtitle, findings, accent, testId}) => {
  const accentStyles =
    accent === 'red'
      ? {
          border: findings.length > 0 ? 'border-[#F87171]/45' : 'border-[#23303E]',
          bg: findings.length > 0 ? 'bg-[#F87171]/8' : 'bg-[#0B1117]',
          titleColor: findings.length > 0 ? 'text-[#FECACA]' : 'text-[#CBD5E1]',
          countColor: findings.length > 0 ? 'text-[#F87171]' : 'text-[#7D8FA3]',
        }
      : accent === 'amber'
        ? {
            border: findings.length > 0 ? 'border-[#D99B26]/45' : 'border-[#23303E]',
            bg: findings.length > 0 ? 'bg-[#D99B26]/8' : 'bg-[#0B1117]',
            titleColor: findings.length > 0 ? 'text-[#F3C669]' : 'text-[#CBD5E1]',
            countColor: findings.length > 0 ? 'text-[#D99B26]' : 'text-[#7D8FA3]',
          }
        : {
            border: findings.length > 0 ? 'border-[#7DD3FC]/40' : 'border-[#23303E]',
            bg: findings.length > 0 ? 'bg-[#7DD3FC]/8' : 'bg-[#0B1117]',
            titleColor: findings.length > 0 ? 'text-[#7DD3FC]' : 'text-[#CBD5E1]',
            countColor: findings.length > 0 ? 'text-[#7DD3FC]' : 'text-[#7D8FA3]',
          };

  return (
    <div data-testid={testId} className={`rounded-xl border p-4 space-y-2.5 ${accentStyles.border} ${accentStyles.bg}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h4 className={`text-xs sm:text-sm font-semibold ${accentStyles.titleColor}`}>{title}</h4>
          <p className="text-[11px] text-[#94A3B8]">{subtitle}</p>
        </div>
        <span className={`font-mono text-xs font-semibold tabular-nums ${accentStyles.countColor}`}>
          {findings.length}
        </span>
      </div>

      {findings.length === 0 ? (
        <p className="text-xs text-[#7D8FA3] italic">None.</p>
      ) : (
        <ul className="space-y-2.5">
          {findings.map((finding, idx) => (
            <li
              key={`${title}-${idx}`}
              className="rounded-lg border border-[#23303E] bg-[#111922] p-3 space-y-1.5 text-xs"
            >
              <p className="text-[#F8FAFC] leading-relaxed">{finding.description}</p>
              {finding.learnerSpan && (
                <p className="text-[11px] text-[#FECACA]">
                  Your text:{' '}
                  <span className="px-1.5 py-0.5 rounded bg-[#F87171]/20 text-[#FECACA] font-medium">
                    “{finding.learnerSpan}”
                  </span>
                </p>
              )}
              {finding.sourceQuote && (
                <div className="flex items-start gap-1.5 text-[11px] text-[#94A3B8] pt-0.5">
                  <Quote className="w-3.5 h-3.5 text-[#7DD3FC] shrink-0 mt-0.5" />
                  <span className="italic text-[#CBD5E1]">Source: “{finding.sourceQuote}”</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
