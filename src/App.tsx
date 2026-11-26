import React, {lazy, Suspense, useCallback, useEffect, useState} from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  FileText,
  HelpCircle,
  Layers,
  MessageSquare,
  Mic,
  Settings,
  Sun,
} from 'lucide-react';
import type {
  AppendErrorEventsFn,
  BriefItem,
  DebriefReport,
  DlptDrillResult,
  DrillHistoryEntry,
  ErrorEvent,
  ErrorLogEntry,
  FreeChatThread,
  MissionConfig,
  ModuleTab,
  OpiRedoRecord,
  OpiSession,
  RecordErrorLogFn,
  RoleplayDebriefResult,
  TodayPlanCompletionStore,
  TodayPlanStepId,
  VocabFsrsRating,
  VocabItem,
} from './types';
import {DEFAULT_MISSION_CONFIG, SEED_SAMPLE_SESSIONS, SEED_VOCAB} from './data/seedData';
import {appendErrorEventsToStore} from './utils/errorPatterns';
import {filterItemsByLanguage, getDialectInfo, getDomainInfo} from './utils/ilrLogic';
import {API_SAVED_EVENT, clearLocalLookupCaches, getApiSavedCount} from './utils/lookupCacheStore';
import {clearLastOpiAudio} from './utils/opiAudioStore';
import {getLocalDateKey, getPlanCompletionKey, type TodayPlanSpeakingItem} from './utils/todayPlan';
import {createInitialVocabFsrs, legacyMasteryToFsrsRating, reviewVocabCardWithFsrs} from './utils/vocabFsrs';
import {useLocalStorage} from './hooks/useLocalStorage';
import {
  sanitizeActiveTab,
  sanitizeChatThreads,
  sanitizeDlptResults,
  sanitizeErrorEvents,
  sanitizeErrorLogEntries,
  sanitizeHistory,
  sanitizeMissionConfig,
  sanitizeSeenTabs,
  sanitizeSessions,
  sanitizeTodayPlanCompletion,
  sanitizeVocabItems,
} from './utils/storageSchemas';
import type {RoleplayLevelRequest, TestPrepView} from './components/TestPrepModule';
import type {TalkWorkRequest} from './components/FreeChatModule';
import {TodayModule} from './components/today/TodayModule';
import {OfflineIndicator, PWAInstallButton} from './components/PWAControls';
import {ErrorBoundary} from './components/ErrorBoundary';
import {createId} from './utils/ids';
import {setApiWorkFocus} from './services/requestContext';

// Tab modules and modals are code-split: each loads on first use, keeping the initial bundle small.
// (All chunks are still precached by the service worker, so tabs work offline after the first visit.)
const FreeChatModule = lazy(() => import('./components/FreeChatModule').then((m) => ({default: m.FreeChatModule})));
const TestPrepModule = lazy(() => import('./components/TestPrepModule').then((m) => ({default: m.TestPrepModule})));
const BriefModule = lazy(() => import('./components/brief/BriefModule').then((m) => ({default: m.BriefModule})));
const VocabModule = lazy(() => import('./components/VocabModule').then((m) => ({default: m.VocabModule})));
const MissionSheet = lazy(() => import('./components/MissionSheet').then((m) => ({default: m.MissionSheet})));
const DataSafetyModal = lazy(() => import('./components/DataSafetyModal').then((m) => ({default: m.DataSafetyModal})));
const SettingsModal = lazy(() => import('./components/SettingsModal').then((m) => ({default: m.SettingsModal})));
const WalkthroughModal = lazy(() =>
  import('./components/WalkthroughModal').then((m) => ({default: m.WalkthroughModal}))
);
const TabIntroModal = lazy(() => import('./components/TabIntroModal').then((m) => ({default: m.TabIntroModal})));

const ModuleLoading: React.FC = () => (
  <div role="status" className="flex items-center justify-center py-24 text-sm text-[#94A3B8]">
    <span className="h-4 w-4 mr-3 rounded-full border-2 border-[#D99B26] border-t-transparent animate-spin" />
    Loading module…
  </div>
);

const NAV_ITEMS: {
  id: ModuleTab;
  label: string;
  shortLabel: string;
  icon: React.FC<{className?: string}>;
}[] = [
  {id: 'today', label: 'Today', shortLabel: 'Today', icon: Sun},
  {id: 'talk', label: 'Talk', shortLabel: 'Talk', icon: MessageSquare},
  {id: 'test_prep', label: 'Test prep', shortLabel: 'Test prep', icon: Mic},
  {id: 'brief', label: 'Brief', shortLabel: 'Brief', icon: FileText},
  {id: 'vocab', label: 'Vocab', shortLabel: 'Vocab', icon: Layers},
];

const sanitizeStoredConfig = sanitizeMissionConfig(DEFAULT_MISSION_CONFIG);
const sanitizeBool = (raw: unknown): boolean | undefined => (typeof raw === 'boolean' ? raw : undefined);

export default function App() {
  const [activeTab, setActiveTab] = useLocalStorage<ModuleTab>('linguaforge_active_tab_v3', 'today', sanitizeActiveTab);
  const [testPrepView, setTestPrepView] = useState<TestPrepView>('opi');
  const [opiCallActive, setOpiCallActive] = useState(false);
  const [missionSheetOpen, setMissionSheetOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);

  const isAutostart =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('autostart') === '1';

  const [dataSafetyAck, setDataSafetyAck] = useLocalStorage<boolean>('linguaforge_data_safety_v1', false, sanitizeBool);
  const [seenTabs, setSeenTabs] = useLocalStorage<ModuleTab[]>('linguaforge_seen_tabs_v2', [], sanitizeSeenTabs, [
    'linguaforge_seen_tabs_v1',
  ]);
  const [tabIntroOpen, setTabIntroOpen] = useState<ModuleTab | null>(null);

  const showDataSafetyModal = !isAutostart && !dataSafetyAck;

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
  }, [activeTab, testPrepView]);

  const navigateToTab = (tab: ModuleTab, nextTestPrepView?: TestPrepView) => {
    if (tab === 'test_prep') {
      setTestPrepView(nextTestPrepView ?? 'opi');
    }
    setActiveTab(tab);
    scrollViewportToTop();
    if (!isAutostart && dataSafetyAck && !seenTabs.includes(tab)) {
      setTabIntroOpen(tab);
    }
  };

  const handleAcknowledgeDataSafety = () => {
    setDataSafetyAck(true);
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

  // Every API request carries the Work focus setting (REVIEW H-3).
  useEffect(() => {
    setApiWorkFocus(config.workFocusEnabled);
  }, [config.workFocusEnabled]);
  const [vocabItems, setVocabItems] = useLocalStorage<VocabItem[]>(
    'linguaforge_vocab_v2',
    SEED_VOCAB,
    sanitizeVocabItems,
    ['linguaforge_vocab_v1']
  );
  const [sessions, setSessions] = useLocalStorage<OpiSession[]>(
    'linguaforge_sessions_v1',
    SEED_SAMPLE_SESSIONS,
    sanitizeSessions
  );
  const [history, setHistory] = useLocalStorage<DrillHistoryEntry[]>('linguaforge_history_v1', [], sanitizeHistory);
  const [dlptResults, setDlptResults] = useLocalStorage<DlptDrillResult[]>(
    'linguaforge_dlpt_results_v1',
    [],
    sanitizeDlptResults
  );
  // Legacy gist hook kept for backward compatibility + Phase 8 unified append-only error log (60-day window)
  const [, setErrorLog] = useLocalStorage<ErrorLogEntry[]>('linguaforge_error_log_v1', [], sanitizeErrorLogEntries);
  const [errorEvents, setErrorEvents] = useLocalStorage<ErrorEvent[]>(
    'linguaforge_error_events_v1',
    [],
    sanitizeErrorEvents
  );
  const [chatThreads, setChatThreads] = useLocalStorage<FreeChatThread[]>(
    'linguaforge_chat_threads_v2',
    [],
    sanitizeChatThreads,
    ['linguaforge_chat_threads_v1']
  );
  const [todayPlanCompletion, setTodayPlanCompletion] = useLocalStorage<TodayPlanCompletionStore>(
    'linguaforge_today_plan_done_v1',
    {},
    sanitizeTodayPlanCompletion
  );
  const [selectedSessionId, setSelectedSessionId] = useState<string>(() => sessions[0]?.id ?? '');
  const [activeBriefStory, setActiveBriefStory] = useState<BriefItem | null>(null);
  const [requestedRoleplayLevel, setRequestedRoleplayLevel] = useState<RoleplayLevelRequest | null>(null);
  const [workTalkRequest, setWorkTalkRequest] = useState<TalkWorkRequest | null>(null);
  const [activePlanReturn, setActivePlanReturn] = useState<{
    step: TodayPlanStepId;
    dateKey: string;
    label: string;
  } | null>(null);

  const handleMarkPlanStepDone = useCallback(
    (step: TodayPlanStepId, dateKey: string) => {
      const key = getPlanCompletionKey(config.language, dateKey);
      setTodayPlanCompletion((prev) => ({
        ...prev,
        [key]: {
          ...prev[key],
          [step]: true,
        },
      }));
    },
    [config.language, setTodayPlanCompletion]
  );

  const handleLaunchSpeakingPlanStep = useCallback(
    (item: TodayPlanSpeakingItem, dateKey: string) => {
      setActivePlanReturn({step: 'speaking', dateKey, label: item.title});
      if (item.kind === 'opi_brief_back' && item.briefItem) {
        setActiveBriefStory(item.briefItem);
        setTestPrepView('opi');
        navigateToTab('test_prep', 'opi');
        return;
      }
      if (item.kind === 'roleplay') {
        setRequestedRoleplayLevel({level: item.probeLevel ?? 2, token: Date.now()});
        setTestPrepView('roleplay');
        navigateToTab('test_prep', 'roleplay');
        return;
      }
      if (item.kind === 'talk_work') {
        setWorkTalkRequest({domain: item.workDomain ?? config.domain, token: Date.now()});
        navigateToTab('talk');
      }
    },
    [config.domain]
  );

  const handleCompleteActivePlanReturn = useCallback(() => {
    if (activePlanReturn) {
      handleMarkPlanStepDone(activePlanReturn.step, activePlanReturn.dateKey);
      setActivePlanReturn(null);
    }
    navigateToTab('today');
  }, [activePlanReturn, handleMarkPlanStepDone]);

  const handleBriefItBack = useCallback((story: BriefItem) => {
    setActiveBriefStory(story);
    setTestPrepView('opi');
    navigateToTab('test_prep', 'opi');
  }, []);

  const updateConfig = (patch: Partial<MissionConfig>) => {
    setConfig((prev) => ({...prev, ...patch}));
  };

  const handleSaveVocab = (item: Omit<VocabItem, 'id' | 'createdAt' | 'mastery' | 'reviewCount'>) => {
    setVocabItems((prev) => {
      const exists = prev.some((v) => v.language === item.language && v.term.toLowerCase() === item.term.toLowerCase());
      if (exists) return prev;
      const nowMs = Date.now();
      const newEntry: VocabItem = {
        ...item,
        id: createId('v'),
        createdAt: new Date(nowMs).toISOString(),
        mastery: 'new',
        reviewCount: 0,
        fsrs: createInitialVocabFsrs(nowMs),
      };
      return [newEntry, ...prev];
    });
  };

  const handleDeleteVocab = (id: string) => {
    setVocabItems((prev) => prev.filter((v) => v.id !== id));
  };

  const handleReviewVocabFsrs = useCallback(
    (id: string, rating: VocabFsrsRating) => {
      const nowMs = Date.now();
      setVocabItems((prev) => prev.map((v) => (v.id === id ? reviewVocabCardWithFsrs(v, rating, nowMs) : v)));
    },
    [setVocabItems]
  );

  const handleUpdateMastery = (id: string, mastery: VocabItem['mastery']) => {
    handleReviewVocabFsrs(id, legacyMasteryToFsrsRating(mastery));
  };

  const handleLogHistory = (entry: DrillHistoryEntry) => {
    setHistory((prev) => [entry, ...prev].slice(0, 60));
  };

  const handleSaveDlptResult = (result: DlptDrillResult) => {
    setDlptResults((prev) => [result, ...prev].slice(0, 60));
  };

  const handleRecordErrorLog: RecordErrorLogFn = useCallback(
    (entries) => {
      if (entries.length === 0) return;
      const now = new Date().toISOString();
      const stamped: ErrorLogEntry[] = entries.map((entry) => ({
        ...entry,
        id: createId('errlog'),
        createdAt: now,
      }));
      setErrorLog((prev) => [...stamped, ...prev].slice(0, 200));
    },
    [setErrorLog]
  );

  const handleAppendErrorEvents: AppendErrorEventsFn = useCallback(
    (incoming) => {
      if (incoming.length === 0) return;
      const nowIso = new Date().toISOString();
      const stamped: ErrorEvent[] = incoming.map((ev) => ({
        ...ev,
        id: createId('err'),
        at: ev.at ?? nowIso,
      }));
      setErrorEvents((prev) => appendErrorEventsToStore(prev, stamped));
    },
    [setErrorEvents]
  );

  const handleCompleteOpiSession = (session: OpiSession) => {
    setSessions((prev) => [session, ...prev].slice(0, 25));
    setSelectedSessionId(session.id);
    const isRoleplay = session.type === 'roleplay';
    handleLogHistory({
      id: createId(isRoleplay ? 'hist-rp' : 'hist-opi'),
      module: isRoleplay ? 'roleplay' : 'opi',
      language: session.language,
      dialect: session.dialect,
      domain: session.domain ?? 'general_policy',
      completedAt: session.startedAt,
      summary: isRoleplay
        ? `Role-play Level ${session.roleplayScenario?.level ?? session.focusLevel ?? 2} (${session.messages.length} turns)`
        : `Live OPI Session (${session.messages.length} turns)`,
      scoreLabel: 'Ready for Debrief',
    });
    if (activePlanReturn?.step === 'speaking') {
      handleMarkPlanStepDone('speaking', activePlanReturn.dateKey);
      setActivePlanReturn(null);
      navigateToTab('today');
      return;
    }
    // Automatically open Debrief inside Test prep when an OPI or Role-play session finishes
    navigateToTab('test_prep', 'debrief');
  };

  const handleSaveMonologueSession = (session: OpiSession) => {
    setSessions((prev) => [session, ...prev].slice(0, 25));
    setSelectedSessionId(session.id);
  };

  const handleSaveDebrief = (sessionId: string, report: DebriefReport) => {
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? {...s, debrief: report} : s)));
  };

  const handleSaveRoleplayDebrief = (sessionId: string, rpDebrief: RoleplayDebriefResult) => {
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? {...s, roleplayDebrief: rpDebrief} : s)));
  };

  const handleSaveRedo = (sessionId: string, record: OpiRedoRecord) => {
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? {...s, redoRecord: record} : s)));
  };

  const handleResetAllData = () => {
    setConfig(DEFAULT_MISSION_CONFIG);
    setVocabItems(SEED_VOCAB);
    setSessions(SEED_SAMPLE_SESSIONS);
    setHistory([]);
    setDlptResults([]);
    setErrorLog([]);
    setErrorEvents([]);
    setTodayPlanCompletion({});
    setActivePlanReturn(null);
    setChatThreads([]);
    setSeenTabs([]);
    clearLocalLookupCaches();
    void clearLastOpiAudio();
    setSelectedSessionId(SEED_SAMPLE_SESSIONS[0]?.id ?? '');
    setSettingsOpen(false);
  };

  const todayCompletionKey = getPlanCompletionKey(config.language, getLocalDateKey());
  const todayDayCompletion = todayPlanCompletion[todayCompletionKey] ?? {};

  const dialectInfo = getDialectInfo(config.language, config.dialect);
  const domainInfo = getDomainInfo(config.domain);
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
                {item.id === 'vocab' && (
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
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 min-h-[44px] rounded-lg border border-[#23303E] bg-[#111922] text-sm font-medium text-[#CBD5E1] hover:text-white hover:border-[#35495E] transition-colors whitespace-nowrap"
          >
            <HelpCircle className="w-4 h-4 text-[#D99B26]" />
            <span>Guided Tour</span>
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 min-h-[44px] rounded-lg border border-[#23303E] bg-[#111922] text-sm font-medium text-[#CBD5E1] hover:text-white hover:border-[#35495E] transition-colors whitespace-nowrap"
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
            <button
              type="button"
              onClick={() => setTabIntroOpen(activeTab)}
              aria-label="About this tab"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border border-[#23303E] bg-[#111922] text-[#D99B26]"
            >
              <HelpCircle className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Open mission settings"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border border-[#23303E] bg-[#111922] text-[#CBD5E1]"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Single Mission Chip Row below header */}
        <div className="border-b border-[#23303E] bg-[#0D141C] px-4 sm:px-6 lg:px-8 py-2">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
            <button
              type="button"
              data-testid="mission-chip"
              onClick={() => setMissionSheetOpen(true)}
              aria-label={`Change mission context: ${config.language.toUpperCase()} ${dialectInfo.short}${
                config.workFocusEnabled ? ` ${domainInfo.shortLabel}` : ''
              }`}
              className="inline-flex items-center gap-2 min-h-[44px] max-w-full px-3 rounded-lg border border-[#23303E] bg-[#111922] hover:border-[#D99B26]/60 text-left transition-colors"
            >
              <span className="px-1.5 py-0.5 rounded bg-[#D99B26] text-[#0B1117] font-mono text-[11px] font-bold shrink-0">
                {config.language.toUpperCase()}
              </span>
              <span className="text-xs sm:text-sm font-medium text-[#E6EDF3] truncate">
                {dialectInfo.short}
                {/* Domain is work content: shown only with Work focus ON (REVIEW H-3). */}
                {config.workFocusEnabled && (
                  <>
                    {' '}
                    <span aria-hidden="true" className="text-[#7D8FA3] mx-0.5">
                      ·
                    </span>{' '}
                    {domainInfo.shortLabel}
                  </>
                )}
              </span>
              <ChevronDown className="w-4 h-4 text-[#94A3B8] shrink-0" />
            </button>

            <div className="hidden lg:flex items-center gap-2 text-xs text-[#7D8FA3] shrink-0">
              <span>ILR 2 → 2+/3 Practice</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {activeLanguageSessionCount} {activeLanguageSessionCount === 1 ? 'session' : 'sessions'}
              </span>
            </div>
          </div>
        </div>

        {/* Main Content Viewport */}
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-5 sm:py-6 pb-28 md:pb-10">
          <div className="max-w-6xl mx-auto">
            {activePlanReturn && activeTab !== 'today' && !opiCallActive && (
              <div
                data-testid="active-plan-return-bar"
                className="mb-4 rounded-xl border border-[#D99B26]/55 bg-[#D99B26]/10 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5"
              >
                <div className="flex items-center gap-2 min-w-0 text-xs">
                  <span className="font-mono font-semibold text-[#F3C669] shrink-0">Today&apos;s plan · 3/3</span>
                  <span className="text-[#CBD5E1] truncate">{activePlanReturn.label}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => navigateToTab('today')}
                    className="inline-flex items-center gap-1 min-h-[36px] px-2.5 rounded-lg border border-[#23303E] bg-[#111922] text-xs font-medium text-[#CBD5E1] hover:text-white transition-colors"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Today</span>
                  </button>
                  <button
                    type="button"
                    data-testid="complete-plan-step-return-btn"
                    onClick={handleCompleteActivePlanReturn}
                    className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-lg bg-[#D99B26] text-[#0B1117] text-xs font-semibold hover:bg-[#E5AE42] transition-colors"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Mark done &amp; return</span>
                  </button>
                </div>
              </div>
            )}

            {/* Keyed by language: switching language remounts the module, which resets its session state
                (modules rely on this instead of their own reset logic). */}
            <ErrorBoundary key={`${activeTab}-${config.language}`} scopeLabel="Active Module">
              <Suspense fallback={<ModuleLoading />}>
                {activeTab === 'today' && (
                  <TodayModule
                    config={config}
                    vocabItems={vocabItems}
                    sessions={sessions}
                    dlptResults={dlptResults}
                    errorEvents={errorEvents}
                    dayCompletion={todayDayCompletion}
                    onMarkPlanStepDone={handleMarkPlanStepDone}
                    onReviewVocabFsrs={handleReviewVocabFsrs}
                    onSaveVocab={handleSaveVocab}
                    onLogHistory={handleLogHistory}
                    onSaveDlptResult={handleSaveDlptResult}
                    onRecordErrorLog={handleRecordErrorLog}
                    onAppendErrorEvents={handleAppendErrorEvents}
                    onBriefItBack={handleBriefItBack}
                    onLaunchSpeakingPlanStep={handleLaunchSpeakingPlanStep}
                    onNavigateTab={navigateToTab}
                    onOpenSettings={() => setSettingsOpen(true)}
                  />
                )}

                {activeTab === 'talk' && (
                  <FreeChatModule
                    config={config}
                    threads={chatThreads}
                    vocabItems={vocabItems}
                    workTalkRequest={workTalkRequest}
                    onConsumeWorkTalkRequest={() => setWorkTalkRequest(null)}
                    onWrapUpComplete={() => {
                      if (activePlanReturn?.step === 'speaking') {
                        handleMarkPlanStepDone('speaking', activePlanReturn.dateKey);
                      }
                    }}
                    onUpdateThreads={setChatThreads}
                    onUpdateConfig={updateConfig}
                    onSaveVocab={handleSaveVocab}
                    onAppendErrorEvents={handleAppendErrorEvents}
                    onNavigateTab={navigateToTab}
                    onOpenTabHelp={() => setTabIntroOpen('talk')}
                  />
                )}

                {activeTab === 'test_prep' && (
                  <TestPrepModule
                    config={config}
                    vocabItems={vocabItems}
                    sessions={sessions}
                    selectedSessionId={selectedSessionId}
                    activeView={testPrepView}
                    briefStory={activeBriefStory}
                    requestedRoleplayLevel={requestedRoleplayLevel}
                    onConsumeRoleplayLevel={() => setRequestedRoleplayLevel(null)}
                    onChangeView={setTestPrepView}
                    onSelectSession={setSelectedSessionId}
                    onCallActiveChange={setOpiCallActive}
                    onSaveVocab={handleSaveVocab}
                    onCompleteOpiSession={handleCompleteOpiSession}
                    onSaveMonologueSession={handleSaveMonologueSession}
                    onSaveDebrief={handleSaveDebrief}
                    onSaveRoleplayDebrief={handleSaveRoleplayDebrief}
                    onSaveRedo={handleSaveRedo}
                    onLogHistory={handleLogHistory}
                    onAppendErrorEvents={handleAppendErrorEvents}
                  />
                )}

                {activeTab === 'brief' && (
                  <BriefModule
                    config={config}
                    vocabItems={vocabItems}
                    onSaveVocab={handleSaveVocab}
                    onLogHistory={handleLogHistory}
                    onSaveDlptResult={handleSaveDlptResult}
                    onRecordErrorLog={handleRecordErrorLog}
                    onAppendErrorEvents={handleAppendErrorEvents}
                    onBriefItBack={handleBriefItBack}
                  />
                )}

                {activeTab === 'vocab' && (
                  <VocabModule
                    config={config}
                    items={vocabItems}
                    onAddVocab={handleSaveVocab}
                    onDeleteVocab={handleDeleteVocab}
                    onUpdateMastery={handleUpdateMastery}
                    onReviewVocabFsrs={handleReviewVocabFsrs}
                    onLogHistory={handleLogHistory}
                  />
                )}
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>
      </div>

      {/* Mobile Fixed Bottom Tab Bar (hidden during active full-screen OPI calls) */}
      {!opiCallActive && (
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
      )}

      <Suspense fallback={null}>
        {missionSheetOpen && (
          <MissionSheet open onClose={() => setMissionSheetOpen(false)} config={config} onUpdateConfig={updateConfig} />
        )}
        {showDataSafetyModal && <DataSafetyModal open onAcknowledge={handleAcknowledgeDataSafety} />}
        {settingsOpen && (
          <SettingsModal
            open
            onClose={() => setSettingsOpen(false)}
            config={config}
            onUpdateConfig={updateConfig}
            history={history}
            apiSavedCount={apiSavedCount}
            onOpenWalkthrough={() => setWalkthroughOpen(true)}
            onResetTabIntros={handleResetTabIntros}
            onResetAllData={handleResetAllData}
          />
        )}
        {!showDataSafetyModal && tabIntroOpen && (
          <TabIntroModal
            tab={tabIntroOpen}
            onDismiss={handleDismissTabIntro}
            onOpenFullTour={() => setWalkthroughOpen(true)}
          />
        )}
        {walkthroughOpen && (
          <WalkthroughModal
            open
            onClose={() => setWalkthroughOpen(false)}
            onNavigateTab={navigateToTab}
            apiSavedCount={apiSavedCount}
          />
        )}
      </Suspense>

      <OfflineIndicator />
    </div>
  );
}
