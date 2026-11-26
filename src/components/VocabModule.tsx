import React, {useMemo, useState} from 'react';
import {BookOpen, Brain, Download, Plus, Search} from 'lucide-react';
import type {
  DrillHistoryEntry,
  MilitaryDomain,
  MissionConfig,
  VocabCategory,
  VocabFsrsRating,
  VocabItem,
} from '../types';
import {
  filterItemsByLanguage,
  formatVocabToAnkiCsv,
  getDialectInfo,
  LANGUAGE_LABELS,
  MILITARY_DOMAINS,
  VALID_VOCAB_CATEGORIES,
} from '../utils/ilrLogic';
import {getOfflineMilitaryEntries, normalizeLookupKey} from '../utils/localDictionary';
import {getDueVocabCards, sortVocabDeckByFsrs} from '../utils/vocabFsrs';
import {useSpeechSynthesis} from '../hooks/useSpeech';
import type {SaveVocabFn} from '../hooks/useWordLookup';
import {createId} from '../utils/ids';
import {AddVocabForm} from './vault/AddVocabForm';
import {MilitaryGlossaryList} from './vault/MilitaryGlossaryList';
import {RecallCard} from './vault/RecallCard';
import {VaultItemList} from './vault/VaultItemList';

interface VocabModuleProps {
  config: MissionConfig;
  items: VocabItem[];
  onAddVocab: SaveVocabFn;
  onDeleteVocab: (id: string) => void;
  onUpdateMastery: (id: string, mastery: VocabItem['mastery']) => void;
  onReviewVocabFsrs?: (id: string, rating: VocabFsrsRating) => void;
  onLogHistory: (entry: DrillHistoryEntry) => void;
}

export const VocabModule: React.FC<VocabModuleProps> = ({
  config,
  items,
  onAddVocab,
  onDeleteVocab,
  onUpdateMastery,
  onReviewVocabFsrs,
  onLogHistory,
}) => {
  const [mode, setMode] = useState<'browse' | 'recall' | 'glossary'>('browse');
  const [categoryFilter, setCategoryFilter] = useState<'all' | VocabCategory>('all');
  const [glossaryDomainFilter, setGlossaryDomainFilter] = useState<'all' | MilitaryDomain>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  // Reverse active-recall progress. `cardSeq` increments on every grade and keys the card,
  // so each new card (even a repeat in a one-card deck) starts with fresh state.
  const [drillIndex, setDrillIndex] = useState(0);
  const [cardSeq, setCardSeq] = useState(0);
  const [completedInSession, setCompletedInSession] = useState(0);

  const tts = useSpeechSynthesis();
  const dialectInfo = getDialectInfo(config.language, config.dialect);
  const speak = (text: string, lang: string = dialectInfo.bcp47) =>
    tts.speak(text, {lang, rate: config.speechRate, voiceURI: config.voiceURI});

  const languageItems = useMemo(() => filterItemsByLanguage(items, config.language), [items, config.language]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return languageItems.filter((item) => {
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        item.term.toLowerCase().includes(q) ||
        item.englishConcept.toLowerCase().includes(q) ||
        item.contextSentence.toLowerCase().includes(q)
      );
    });
  }, [languageItems, categoryFilter, searchQuery]);

  const dueTodayCount = useMemo(() => getDueVocabCards(items, config.language).length, [items, config.language]);

  // FSRS scheduling: due-today cards come first (earliest due first), then upcoming cards.
  const drillDeck = useMemo(
    () => sortVocabDeckByFsrs(filteredItems.length > 0 ? filteredItems : languageItems),
    [filteredItems, languageItems]
  );
  const currentCard = drillDeck[drillIndex % Math.max(1, drillDeck.length)] ?? null;

  const offlineMilitaryEntries = useMemo(() => getOfflineMilitaryEntries(config.language), [config.language]);
  const filteredGlossaryEntries = useMemo(() => {
    const q = normalizeLookupKey(searchQuery);
    return offlineMilitaryEntries.filter((entry) => {
      if (glossaryDomainFilter !== 'all' && entry.domain !== glossaryDomainFilter) return false;
      if (!q) return true;
      return (
        normalizeLookupKey(entry.term).includes(q) ||
        normalizeLookupKey(entry.meaning).includes(q) ||
        normalizeLookupKey(entry.note).includes(q)
      );
    });
  }, [offlineMilitaryEntries, glossaryDomainFilter, searchQuery]);

  const savedNormalizedTerms = useMemo(
    () => new Set(languageItems.map((item) => normalizeLookupKey(item.term))),
    [languageItems]
  );

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

  const handleGradeCard = (mastery: VocabItem['mastery']) => {
    if (!currentCard) return;
    onUpdateMastery(currentCard.id, mastery);
    const nextDone = completedInSession + 1;
    setCompletedInSession(nextDone);
    if (nextDone % 3 === 0) {
      onLogHistory({
        id: createId('hist-vocab'),
        module: 'vocab_recall',
        language: currentCard.language,
        dialect: currentCard.dialect,
        domain: currentCard.domain ?? config.domain,
        completedAt: new Date().toISOString(),
        summary: `Reverse Active-Recall Drill (${nextDone} cards reviewed)`,
        scoreLabel: mastery === 'mastered' ? 'Mastered' : 'Active Recall',
      });
    }
    setDrillIndex((i) => (i + 1) % Math.max(1, drillDeck.length));
    setCardSeq((n) => n + 1);
  };

  const handleFsrsGradeCard = (rating: VocabFsrsRating) => {
    if (!currentCard) return;
    if (onReviewVocabFsrs) {
      onReviewVocabFsrs(currentCard.id, rating);
    } else {
      onUpdateMastery(currentCard.id, rating === 'again' ? 'new' : rating === 'easy' ? 'mastered' : 'practicing');
    }
    const nextDone = completedInSession + 1;
    setCompletedInSession(nextDone);
    if (nextDone % 3 === 0) {
      onLogHistory({
        id: createId('hist-vocab'),
        module: 'vocab_recall',
        language: currentCard.language,
        dialect: currentCard.dialect,
        domain: currentCard.domain ?? config.domain,
        completedAt: new Date().toISOString(),
        summary: `FSRS Active-Recall Drill (${nextDone} cards reviewed)`,
        scoreLabel: rating === 'easy' ? 'Easy' : rating === 'good' ? 'Good' : rating === 'hard' ? 'Hard' : 'Again',
      });
    }
    setDrillIndex((i) => (i + 1) % Math.max(1, drillDeck.length));
    setCardSeq((n) => n + 1);
  };

  return (
    <div className="space-y-6 pb-24 md:pb-0">
      {/* Header & Mode Switch */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-5 border-b border-[#23303E]">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-[#94A3B8]">
            {LANGUAGE_LABELS[config.language]} Lexicon ·{' '}
            <span className="font-mono tabular-nums">{languageItems.length}</span> saved ·{' '}
            <span className="font-mono tabular-nums text-[#F3C669]">{dueTodayCount} due today</span> · FSRS
          </p>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-[#F8FAFC]">
            Vocab &amp; Active Recall
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div
            className="grid grid-cols-3 sm:inline-flex items-center p-1 rounded-lg bg-[#111922] border border-[#23303E] w-full sm:w-auto"
            role="tablist"
            aria-label="Vocab mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'browse'}
              onClick={() => setMode('browse')}
              className={`flex items-center justify-center min-h-[44px] px-2 sm:px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                mode === 'browse' ? 'bg-[#1D2B3A] text-[#F8FAFC]' : 'text-[#94A3B8] hover:text-white'
              }`}
            >
              <span className="sm:hidden">Library</span>
              <span className="hidden sm:inline">Vocab Library</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'glossary'}
              onClick={() => setMode('glossary')}
              className={`flex items-center justify-center gap-1.5 min-h-[44px] px-2 sm:px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                mode === 'glossary' ? 'bg-[#1D2B3A] text-[#F8FAFC]' : 'text-[#94A3B8] hover:text-white'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5 text-[#D99B26] shrink-0" />
              <span className="sm:hidden">Military Dict</span>
              <span className="hidden sm:inline">Offline Military Dict</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'recall'}
              onClick={() => setMode('recall')}
              className={`flex items-center justify-center gap-1.5 min-h-[44px] px-2 sm:px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                mode === 'recall' ? 'bg-[#D99B26] text-[#0B1117] font-semibold' : 'text-[#94A3B8] hover:text-white'
              }`}
            >
              <Brain className="w-3.5 h-3.5 shrink-0" />
              <span className="sm:hidden">Recall</span>
              <span className="hidden sm:inline">Active Recall</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={languageItems.length === 0}
            className="flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-lg border border-[#23303E] bg-[#111922] text-xs font-medium text-[#CBD5E1] hover:text-white hover:border-[#35495E] disabled:opacity-40 transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Anki CSV</span>
          </button>

          {mode === 'browse' && (
            <button
              type="button"
              onClick={() => setShowAddForm((s) => !s)}
              className="hidden md:inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-lg bg-[#D99B26] text-[#0B1117] text-xs font-semibold hover:bg-[#E5AE42] transition-colors whitespace-nowrap"
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
          <div
            className="flex items-center gap-1.5 overflow-x-auto sm:flex-wrap sm:overflow-visible pb-0.5 sm:pb-0"
            role="group"
            aria-label="Filter by domain"
          >
            <button
              type="button"
              onClick={() => setGlossaryDomainFilter('all')}
              aria-pressed={glossaryDomainFilter === 'all'}
              className={`px-3 py-1.5 min-h-[44px] rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
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
                aria-pressed={glossaryDomainFilter === dom.id}
                className={`px-3 py-1.5 min-h-[44px] rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
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
          <div
            className="flex items-center gap-1.5 overflow-x-auto sm:flex-wrap sm:overflow-visible pb-0.5 sm:pb-0"
            role="group"
            aria-label="Filter by category"
          >
            {(['all', ...VALID_VOCAB_CATEGORIES] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => {
                  setCategoryFilter(cat);
                  setDrillIndex(0);
                }}
                aria-pressed={categoryFilter === cat}
                className={`px-3 py-1.5 min-h-[44px] rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
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
              <label htmlFor="vocab-search-input" className="sr-only">
                {mode === 'glossary'
                  ? `Search offline ${LANGUAGE_LABELS[config.language]} military dictionary`
                  : `Search saved ${LANGUAGE_LABELS[config.language]} vocabulary`}
              </label>
              <input
                id="vocab-search-input"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  mode === 'glossary'
                    ? `Search offline ${LANGUAGE_LABELS[config.language]} military terms…`
                    : `Search ${LANGUAGE_LABELS[config.language]} terms…`
                }
                className="w-full min-h-[44px] rounded-lg border border-[#23303E] bg-[#111922] pl-8 pr-3 py-1.5 text-xs text-[#E6EDF3] placeholder:text-[#64748B] focus:outline-none focus:border-[#D99B26]"
              />
            </div>
          )}
        </div>
      </div>

      {/* Manual Entry Form */}
      {mode === 'browse' && showAddForm && (
        <AddVocabForm config={config} onAdd={onAddVocab} onClose={() => setShowAddForm(false)} />
      )}

      {/* BROWSE MODE / OFFLINE MILITARY DICTIONARY / REVERSE ACTIVE-RECALL */}
      {mode === 'glossary' ? (
        <MilitaryGlossaryList
          config={config}
          entries={filteredGlossaryEntries}
          savedTerms={savedNormalizedTerms}
          onAddVocab={onAddVocab}
          onSpeak={(text) => speak(text)}
        />
      ) : mode === 'browse' ? (
        <VaultItemList language={config.language} items={filteredItems} onDeleteVocab={onDeleteVocab} onSpeak={speak} />
      ) : currentCard ? (
        <RecallCard
          key={cardSeq}
          card={currentCard}
          position={(drillIndex % drillDeck.length) + 1}
          deckSize={drillDeck.length}
          onGradeFsrs={handleFsrsGradeCard}
          onGrade={handleGradeCard}
          onSpeak={speak}
        />
      ) : (
        <div className="rounded-xl border border-[#23303E] bg-[#111922] p-10 text-center text-sm text-[#94A3B8]">
          Save at least one {LANGUAGE_LABELS[config.language]} vocabulary item to launch Reverse Active-Recall drills.
        </div>
      )}

      {/* Mobile Thumb-Zone Sticky Primary CTA */}
      {mode !== 'recall' && (
        <div className="md:hidden fixed bottom-[60px] left-0 right-0 z-30 px-4 py-2.5 bg-[#0B1117]/95 backdrop-blur-md border-t border-[#23303E] flex items-center gap-2">
          <button
            type="button"
            onClick={() => (languageItems.length > 0 ? setMode('recall') : setShowAddForm(true))}
            className="flex-1 inline-flex items-center justify-center gap-2 min-h-[52px] px-4 rounded-xl bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] transition-colors"
          >
            {languageItems.length > 0 ? <Brain className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            <span>{languageItems.length > 0 ? 'Start Active Recall' : 'Add Vocab Entry'}</span>
          </button>
          {mode === 'browse' && languageItems.length > 0 && (
            <button
              type="button"
              onClick={() => setShowAddForm((s) => !s)}
              aria-label="Add vocab entry"
              className="min-h-[52px] min-w-[52px] flex items-center justify-center rounded-xl border border-[#23303E] bg-[#111922] text-[#F8FAFC]"
            >
              <Plus className="w-5 h-5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
