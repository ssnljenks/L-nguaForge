import React, {useMemo, useState} from 'react';
import {BookOpen, Brain, Download, Plus, Search} from 'lucide-react';
import type {DrillHistoryEntry, MilitaryDomain, MissionConfig, VocabCategory, VocabItem} from '../types';
import {
  filterItemsByLanguage,
  formatVocabToAnkiCsv,
  getDialectInfo,
  LANGUAGE_LABELS,
  MILITARY_DOMAINS,
  VALID_VOCAB_CATEGORIES,
} from '../utils/ilrLogic';
import {getOfflineMilitaryEntries, normalizeLookupKey} from '../utils/localDictionary';
import {useSpeechSynthesis} from '../hooks/useSpeech';
import type {SaveVocabFn} from '../hooks/useWordLookup';
import {createId} from '../utils/ids';
import {AddVocabForm} from './vault/AddVocabForm';
import {MilitaryGlossaryList} from './vault/MilitaryGlossaryList';
import {RecallCard} from './vault/RecallCard';
import {VaultItemList} from './vault/VaultItemList';

interface VocabVaultModuleProps {
  config: MissionConfig;
  items: VocabItem[];
  onAddVocab: SaveVocabFn;
  onDeleteVocab: (id: string) => void;
  onUpdateMastery: (id: string, mastery: VocabItem['mastery']) => void;
  onLogHistory: (entry: DrillHistoryEntry) => void;
}

const MASTERY_RANK: Record<VocabItem['mastery'], number> = {new: 0, practicing: 1, mastered: 2};

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

  // Items needing practice come first.
  const drillDeck = useMemo(
    () =>
      [...(filteredItems.length > 0 ? filteredItems : languageItems)].sort(
        (a, b) => MASTERY_RANK[a.mastery] - MASTERY_RANK[b.mastery]
      ),
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
        domain: currentCard.domain,
        completedAt: new Date().toISOString(),
        summary: `Reverse Active-Recall Drill (${nextDone} cards reviewed)`,
        scoreLabel: mastery === 'mastered' ? 'Mastered' : 'Active Recall',
      });
    }
    setDrillIndex((i) => (i + 1) % Math.max(1, drillDeck.length));
    setCardSeq((n) => n + 1);
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
              onClick={() => setMode('browse')}
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
              onClick={() => setMode('glossary')}
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
              onClick={() => setMode('recall')}
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
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by domain">
            <button
              type="button"
              onClick={() => setGlossaryDomainFilter('all')}
              aria-pressed={glossaryDomainFilter === 'all'}
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
                aria-pressed={glossaryDomainFilter === dom.id}
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
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by category">
            {(['all', ...VALID_VOCAB_CATEGORIES] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => {
                  setCategoryFilter(cat);
                  setDrillIndex(0);
                }}
                aria-pressed={categoryFilter === cat}
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
          onGrade={handleGradeCard}
          onSpeak={speak}
        />
      ) : (
        <div className="rounded-xl border border-[#23303E] bg-[#111922] p-10 text-center text-sm text-[#94A3B8]">
          Save at least one {LANGUAGE_LABELS[config.language]} vocabulary item to launch Reverse Active-Recall drills.
        </div>
      )}
    </div>
  );
};
