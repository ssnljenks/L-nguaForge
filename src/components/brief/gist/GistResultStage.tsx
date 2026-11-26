import React, {useMemo, useRef, useState} from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Headphones,
  Pause,
  Play,
  Sparkles,
  XCircle,
} from 'lucide-react';
import type {BriefItem, GistGradeResult, MissionConfig, VocabItem} from '../../../types';
import {segmentGistHighlights} from '../../../utils/gistLogic';
import {type SaveVocabFn, useWordLookup} from '../../../hooks/useWordLookup';
import {TappableText} from '../../shared/TappableText';
import {WordLookupPopover} from '../../shared/WordLookupPopover';
import {ModalBody, ModalFooter} from '../modalLayout';
import {FidelitySection} from './FidelitySection';

interface GistResultStageProps {
  clip: BriefItem;
  grade: GistGradeResult;
  submittedSummary: string;
  autoSubmitted: boolean;
  config: MissionConfig;
  vocabItems: VocabItem[];
  onSaveVocab: SaveVocabFn;
  hasNextClip: boolean;
  onNextClip: () => void;
  onDone: () => void;
}

/** Review stage: highlighted additions, main point / key details, fidelity check, model gist + audio. */
export const GistResultStage: React.FC<GistResultStageProps> = ({
  clip: activeClip,
  grade,
  submittedSummary,
  autoSubmitted,
  config,
  vocabItems,
  onSaveVocab,
  hasNextClip,
  onNextClip,
  onDone,
}) => {
  const modelAudioRef = useRef<HTMLAudioElement | null>(null);
  const [showModelPanel, setShowModelPanel] = useState(false);
  const [isPlayingModelAudio, setIsPlayingModelAudio] = useState(false);

  const wordLookup = useWordLookup({
    config,
    vocabItems,
    onSaveVocab,
    vocabSource: 'brief',
    omitDomain: !config.workFocusEnabled,
  });

  const highlightedSegments = useMemo(
    () => segmentGistHighlights(submittedSummary, grade.additions ?? []),
    [submittedSummary, grade]
  );

  const handleToggleModelAudio = () => {
    if (!modelAudioRef.current) return;
    if (isPlayingModelAudio) {
      modelAudioRef.current.pause();
      setIsPlayingModelAudio(false);
    } else {
      modelAudioRef.current.currentTime = 0;
      modelAudioRef.current.play().catch(() => setIsPlayingModelAudio(false));
      setIsPlayingModelAudio(true);
    }
  };

  const mainPointMeta =
    grade.mainPoint === 'captured'
      ? {
          label: 'Captured',
          color: 'text-[#7DD3FC]',
          border: 'border-[#7DD3FC]/40',
          bg: 'bg-[#7DD3FC]/8',
          icon: CheckCircle2,
        }
      : grade.mainPoint === 'partial'
        ? {
            label: 'Partial',
            color: 'text-[#D99B26]',
            border: 'border-[#D99B26]/40',
            bg: 'bg-[#D99B26]/8',
            icon: AlertCircle,
          }
        : {
            label: 'Missed',
            color: 'text-[#F87171]',
            border: 'border-[#F87171]/40',
            bg: 'bg-[#F87171]/8',
            icon: XCircle,
          };

  return (
    <>
      <ModalBody>
        <div className="space-y-5">
          {/* 1. Learner's Gist with Highlighted Additions */}
          <section
            aria-label="Your submitted gist"
            className="rounded-xl border border-[#23303E] bg-[#0B1117] p-4 space-y-2.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-xs uppercase tracking-wider text-[#94A3B8]">
                Your gist {autoSubmitted ? '· Auto-submitted at 0:00' : ''}
              </span>
              {grade.additions.length > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#FECACA]">
                  <AlertTriangle className="w-3.5 h-3.5 text-[#F87171]" />
                  <span>Highlighted spans = unsupported additions</span>
                </span>
              )}
            </div>

            {submittedSummary ? (
              <p data-testid="gist-learner-text" className="text-sm text-[#F8FAFC] leading-relaxed">
                {highlightedSegments.map((seg, idx) =>
                  seg.isAddition ? (
                    <mark
                      key={`seg-${idx}`}
                      className="bg-[#F87171]/25 text-[#FECACA] underline decoration-[#F87171] decoration-wavy underline-offset-2 px-1 py-0.5 rounded"
                    >
                      {seg.text}
                    </mark>
                  ) : (
                    <React.Fragment key={`seg-${idx}`}>{seg.text}</React.Fragment>
                  )
                )}
              </p>
            ) : (
              <p className="text-sm italic text-[#7D8FA3]">No summary was entered before 0:00.</p>
            )}
          </section>

          {/* 2. Two Stat Tiles: Main point + Key details x of y */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div
              data-testid="gist-stat-main-point"
              className={`rounded-xl border p-4 space-y-1.5 ${mainPointMeta.border} ${mainPointMeta.bg}`}
            >
              <span className="font-mono text-[11px] uppercase tracking-wider text-[#94A3B8]">Main point</span>
              <div className={`flex items-center gap-2 text-lg font-bold ${mainPointMeta.color}`}>
                <mainPointMeta.icon className="w-5 h-5 shrink-0" />
                <span>{mainPointMeta.label}</span>
              </div>
            </div>

            <div
              data-testid="gist-stat-key-details"
              className="rounded-xl border border-[#23303E] bg-[#0B1117] p-4 space-y-1.5"
            >
              <span className="font-mono text-[11px] uppercase tracking-wider text-[#94A3B8]">Key details</span>
              <p className="font-display text-lg font-bold text-[#F8FAFC] tabular-nums">
                {grade.keyDetails.found} of {grade.keyDetails.total}
              </p>
              {grade.keyDetails.missing.length > 0 && (
                <p className="text-xs text-[#94A3B8] leading-snug">Missing: {grade.keyDetails.missing.join(' · ')}</p>
              )}
            </div>
          </div>

          {/* 3. Fidelity Check List: strictly ordered Additions -> Omissions -> Distortions */}
          <section aria-label="Fidelity check" className="space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">Fidelity check</h3>
              <span className="text-[11px] text-[#7D8FA3]">Additions → Omissions → Distortions</span>
            </div>

            <FidelitySection
              testId="fidelity-additions"
              title="Additions"
              subtitle="Most serious · claims stated that are not in the source"
              findings={grade.additions}
              accent="red"
            />

            <FidelitySection
              testId="fidelity-omissions"
              title="Omissions"
              subtitle="Important source points left out of your gist"
              findings={grade.omissions}
              accent="amber"
            />

            <FidelitySection
              testId="fidelity-distortions"
              title="Distortions"
              subtitle="Source details misstated (actors, numbers, or cause)"
              findings={grade.distortions}
              accent="sky"
            />
          </section>

          {/* 4. Expandable Model Gist + Audio + Short Transcript */}
          {showModelPanel && (
            <section
              data-testid="gist-model-panel"
              className="rounded-xl border border-[#7DD3FC]/35 bg-[#0B1117] p-4 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#7DD3FC]" />
                  <h3 className="text-sm font-semibold text-[#F8FAFC]">Model gist + audio</h3>
                </div>
                <a
                  href={activeClip.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-[#7DD3FC] hover:underline"
                >
                  <span>{activeClip.sourceName}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <p className="text-sm text-[#E2E8F0] leading-relaxed">{grade.modelGist}</p>

              {activeClip.audioUrl && (
                <div className="flex items-center gap-3">
                  <audio
                    ref={modelAudioRef}
                    key={`gist-model-${activeClip.id}`}
                    src={activeClip.audioUrl}
                    preload="none"
                    onPlay={() => setIsPlayingModelAudio(true)}
                    onPause={() => setIsPlayingModelAudio(false)}
                    onEnded={() => setIsPlayingModelAudio(false)}
                  >
                    <track kind="captions" />
                  </audio>
                  <button
                    type="button"
                    onClick={handleToggleModelAudio}
                    className="inline-flex items-center gap-2 px-4 py-2 min-h-[52px] rounded-xl bg-[#D99B26] text-[#0B1117] text-xs font-semibold hover:bg-[#E5AE42] transition-colors"
                  >
                    {isPlayingModelAudio ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                    <span>{isPlayingModelAudio ? 'Pause clip' : 'Replay clip audio'}</span>
                  </button>
                </div>
              )}

              {grade.studyExcerpt && (
                <div className="space-y-2 pt-2 border-t border-[#23303E]">
                  <p className="text-xs text-[#94A3B8]">
                    Short review transcript (tap any word to inspect &amp; save to Vocab):
                  </p>
                  <div className="p-3.5 rounded-lg bg-[#111922] border border-[#23303E] text-sm text-[#F8FAFC] leading-relaxed">
                    <TappableText
                      text={grade.studyExcerpt}
                      activeWord={wordLookup.lookup?.word}
                      onWordTap={(w) =>
                        void wordLookup.lookUpWord(`gist-tx-${activeClip.id}`, w, grade.studyExcerpt || '')
                      }
                    />
                  </div>

                  {wordLookup.lookup && (
                    <WordLookupPopover
                      lookup={wordLookup.lookup}
                      onClose={wordLookup.close}
                      onRetry={wordLookup.retry}
                      onSave={wordLookup.save}
                    />
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      </ModalBody>

      <ModalFooter>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="gist-model-btn"
            onClick={() => setShowModelPanel((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[44px] rounded-xl border border-[#7DD3FC]/45 bg-[#7DD3FC]/10 text-xs sm:text-sm font-semibold text-[#7DD3FC] hover:bg-[#7DD3FC]/20 transition-colors"
          >
            <Headphones className="w-4 h-4" />
            <span>{showModelPanel ? 'Hide model gist' : 'Model gist + audio'}</span>
          </button>

          {hasNextClip && (
            <button
              type="button"
              data-testid="gist-next-clip-btn"
              onClick={onNextClip}
              className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[52px] rounded-xl bg-[#D99B26] text-[#0B1117] text-xs sm:text-sm font-semibold hover:bg-[#E5AE42] transition-colors"
            >
              <span>Next clip</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onDone}
          className="px-4 py-2 min-h-[44px] rounded-xl text-xs sm:text-sm font-medium text-[#94A3B8] hover:text-white transition-colors"
        >
          Done
        </button>
      </ModalFooter>
    </>
  );
};
