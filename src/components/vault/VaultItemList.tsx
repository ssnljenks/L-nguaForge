import React from 'react';
import {Trash2, Volume2} from 'lucide-react';
import type {TargetLanguage, VocabItem} from '../../types';
import {getDialectInfo, getDomainInfo, LANGUAGE_LABELS} from '../../utils/ilrLogic';

interface VaultItemListProps {
  language: TargetLanguage;
  items: VocabItem[];
  onDeleteVocab: (id: string) => void;
  onSpeak: (text: string, lang: string) => void;
}

const MASTERY_LABELS: Record<VocabItem['mastery'], {label: string; className: string}> = {
  mastered: {label: 'Mastered', className: 'text-emerald-400'},
  practicing: {label: 'Practicing', className: 'text-amber-300'},
  new: {label: 'New', className: 'text-[#94A3B8]'},
};

const SOURCE_LABELS: Record<NonNullable<VocabItem['source']>, string> = {
  talk: 'Talk',
  opi: 'OPI',
  brief: 'Brief',
  manual: 'Manual',
};

/** The user's saved vocabulary for the current language and filters. */
export const VaultItemList: React.FC<VaultItemListProps> = ({language, items, onDeleteVocab, onSpeak}) =>
  items.length === 0 ? (
    <div className="rounded-xl border border-[#23303E] bg-[#111922] p-10 text-center space-y-2">
      <p className="text-sm font-medium text-[#E6EDF3]">
        No {LANGUAGE_LABELS[language]} vocabulary entries match this filter.
      </p>
      <p className="text-xs text-[#94A3B8]">
        Tap words in Talk or OPI Transcript, wrap up a chat with your tutor, save upgrades from Debrief, or add a new{' '}
        {LANGUAGE_LABELS[language]} entry above.
      </p>
    </div>
  ) : (
    <div className="rounded-xl border border-[#23303E] bg-[#111922] divide-y divide-[#1D2835]">
      {items.map((item) => {
        const dialect = getDialectInfo(item.language, item.dialect);
        const domainShort = item.domain ? getDomainInfo(item.domain).shortLabel : null;
        return (
          <div
            key={item.id}
            className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-start justify-between gap-4 hover:bg-[#141E29] transition-colors"
          >
            <div className="space-y-1.5 min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="text-base font-semibold text-[#F8FAFC]">{item.term}</h3>
                <span className="text-sm text-[#CBD5E1]">{item.englishConcept}</span>
              </div>
              <p className="text-xs text-[#94A3B8] leading-relaxed italic">&ldquo;{item.contextSentence}&rdquo;</p>
              <p className="text-xs text-[#7D8FA3]">
                {domainShort ?? item.category}
                {item.kind ? (
                  <>
                    <span className="mx-1.5" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-[#CBD5E1]">{item.kind}</span>
                  </>
                ) : null}
                <span className="mx-1.5" aria-hidden="true">
                  ·
                </span>
                {item.regionTag ? item.regionTag : `${LANGUAGE_LABELS[item.language]} (${dialect.short})`}
                <span className="mx-1.5" aria-hidden="true">
                  ·
                </span>
                {item.registerTag}
                {item.source ? (
                  <>
                    <span className="mx-1.5" aria-hidden="true">
                      ·
                    </span>
                    <span>{SOURCE_LABELS[item.source]}</span>
                  </>
                ) : null}
                <span className="mx-1.5" aria-hidden="true">
                  ·
                </span>
                <span className={MASTERY_LABELS[item.mastery].className}>{MASTERY_LABELS[item.mastery].label}</span>
              </p>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => onSpeak(item.term.replace(/\s*\(.*?\)\s*/g, ''), dialect.bcp47)}
                aria-label={`Listen to ${item.term}`}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border border-[#23303E] text-[#CBD5E1] hover:text-[#F3C669] hover:border-[#35495E] transition-colors"
              >
                <Volume2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => onDeleteVocab(item.id)}
                aria-label={`Delete ${item.term}`}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border border-[#23303E] text-[#94A3B8] hover:text-red-400 hover:border-red-500/40 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
