import React from 'react';
import {BookmarkPlus, Check, ChevronDown, ChevronUp} from 'lucide-react';
import type {TargetLanguage, TalkPickedUpItem, VocabItem} from '../../types';
import {isTermInVocab} from '../../utils/talkLogic';

interface PickedUpTrayProps {
  threadPickedUp: TalkPickedUpItem[];
  pickedUpPreviewText: string;
  showPickedUpTray: boolean;
  onToggleTray: () => void;
  language: TargetLanguage;
  vocabItems: VocabItem[];
  tutorName: string;
  onSave: (item: TalkPickedUpItem, exampleSentence: string) => void;
}

/** "Picked up" chip with the expressions noted so far; each can be saved to Vocab. */
export const PickedUpTray: React.FC<PickedUpTrayProps> = ({
  threadPickedUp,
  pickedUpPreviewText,
  showPickedUpTray,
  onToggleTray,
  language,
  vocabItems,
  tutorName,
  onSave,
}) => (
  <section className="rounded-xl border border-[#23303E] bg-[#111922] overflow-hidden" data-testid="picked-up-bar">
    <button
      type="button"
      onClick={onToggleTray}
      aria-expanded={showPickedUpTray}
      className="w-full min-h-[44px] px-4 py-2.5 flex items-center justify-between gap-2 text-left hover:bg-[#141E29] transition-colors"
    >
      <span className="text-xs text-[#E6EDF3] truncate">
        <span className="font-semibold text-[#7DD3FC]">Picked up:</span> {pickedUpPreviewText}
      </span>
      <span className="inline-flex items-center gap-1 text-xs text-[#94A3B8] shrink-0">
        <span className="font-mono tabular-nums">{threadPickedUp.length}</span>
        {showPickedUpTray ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </span>
    </button>

    {showPickedUpTray && (
      <div className="border-t border-[#1D2835] divide-y divide-[#1D2835]">
        {threadPickedUp.map((item) => {
          const alreadySaved = isTermInVocab(item.term, language, vocabItems);
          return (
            <div key={item.term} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#F8FAFC]">
                  {item.term} <span className="text-xs font-normal text-[#94A3B8]">· {item.meaning}</span>
                </p>
                <p className="text-[11px] text-[#7D8FA3]">{item.regionTag}</p>
              </div>
              <button
                type="button"
                disabled={alreadySaved}
                onClick={() => onSave(item, item.example ?? `${tutorName} used ${item.term}`)}
                className={`inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg text-xs font-semibold shrink-0 transition-colors ${
                  alreadySaved
                    ? 'border border-emerald-500/35 bg-emerald-950/25 text-emerald-300 cursor-default'
                    : 'bg-[#D99B26] text-[#0B1117] hover:bg-[#E5AE42]'
                }`}
              >
                {alreadySaved ? <Check className="w-3.5 h-3.5" /> : <BookmarkPlus className="w-3.5 h-3.5" />}
                <span>{alreadySaved ? 'In Vocab' : 'Save'}</span>
              </button>
            </div>
          );
        })}
      </div>
    )}
  </section>
);
