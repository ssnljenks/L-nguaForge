import React, {useState} from 'react';
import {AlertCircle, ArrowLeft, ArrowRight, Loader2, Sparkles} from 'lucide-react';
import type {BriefDrill, BriefItem, DlptDrillMode, DlptSkill, VocabItem} from '../../../types';
import type {DlptRuleProfile} from '../../../utils/dlptRules';
import type {useWordLookup} from '../../../hooks/useWordLookup';
import {ModalBody, ModalFooter} from '../modalLayout';
import {DrillPassageCard} from './DrillPassageCard';
import {DrillQuestionCard} from './DrillQuestionCard';
import type {DrillAudio} from './useDrillAudio';

interface DrillRunStageProps {
  profile: DlptRuleProfile;
  mode: DlptDrillMode;
  skill: DlptSkill;
  passage: BriefItem;
  drill: BriefDrill | null;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  adaptiveStepNote: string | null;
  flagged: boolean;
  onToggleFlag: (flagged: boolean) => void;
  audio: DrillAudio;
  wordLookup: ReturnType<typeof useWordLookup>;
  vocabItems: VocabItem[];
  selectedAnswers: Record<string, number>;
  onSelectOption: (questionId: string, optionIndex: number, questionIndex: number) => void;
  isPageChecked: boolean;
  canProceed: boolean;
  answeredOnPageCount: number;
  isLastPlannedPassage: boolean;
  canGoBack: boolean;
  onPrevious: () => void;
  onCheckPage: () => void;
  onAdvance: () => void;
  onSaveVocabTerm: (term: string, meaning: string, excerpt?: string) => void;
}

/** Run stage: the current passage, its questions and the Previous / Check / Next controls. */
export const DrillRunStage: React.FC<DrillRunStageProps> = ({
  profile,
  mode,
  skill,
  passage,
  drill,
  isLoading,
  error,
  onRetry,
  adaptiveStepNote,
  flagged,
  onToggleFlag,
  audio,
  wordLookup,
  vocabItems,
  selectedAnswers,
  onSelectOption,
  isPageChecked,
  canProceed,
  answeredOnPageCount,
  isLastPlannedPassage,
  canGoBack,
  onPrevious,
  onCheckPage,
  onAdvance,
  onSaveVocabTerm,
}) => {
  const [savedVocabTerms, setSavedVocabTerms] = useState<Set<string>>(new Set());
  const showFeedback = mode === 'practice' && isPageChecked;

  const isTermSaved = (term: string) =>
    savedVocabTerms.has(term.toLowerCase()) || vocabItems.some((v) => v.term.toLowerCase() === term.toLowerCase());

  const handleSaveTerm = (term: string, english: string) => {
    onSaveVocabTerm(term, english, drill?.studyExcerpt);
    setSavedVocabTerms((prev) => new Set(prev).add(term.toLowerCase()));
  };

  return (
    <>
      <ModalBody>
        {/* Adaptive step notice (Practice mode only) */}
        {adaptiveStepNote && mode === 'practice' && (
          <div className="px-3.5 py-2 rounded-lg border border-[#7DD3FC]/30 bg-[#7DD3FC]/8 text-xs text-[#7DD3FC]">
            {adaptiveStepNote}
          </div>
        )}

        <DrillPassageCard
          passage={passage}
          drill={drill}
          allowFlag={profile.allowFlag}
          flagged={flagged}
          onToggleFlag={onToggleFlag}
          audio={audio}
          showFeedback={showFeedback}
          wordLookup={wordLookup}
        />

        {/* Loading state */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-14 gap-3 text-[#94A3B8]">
            <Loader2 className="w-6 h-6 animate-spin text-[#D99B26]" />
            <p className="text-sm font-medium">
              Generating verified DLPT {skill === 'listening' ? 'listening' : 'reading'} items…
            </p>
          </div>
        )}

        {/* Error state */}
        {error && !isLoading && (
          <div className="p-4 rounded-xl border border-[#F87171]/45 bg-[#F87171]/10 text-red-200 text-sm flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 shrink-0 text-[#F87171] mt-0.5" />
              <div>
                <p className="font-semibold">Unable to load verified questions</p>
                <p className="text-xs text-red-200/90 mt-0.5">{error}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onRetry}
              className="px-3 py-2 min-h-[52px] rounded-lg bg-[#D99B26] text-[#0B1117] text-xs font-semibold hover:bg-[#E5AE42] shrink-0"
            >
              Retry
            </button>
          </div>
        )}

        {/* Questions Fieldsets */}
        {drill && !isLoading && (
          <div className="space-y-4">
            {drill.questions.map((q, qIdx) => (
              <DrillQuestionCard
                key={q.id}
                question={q}
                index={qIdx}
                total={drill.questions.length}
                userChoice={selectedAnswers[q.id]}
                showFeedback={showFeedback}
                onSelect={(optIdx) => onSelectOption(q.id, optIdx, qIdx)}
                isTermSaved={isTermSaved}
                onSaveTerm={handleSaveTerm}
              />
            ))}
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <div className="flex items-center gap-2">
          {canGoBack && (
            <button
              type="button"
              onClick={onPrevious}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-xl border border-[#23303E] bg-[#111922] text-xs sm:text-sm font-semibold text-[#CBD5E1] hover:text-white transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Previous</span>
            </button>
          )}

          {profile.hideNextUntilPageComplete && !canProceed && drill && (
            <span className="text-xs text-[#94A3B8] font-mono tabular-nums">
              Answer all {drill.questions.length} questions to continue ({answeredOnPageCount}/{drill.questions.length})
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {/* Practice mode: Check answers first, then Next/Finish */}
          {mode === 'practice' && !isPageChecked && canProceed && drill && (
            <button
              type="button"
              data-testid="dlpt-check-page-btn"
              onClick={onCheckPage}
              className="inline-flex items-center gap-2 px-5 py-2.5 min-h-[52px] rounded-xl bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] transition-colors"
            >
              <Sparkles className="w-4 h-4" />
              <span>Check answers</span>
            </button>
          )}

          {/* Advance button:
              - In Practice mode: shown after checking the page (or on PT where skipping is allowed)
              - In Test mode: shown whenever canProceed is true (hidden on ES until all answered!) */}
          {((mode === 'practice' && (isPageChecked || !profile.hideNextUntilPageComplete)) ||
            (mode === 'test' && canProceed)) &&
            drill && (
              <button
                type="button"
                data-testid="dlpt-next-btn"
                onClick={onAdvance}
                className={`inline-flex items-center gap-2 px-5 py-2.5 min-h-[52px] rounded-xl text-sm font-semibold transition-colors ${
                  mode === 'practice' && !isPageChecked
                    ? 'border border-[#23303E] bg-[#111922] text-[#CBD5E1] hover:text-white'
                    : 'bg-[#D99B26] text-[#0B1117] hover:bg-[#E5AE42]'
                }`}
              >
                <span>
                  {!isLastPlannedPassage
                    ? 'Next passage'
                    : profile.allowEndReview && mode === 'test'
                      ? 'Review & submit'
                      : 'Finish drill'}
                </span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
        </div>
      </ModalFooter>
    </>
  );
};
