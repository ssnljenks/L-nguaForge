import React from 'react';
import {MessageSquare, RotateCcw} from 'lucide-react';
import type {BriefDrill, BriefItem, DlptDrillMode, DlptDrillResult, DlptSkill, DlptTrapType} from '../../../types';
import {CHOICE_LETTERS, TRAP_TYPE_META} from '../../../utils/dlptRules';
import type {useWordLookup} from '../../../hooks/useWordLookup';
import {TappableText} from '../../shared/TappableText';
import {WordLookupPopover} from '../../shared/WordLookupPopover';
import {DlptTrapCard} from '../DlptTrapCard';
import {DrillBody, DrillFooter} from './drillLayout';

interface DrillSummaryStageProps {
  result: DlptDrillResult;
  skill: DlptSkill;
  mode: DlptDrillMode;
  passages: BriefItem[];
  drillsById: Record<string, BriefDrill>;
  selectedAnswers: Record<string, number>;
  wordLookup: ReturnType<typeof useWordLookup>;
  onRestart: () => void;
  onBriefItBack: () => void;
  onDone: () => void;
}

/** Summary stage: score, traps to watch, and a full passage-by-passage review. */
export const DrillSummaryStage: React.FC<DrillSummaryStageProps> = ({
  result: finalResult,
  skill,
  mode,
  passages,
  drillsById,
  selectedAnswers,
  wordLookup,
  onRestart,
  onBriefItBack,
  onDone,
}) => (
  <>
    <DrillBody>
      <div className="space-y-6">
        {/* Summary Hero */}
        <div className="rounded-xl border border-[#D99B26]/45 bg-[#D99B26]/10 p-5 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-xs uppercase tracking-wider text-[#D99B26]">
                DLPT {skill === 'listening' ? 'Listening' : 'Reading'} Summary ·{' '}
                {mode === 'test' ? 'Test conditions' : 'Practice mode'}
              </p>
              <h2 id="brief-drill-title" className="text-lg sm:text-xl font-bold text-[#F8FAFC] mt-0.5">
                {finalResult.correctCount} of {finalResult.totalQuestions} correct (
                {finalResult.totalQuestions > 0
                  ? Math.round((finalResult.correctCount / finalResult.totalQuestions) * 100)
                  : 0}
                %)
              </h2>
            </div>
            <span className="font-mono text-xs text-[#CBD5E1] tabular-nums">
              Levels: {finalResult.passageLevels.join(' → ')}
            </span>
          </div>

          {/* Trap breakdown */}
          {Object.keys(finalResult.trapsMissed).length > 0 && (
            <div className="pt-2 border-t border-[#D99B26]/25 space-y-1.5">
              <p className="text-xs font-semibold text-[#F8FAFC]">Distractor traps to watch:</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(finalResult.trapsMissed)
                  .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
                  .map(([trapKey, count]) => {
                    const meta = TRAP_TYPE_META[trapKey as DlptTrapType];
                    return (
                      <span
                        key={trapKey}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#F87171]/35 bg-[#0B1117] text-xs text-[#FECACA]"
                      >
                        <span>{meta?.label ?? trapKey}</span>
                        <span className="font-mono text-[#F87171] tabular-nums">×{count}</span>
                      </span>
                    );
                  })}
              </div>
            </div>
          )}

          <p className="text-xs text-[#94A3B8]">
            Saved to your Today ILR profile. Practice estimate, not an official rating.
          </p>
        </div>

        {/* Full Passage-by-Passage Review (especially essential for Test mode end-only feedback) */}
        <div className="space-y-5">
          {passages.map((passage, pIdx) => {
            const drill = drillsById[passage.id];
            if (!drill) return null;

            return (
              <div key={passage.id} className="rounded-xl border border-[#23303E] bg-[#0B1117] p-4 sm:p-5 space-y-4">
                <div className="space-y-1">
                  <p className="font-mono text-xs text-[#7DD3FC] tabular-nums">
                    Passage {pIdx + 1} · ILR Level {passage.ilrLevel} · {passage.sourceName}
                  </p>
                  <h3 className="text-sm sm:text-base font-semibold text-[#F8FAFC]">{passage.title}</h3>
                  <p className="text-xs italic text-[#94A3B8]">{drill.orientationLine}</p>
                </div>

                {drill.questions.map((q, qIdx) => {
                  const picked = selectedAnswers[q.id];
                  const isCorrect = picked === q.correctIndex;
                  const pickedLetter = typeof picked === 'number' ? CHOICE_LETTERS[picked] : null;
                  const correctLetter = CHOICE_LETTERS[q.correctIndex] ?? 'A';

                  return (
                    <div key={q.id} className="p-3.5 rounded-xl border border-[#23303E] bg-[#111922] space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs sm:text-sm font-semibold text-[#F8FAFC]">
                          Q{qIdx + 1}. {q.questionEnglish || q.question}
                        </p>
                        <span
                          className={`text-xs font-semibold shrink-0 ${isCorrect ? 'text-[#7DD3FC]' : 'text-[#F87171]'}`}
                        >
                          {isCorrect
                            ? `Correct (${correctLetter})`
                            : pickedLetter
                              ? `Picked (${pickedLetter}) · Ans (${correctLetter})`
                              : `Blank · Ans (${correctLetter})`}
                        </span>
                      </div>

                      <DlptTrapCard question={q} userChoiceIndex={picked} />
                    </div>
                  );
                })}

                {drill.studyExcerpt && (
                  <div className="pt-2 border-t border-[#23303E] space-y-2">
                    <span className="font-mono text-[11px] uppercase tracking-wider text-[#7DD3FC]">
                      Short Review {passage.mediaType === 'audio' ? 'Transcript' : 'Excerpt'} (tap any word)
                    </span>
                    <div className="p-3.5 rounded-lg bg-[#111922] border border-[#23303E] text-sm text-[#F8FAFC] leading-relaxed">
                      <TappableText
                        text={drill.studyExcerpt}
                        activeWord={wordLookup.lookup?.word}
                        onWordTap={(w) => void wordLookup.lookUpWord(`fin-${passage.id}`, w, drill.studyExcerpt || '')}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {wordLookup.lookup && (
            <WordLookupPopover
              lookup={wordLookup.lookup}
              onClose={wordLookup.close}
              onRetry={wordLookup.retry}
              onSave={wordLookup.save}
            />
          )}
        </div>
      </div>
    </DrillBody>

    <DrillFooter>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onRestart}
          className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[44px] rounded-xl border border-[#23303E] bg-[#111922] text-xs sm:text-sm font-semibold text-[#CBD5E1] hover:text-white transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
          <span>Try again</span>
        </button>
        <button
          type="button"
          onClick={onBriefItBack}
          className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[52px] rounded-xl bg-[#D99B26] text-[#0B1117] text-xs sm:text-sm font-semibold hover:bg-[#E5AE42] transition-colors"
        >
          <MessageSquare className="w-4 h-4" />
          <span>Brief it back in OPI</span>
        </button>
      </div>

      <button
        type="button"
        onClick={onDone}
        className="px-4 py-2 min-h-[44px] rounded-xl text-xs sm:text-sm font-medium text-[#94A3B8] hover:text-white transition-colors"
      >
        Done
      </button>
    </DrillFooter>
  </>
);
