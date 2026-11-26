import React, {useEffect, useMemo, useState} from 'react';
import {ArrowLeft, ArrowRight, BookmarkPlus, Check, Loader2, RefreshCw} from 'lucide-react';
import type {TutorPersona} from '../../data/tutors';
import type {MilitaryDomain, TalkWrapUpItem, TalkWrapUpResponse, VocabItem} from '../../types';
import type {SaveVocabFn} from '../../hooks/useWordLookup';
import {annotateWrapUpItems, buildTalkVocabSaveInput, normalizeTalkTerm} from '../../utils/talkLogic';

interface TalkWrapUpViewProps {
  tutor: TutorPersona;
  sceneLabel: string;
  workTalk: boolean;
  domain: MilitaryDomain;
  vocabItems: VocabItem[];
  wrapUp: TalkWrapUpResponse | null;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onSaveVocab: SaveVocabFn;
  onSavedTerm?: (term: string) => void;
  onKeepTalking: () => void;
  onStartFresh: () => void;
  onGoToVocab: () => void;
}

export const TalkWrapUpView: React.FC<TalkWrapUpViewProps> = ({
  tutor,
  sceneLabel,
  workTalk,
  domain,
  vocabItems,
  wrapUp,
  isLoading,
  error,
  onRetry,
  onSaveVocab,
  onSavedTerm,
  onKeepTalking,
  onStartFresh,
  onGoToVocab,
}) => {
  const annotatedItems = useMemo(
    () => annotateWrapUpItems(wrapUp?.items ?? [], tutor.language, vocabItems),
    [wrapUp?.items, tutor.language, vocabItems]
  );

  const [selectedNorms, setSelectedNorms] = useState<Set<string>>(new Set());
  const [addedCount, setAddedCount] = useState<number>(0);

  // Initialize pre-checked boxes for every new item whenever a wrap-up result arrives.
  useEffect(() => {
    if (!wrapUp) return;
    const next = new Set<string>();
    for (const item of annotatedItems) {
      if (!item.alreadyInVocab) {
        next.add(normalizeTalkTerm(item.term));
      }
    }
    setSelectedNorms(next);
    setAddedCount(0);
    // Only re-initialize when a new wrapUp object arrives, not when vocabItems updates on Save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrapUp]);

  const toggleItem = (item: TalkWrapUpItem) => {
    const norm = normalizeTalkTerm(item.term);
    if (!norm) return;
    setSelectedNorms((prev) => {
      const next = new Set(prev);
      if (next.has(norm)) next.delete(norm);
      else next.add(norm);
      return next;
    });
  };

  const selectedNewItems = useMemo(
    () => annotatedItems.filter((item) => !item.alreadyInVocab && selectedNorms.has(normalizeTalkTerm(item.term))),
    [annotatedItems, selectedNorms]
  );

  const handleAddSelected = () => {
    if (selectedNewItems.length === 0) return;
    let savedNow = 0;
    for (const item of selectedNewItems) {
      onSaveVocab(
        buildTalkVocabSaveInput({
          term: item.term,
          meaning: item.meaning,
          exampleSentence: item.exampleFromConversation,
          language: tutor.language,
          dialect: tutor.dialectId,
          tutorId: tutor.id,
          regionTag: item.regionTag,
          kind: item.kind,
          workTalk,
          domain: workTalk ? domain : undefined,
        })
      );
      onSavedTerm?.(item.term);
      savedNow += 1;
    }
    setAddedCount((prev) => prev + savedNow);
  };

  const newItemsCount = annotatedItems.filter((i) => !i.alreadyInVocab).length;

  return (
    <div className="max-w-3xl mx-auto space-y-5 pb-28 md:pb-10">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 pb-4 border-b border-[#23303E]">
        <div className="space-y-1">
          <p className="text-xs font-medium text-[#7DD3FC]">
            {tutor.city} · {sceneLabel}
          </p>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-[#F8FAFC]">
            Wrap-up with {tutor.name}
          </h1>
        </div>
        <button
          type="button"
          onClick={onKeepTalking}
          className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-lg border border-[#23303E] bg-[#111922] text-xs font-medium text-[#CBD5E1] hover:text-white transition-colors shrink-0"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Keep talking</span>
        </button>
      </div>

      {isLoading && (
        <div
          className="rounded-xl border border-[#23303E] bg-[#111922] p-8 flex flex-col items-center justify-center text-center space-y-3"
          role="status"
        >
          <Loader2 className="w-6 h-6 animate-spin text-[#D99B26]" />
          <p className="text-sm font-medium text-[#F8FAFC]">Gathering phrases &amp; patterns with {tutor.name}…</p>
          <p className="text-xs text-[#94A3B8]">Pulling out the local expressions and grammar patterns that came up.</p>
        </div>
      )}

      {error && !isLoading && (
        <div role="alert" className="rounded-xl border border-red-500/40 bg-red-950/30 p-5 space-y-3">
          <p className="text-sm text-red-200">{error}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-lg bg-[#D99B26] text-[#0B1117] text-xs font-semibold hover:bg-[#E5AE42] transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Try again</span>
            </button>
            <button
              type="button"
              onClick={onKeepTalking}
              className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-lg border border-[#23303E] bg-[#111922] text-xs font-medium text-[#CBD5E1] hover:text-white transition-colors"
            >
              <span>Keep talking</span>
            </button>
          </div>
        </div>
      )}

      {wrapUp && !isLoading && (
        <>
          {/* Warm conversation recap */}
          <section className="rounded-xl border border-[#23303E] bg-[#111922] p-4 sm:p-5 space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">Conversation recap</h2>
            <p className="text-sm text-[#E6EDF3] leading-relaxed">{wrapUp.summary}</p>
          </section>

          {/* Optional end-of-chat gentle notes (for At the end only mode) */}
          {wrapUp.endNotes.length > 0 && (
            <section className="rounded-xl border border-[#2E4054] bg-[#111922] p-4 sm:p-5 space-y-2.5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#7DD3FC]">Tips from {tutor.name}</h2>
              <ul className="space-y-2 text-sm text-[#CBD5E1]">
                {wrapUp.endNotes.map((note, idx) => (
                  <li key={idx} className="leading-relaxed">
                    · {note}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Checklist of up to 8 words, phrases & patterns */}
          <section className="rounded-xl border border-[#23303E] bg-[#111922] overflow-hidden">
            <div className="px-4 py-3.5 border-b border-[#23303E] flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-[#F8FAFC]">Words, phrases &amp; patterns</h2>
                <p className="text-xs text-[#94A3B8]">Uncheck anything you already know before adding to Vocab.</p>
              </div>
              {newItemsCount > 1 && (
                <div className="flex items-center gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedNorms(
                        new Set(annotatedItems.filter((i) => !i.alreadyInVocab).map((i) => normalizeTalkTerm(i.term)))
                      )
                    }
                    className="min-h-[44px] text-[#F3C669] hover:underline font-medium"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedNorms(new Set())}
                    className="min-h-[44px] text-[#94A3B8] hover:text-white"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>

            {annotatedItems.length === 0 ? (
              <div className="p-6 text-center text-sm text-[#94A3B8]">
                Not enough conversation yet to pull out specific phrases. Keep chatting a bit more with {tutor.name}!
              </div>
            ) : (
              <div className="divide-y divide-[#1D2835]">
                {annotatedItems.map((item) => {
                  const norm = normalizeTalkTerm(item.term);
                  const checked = item.alreadyInVocab || selectedNorms.has(norm);
                  return (
                    <label
                      key={norm}
                      className={`flex items-start gap-3.5 p-4 sm:px-5 min-h-[56px] transition-colors ${
                        item.alreadyInVocab ? 'opacity-70 cursor-default' : 'cursor-pointer hover:bg-[#141E29]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={item.alreadyInVocab}
                        onChange={() => toggleItem(item)}
                        className="mt-1 h-5 w-5 rounded border-[#35495E] bg-[#0B1117] accent-[#D99B26] shrink-0"
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-base font-semibold text-[#F8FAFC]">{item.term}</span>
                          <span className="text-xs text-[#7D8FA3]">
                            {item.kind} · {item.regionTag}
                            {item.alreadyInVocab && (
                              <span className="ml-2 text-emerald-400 font-medium">Already in Vocab</span>
                            )}
                          </span>
                        </div>
                        <p className="text-sm text-[#CBD5E1]">{item.meaning}</p>
                        {item.exampleFromConversation && (
                          <p className="text-xs italic text-[#94A3B8] leading-relaxed">
                            &ldquo;{item.exampleFromConversation}&rdquo;
                          </p>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </section>

          {addedCount > 0 && (
            <div
              role="status"
              className="rounded-xl border border-emerald-500/35 bg-emerald-950/25 px-4 py-3 flex flex-wrap items-center justify-between gap-3"
            >
              <span className="inline-flex items-center gap-2 text-sm text-emerald-300 font-medium">
                <Check className="w-4 h-4" />
                <span>
                  Added <span className="font-mono tabular-nums">{addedCount}</span>{' '}
                  {addedCount === 1 ? 'item' : 'items'} to Vocab
                </span>
              </span>
              <button
                type="button"
                onClick={onGoToVocab}
                className="inline-flex items-center gap-1 min-h-[44px] text-xs font-semibold text-emerald-200 hover:underline"
              >
                <span>Open Vocab</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Desktop Action Bar */}
          <div className="hidden md:flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onKeepTalking}
                className="min-h-[44px] px-4 rounded-xl border border-[#23303E] bg-[#111922] text-sm font-medium text-[#CBD5E1] hover:text-white transition-colors"
              >
                Keep talking
              </button>
              <button
                type="button"
                onClick={onStartFresh}
                className="min-h-[44px] px-4 rounded-xl border border-[#23303E] text-xs font-medium text-[#94A3B8] hover:text-white transition-colors"
              >
                New partner / scene
              </button>
            </div>

            {selectedNewItems.length > 0 ? (
              <button
                type="button"
                onClick={handleAddSelected}
                data-testid="wrap-up-add-desktop"
                className="inline-flex items-center gap-2 min-h-[52px] px-6 rounded-xl bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] transition-colors"
              >
                <BookmarkPlus className="w-4 h-4" />
                <span>Add {selectedNewItems.length} to Vocab</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onStartFresh}
                className="inline-flex items-center gap-2 min-h-[52px] px-6 rounded-xl bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] transition-colors"
              >
                <span>Start a new chat</span>
              </button>
            )}
          </div>

          {/* Mobile Sticky Thumb-Zone CTA */}
          <div className="md:hidden fixed bottom-[60px] left-0 right-0 z-30 px-4 py-2.5 bg-[#0B1117]/95 backdrop-blur-md border-t border-[#23303E] flex items-center gap-2">
            <button
              type="button"
              onClick={onKeepTalking}
              className="min-h-[52px] px-4 rounded-xl border border-[#23303E] bg-[#111922] text-xs font-semibold text-[#CBD5E1] shrink-0"
            >
              Keep talking
            </button>

            {selectedNewItems.length > 0 ? (
              <button
                type="button"
                onClick={handleAddSelected}
                data-testid="wrap-up-add-mobile"
                className="flex-1 inline-flex items-center justify-center gap-2 min-h-[52px] px-4 rounded-xl bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] transition-colors"
              >
                <BookmarkPlus className="w-4 h-4" />
                <span>Add {selectedNewItems.length} to Vocab</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onStartFresh}
                className="flex-1 inline-flex items-center justify-center gap-2 min-h-[52px] px-4 rounded-xl bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] transition-colors"
              >
                <span>Start a new chat</span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};
