import React, {lazy, Suspense, useCallback, useState} from 'react';
import {ArrowLeft, ArrowRight, FileBarChart2, MessagesSquare, Timer} from 'lucide-react';
import type {IlrBaseLevel, IlrFunctionKey} from '../data/ilrSpeakingLevels';
import type {
  AppendErrorEventsFn,
  BriefItem,
  DebriefReport,
  DrillHistoryEntry,
  MissionConfig,
  OpiRedoRecord,
  OpiSession,
  RoleplayDebriefResult,
  RoleplayScenarioPublic,
  VocabItem,
} from '../types';
import {filterItemsByLanguage} from '../utils/ilrLogic';
import {OpiSimulatorModule, type TargetedRetryRequest} from './OpiSimulatorModule';
import type {RoleplayReplayRequest} from './RoleplayModule';

const PrepInterpLabModule = lazy(() => import('./PrepInterpLabModule').then((m) => ({default: m.PrepInterpLabModule})));
const DebriefModule = lazy(() => import('./DebriefModule').then((m) => ({default: m.DebriefModule})));
const RoleplayModule = lazy(() => import('./RoleplayModule').then((m) => ({default: m.RoleplayModule})));

export type TestPrepView = 'opi' | 'roleplay' | 'lab' | 'debrief';

export interface RoleplayLevelRequest {
  level: IlrBaseLevel;
  token: number;
}

interface TestPrepModuleProps {
  config: MissionConfig;
  vocabItems: VocabItem[];
  sessions: OpiSession[];
  selectedSessionId: string;
  activeView: TestPrepView;
  briefStory?: BriefItem | null;
  requestedRoleplayLevel?: RoleplayLevelRequest | null;
  onConsumeRoleplayLevel?: () => void;
  onChangeView: (view: TestPrepView) => void;
  onSelectSession: (id: string) => void;
  onCallActiveChange?: (active: boolean) => void;
  onSaveVocab: (item: Omit<VocabItem, 'id' | 'createdAt' | 'mastery' | 'reviewCount'>) => void;
  onCompleteOpiSession: (session: OpiSession) => void;
  onSaveMonologueSession: (session: OpiSession) => void;
  onSaveDebrief: (sessionId: string, report: DebriefReport) => void;
  onSaveRoleplayDebrief?: (sessionId: string, rpDebrief: RoleplayDebriefResult) => void;
  onSaveRedo: (sessionId: string, record: OpiRedoRecord) => void;
  onLogHistory: (entry: DrillHistoryEntry) => void;
  onAppendErrorEvents?: AppendErrorEventsFn;
}

const SubmoduleLoading: React.FC = () => (
  <div role="status" className="flex items-center justify-center py-20 text-sm text-[#94A3B8]">
    <span className="h-4 w-4 mr-3 rounded-full border-2 border-[#D99B26] border-t-transparent animate-spin" />
    Loading module…
  </div>
);

export const TestPrepModule: React.FC<TestPrepModuleProps> = ({
  config,
  vocabItems,
  sessions,
  selectedSessionId,
  activeView,
  briefStory,
  requestedRoleplayLevel,
  onConsumeRoleplayLevel,
  onChangeView,
  onSelectSession,
  onCallActiveChange,
  onSaveVocab,
  onCompleteOpiSession,
  onSaveMonologueSession,
  onSaveDebrief,
  onSaveRoleplayDebrief,
  onSaveRedo,
  onLogHistory,
  onAppendErrorEvents,
}) => {
  const activeLanguageSessionCount = filterItemsByLanguage(sessions, config.language).length;
  const [isOpiCallActive, setIsOpiCallActive] = useState(false);
  const [targetedRetry, setTargetedRetry] = useState<TargetedRetryRequest | null>(null);
  const [selectedRoleplayLevel, setSelectedRoleplayLevel] = useState<IlrBaseLevel>(
    () => requestedRoleplayLevel?.level ?? 2
  );
  const [roleplayReplay, setRoleplayReplay] = useState<RoleplayReplayRequest | null>(null);

  React.useEffect(() => {
    if (!requestedRoleplayLevel) return;
    setSelectedRoleplayLevel(requestedRoleplayLevel.level);
    onConsumeRoleplayLevel?.();
  }, [requestedRoleplayLevel, onConsumeRoleplayLevel]);

  const handleCallActiveChange = useCallback(
    (active: boolean) => {
      setIsOpiCallActive(active);
      onCallActiveChange?.(active);
    },
    [onCallActiveChange]
  );

  const handleStartTargetedRetry = useCallback(
    (functionKey: IlrFunctionKey) => {
      setTargetedRetry({functionKey, token: Date.now()});
      onChangeView('opi');
    },
    [onChangeView]
  );

  const handleLaunchStandaloneRoleplay = useCallback(
    (lvl: IlrBaseLevel) => {
      setSelectedRoleplayLevel(lvl);
      setRoleplayReplay(null);
      onChangeView('roleplay');
    },
    [onChangeView]
  );

  const handleReplayRoleplayWithTwist = useCallback(
    (payload: {scenario: RoleplayScenarioPublic; hiddenGoal: string; complication: string}) => {
      setSelectedRoleplayLevel(payload.scenario.level);
      setRoleplayReplay({
        ...payload,
        token: Date.now(),
      });
      onChangeView('roleplay');
    },
    [onChangeView]
  );

  if (activeView === 'roleplay') {
    return (
      <Suspense fallback={<SubmoduleLoading />}>
        <RoleplayModule
          config={config}
          vocabItems={vocabItems}
          initialLevel={selectedRoleplayLevel}
          replayRequest={roleplayReplay}
          onConsumeReplay={() => setRoleplayReplay(null)}
          onBackToTestPrep={() => onChangeView('opi')}
          onCallActiveChange={handleCallActiveChange}
          onSaveVocab={onSaveVocab}
          onCompleteSession={onCompleteOpiSession}
        />
      </Suspense>
    );
  }

  if (activeView === 'lab') {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => onChangeView('opi')}
            className="inline-flex items-center gap-2 min-h-[44px] px-3.5 rounded-lg border border-[#23303E] bg-[#111922] text-xs font-medium text-[#CBD5E1] hover:text-white hover:border-[#35495E] transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-[#D99B26]" />
            <span>Back to Test prep</span>
          </button>

          <button
            type="button"
            onClick={() => onChangeView('debrief')}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-lg border border-[#23303E] bg-[#111922] text-xs font-medium text-[#94A3B8] hover:text-white transition-colors"
          >
            <FileBarChart2 className="w-3.5 h-3.5 text-[#7DD3FC]" />
            <span>Past sessions ({activeLanguageSessionCount})</span>
          </button>
        </div>

        <Suspense fallback={<SubmoduleLoading />}>
          <PrepInterpLabModule
            config={config}
            onSaveMonologueSession={onSaveMonologueSession}
            onLogHistory={onLogHistory}
            onAppendErrorEvents={onAppendErrorEvents}
          />
        </Suspense>
      </div>
    );
  }

  if (activeView === 'debrief') {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => onChangeView('opi')}
            className="inline-flex items-center gap-2 min-h-[44px] px-3.5 rounded-lg border border-[#23303E] bg-[#111922] text-xs font-medium text-[#CBD5E1] hover:text-white hover:border-[#35495E] transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-[#D99B26]" />
            <span>Back to Test prep</span>
          </button>

          <button
            type="button"
            onClick={() => onChangeView('lab')}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-lg border border-[#23303E] bg-[#111922] text-xs font-medium text-[#94A3B8] hover:text-white transition-colors"
          >
            <Timer className="w-3.5 h-3.5 text-[#D99B26]" />
            <span>PREP &amp; Interp Lab</span>
          </button>
        </div>

        <Suspense fallback={<SubmoduleLoading />}>
          <DebriefModule
            language={config.language}
            sessions={sessions}
            selectedSessionId={selectedSessionId}
            onSelectSession={onSelectSession}
            onSaveDebrief={onSaveDebrief}
            onSaveRoleplayDebrief={onSaveRoleplayDebrief}
            onSaveRedo={onSaveRedo}
            onSaveVocab={onSaveVocab}
            onAppendErrorEvents={onAppendErrorEvents}
            onStartTargetedRetry={handleStartTargetedRetry}
            onReplayRoleplayWithTwist={handleReplayRoleplayWithTwist}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <OpiSimulatorModule
        config={config}
        vocabItems={vocabItems}
        briefStory={briefStory}
        targetedRetryRequest={targetedRetry}
        onConsumeTargetedRetry={() => setTargetedRetry(null)}
        onCallActiveChange={handleCallActiveChange}
        onSaveVocab={onSaveVocab}
        onCompleteSession={onCompleteOpiSession}
      />

      {/* Secondary Entries: Standalone Role-play + PREP & Interp Lab + Past Sessions */}
      {!isOpiCallActive && (
        <section
          aria-label="Additional test prep tools"
          className="grid grid-cols-1 md:grid-cols-3 gap-3 pb-24 md:pb-0"
        >
          {/* Standalone Role-play card with inline 1 / 2 / 3 level picker */}
          <div
            data-testid="test-prep-roleplay-card"
            className="rounded-xl border border-[#23303E] bg-[#111922] p-4 flex flex-col justify-between gap-3"
          >
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg border border-[#23303E] bg-[#0B1117] flex items-center justify-center shrink-0">
                <MessagesSquare className="w-4 h-4 text-[#D99B26]" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#F8FAFC]">Role-play</p>
                <p className="text-xs text-[#94A3B8]">Everyday civilian task (~4 min) matched to ILR level</p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <div role="group" aria-label="Role-play quick level picker" className="inline-flex gap-1">
                {([1, 2, 3] as IlrBaseLevel[]).map((lvl) => {
                  const selected = selectedRoleplayLevel === lvl;
                  return (
                    <button
                      key={lvl}
                      type="button"
                      data-testid={`test-prep-roleplay-lvl-${lvl}`}
                      aria-pressed={selected}
                      onClick={() => setSelectedRoleplayLevel(lvl)}
                      className={`min-h-[44px] min-w-[44px] px-2.5 rounded-lg border font-mono text-xs font-semibold transition-colors ${
                        selected
                          ? 'border-[#D99B26] bg-[#D99B26] text-[#0B1117]'
                          : 'border-[#23303E] bg-[#0B1117] text-[#CBD5E1] hover:border-[#35495E]'
                      }`}
                    >
                      L{lvl}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                data-testid="test-prep-open-roleplay"
                onClick={() => handleLaunchStandaloneRoleplay(selectedRoleplayLevel)}
                className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3.5 rounded-lg border border-[#D99B26]/50 bg-[#D99B26]/10 text-xs font-semibold text-[#F3C669] hover:bg-[#D99B26]/20 transition-colors whitespace-nowrap"
              >
                <span>Open</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onChangeView('lab')}
            className="flex items-center justify-between gap-3 rounded-xl border border-[#23303E] bg-[#111922] p-4 min-h-[60px] text-left hover:border-[#D99B26]/50 transition-colors"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-lg border border-[#23303E] bg-[#0B1117] flex items-center justify-center shrink-0">
                <Timer className="w-4 h-4 text-[#D99B26]" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#F8FAFC]">PREP &amp; Interp Lab</p>
                <p className="text-xs text-[#94A3B8]">90s monologues &amp; consecutive interpretation</p>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-[#94A3B8] shrink-0" />
          </button>

          <button
            type="button"
            onClick={() => onChangeView('debrief')}
            className="flex items-center justify-between gap-3 rounded-xl border border-[#23303E] bg-[#111922] p-4 min-h-[60px] text-left hover:border-[#7DD3FC]/50 transition-colors"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-lg border border-[#23303E] bg-[#0B1117] flex items-center justify-center shrink-0">
                <FileBarChart2 className="w-4 h-4 text-[#7DD3FC]" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#F8FAFC]">Past sessions</p>
                <p className="text-xs text-[#94A3B8]">
                  <span className="font-mono tabular-nums text-[#CBD5E1]">{activeLanguageSessionCount}</span>{' '}
                  {activeLanguageSessionCount === 1 ? 'debrief' : 'debriefs'} available
                </p>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-[#94A3B8] shrink-0" />
          </button>
        </section>
      )}
    </div>
  );
};
