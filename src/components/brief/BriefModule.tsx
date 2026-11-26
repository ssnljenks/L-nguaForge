import React, {useCallback, useEffect, useState} from 'react';
import {Briefcase, Headphones, Newspaper, RefreshCw, Search, Sparkles} from 'lucide-react';
import type {
  AppendErrorEventsFn,
  BriefIlrLevel,
  BriefItem,
  BriefMediaType,
  BriefTopic,
  DlptDrillResult,
  DrillHistoryEntry,
  MissionConfig,
  RecordErrorLogFn,
  VocabItem,
} from '../../types';
import {BRIEF_ILR_LEVELS, BRIEF_TOPICS, SEED_BRIEF_ITEMS} from '../../utils/briefLogic';
import {fetchBriefFeed, triggerBriefRefresh} from '../../services/api';
import type {SaveVocabFn} from '../../hooks/useWordLookup';
import {getDialectInfo, LANGUAGE_LABELS} from '../../utils/ilrLogic';
import {BriefFeedCard} from './BriefFeedCard';
import {BriefDrillModal} from './BriefDrillModal';
import {BriefGistModal} from './BriefGistModal';
import {BriefStudySheet} from './BriefStudySheet';

interface BriefModuleProps {
  config: MissionConfig;
  vocabItems: VocabItem[];
  onSaveVocab: SaveVocabFn;
  onLogHistory: (entry: DrillHistoryEntry) => void;
  onSaveDlptResult: (result: DlptDrillResult) => void;
  onRecordErrorLog: RecordErrorLogFn;
  onAppendErrorEvents?: AppendErrorEventsFn;
  onBriefItBack: (item: BriefItem) => void;
}

export const BriefModule: React.FC<BriefModuleProps> = ({
  config,
  vocabItems,
  onSaveVocab,
  onLogHistory,
  onSaveDlptResult,
  onRecordErrorLog,
  onAppendErrorEvents,
  onBriefItBack,
}) => {
  const [mediaType, setMediaType] = useState<BriefMediaType>('audio');
  const [selectedLevel, setSelectedLevel] = useState<'all' | BriefIlrLevel>('all');
  const [selectedTopic, setSelectedTopic] = useState<'all' | BriefTopic>('all');
  const [workFilterActive, setWorkFilterActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [items, setItems] = useState<BriefItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);

  // Modals
  const [drillItem, setDrillItem] = useState<BriefItem | null>(null);
  const [gistItem, setGistItem] = useState<BriefItem | null>(null);
  const [studyItem, setStudyItem] = useState<BriefItem | null>(null);

  const dialect = getDialectInfo(config.language, config.dialect);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchBriefFeed({
        language: config.language,
        mediaType,
        level: selectedLevel !== 'all' ? selectedLevel : undefined,
        topic: selectedTopic !== 'all' ? selectedTopic : undefined,
        workFilter: workFilterActive,
        userDomain: workFilterActive ? config.domain : undefined,
        searchQuery: searchQuery.trim() || undefined,
      });
      setItems(data.items);
      setLastRefreshedAt(data.lastRefreshedAt);
    } catch {
      // Fallback empty or handled by server seed
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [config.language, config.domain, mediaType, selectedLevel, selectedTopic, workFilterActive, searchQuery]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await triggerBriefRefresh();
      await loadFeed();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleResetFilters = () => {
    setSelectedLevel('all');
    setSelectedTopic('all');
    setWorkFilterActive(false);
    setSearchQuery('');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-1.5 pb-4 border-b border-[#23303E]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium text-[#94A3B8]">
            Open-source news + practice stories · {LANGUAGE_LABELS[config.language]} ({dialect.short})
          </p>
          {lastRefreshedAt && (
            <p className="text-[11px] text-[#7D8FA3]">
              Updated {new Date(lastRefreshedAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-[#F8FAFC]">Daily Brief</h1>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            aria-label="Refresh open-source feed"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] rounded-lg border border-[#23303E] bg-[#111922] text-xs font-semibold text-[#CBD5E1] hover:text-white hover:border-[#35495E] disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-[#D99B26]' : ''}`} />
            <span>{isRefreshing ? 'Checking feeds…' : 'Refresh'}</span>
          </button>
        </div>
        <p className="text-xs sm:text-sm text-[#94A3B8] max-w-2xl leading-relaxed">
          Open-source radio broadcasts and news rated across ILR Levels 2 to 3+. Test comprehension with DLPT-style
          drills or brief it back in an Oral Proficiency Interview.
        </p>
      </div>

      {/* Controls: Segmented Media Type + Search + Filter Chips */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Segmented Listening | Reading Toggle */}
          <div
            role="tablist"
            aria-label="Media format"
            className="inline-flex p-1 rounded-xl bg-[#0B1117] border border-[#23303E] shrink-0"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mediaType === 'audio'}
              onClick={() => setMediaType('audio')}
              className={`inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors ${
                mediaType === 'audio' ? 'bg-[#D99B26] text-[#0B1117]' : 'text-[#94A3B8] hover:text-[#F8FAFC]'
              }`}
            >
              <Headphones className="w-4 h-4" />
              <span>Listening</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mediaType === 'text'}
              onClick={() => setMediaType('text')}
              className={`inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors ${
                mediaType === 'text' ? 'bg-[#D99B26] text-[#0B1117]' : 'text-[#94A3B8] hover:text-[#F8FAFC]'
              }`}
            >
              <Newspaper className="w-4 h-4" />
              <span>Reading</span>
            </button>
          </div>

          {/* Search Bar */}
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search headline or topic…"
              aria-label="Search brief articles"
              className="w-full min-h-[44px] pl-9 pr-3 py-2 rounded-xl bg-[#0B1117] border border-[#23303E] text-xs sm:text-sm text-[#F8FAFC] placeholder-[#7D8FA3] focus:border-[#D99B26] focus:outline-none transition-colors"
            />
          </div>
        </div>

        {/* Filter Chips Bar */}
        <div className="space-y-2 pt-1">
          {/* Level Chips */}
          <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="ILR Level filter">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#7D8FA3] mr-1">Level:</span>
            <button
              type="button"
              role="radio"
              aria-checked={selectedLevel === 'all'}
              onClick={() => setSelectedLevel('all')}
              className={`px-3 py-1.5 min-h-[36px] rounded-lg text-xs font-semibold transition-colors ${
                selectedLevel === 'all'
                  ? 'bg-[#7DD3FC] text-[#0B1117]'
                  : 'bg-[#111922] border border-[#23303E] text-[#94A3B8] hover:text-white'
              }`}
            >
              All levels
            </button>
            {BRIEF_ILR_LEVELS.map((lvl) => (
              <button
                key={lvl}
                type="button"
                role="radio"
                aria-checked={selectedLevel === lvl}
                onClick={() => setSelectedLevel(lvl)}
                className={`px-3 py-1.5 min-h-[36px] rounded-lg text-xs font-semibold transition-colors ${
                  selectedLevel === lvl
                    ? 'bg-[#7DD3FC] text-[#0B1117]'
                    : 'bg-[#111922] border border-[#23303E] text-[#94A3B8] hover:text-white'
                }`}
              >
                Level {lvl}
              </button>
            ))}
          </div>

          {/* Topic Chips + Optional Work Chip */}
          <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Topic filter">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#7D8FA3] mr-1">Topic:</span>
            <button
              type="button"
              role="radio"
              aria-checked={selectedTopic === 'all'}
              onClick={() => setSelectedTopic('all')}
              className={`px-3 py-1.5 min-h-[36px] rounded-lg text-xs font-semibold transition-colors ${
                selectedTopic === 'all'
                  ? 'bg-[#D99B26] text-[#0B1117]'
                  : 'bg-[#111922] border border-[#23303E] text-[#94A3B8] hover:text-white'
              }`}
            >
              All topics
            </button>
            {BRIEF_TOPICS.map((top) => (
              <button
                key={top.id}
                type="button"
                role="radio"
                aria-checked={selectedTopic === top.id}
                onClick={() => setSelectedTopic(top.id)}
                className={`px-3 py-1.5 min-h-[36px] rounded-lg text-xs font-semibold transition-colors ${
                  selectedTopic === top.id
                    ? 'bg-[#D99B26] text-[#0B1117]'
                    : 'bg-[#111922] border border-[#23303E] text-[#94A3B8] hover:text-white'
                }`}
              >
                {top.label}
              </button>
            ))}

            {/* Work Chip (Shown only when Work focus is ON in Settings, never selected by default) */}
            {config.workFocusEnabled && (
              <button
                type="button"
                onClick={() => setWorkFilterActive(!workFilterActive)}
                aria-pressed={workFilterActive}
                className={`inline-flex items-center gap-1 px-3 py-1.5 min-h-[36px] rounded-lg text-xs font-semibold border transition-colors ${
                  workFilterActive
                    ? 'bg-[#D99B26] text-[#0B1117] border-[#D99B26]'
                    : 'bg-[#111922] border-[#D99B26]/40 text-[#F3C669] hover:bg-[#D99B26]/10'
                }`}
              >
                <Briefcase className="w-3 h-3" />
                <span>Work focus</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Feed List */}
      <section aria-label="Brief passages list" className="space-y-4">
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center gap-3 text-[#94A3B8]">
            <span className="h-5 w-5 rounded-full border-2 border-[#D99B26] border-t-transparent animate-spin" />
            <p className="text-sm">Loading authentic passages…</p>
          </div>
        ) : items.length === 0 ? (
          <div className="p-8 sm:p-12 rounded-xl border border-[#23303E] bg-[#111922] text-center space-y-3">
            <Sparkles className="w-8 h-8 text-[#94A3B8] mx-auto" />
            <p className="text-sm sm:text-base font-semibold text-[#F8FAFC]">No passages found for this combination</p>
            <p className="text-xs text-[#94A3B8] max-w-sm mx-auto leading-relaxed">
              Try switching media format, widening your level filter, or clearing the search keyword.
            </p>
            <button
              type="button"
              onClick={handleResetFilters}
              className="inline-flex items-center px-4 py-2 min-h-[44px] rounded-lg bg-[#D99B26] text-[#0B1117] text-xs font-semibold hover:bg-[#E5AE42] transition-colors"
            >
              Reset all filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {items.map((item) => (
              <BriefFeedCard
                key={item.id}
                item={item}
                onOpenDrill={(it) => setDrillItem(it)}
                onOpenGist={item.mediaType === 'audio' ? (it) => setGistItem(it) : undefined}
                onBriefItBack={onBriefItBack}
                onOpenStudy={(it) => setStudyItem(it)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Legal & Copyright Safeguard Footer */}
      <footer className="pt-6 border-t border-[#23303E] text-center text-xs text-[#7D8FA3] space-y-1">
        <p className="italic font-medium">Sources are linked or embedded, never copied.</p>
        <p className="text-[11px] text-[#94A3B8]">
          Articles and broadcasts remain the intellectual property of their original publishers. Transcripts and
          excerpts are utilized solely for language proficiency assessment.
        </p>
      </footer>

      {/* DLPT Drill Modal */}
      {drillItem && (
        <BriefDrillModal
          item={drillItem}
          allPassages={[...items, ...SEED_BRIEF_ITEMS]}
          config={config}
          vocabItems={vocabItems}
          onClose={() => setDrillItem(null)}
          onLogHistory={onLogHistory}
          onSaveDlptResult={onSaveDlptResult}
          onAppendErrorEvents={onAppendErrorEvents}
          onSaveVocab={onSaveVocab}
          onBriefItBack={(it) => {
            setDrillItem(null);
            onBriefItBack(it);
          }}
        />
      )}

      {/* Phase 7 Gist Drill Modal */}
      {gistItem && (
        <BriefGistModal
          item={gistItem}
          audioPool={[...items, ...SEED_BRIEF_ITEMS]}
          config={config}
          vocabItems={vocabItems}
          onClose={() => setGistItem(null)}
          onLogHistory={onLogHistory}
          onRecordErrorLog={onRecordErrorLog}
          onAppendErrorEvents={onAppendErrorEvents}
          onSaveVocab={onSaveVocab}
        />
      )}

      {/* Study Excerpt Sheet */}
      {studyItem && (
        <BriefStudySheet
          item={studyItem}
          config={config}
          vocabItems={vocabItems}
          onClose={() => setStudyItem(null)}
          onSaveVocab={onSaveVocab}
        />
      )}
    </div>
  );
};
