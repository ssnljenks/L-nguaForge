import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  BookOpen,
  BookmarkPlus,
  Brain,
  Check,
  Download,
  Loader2,
  Mic,
  MicOff,
  Plus,
  Search,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import type {DrillHistoryEntry, MilitaryDomain, MissionConfig, VocabCategory, VocabItem} from '../types';
import {
  filterItemsByLanguage,
  formatVocabToAnkiCsv,
  getDialectInfo,
  getDomainInfo,
  LANGUAGE_LABELS,
  MILITARY_DOMAINS,
  scorePhraseRecallMatch,
} from '../utils/ilrLogic';
import {getOfflineMilitaryEntries, normalizeLookupKey} from '../utils/localDictionary';
import {evaluateRecallSentence} from '../services/api';
import {useSpeechRecognition, useSpeechSynthesis} from '../hooks/useSpeech';

const VOCAB_CATEGORIES: VocabCategory[] = [
  'High-Register Connectors',
  'Operational/Military Terms',
  'Regional Idioms',
  'False Friends',
];

interface VocabVaultModuleProps {
  config: MissionConfig;
  items: VocabItem[];
  onAddVocab: (item: Omit<VocabItem, 'id' | 'createdAt' | 'mastery' | 'reviewCount'>) => void;
  onDeleteVocab: (id: string) => void;
  onUpdateMastery: (id: string, mastery: VocabItem['mastery']) => void;
  onLogHistory: (entry: DrillHistoryEntry) => void;
}

export const VocabVaultModule: React.FC<VocabVaultModuleProps> = ({
  config,
  items,
  onAddVocab,
  onDeleteVocab,
  onUpdateMastery,
  onLogHistory,
}) => {
  const [mode, setMode] = useState<'browse' | 'recall' | 'glossary'>('browse');
  const [categoryFilter, setCategoryFilter] = useState<'all' | VocabCategory>('all');
  const [glossaryDomainFilter, setGlossaryDomainFilter] = useState<'all' | MilitaryDomain>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  // Add manual entry form state
  const [newTerm, setNewTerm] = useState('');
  const [newEnglish, setNewEnglish] = useState('');
  const [newContext, setNewContext] = useState('');
  const [newRegister, setNewRegister] = useState('Formal / Operational');
  const [newCategory, setNewCategory] = useState<VocabCategory>('High-Register Connectors');
  const [formError, setFormError] = useState<string | null>(null);

  // Reverse Active-Recall Drill State
  const [drillIndex, setDrillIndex] = useState(0);
  const [recallGuess, setRecallGuess] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [recallMatchScore, setRecallMatchScore] = useState<number | null>(null);
  const [usageSentence, setUsageSentence] = useState('');
  const [sentenceEval, setSentenceEval] = useState<{
    isNatural: boolean;
    feedback: string;
    polishedVersion: string;
  } | null>(null);
  const [evalLoading, setEvalLoading] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [completedInSession, setCompletedInSession] = useState(0);

  const tts = useSpeechSynthesis();
  const stt = useSpeechRecognition();

  const languageItems = useMemo(() => filterItemsByLanguage(items, config.language), [items, config.language]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return languageItems.filter((item) => {
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
      if (q) {
        return (
          item.term.toLowerCase().includes(q) ||
          item.englishConcept.toLowerCase().includes(q) ||
          item.contextSentence.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [languageItems, categoryFilter, searchQuery]);

  const drillDeck = useMemo(() => {
    const base = filteredItems.length > 0 ? filteredItems : languageItems;
    // Prioritize items needing practice first
    return [...base].sort((a, b) => {
      const rank = {new: 0, practicing: 1, mastered: 2};
      return rank[a.mastery] - rank[b.mastery];
    });
  }, [filteredItems, languageItems]);

  const currentCard = drillDeck[drillIndex % Math.max(1, drillDeck.length)] ?? null;

  const offlineMilitaryEntries = useMemo(() => getOfflineMilitaryEntries(config.language), [config.language]);

  const filteredGlossaryEntries = useMemo(() => {
    const q = normalizeLookupKey(searchQuery);
    return offlineMilitaryEntries.filter((entry) => {
      if (glossaryDomainFilter !== 'all' && entry.domain !== glossaryDomainFilter) {
        return false;
      }
      if (q) {
        return (
          normalizeLookupKey(entry.term).includes(q) ||
          normalizeLookupKey(entry.meaning).includes(q) ||
          normalizeLookupKey(entry.note).includes(q)
        );
      }
      return true;
    });
  }, [offlineMilitaryEntries, glossaryDomainFilter, searchQuery]);

  const savedNormalizedTerms = useMemo(
    () => new Set(languageItems.map((item) => normalizeLookupKey(item.term))),
    [languageItems]
  );

  const dialectInfo = getDialectInfo(config.language, config.dialect);

  const prevLangRef = useRef(config.language);
  useEffect(() => {
    if (prevLangRef.current !== config.language) {
      prevLangRef.current = config.language;
      tts.stop();
      stt.stopListening();
      stt.resetTranscript();
      setDrillIndex(0);
      setSearchQuery('');
      setCategoryFilter('all');
      setGlossaryDomainFilter('all');
      setShowAddForm(false);
      setFormError(null);
      setRecallGuess('');
      setRevealed(false);
      setRecallMatchScore(null);
      setUsageSentence('');
      setSentenceEval(null);
      setEvalError(null);
      setCompletedInSession(0);
    }
  }, [config.language, tts, stt]);

  const handleExportCsv = () => {
    const targetList = filteredItems.length > 0 ? filteredItems : languageItems;
    if (targetList.length === 0) return;
    const csv = formatVocabToAnkiCsv(targetList);
    const blob = new Blob(['\uFEFF' + csv], {type: 'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `linguaforge-ilr-${config.language}-anki-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleManualAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTerm.trim() || !newEnglish.trim()) {
      setFormError('Both the target term and the English concept are required.');
      return;
    }
    setFormError(null);
    onAddVocab({
      term: newTerm.trim(),
      englishConcept: newEnglish.trim(),
      contextSentence: newContext.trim() || `Operational example using "${newTerm.trim()}".`,
      registerTag: newRegister.trim() || 'Formal / Operational',
      category: newCategory,
      language: config.language,
      dialect: config.dialect,
      domain: config.domain,
    });
    setNewTerm('');
    setNewEnglish('');
    setNewContext('');
    setShowAddForm(false);
  };

  const resetCardState = () => {
    setRecallGuess('');
    setRevealed(false);
    setRecallMatchScore(null);
    setUsageSentence('');
    setSentenceEval(null);
    setEvalError(null);
    stt.stopListening();
    stt.resetTranscript();
  };

  const handleCheckRecall = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentCard) return;
    const guess = (recallGuess || stt.finalTranscript).trim();
    const cleanedTarget = currentCard.term.replace(/\s*\(.*?\)\s*/g, '').trim();
    const score = guess ? scorePhraseRecallMatch(cleanedTarget, guess) : 0;
    setRecallMatchScore(score);
    setRevealed(true);
    stt.stopListening();
  };

  const handleVoiceRecall = () => {
    if (!currentCard) return;
    const bcp = getDialectInfo(currentCard.language, currentCard.dialect).bcp47;
    if (stt.isListening) {
      stt.stopListening();
      if (stt.finalTranscript) {
        if (!revealed) setRecallGuess(stt.finalTranscript);
        else setUsageSentence(stt.finalTranscript);
      }
      return;
    }
    stt.resetTranscript();
    stt.startListening({
      lang: bcp,
      continuous: false,
      onFinalSegment: (seg) => {
        if (!revealed) setRecallGuess((prev) => (prev ? `${prev} ${seg}` : seg));
        else setUsageSentence((prev) => (prev ? `${prev} ${seg}` : seg));
      },
    });
  };

  const handleEvaluateSentence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentCard || !usageSentence.trim()) return;
    setEvalLoading(true);
    setEvalError(null);
    try {
      const domainLabel = getDomainInfo(currentCard.domain).label;
      const res = await evaluateRecallSentence({
        language: currentCard.language,
        targetTerm: currentCard.term,
        userSentence: usageSentence.trim(),
        domainLabel,
      });
      setSentenceEval(res);
    } catch (err) {
      setEvalError(err instanceof Error ? err.message : 'Unable to evaluate sentence.');
    } finally {
      setEvalLoading(false);
    }
  };

  const handleGradeCard = (mastery: VocabItem['mastery']) => {
    if (!currentCard) return;
    onUpdateMastery(currentCard.id, mastery);
    const nextDone = completedInSession + 1;
    setCompletedInSession(nextDone);
    if (nextDone % 3 === 0) {
      onLogHistory({
        id: `hist-vocab-${Date.now()}`,
        module: 'vocab_recall',
        language: currentCard.language,
        dialect: currentCard.dialect,
        domain: currentCard.domain,
        completedAt: new Date().toISOString(),
        summary: `Reverse Active-Recall Drill (${nextDone} cards reviewed)`,
        scoreLabel: mastery === 'mastered' ? 'Mastered' : 'Active Recall',
      });
    }
    setDrillIndex((i) => (i + 1) % Math.max(1, drillDeck.length));
    resetCardState();
  };

  return (
    <div className="space-y-6">
      {/* Header & Mode Switch */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-5 border-b border-[#23303E]">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-[#94A3B8]">
            {LANGUAGE_LABELS[config.language]} Lexicon ·{' '}
            <span className="font-mono tabular-nums">{languageItems.length}</span> saved items · Anki CSV Ready
          </p>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#F8FAFC]">
            Vocabulary &amp; Active Recall Vault
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div
            className="flex flex-wrap items-center p-1 rounded-lg bg-[#111922] border border-[#23303E]"
            role="tablist"
            aria-label="Vault mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'browse'}
              onClick={() => {
                setMode('browse');
                stt.stopListening();
              }}
              className={`px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                mode === 'browse' ? 'bg-[#1D2B3A] text-[#F8FAFC]' : 'text-[#94A3B8] hover:text-white'
              }`}
            >
              Vault Library
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'glossary'}
              onClick={() => {
                setMode('glossary');
                stt.stopListening();
              }}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                mode === 'glossary' ? 'bg-[#1D2B3A] text-[#F8FAFC]' : 'text-[#94A3B8] hover:text-white'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5 text-[#D99B26]" />
              <span>Offline Military Dict</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'recall'}
              onClick={() => {
                setMode('recall');
                resetCardState();
              }}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                mode === 'recall' ? 'bg-[#D99B26] text-[#0B1117] font-semibold' : 'text-[#94A3B8] hover:text-white'
              }`}
            >
              <Brain className="w-3.5 h-3.5" />
              <span>Reverse Active-Recall</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={languageItems.length === 0}
            className="flex items-center gap-1.5 px-3.5 py-2 min-h-[42px] rounded-lg border border-[#23303E] bg-[#111922] text-xs font-medium text-[#CBD5E1] hover:text-white hover:border-[#35495E] disabled:opacity-40 transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Anki CSV</span>
          </button>

          {mode === 'browse' && (
            <button
              type="button"
              onClick={() => setShowAddForm((s) => !s)}
              className="flex items-center gap-1.5 px-3.5 py-2 min-h-[42px] rounded-lg bg-[#D99B26] text-[#0B1117] text-xs font-semibold hover:bg-[#E5AE42] transition-colors whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Add Entry</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        {mode === 'glossary' ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setGlossaryDomainFilter('all')}
              className={`px-3 py-1.5 min-h-[36px] rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                glossaryDomainFilter === 'all'
                  ? 'bg-[#1D2B3A] text-[#F8FAFC] border border-[#35495E]'
                  : 'text-[#94A3B8] hover:text-white border border-transparent hover:bg-[#111922]'
              }`}
            >
              All Domains ({offlineMilitaryEntries.length})
            </button>
            {MILITARY_DOMAINS.map((dom) => (
              <button
                key={dom.id}
                type="button"
                onClick={() => setGlossaryDomainFilter(dom.id)}
                className={`px-3 py-1.5 min-h-[36px] rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  glossaryDomainFilter === dom.id
                    ? 'bg-[#1D2B3A] text-[#F8FAFC] border border-[#35495E]'
                    : 'text-[#94A3B8] hover:text-white border border-transparent hover:bg-[#111922]'
                }`}
              >
                {dom.shortLabel}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {(['all', ...VOCAB_CATEGORIES] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => {
                  setCategoryFilter(cat);
                  setDrillIndex(0);
                }}
                className={`px-3 py-1.5 min-h-[36px] rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  categoryFilter === cat
                    ? 'bg-[#1D2B3A] text-[#F8FAFC] border border-[#35495E]'
                    : 'text-[#94A3B8] hover:text-white border border-transparent hover:bg-[#111922]'
                }`}
              >
                {cat === 'all' ? 'All Categories' : cat}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          {(mode === 'browse' || mode === 'glossary') && (
            <div className="relative flex-1 md:w-64">
              <Search className="w-3.5 h-3.5 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <label htmlFor="vault-search-input" className="sr-only">
                {mode === 'glossary'
                  ? `Search offline ${LANGUAGE_LABELS[config.language]} military dictionary`
                  : `Search saved ${LANGUAGE_LABELS[config.language]} vocabulary`}
              </label>
              <input
                id="vault-search-input"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  mode === 'glossary'
                    ? `Search offline ${LANGUAGE_LABELS[config.language]} military terms…`
                    : `Search ${LANGUAGE_LABELS[config.language]} terms…`
                }
                className="w-full min-h-[38px] rounded-lg border border-[#23303E] bg-[#111922] pl-8 pr-3 py-1.5 text-xs text-[#E6EDF3] placeholder:text-[#64748B] focus:outline-none focus:border-[#D99B26]"
              />
            </div>
          )}
        </div>
      </div>

      {/* Manual Entry Form */}
      {mode === 'browse' && showAddForm && (
        <form onSubmit={handleManualAdd} className="rounded-xl border border-[#D99B26]/35 bg-[#111922] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#F8FAFC]">Add to {LANGUAGE_LABELS[config.language]} Vault</h2>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              aria-label="Close add entry form"
              className="text-[#94A3B8] hover:text-white p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {formError && <p className="text-xs text-red-300">{formError}</p>}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label htmlFor="vocab-term" className="text-xs text-[#94A3B8]">
                Target Phrase ({LANGUAGE_LABELS[config.language]})
              </label>
              <input
                id="vocab-term"
                type="text"
                value={newTerm}
                onChange={(e) => setNewTerm(e.target.value)}
                placeholder="e.g., cabe destacar que"
                className="w-full min-h-[40px] rounded-lg border border-[#23303E] bg-[#0B1117] px-3 py-2 text-sm text-[#E6EDF3] focus:outline-none focus:border-[#D99B26]"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="vocab-english" className="text-xs text-[#94A3B8]">
                English Concept / Operational Scenario
              </label>
              <input
                id="vocab-english"
                type="text"
                value={newEnglish}
                onChange={(e) => setNewEnglish(e.target.value)}
                placeholder="e.g., it should be highlighted that (formal framing)"
                className="w-full min-h-[40px] rounded-lg border border-[#23303E] bg-[#0B1117] px-3 py-2 text-sm text-[#E6EDF3] focus:outline-none focus:border-[#D99B26]"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="vocab-category" className="text-xs text-[#94A3B8]">
                Category
              </label>
              <select
                id="vocab-category"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value as VocabCategory)}
                className="w-full min-h-[40px] rounded-lg border border-[#23303E] bg-[#0B1117] px-3 py-2 text-sm text-[#E6EDF3] focus:outline-none focus:border-[#D99B26]"
              >
                {VOCAB_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label htmlFor="vocab-register" className="text-xs text-[#94A3B8]">
                Register Tag
              </label>
              <input
                id="vocab-register"
                type="text"
                value={newRegister}
                onChange={(e) => setNewRegister(e.target.value)}
                className="w-full min-h-[40px] rounded-lg border border-[#23303E] bg-[#0B1117] px-3 py-2 text-sm text-[#E6EDF3] focus:outline-none focus:border-[#D99B26]"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="vocab-context" className="text-xs text-[#94A3B8]">
              Sentence Context
            </label>
            <input
              id="vocab-context"
              type="text"
              value={newContext}
              onChange={(e) => setNewContext(e.target.value)}
              placeholder="Full operational sentence illustrating usage…"
              className="w-full min-h-[40px] rounded-lg border border-[#23303E] bg-[#0B1117] px-3 py-2 text-sm text-[#E6EDF3] focus:outline-none focus:border-[#D99B26]"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="px-4 py-2 rounded-lg text-xs font-medium text-[#94A3B8] hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-[#D99B26] text-[#0B1117] text-xs font-semibold hover:bg-[#E5AE42]"
            >
              Save to Vault
            </button>
          </div>
        </form>
      )}

      {/* BROWSE MODE / OFFLINE MILITARY DICTIONARY / REVERSE ACTIVE-RECALL */}
      {mode === 'glossary' ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#94A3B8]">
            <span>
              Built-in offline {LANGUAGE_LABELS[config.language]} military lexicon —{' '}
              <span className="font-mono text-[#E6EDF3] tabular-nums">{filteredGlossaryEntries.length}</span>{' '}
              {filteredGlossaryEntries.length === 1 ? 'term' : 'terms'} ready with zero API calls
            </span>
          </div>

          {filteredGlossaryEntries.length === 0 ? (
            <div className="rounded-xl border border-[#23303E] bg-[#111922] p-10 text-center space-y-2">
              <p className="text-sm font-medium text-[#E6EDF3]">
                No offline {LANGUAGE_LABELS[config.language]} military terms match that search.
              </p>
              <p className="text-xs text-[#94A3B8]">
                Try clearing the domain filter or searching by English or {LANGUAGE_LABELS[config.language]} root word.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-[#23303E] bg-[#111922] divide-y divide-[#1D2835]">
              {filteredGlossaryEntries.map((entry) => {
                const alreadySaved = savedNormalizedTerms.has(normalizeLookupKey(entry.term));
                return (
                  <div
                    key={`${config.language}-${entry.term}`}
                    className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-start justify-between gap-4 hover:bg-[#141E29] transition-colors"
                  >
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <h3 className="text-base font-semibold text-[#F8FAFC]">{entry.term}</h3>
                        <span className="text-sm text-[#CBD5E1]">{entry.meaning}</span>
                      </div>
                      <p className="text-xs text-[#94A3B8] leading-relaxed">{entry.note}</p>
                      <p className="text-xs text-[#7D8FA3]">
                        {getDomainInfo(entry.domain).shortLabel}
                        <span className="mx-1.5" aria-hidden="true">
                          ·
                        </span>
                        {entry.register}
                        <span className="mx-1.5" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-emerald-400">Offline Ready</span>
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          tts.speak(entry.term, {
                            lang: dialectInfo.bcp47,
                            rate: config.speechRate,
                            voiceURI: config.voiceURI,
                          })
                        }
                        aria-label={`Listen to ${entry.term}`}
                        className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-[#23303E] text-[#CBD5E1] hover:text-[#F3C669] hover:border-[#35495E] transition-colors"
                      >
                        <Volume2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        disabled={alreadySaved}
                        onClick={() =>
                          onAddVocab({
                            term: entry.term,
                            englishConcept: entry.meaning,
                            contextSentence: entry.note,
                            registerTag: entry.register,
                            category: entry.category,
                            language: config.language,
                            dialect: config.dialect,
                            domain: entry.domain,
                          })
                        }
                        aria-label={alreadySaved ? `${entry.term} already in Vault` : `Save ${entry.term} to Vault`}
                        className={`inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                          alreadySaved
                            ? 'border border-emerald-500/35 bg-emerald-950/25 text-emerald-300 cursor-default'
                            : 'bg-[#D99B26] text-[#0B1117] hover:bg-[#E5AE42]'
                        }`}
                      >
                        {alreadySaved ? <Check className="w-3.5 h-3.5" /> : <BookmarkPlus className="w-3.5 h-3.5" />}
                        <span>{alreadySaved ? 'In Vault' : 'Save to Vault'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : mode === 'browse' ? (
        filteredItems.length === 0 ? (
          <div className="rounded-xl border border-[#23303E] bg-[#111922] p-10 text-center space-y-2">
            <p className="text-sm font-medium text-[#E6EDF3]">
              No {LANGUAGE_LABELS[config.language]} vocabulary entries match this filter.
            </p>
            <p className="text-xs text-[#94A3B8]">
              Tap words in Live Voice Chat or OPI Transcript, save upgrades from ILR Debrief, or add a new{' '}
              {LANGUAGE_LABELS[config.language]} entry above.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-[#23303E] bg-[#111922] divide-y divide-[#1D2835]">
            {filteredItems.map((item) => {
              const dialect = getDialectInfo(item.language, item.dialect);
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
                    <p className="text-xs text-[#94A3B8] leading-relaxed italic">
                      &ldquo;{item.contextSentence}&rdquo;
                    </p>
                    <p className="text-xs text-[#7D8FA3]">
                      {item.category}
                      <span className="mx-1.5" aria-hidden="true">
                        ·
                      </span>
                      {LANGUAGE_LABELS[item.language]} ({dialect.short})
                      <span className="mx-1.5" aria-hidden="true">
                        ·
                      </span>
                      {item.registerTag}
                      <span className="mx-1.5" aria-hidden="true">
                        ·
                      </span>
                      <span
                        className={
                          item.mastery === 'mastered'
                            ? 'text-emerald-400'
                            : item.mastery === 'practicing'
                              ? 'text-amber-300'
                              : 'text-[#94A3B8]'
                        }
                      >
                        {item.mastery === 'mastered'
                          ? 'Mastered'
                          : item.mastery === 'practicing'
                            ? 'Practicing'
                            : 'New'}
                      </span>
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        tts.speak(item.term.replace(/\s*\(.*?\)\s*/g, ''), {
                          lang: dialect.bcp47,
                          rate: config.speechRate,
                          voiceURI: config.voiceURI,
                        })
                      }
                      aria-label={`Listen to ${item.term}`}
                      className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg border border-[#23303E] text-[#CBD5E1] hover:text-[#F3C669] hover:border-[#35495E] transition-colors"
                    >
                      <Volume2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteVocab(item.id)}
                      aria-label={`Delete ${item.term}`}
                      className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg border border-[#23303E] text-[#94A3B8] hover:text-red-400 hover:border-red-500/40 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : /* REVERSE ACTIVE-RECALL DRILL MODE */
      currentCard ? (
        <div className="max-w-3xl mx-auto rounded-xl border border-[#23303E] bg-[#111922] p-5 sm:p-7 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#94A3B8]">
            <span>
              Reverse Active-Recall · Card{' '}
              <span className="font-mono text-[#F8FAFC] tabular-nums">
                {(drillIndex % drillDeck.length) + 1}/{drillDeck.length}
              </span>
            </span>
            <span>
              Target: <strong className="text-[#E6EDF3]">{LANGUAGE_LABELS[currentCard.language]}</strong> ·{' '}
              {currentCard.category}
            </span>
          </div>

          {/* Step 1: English Concept Only (Target Term Hidden!) */}
          <div className="space-y-2 py-2">
            <p className="text-xs text-[#7D8FA3]">Recall the {LANGUAGE_LABELS[currentCard.language]} expression for:</p>
            <h2 data-testid="recall-english-prompt" className="text-2xl font-semibold text-[#F8FAFC] leading-snug">
              {currentCard.englishConcept}
            </h2>
            <p className="text-xs text-[#94A3B8]">
              Register target: {currentCard.registerTag} · Domain: {getDomainInfo(currentCard.domain).shortLabel}
            </p>
          </div>

          {!revealed ? (
            <form onSubmit={handleCheckRecall} className="space-y-4">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleVoiceRecall}
                  aria-label={stt.isListening ? 'Stop voice recall' : 'Speak target phrase from memory'}
                  className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border transition-colors shrink-0 ${
                    stt.isListening
                      ? 'border-red-500 bg-red-600 text-white'
                      : 'border-[#2E4054] bg-[#16202B] text-[#E6EDF3] hover:bg-[#1E2C3A]'
                  }`}
                >
                  {stt.isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>

                <label htmlFor="recall-attempt-input" className="sr-only">
                  Type or speak the target term from memory
                </label>
                <input
                  id="recall-attempt-input"
                  type="text"
                  value={recallGuess}
                  onChange={(e) => setRecallGuess(e.target.value)}
                  placeholder={`Speak or type the ${LANGUAGE_LABELS[currentCard.language]} phrase from memory…`}
                  className="flex-1 min-h-[44px] rounded-lg border border-[#23303E] bg-[#0B1117] px-3.5 py-2 text-sm text-[#E6EDF3] placeholder:text-[#64748B] focus:outline-none focus:border-[#D99B26]"
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setRecallMatchScore(0);
                    setRevealed(true);
                  }}
                  className="px-3.5 py-2 min-h-[42px] rounded-lg text-xs font-medium text-[#94A3B8] hover:text-white"
                >
                  Reveal Answer
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 min-h-[44px] rounded-lg bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] transition-colors"
                >
                  Check Recall
                </button>
              </div>
            </form>
          ) : (
            /* Step 2: Reveal Target Term + Full Operational Sentence Prompt */
            <div className="space-y-6 pt-4 border-t border-[#23303E]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-xs text-[#94A3B8]">
                    Target Expression
                    {recallMatchScore !== null && (
                      <>
                        <span className="mx-1.5" aria-hidden="true">
                          ·
                        </span>
                        <span
                          className={`font-mono font-semibold tabular-nums ${
                            recallMatchScore >= 75 ? 'text-emerald-400' : 'text-amber-300'
                          }`}
                        >
                          {recallMatchScore}% recall match
                        </span>
                      </>
                    )}
                  </p>
                  <p data-testid="recall-revealed-term" className="text-2xl font-bold text-[#F3C669]">
                    {currentCard.term}
                  </p>
                  <p className="text-sm text-[#CBD5E1] italic mt-1">&ldquo;{currentCard.contextSentence}&rdquo;</p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    tts.speak(currentCard.term.replace(/\s*\(.*?\)\s*/g, ''), {
                      lang: getDialectInfo(currentCard.language, currentCard.dialect).bcp47,
                      rate: config.speechRate,
                      voiceURI: config.voiceURI,
                    })
                  }
                  className="flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-lg border border-[#2E4054] bg-[#16202B] text-xs font-medium text-[#E6EDF3] hover:bg-[#1E2C3A]"
                >
                  <Volume2 className="w-4 h-4 text-[#D99B26]" />
                  <span>Listen</span>
                </button>
              </div>

              {/* Production step: use it in a full operational sentence */}
              <form onSubmit={handleEvaluateSentence} className="space-y-3 pt-4 border-t border-[#23303E]">
                <label htmlFor="recall-sentence-input" className="block text-xs font-semibold text-[#E6EDF3]">
                  Step 2 — Use &ldquo;{currentCard.term.replace(/\s*\(.*?\)\s*/g, '')}&rdquo; in a full operational
                  sentence:
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleVoiceRecall}
                    aria-label={stt.isListening ? 'Stop speaking sentence' : 'Speak full sentence'}
                    className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border shrink-0 ${
                      stt.isListening
                        ? 'border-red-500 bg-red-600 text-white'
                        : 'border-[#2E4054] bg-[#16202B] text-[#E6EDF3]'
                    }`}
                  >
                    {stt.isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  </button>
                  <input
                    id="recall-sentence-input"
                    type="text"
                    value={usageSentence}
                    onChange={(e) => setUsageSentence(e.target.value)}
                    placeholder={`Produce a complete ${LANGUAGE_LABELS[currentCard.language]} sentence…`}
                    className="flex-1 min-h-[44px] rounded-lg border border-[#23303E] bg-[#0B1117] px-3.5 py-2 text-sm text-[#E6EDF3] placeholder:text-[#64748B] focus:outline-none focus:border-[#D99B26]"
                  />
                  <button
                    type="submit"
                    disabled={!usageSentence.trim() || evalLoading}
                    className="px-4 py-2 min-h-[44px] rounded-lg border border-[#2E4054] bg-[#16202B] text-xs font-semibold text-[#F8FAFC] hover:bg-[#1E2C3A] disabled:opacity-40 whitespace-nowrap shrink-0"
                  >
                    {evalLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Coach Check'}
                  </button>
                </div>

                {evalError && <p className="text-xs text-red-300">{evalError}</p>}

                {sentenceEval && (
                  <div className="rounded-lg border border-[#23303E] bg-[#0B1117] p-3.5 space-y-1.5">
                    <p
                      className={`text-xs font-semibold ${sentenceEval.isNatural ? 'text-emerald-400' : 'text-amber-300'}`}
                    >
                      {sentenceEval.isNatural ? 'Natural Operational Register' : 'Register Adjustment Suggested'}
                    </p>
                    <p className="text-xs text-[#CBD5E1]">{sentenceEval.feedback}</p>
                    <p className="text-xs text-[#94A3B8]">
                      Polished: <span className="text-[#F8FAFC]">{sentenceEval.polishedVersion}</span>
                    </p>
                  </div>
                )}
              </form>

              {/* Mastery Self-Rating & Next Card */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-[#23303E]">
                <span className="text-xs text-[#94A3B8]">Log mastery to advance:</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleGradeCard('new')}
                    className="px-3.5 py-2 min-h-[40px] rounded-lg border border-red-500/30 bg-red-950/20 text-xs font-medium text-red-300 hover:bg-red-950/40"
                  >
                    Needs Work
                  </button>
                  <button
                    type="button"
                    onClick={() => handleGradeCard('practicing')}
                    className="px-3.5 py-2 min-h-[40px] rounded-lg border border-amber-500/30 bg-amber-950/20 text-xs font-medium text-amber-300 hover:bg-amber-950/40"
                  >
                    Solid
                  </button>
                  <button
                    type="button"
                    onClick={() => handleGradeCard('mastered')}
                    className="flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-xs font-semibold text-emerald-300 hover:bg-emerald-600/30"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Mastered</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-[#23303E] bg-[#111922] p-10 text-center text-sm text-[#94A3B8]">
          Save at least one {LANGUAGE_LABELS[config.language]} vocabulary item to launch Reverse Active-Recall drills.
        </div>
      )}
    </div>
  );
};
