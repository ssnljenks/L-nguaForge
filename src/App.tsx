import React, {useEffect, useState} from 'react';
import {BookMarked, FileBarChart2, HelpCircle, MessageSquare, Mic, Settings, Timer} from 'lucide-react';
import type {
  DebriefReport,
  DrillHistoryEntry,
  FreeChatThread,
  MilitaryDomain,
  MissionConfig,
  ModuleTab,
  OpiSession,
  TargetLanguage,
  VocabItem,
} from './types';
import {DEFAULT_MISSION_CONFIG, SEED_SAMPLE_SESSIONS, SEED_VOCAB} from './data/seedData';
import {DIALECTS_BY_LANGUAGE, filterItemsByLanguage, getDefaultDialect, MILITARY_DOMAINS} from './utils/ilrLogic';
import {API_SAVED_EVENT, clearLocalLookupCaches, getApiSavedCount} from './utils/localDictionary';
import {useLocalStorage} from './hooks/useLocalStorage';
import {
  sanitizeChatThreads,
  sanitizeHistory,
  sanitizeMissionConfig,
  sanitizeSeenTabs,
  sanitizeSessions,
  sanitizeVocabItems,
} from './utils/storageSchemas';
import {OpiSimulatorModule} from './components/OpiSimulatorModule';
import {DebriefModule} from './components/DebriefModule';
import {VocabVaultModule} from './components/VocabVaultModule';
import {PrepInterpLabModule} from './components/PrepInterpLabModule';
import {FreeChatModule} from './components/FreeChatModule';
import {SettingsModal} from './components/SettingsModal';
import {WalkthroughModal} from './components/WalkthroughModal';
import {TabIntroModal} from './components/TabIntroModal';
import {OfflineIndicator, PWAInstallButton} from './components/PWAControls';
import {ErrorBoundary} from './components/ErrorBoundary';
import {createId} from './utils/ids';

const NAV_ITEMS: {
  id: ModuleTab;
  label: string;
  shortLabel: string;
  icon: React.FC<{className?: string}>;
}[] = [
  {id: 'chat', label: 'Live Voice Chat', shortLabel: 'Chat', icon: MessageSquare},
  {id: 'opi', label: 'Live Voice OPI', shortLabel: 'OPI', icon: Mic},
  {id: 'debrief', label: 'ILR Debrief', shortLabel: 'Debrief', icon: FileBarChart2},
  {id: 'vault', label: 'Vocab Vault', shortLabel: 'Vault', icon: BookMarked},
  {id: 'lab', label: 'PREP & Interp Lab', shortLabel: 'Lab', icon: Timer},
];

const sanitizeStoredConfig = sanitizeMissionConfig(DEFAULT_MISSION_CONFIG);

export default function App() {
  const [activeTab, setActiveTab] = useState<ModuleTab>('chat');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);

  const isAutostart =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('autostart') === '1';

  const [seenTabs, setSeenTabs] = useLocalStorage<ModuleTab[]>('linguaforge_seen_tabs_v1', [], sanitizeSeenTabs);
  const [tabIntroOpen, setTabIntroOpen] = useState<ModuleTab | null>(() =>
    isAutostart || seenTabs.includes('chat') ? null : 'chat'
  );

  const [apiSavedCount, setApiSavedCount] = useState<number>(() => getApiSavedCount());

  useEffect(() => {
    const handleSaved = () => setApiSavedCount(getApiSavedCount());
    window.addEventListener(API_SAVED_EVENT, handleSaved);
    return () => window.removeEventListener(API_SAVED_EVENT, handleSaved);
  }, []);

  const scrollViewportToTop = () => {
    if (typeof window === 'undefined') return;
    window.scrollTo({top: 0, left: 0, behavior: 'auto'});
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  };

  useEffect(() => {
    scrollViewportToTop();
    const rafId = window.requestAnimationFrame(scrollViewportToTop);
    return () => window.cancelAnimationFrame(rafId);
  }, [activeTab]);

  const navigateToTab = (tab: ModuleTab) => {
    setActiveTab(tab);
    scrollViewportToTop();
    if (!isAutostart && !seenTabs.includes(tab)) {
      setTabIntroOpen(tab);
    }
  };

  const handleDismissTabIntro = (tab: ModuleTab) => {
    setTabIntroOpen(null);
    setSeenTabs((prev) => (prev.includes(tab) ? prev : [...prev, tab]));
    scrollViewportToTop();
    window.requestAnimationFrame(scrollViewportToTop);
  };

  const handleResetTabIntros = () => {
    setSeenTabs([]);
    setTabIntroOpen(activeTab);
  };

  const [config, setConfig] = useLocalStorage<MissionConfig>(
    'linguaforge_config_v1',
    DEFAULT_MISSION_CONFIG,
    sanitizeStoredConfig
  );
  const [vocabItems, setVocabItems] = useLocalStorage<VocabItem[]>(
    'linguaforge_vocab_v1',
    SEED_VOCAB,
    sanitizeVocabItems
  );
  const [sessions, setSessions] = useLocalStorage<OpiSession[]>(
    'linguaforge_sessions_v1',
    SEED_SAMPLE_SESSIONS,
    sanitizeSessions
  );
  const [history, setHistory] = useLocalStorage<DrillHistoryEntry[]>('linguaforge_history_v1', [], sanitizeHistory);
  const [chatThreads, setChatThreads] = useLocalStorage<FreeChatThread[]>(
    'linguaforge_chat_threads_v1',
    [],
    sanitizeChatThreads
  );
  const [selectedSessionId, setSelectedSessionId] = useState<string>(() => sessions[0]?.id ?? '');

  const updateConfig = (patch: Partial<MissionConfig>) => {
    setConfig((prev) => ({...prev, ...patch}));
  };

  const handleLanguageToggle = (lang: TargetLanguage) => {
    if (lang === config.language) return;
    updateConfig({
      language: lang,
      dialect: getDefaultDialect(lang),
      voiceURI: '',
    });
  };

  const handleSaveVocab = (item: Omit<VocabItem, 'id' | 'createdAt' | 'mastery' | 'reviewCount'>) => {
    setVocabItems((prev) => {
      const exists = prev.some((v) => v.language === item.language && v.term.toLowerCase() === item.term.toLowerCase());
      if (exists) return prev;
      const newEntry: VocabItem = {
        ...item,
        id: createId('v'),
        createdAt: new Date().toISOString(),
        mastery: 'new',
        reviewCount: 0,
      };
      return [newEntry, ...prev];
    });
  };

  const handleDeleteVocab = (id: string) => {
    setVocabItems((prev) => prev.filter((v) => v.id !== id));
  };

  const handleUpdateMastery = (id: string, mastery: VocabItem['mastery']) => {
    setVocabItems((prev) => prev.map((v) => (v.id === id ? {...v, mastery, reviewCount: v.reviewCount + 1} : v)));
  };

  const handleLogHistory = (entry: DrillHistoryEntry) => {
    setHistory((prev) => [entry, ...prev].slice(0, 60));
  };

  const handleCompleteOpiSession = (session: OpiSession) => {
    setSessions((prev) => [session, ...prev].slice(0, 25));
    setSelectedSessionId(session.id);
    handleLogHistory({
      id: createId('hist-opi'),
      module: 'opi',
      language: session.language,
      dialect: session.dialect,
      domain: session.domain,
      completedAt: session.startedAt,
      summary: `Live OPI Session (${session.messages.length} turns)`,
      scoreLabel: 'Ready for Debrief',
    });
    navigateToTab('debrief');
  };

  const handleSaveMonologueSession = (session: OpiSession) => {
    setSessions((prev) => [session, ...prev].slice(0, 25));
    setSelectedSessionId(session.id);
  };

  const handleSaveDebrief = (sessionId: string, report: DebriefReport) => {
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? {...s, debrief: report} : s)));
  };

  const handleResetAllData = () => {
    setConfig(DEFAULT_MISSION_CONFIG);
    setVocabItems(SEED_VOCAB);
    setSessions(SEED_SAMPLE_SESSIONS);
    setHistory([]);
    setChatThreads([]);
    setSeenTabs([]);
    clearLocalLookupCaches();
    setSelectedSessionId(SEED_SAMPLE_SESSIONS[0]?.id ?? '');
    setSettingsOpen(false);
  };

  const dialects = DIALECTS_BY_LANGUAGE[config.language];
  const activeLanguageVocabCount = filterItemsByLanguage(vocabItems, config.language).length;
  const activeLanguageSessionCount = filterItemsByLanguage(sessions, config.language).length;

  return (
    <div className="min-h-screen bg-[#0B1117] text-[#E6EDF3] flex flex-col md:flex-row">
      {/* Desktop Left Sidebar Navigation (256px) */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 border-r border-[#23303E] bg-[#0E151D] z-30">
        <div className="h-16 px-5 flex items-center border-b border-[#23303E]">
          <span className="font-display text-lg font-bold tracking-tight text-[#F8FAFC] whitespace-nowrap">
            LinguaForge ILR
          </span>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-1 overflow-y-auto" aria-label="Primary modules">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigateToTab(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 min-h-[44px] rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  active ? 'bg-[#192533] text-[#F8FAFC]' : 'text-[#94A3B8] hover:text-[#E6EDF3] hover:bg-[#131C26]'
                }`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-[#D99B26]' : 'text-[#7D8FA3]'}`} />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.id === 'vault' && (
                  <span className="font-mono text-xs text-[#7D8FA3] tabular-nums">{activeLanguageVocabCount}</span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-[#23303E] space-y-2.5">
          <PWAInstallButton />
          <button
            type="button"
            onClick={() => setWalkthroughOpen(true)}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 min-h-[42px] rounded-lg border border-[#23303E] bg-[#111922] text-sm font-medium text-[#CBD5E1] hover:text-white hover:border-[#35495E] transition-colors whitespace-nowrap"
          >
            <HelpCircle className="w-4 h-4 text-[#D99B26]" />
            <span>Guided Tour</span>
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 min-h-[42px] rounded-lg border border-[#23303E] bg-[#111922] text-sm font-medium text-[#CBD5E1] hover:text-white hover:border-[#35495E] transition-colors whitespace-nowrap"
          >
            <Settings className="w-4 h-4 text-[#94A3B8]" />
            <span>Mission Settings</span>
          </button>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 md:pl-64 flex flex-col min-w-0">
        {/* Compact Mobile Top Bar (52px) */}
        <header className="md:hidden sticky top-0 z-30 h-[52px] px-4 flex items-center justify-between gap-3 border-b border-[#23303E] bg-[#0E151D]/95 backdrop-blur-md">
          <span className="font-display text-base font-bold tracking-tight text-[#F8FAFC] whitespace-nowrap">
            LinguaForge ILR
          </span>

          <div className="flex items-center gap-1.5 shrink-0">
            <div
              className="flex items-center rounded-md bg-[#111922] p-0.5 border border-[#23303E]"
              role="group"
              aria-label="Target language"
            >
              {(['es', 'pt'] as const).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => handleLanguageToggle(lang)}
                  className={`px-2 py-1 text-xs font-semibold rounded transition-colors ${
                    config.language === lang ? 'bg-[#D99B26] text-[#0B1117]' : 'text-[#94A3B8]'
                  }`}
                >
                  {lang.toUpperCase()}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setTabIntroOpen(activeTab)}
              aria-label="About this tab"
              className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-[#23303E] bg-[#111922] text-[#D99B26]"
            >
              <HelpCircle className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Open mission settings"
              className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-[#23303E] bg-[#111922] text-[#CBD5E1]"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Operational Context Toolbar (Language · Dialect · Military Domain) */}
        <div className="border-b border-[#23303E] bg-[#0D141C] px-4 sm:px-6 lg:px-8 py-2.5 md:py-3">
          <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-2.5 md:gap-3">
            <div className="grid grid-cols-2 md:flex md:flex-wrap items-center gap-2 md:gap-3">
              {/* Desktop Target Language Segmented Toggle (mobile uses top header ES/PT toggle) */}
              <div
                className="hidden md:flex items-center rounded-lg bg-[#111922] p-0.5 border border-[#23303E]"
                role="group"
                aria-label="Target language selector"
              >
                <button
                  type="button"
                  onClick={() => handleLanguageToggle('es')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                    config.language === 'es' ? 'bg-[#D99B26] text-[#0B1117]' : 'text-[#94A3B8] hover:text-white'
                  }`}
                >
                  Spanish
                </button>
                <button
                  type="button"
                  onClick={() => handleLanguageToggle('pt')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                    config.language === 'pt' ? 'bg-[#D99B26] text-[#0B1117]' : 'text-[#94A3B8] hover:text-white'
                  }`}
                >
                  Portuguese
                </button>
              </div>

              {/* Regional Dialect Selector */}
              <div className="flex items-center gap-2 min-w-0">
                <label htmlFor="toolbar-dialect" className="text-xs text-[#7D8FA3] hidden md:inline shrink-0">
                  Dialect
                </label>
                <select
                  id="toolbar-dialect"
                  aria-label="Regional dialect"
                  value={config.dialect}
                  onChange={(e) => updateConfig({dialect: e.target.value})}
                  className="w-full md:w-auto min-h-[38px] rounded-lg border border-[#23303E] bg-[#111922] px-2.5 py-1 text-xs text-[#E6EDF3] truncate focus:outline-none focus:border-[#D99B26]"
                >
                  {dialects.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Military Domain Preset Selector */}
              <div className="flex items-center gap-2 min-w-0">
                <label htmlFor="toolbar-domain" className="text-xs text-[#7D8FA3] hidden md:inline shrink-0">
                  Domain
                </label>
                <select
                  id="toolbar-domain"
                  aria-label="Military domain preset"
                  value={config.domain}
                  onChange={(e) => updateConfig({domain: e.target.value as MilitaryDomain})}
                  className="w-full md:w-auto min-h-[38px] rounded-lg border border-[#23303E] bg-[#111922] px-2.5 py-1 text-xs text-[#E6EDF3] truncate focus:outline-none focus:border-[#D99B26]"
                >
                  {MILITARY_DOMAINS.map((dom) => (
                    <option key={dom.id} value={dom.id}>
                      {dom.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="hidden lg:flex items-center gap-2 text-xs text-[#7D8FA3] shrink-0">
              <span>ILR 2 → 2+/3 Progression</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {activeLanguageSessionCount} {activeLanguageSessionCount === 1 ? 'session' : 'sessions'}
              </span>
            </div>
          </div>
        </div>

        {/* Main Content Viewport */}
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 pb-24 md:pb-10">
          <div className="max-w-6xl mx-auto">
            <ErrorBoundary key={`${activeTab}-${config.language}`} scopeLabel="Active Module">
              {activeTab === 'chat' && (
                <FreeChatModule
                  config={config}
                  threads={chatThreads}
                  vocabItems={vocabItems}
                  onUpdateThreads={setChatThreads}
                  onUpdateConfig={updateConfig}
                  onSaveVocab={handleSaveVocab}
                  onNavigateTab={navigateToTab}
                  onOpenTabHelp={() => setTabIntroOpen('chat')}
                />
              )}

              {activeTab === 'opi' && (
                <OpiSimulatorModule
                  config={config}
                  vocabItems={vocabItems}
                  onUpdateConfig={updateConfig}
                  onSaveVocab={handleSaveVocab}
                  onCompleteSession={handleCompleteOpiSession}
                />
              )}

              {activeTab === 'debrief' && (
                <DebriefModule
                  language={config.language}
                  sessions={sessions}
                  selectedSessionId={selectedSessionId}
                  onSelectSession={setSelectedSessionId}
                  onSaveDebrief={handleSaveDebrief}
                  onSaveVocab={handleSaveVocab}
                />
              )}

              {activeTab === 'vault' && (
                <VocabVaultModule
                  config={config}
                  items={vocabItems}
                  onAddVocab={handleSaveVocab}
                  onDeleteVocab={handleDeleteVocab}
                  onUpdateMastery={handleUpdateMastery}
                  onLogHistory={handleLogHistory}
                />
              )}

              {activeTab === 'lab' && (
                <PrepInterpLabModule
                  config={config}
                  onSaveMonologueSession={handleSaveMonologueSession}
                  onLogHistory={handleLogHistory}
                />
              )}
            </ErrorBoundary>
          </div>
        </main>
      </div>

      {/* Mobile Fixed Bottom Tab Bar (60px -> total sticky 52+60 = 112px = 13.2% < 15% cap) */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-[#23303E] bg-[#0E151D]/95 backdrop-blur-md pb-safe"
      >
        <div className="grid grid-cols-5 h-[60px] items-center">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigateToTab(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center justify-center gap-1 h-full py-1.5 transition-colors ${
                  active ? 'text-[#D99B26]' : 'text-[#8B9BB0]'
                }`}
              >
                <Icon className="w-[18px] h-[18px] shrink-0" />
                <span className="text-[10px] font-medium leading-tight whitespace-nowrap">{item.shortLabel}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        config={config}
        onUpdateConfig={updateConfig}
        history={history}
        apiSavedCount={apiSavedCount}
        onOpenWalkthrough={() => setWalkthroughOpen(true)}
        onResetTabIntros={handleResetTabIntros}
        onResetAllData={handleResetAllData}
      />

      <TabIntroModal
        tab={tabIntroOpen}
        onDismiss={handleDismissTabIntro}
        onOpenFullTour={() => setWalkthroughOpen(true)}
      />

      <WalkthroughModal
        open={walkthroughOpen}
        onClose={() => setWalkthroughOpen(false)}
        onNavigateTab={navigateToTab}
        apiSavedCount={apiSavedCount}
      />

      <OfflineIndicator />
    </div>
  );
}
