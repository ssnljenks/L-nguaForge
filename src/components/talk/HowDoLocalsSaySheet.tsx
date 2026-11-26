import React, {useEffect, useState} from 'react';
import {BookmarkPlus, Check, Loader2, Mic, MicOff, Send, Volume2, X} from 'lucide-react';
import type {TutorPersona} from '../../data/tutors';
import type {MilitaryDomain, TalkHowDoLocalsSayOption, VocabItem} from '../../types';
import {requestHowDoLocalsSay} from '../../services/api';
import {useSpeechRecognition, useSpeechSynthesis} from '../../hooks/useSpeech';
import type {SaveVocabFn} from '../../hooks/useWordLookup';
import {buildTalkVocabSaveInput, getSlangLevelSpec, isTermInVocab} from '../../utils/talkLogic';
import {getDialectInfo} from '../../utils/ilrLogic';
import {Dialog} from '../shared/Dialog';

interface HowDoLocalsSaySheetProps {
  tutor: TutorPersona;
  slangLevel: number;
  workTalk: boolean;
  domain: MilitaryDomain;
  speechRate: number;
  voiceURI: string;
  vocabItems: VocabItem[];
  onSaveVocab: SaveVocabFn;
  onSavedTerm?: (term: string) => void;
  onClose: () => void;
}

export const HowDoLocalsSaySheet: React.FC<HowDoLocalsSaySheetProps> = ({
  tutor,
  slangLevel,
  workTalk,
  domain,
  speechRate,
  voiceURI,
  vocabItems,
  onSaveVocab,
  onSavedTerm,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [versions, setVersions] = useState<TalkHowDoLocalsSayOption[]>([]);
  const [resolvedMeta, setResolvedMeta] = useState<{city: string; regionTag: string} | null>(null);

  const stt = useSpeechRecognition();
  const tts = useSpeechSynthesis();
  const slangSpec = getSlangLevelSpec(slangLevel);
  const dialectInfo = getDialectInfo(tutor.language, tutor.dialectId);

  useEffect(() => {
    const spoken = `${stt.finalTranscript} ${stt.interimTranscript}`.trim();
    if (spoken) {
      setQuery(spoken);
    }
  }, [stt.finalTranscript, stt.interimTranscript]);

  useEffect(() => {
    return () => {
      stt.stopListening();
      tts.stop();
    };
  }, [stt, tts]);

  const handleToggleVoice = () => {
    if (stt.isListening) {
      stt.stopListening();
      return;
    }
    stt.resetTranscript();
    stt.startListening({lang: 'en-US', continuous: false});
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = query.trim();
    if (!clean || loading) return;

    stt.stopListening();
    setLoading(true);
    setError(null);
    try {
      const res = await requestHowDoLocalsSay({
        language: tutor.language,
        dialect: tutor.dialectId,
        tutorId: tutor.id,
        workTalk,
        ...(workTalk ? {domain} : {}),
        slangLevel,
        englishQuery: clean,
      });
      setVersions(res.versions);
      setResolvedMeta({city: res.city, regionTag: res.regionTag});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to ask right now. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveOption = (opt: TalkHowDoLocalsSayOption) => {
    const regionTag = resolvedMeta?.regionTag ?? tutor.regionTag;
    onSaveVocab(
      buildTalkVocabSaveInput({
        term: opt.expression,
        meaning: opt.literalOrContext,
        exampleSentence: opt.example,
        language: tutor.language,
        dialect: tutor.dialectId,
        tutorId: tutor.id,
        regionTag,
        kind: opt.kind,
        workTalk,
        domain: workTalk ? domain : undefined,
      })
    );
    onSavedTerm?.(opt.expression);
  };

  return (
    <Dialog
      labelledBy="how-locals-say-title"
      onClose={onClose}
      closeOnBackdrop
      variant="sheet"
      className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl border border-[#23303E] bg-[#111922] p-5 max-h-[88vh] overflow-y-auto space-y-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <h2 id="how-locals-say-title" className="font-display text-lg font-semibold text-[#F8FAFC]">
            How do locals say…
          </h2>
          <p className="text-xs text-[#94A3B8]">
            {tutor.name} · {tutor.city} ({slangSpec.label})
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close How do locals say"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border border-[#23303E] text-[#94A3B8] hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-2.5">
        <label htmlFor="how-locals-say-input" className="block text-xs font-medium text-[#CBD5E1]">
          Ask in English (type or speak)
        </label>
        <div className="flex items-center gap-2">
          <input
            id="how-locals-say-input"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. I’m running late because of traffic"
            className="flex-1 min-h-[44px] rounded-lg border border-[#23303E] bg-[#0B1117] px-3.5 py-2 text-sm text-[#E6EDF3] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#D99B26]"
          />
          {stt.supported && (
            <button
              type="button"
              onClick={handleToggleVoice}
              aria-label={stt.isListening ? 'Stop voice input' : 'Speak English phrase'}
              className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border transition-colors shrink-0 ${
                stt.isListening
                  ? 'border-[#D99B26] bg-[#1B2531] text-[#F3C669]'
                  : 'border-[#23303E] bg-[#0B1117] text-[#CBD5E1] hover:text-white'
              }`}
            >
              {stt.isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
          )}
        </div>

        <button
          type="submit"
          disabled={!query.trim() || loading}
          className="w-full inline-flex items-center justify-center gap-2 min-h-[52px] px-4 rounded-xl bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] disabled:opacity-45 transition-colors"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          <span>{loading ? `Asking ${tutor.name}…` : `Ask ${tutor.name}`}</span>
        </button>
      </form>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-950/30 px-3.5 py-2.5 text-xs text-red-200"
        >
          {error}
        </div>
      )}

      {versions.length > 0 && (
        <div className="space-y-3 pt-1" data-testid="how-locals-say-results">
          {versions.map((opt) => {
            const alreadySaved = isTermInVocab(opt.expression, tutor.language, vocabItems);
            return (
              <div key={opt.expression} className="rounded-xl border border-[#23303E] bg-[#0D141C] p-4 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-base font-semibold text-[#F8FAFC]">{opt.expression}</p>
                    <p className="text-xs text-[#7DD3FC]">
                      {resolvedMeta?.city ?? tutor.city} · {opt.kind}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      tts.speak(opt.expression, {
                        lang: dialectInfo.bcp47,
                        rate: speechRate,
                        voiceURI,
                      })
                    }
                    aria-label={`Listen to ${opt.expression}`}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border border-[#23303E] text-[#CBD5E1] hover:text-[#F3C669] transition-colors shrink-0"
                  >
                    <Volume2 className="w-4 h-4" />
                  </button>
                </div>

                <p className="text-sm text-[#E6EDF3]">{opt.literalOrContext}</p>
                {opt.nuance && <p className="text-xs text-[#94A3B8] leading-relaxed">{opt.nuance}</p>}
                {opt.example && (
                  <p className="text-xs italic text-[#CBD5E1] border-l-2 border-[#D99B26]/50 pl-2.5">
                    &ldquo;{opt.example}&rdquo;
                  </p>
                )}

                <div className="pt-1 flex justify-end">
                  <button
                    type="button"
                    disabled={alreadySaved}
                    onClick={() => handleSaveOption(opt)}
                    className={`inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-lg text-xs font-semibold transition-colors ${
                      alreadySaved
                        ? 'border border-emerald-500/35 bg-emerald-950/25 text-emerald-300 cursor-default'
                        : 'bg-[#D99B26] text-[#0B1117] hover:bg-[#E5AE42]'
                    }`}
                  >
                    {alreadySaved ? <Check className="w-3.5 h-3.5" /> : <BookmarkPlus className="w-3.5 h-3.5" />}
                    <span>{alreadySaved ? 'Already in Vocab' : 'Save to Vocab'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Dialog>
  );
};
