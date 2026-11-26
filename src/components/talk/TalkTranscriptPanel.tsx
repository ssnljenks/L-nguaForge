import React from 'react';
import {ArrowRight, BookmarkPlus, Check, Loader2, Volume2, X} from 'lucide-react';
import type {TutorPersona} from '../../data/tutors';
import type {FreeChatMessage, MissionConfig, TalkPickedUpItem, VocabItem} from '../../types';
import {buildRegionalCandidates, isTermInVocab, type RegionalTermCandidate} from '../../utils/talkLogic';
import type {SaveVocabFn, useWordLookup} from '../../hooks/useWordLookup';
import type {useSpeechSynthesis} from '../../hooks/useSpeech';
import {WordLookupPopover} from '../shared/WordLookupPopover';
import {FlagWordDrawer} from '../chat/FlagWordDrawer';
import {ColloquialTranscriptText} from './ColloquialTranscriptText';

export interface ColloquialLookupState {
  messageId: string;
  candidate: RegionalTermCandidate;
  contextSentence: string;
}

interface TalkTranscriptPanelProps {
  config: MissionConfig;
  lookupConfig: MissionConfig;
  selectedTutor: TutorPersona;
  dialectInfo: {bcp47: string};
  messages: FreeChatMessage[];
  threadPickedUp: TalkPickedUpItem[];
  regionalCandidates: RegionalTermCandidate[];
  live: {isLive: boolean; liveUserTranscript: string; livePartnerTranscript: string};
  isSendingText: boolean;
  tts: ReturnType<typeof useSpeechSynthesis>;
  wordLookup: ReturnType<typeof useWordLookup>;
  colloquialLookup: ColloquialLookupState | null;
  setColloquialLookup: (next: ColloquialLookupState | null) => void;
  vocabItems: VocabItem[];
  onSaveVocab: SaveVocabFn;
  recordSavedTerm: (term: string) => void;
  handleSaveColloquial: (item: TalkPickedUpItem | RegionalTermCandidate, exampleSentence: string) => void;
  showFlagDrawer: boolean;
  onToggleFlagDrawer: () => void;
  onCloseFlagDrawer: () => void;
  savedCount: number;
  onGoToVocab: () => void;
  transcriptPaneRef: React.RefObject<HTMLDivElement | null>;
}

/** The conversation: messages with tappable local phrases and words, live captions, and the save-a-phrase tool. */
export const TalkTranscriptPanel: React.FC<TalkTranscriptPanelProps> = ({
  config,
  lookupConfig,
  selectedTutor,
  dialectInfo,
  messages,
  threadPickedUp,
  regionalCandidates,
  live,
  isSendingText,
  tts,
  wordLookup,
  colloquialLookup,
  setColloquialLookup,
  vocabItems,
  onSaveVocab,
  recordSavedTerm,
  handleSaveColloquial,
  showFlagDrawer,
  onToggleFlagDrawer,
  onCloseFlagDrawer,
  savedCount,
  onGoToVocab,
  transcriptPaneRef,
}) => (
  <section
    data-testid="talk-transcript-panel"
    className="rounded-xl border border-[#23303E] bg-[#111922] overflow-hidden"
  >
    <div className="px-4 py-3 border-b border-[#23303E] flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-xs text-[#94A3B8]">
        <span className="font-medium text-[#CBD5E1]">Conversation</span>
        <span>·</span>
        <span>
          Tap <span className="text-[#BAE6FD] underline decoration-dotted decoration-[#7DD3FC]">local phrases</span> or
          any word to save
        </span>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggleFlagDrawer}
          className="inline-flex items-center gap-1 min-h-[44px] text-xs font-medium text-[#F3C669] hover:underline whitespace-nowrap"
        >
          <BookmarkPlus className="w-3.5 h-3.5" />
          <span>{showFlagDrawer ? 'Hide Note Tool' : 'Save a Phrase'}</span>
        </button>

        {savedCount > 0 && (
          <button
            type="button"
            onClick={onGoToVocab}
            className="inline-flex items-center gap-1 min-h-[44px] text-xs font-medium text-emerald-400 hover:underline whitespace-nowrap tabular-nums"
          >
            <span>{savedCount} in Vocab</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>

    {showFlagDrawer && (
      <FlagWordDrawer
        config={lookupConfig}
        fallbackContextSentence={messages[messages.length - 1]?.text ?? ''}
        onSaveVocab={onSaveVocab}
        onSaved={recordSavedTerm}
        onClose={onCloseFlagDrawer}
      />
    )}

    <div ref={transcriptPaneRef} className="max-h-[360px] overflow-y-auto p-4 space-y-4">
      {messages.length === 0 && !live.liveUserTranscript && !live.livePartnerTranscript ? (
        <p className="text-xs text-[#7D8FA3] text-center py-6">
          Listening… captions will appear here as you and {selectedTutor.name} talk.
        </p>
      ) : (
        <>
          {messages.map((msg) => {
            const isPartner = msg.role === 'assistant';
            const safeText = typeof msg.text === 'string' ? msg.text : '';
            const msgCandidates =
              msg.pickedUp && msg.pickedUp.length > 0
                ? buildRegionalCandidates(selectedTutor, [msg.pickedUp, threadPickedUp])
                : regionalCandidates;

            const colloquialOpen = colloquialLookup?.messageId === msg.id ? colloquialLookup : null;
            const colloquialAlreadySaved = colloquialOpen
              ? isTermInVocab(colloquialOpen.candidate.term, config.language, vocabItems)
              : false;

            return (
              <div key={msg.id} className={`flex flex-col ${isPartner ? 'items-start' : 'items-end'}`}>
                <div className="flex items-center gap-2 text-[11px] text-[#7D8FA3] mb-1 px-1">
                  <span>{isPartner ? selectedTutor.name : 'You'}</span>
                  {isPartner && safeText && !live.isLive && (
                    <button
                      type="button"
                      onClick={() =>
                        tts.speak(safeText, {
                          lang: dialectInfo.bcp47,
                          rate: config.speechRate,
                          voiceURI: config.voiceURI,
                        })
                      }
                      aria-label={`Replay ${selectedTutor.name} message`}
                      className="text-[#94A3B8] hover:text-[#F3C669] p-1"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div
                  className={`max-w-[90%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                    isPartner
                      ? 'bg-[#16202B] border border-[#253545] text-[#F1F5F9]'
                      : 'bg-[#1D2835] border border-[#2E4054] text-[#E6EDF3]'
                  }`}
                >
                  <ColloquialTranscriptText
                    text={safeText}
                    candidates={isPartner ? msgCandidates : []}
                    activeWord={wordLookup.lookup?.messageId === msg.id ? wordLookup.lookup.word : undefined}
                    isPartner={isPartner}
                    onWordTap={(word) => {
                      setColloquialLookup(null);
                      void wordLookup.lookUpWord(msg.id, word, safeText);
                    }}
                    onColloquialTap={(candidate) => {
                      wordLookup.close();
                      setColloquialLookup({
                        messageId: msg.id,
                        candidate,
                        contextSentence: safeText,
                      });
                    }}
                  />
                </div>

                {/* Inline Colloquial Expression Card (from dotted-underline tap) */}
                {isPartner && colloquialOpen && (
                  <div
                    role="region"
                    aria-label={`Local expression: ${colloquialOpen.candidate.term}`}
                    className="mt-2.5 w-full max-w-sm rounded-xl border border-[#7DD3FC]/45 bg-[#0D141C] p-3.5 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-[#F8FAFC]">{colloquialOpen.candidate.term}</p>
                        <p className="text-[11px] text-[#7DD3FC]">{colloquialOpen.candidate.regionTag}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setColloquialLookup(null)}
                        aria-label="Close local expression card"
                        className="p-1 text-[#94A3B8] hover:text-white"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <p className="text-sm text-[#E6EDF3]">{colloquialOpen.candidate.meaning}</p>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={colloquialAlreadySaved}
                        onClick={() => handleSaveColloquial(colloquialOpen.candidate, colloquialOpen.contextSentence)}
                        className={`inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-lg text-xs font-semibold transition-colors ${
                          colloquialAlreadySaved
                            ? 'border border-emerald-500/35 bg-emerald-950/25 text-emerald-300 cursor-default'
                            : 'bg-[#D99B26] text-[#0B1117] hover:bg-[#E5AE42]'
                        }`}
                      >
                        {colloquialAlreadySaved ? (
                          <Check className="w-3.5 h-3.5" />
                        ) : (
                          <BookmarkPlus className="w-3.5 h-3.5" />
                        )}
                        <span>{colloquialAlreadySaved ? 'Already in Vocab' : 'Save to Vocab'}</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Standard Single-Word Lookup Popover */}
                {isPartner && wordLookup.lookup?.messageId === msg.id && (
                  <WordLookupPopover
                    lookup={wordLookup.lookup}
                    onClose={wordLookup.close}
                    onRetry={wordLookup.retry}
                    onSave={wordLookup.save}
                    compact
                  />
                )}
              </div>
            );
          })}

          {live.liveUserTranscript && (
            <div className="flex flex-col items-end">
              <span className="text-[11px] text-[#7D8FA3] mb-1 px-1">You (speaking…)</span>
              <div className="max-w-[90%] rounded-xl px-3.5 py-2.5 text-sm bg-[#1D2835]/70 border border-[#D99B26]/35 text-[#E6EDF3]">
                {live.liveUserTranscript}
              </div>
            </div>
          )}

          {live.livePartnerTranscript && (
            <div className="flex flex-col items-start">
              <span className="text-[11px] text-[#7D8FA3] mb-1 px-1">{selectedTutor.name} (speaking…)</span>
              <div className="max-w-[90%] rounded-xl px-3.5 py-2.5 text-sm bg-[#16202B]/80 border border-sky-400/35 text-[#F1F5F9]">
                {live.livePartnerTranscript}
              </div>
            </div>
          )}

          {isSendingText && (
            <div className="flex items-center gap-2 text-xs text-[#94A3B8] px-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#D99B26]" />
              <span>{selectedTutor.name} is replying…</span>
            </div>
          )}
        </>
      )}
    </div>
  </section>
);
