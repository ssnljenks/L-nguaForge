import React, {useEffect, useState} from 'react';
import {HelpCircle, RotateCcw, Trash2, Volume2, X} from 'lucide-react';
import type {DrillHistoryEntry, MilitaryDomain, MissionConfig, TargetLanguage} from '../types';
import {
  DIALECTS_BY_LANGUAGE,
  filterItemsByLanguage,
  getDefaultDialect,
  getDialectInfo,
  LANGUAGE_LABELS,
  MILITARY_DOMAINS,
} from '../utils/ilrLogic';
import {clearWordCacheOnly, getLocalCacheStats, WORD_CACHE_EVENT} from '../utils/localDictionary';
import {useSpeechSynthesis} from '../hooks/useSpeech';
import {PWAInstallButton} from './PWAControls';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  config: MissionConfig;
  onUpdateConfig: (patch: Partial<MissionConfig>) => void;
  history: DrillHistoryEntry[];
  apiSavedCount: number;
  onOpenWalkthrough: () => void;
  onResetTabIntros: () => void;
  onResetAllData: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  onClose,
  config,
  onUpdateConfig,
  history,
  apiSavedCount,
  onOpenWalkthrough,
  onResetTabIntros,
  onResetAllData,
}) => {
  const tts = useSpeechSynthesis();
  const [cacheStats, setCacheStats] = useState(() => getLocalCacheStats(config.language));

  useEffect(() => {
    if (!open) return;
    const refresh = () => setCacheStats(getLocalCacheStats(config.language));
    refresh();
    window.addEventListener(WORD_CACHE_EVENT, refresh);
    return () => window.removeEventListener(WORD_CACHE_EVENT, refresh);
  }, [open, config.language, apiSavedCount]);

  if (!open) return null;

  const dialectList = DIALECTS_BY_LANGUAGE[config.language];
  const dialectInfo = getDialectInfo(config.language, config.dialect);
  const matchingVoices = tts.voices.filter((v) => v.lang.toLowerCase().startsWith(config.language));
  const languageHistory = filterItemsByLanguage(history, config.language);

  const handleLanguageChange = (lang: TargetLanguage) => {
    onUpdateConfig({
      language: lang,
      dialect: getDefaultDialect(lang),
      voiceURI: '',
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div className="w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-xl border border-[#23303E] bg-[#111922] p-5 sm:p-6 space-y-6">
        <div className="flex items-center justify-between pb-4 border-b border-[#23303E]">
          <div>
            <h2 id="settings-modal-title" className="text-lg font-semibold text-[#F8FAFC]">
              Mission &amp; Audio Configuration
            </h2>
            <p className="text-xs text-[#94A3B8] mt-0.5">
              All preferences, saved vocabulary, transcripts, and drill logs persist locally in your browser.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-[#94A3B8] hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Language, Dialect, Domain */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="settings-lang" className="text-xs font-medium text-[#CBD5E1]">
              Target Language
            </label>
            <select
              id="settings-lang"
              value={config.language}
              onChange={(e) => handleLanguageChange(e.target.value as TargetLanguage)}
              className="w-full min-h-[42px] rounded-lg border border-[#23303E] bg-[#0B1117] px-3 py-2 text-sm text-[#E6EDF3] focus:outline-none focus:border-[#D99B26]"
            >
              <option value="es">Spanish (ES)</option>
              <option value="pt">Portuguese (PT)</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="settings-dialect" className="text-xs font-medium text-[#CBD5E1]">
              Regional Dialect
            </label>
            <select
              id="settings-dialect"
              value={config.dialect}
              onChange={(e) => onUpdateConfig({dialect: e.target.value})}
              className="w-full min-h-[42px] rounded-lg border border-[#23303E] bg-[#0B1117] px-3 py-2 text-sm text-[#E6EDF3] focus:outline-none focus:border-[#D99B26]"
            >
              {dialectList.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2 space-y-1.5">
            <label htmlFor="settings-domain" className="text-xs font-medium text-[#CBD5E1]">
              Military Domain Preset
            </label>
            <select
              id="settings-domain"
              value={config.domain}
              onChange={(e) => onUpdateConfig({domain: e.target.value as MilitaryDomain})}
              className="w-full min-h-[42px] rounded-lg border border-[#23303E] bg-[#0B1117] px-3 py-2 text-sm text-[#E6EDF3] focus:outline-none focus:border-[#D99B26]"
            >
              {MILITARY_DOMAINS.map((dom) => (
                <option key={dom.id} value={dom.id}>
                  {dom.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Speech Synthesis Calibration */}
        <div className="pt-4 border-t border-[#23303E] space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#F8FAFC]">Web Speech TTS &amp; Voice</h3>
            <button
              type="button"
              onClick={() =>
                tts.speak(
                  config.language === 'es'
                    ? 'Prueba de audio operativa en nivel tres.'
                    : 'Teste de áudio operacional no nível três.',
                  {
                    lang: dialectInfo.bcp47,
                    rate: config.speechRate,
                    voiceURI: config.voiceURI,
                  }
                )
              }
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#23303E] text-xs text-[#CBD5E1] hover:text-white"
            >
              <Volume2 className="w-3.5 h-3.5 text-[#D99B26]" />
              <span>Test Voice</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-[#CBD5E1]">
                <label htmlFor="settings-rate">Default Speech Rate</label>
                <span className="font-mono tabular-nums text-[#F3C669]">{config.speechRate.toFixed(2)}x</span>
              </div>
              <input
                id="settings-rate"
                type="range"
                min={0.75}
                max={1.25}
                step={0.05}
                value={config.speechRate}
                onChange={(e) => onUpdateConfig({speechRate: Number(e.target.value)})}
                className="w-full accent-[#D99B26]"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="settings-voice" className="text-xs font-medium text-[#CBD5E1]">
                Browser {LANGUAGE_LABELS[config.language]} Voice
              </label>
              <select
                id="settings-voice"
                value={config.voiceURI}
                onChange={(e) => onUpdateConfig({voiceURI: e.target.value})}
                className="w-full min-h-[40px] rounded-lg border border-[#23303E] bg-[#0B1117] px-3 py-2 text-xs text-[#E6EDF3] focus:outline-none focus:border-[#D99B26]"
              >
                <option value="">Auto-select ({dialectInfo.bcp47})</option>
                {matchingVoices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Offline Military Dictionary, Word Cache & Guided Tour */}
        <div className="pt-4 border-t border-[#23303E] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-[#F8FAFC]">Offline Dictionary &amp; Local Word Cache</h3>
            <span className="font-mono text-xs text-emerald-400 tabular-nums">
              {apiSavedCount} API {apiSavedCount === 1 ? 'call' : 'calls'} saved locally
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            <div className="rounded-lg border border-[#23303E] bg-[#0B1117] px-3 py-2">
              <p className="text-[11px] text-[#7D8FA3]">Military Dict ({config.language.toUpperCase()})</p>
              <p
                data-testid="settings-military-dict-count"
                className="font-mono text-sm font-semibold text-[#F8FAFC] tabular-nums"
              >
                {cacheStats.militaryCount} terms
              </p>
            </div>
            <div className="rounded-lg border border-[#23303E] bg-[#0B1117] px-3 py-2">
              <p className="text-[11px] text-[#7D8FA3]">Core Dict ({config.language.toUpperCase()})</p>
              <p className="font-mono text-sm font-semibold text-[#F8FAFC] tabular-nums">
                {cacheStats.coreCount} terms
              </p>
            </div>
            <div className="rounded-lg border border-[#23303E] bg-[#0B1117] px-3 py-2">
              <p className="text-[11px] text-[#7D8FA3]">Cached AI Lookups</p>
              <p
                data-testid="settings-cached-word-count"
                className="font-mono text-sm font-semibold text-[#F3C669] tabular-nums"
              >
                {cacheStats.cachedWordCount} saved
              </p>
            </div>
          </div>

          <p className="text-xs text-[#94A3B8] leading-relaxed">
            Tap-to-define checks your Vocab Vault, the built-in offline military &amp; core dictionaries (including
            plurals and gender forms), and your browser&apos;s persistent word cache before calling AI.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                clearWordCacheOnly();
                setCacheStats(getLocalCacheStats(config.language));
              }}
              disabled={cacheStats.cachedWordCount === 0 && cacheStats.cachedTotCount === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#23303E] bg-[#0B1117] text-xs font-medium text-[#CBD5E1] hover:text-white hover:border-[#35495E] disabled:opacity-40 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5 text-[#94A3B8]" />
              <span>Clear Word Cache</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenWalkthrough();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#23303E] bg-[#0B1117] text-xs font-medium text-[#CBD5E1] hover:text-white hover:border-[#35495E] transition-colors"
            >
              <HelpCircle className="w-3.5 h-3.5 text-[#D99B26]" />
              <span>Open Guided Walkthrough</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                onResetTabIntros();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#23303E] bg-[#0B1117] text-xs font-medium text-[#94A3B8] hover:text-white hover:border-[#35495E] transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Replay Tab Tips</span>
            </button>
          </div>
        </div>

        {/* Recent Drill History */}
        <div className="pt-4 border-t border-[#23303E] space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#F8FAFC]">
              Recent {LANGUAGE_LABELS[config.language]} Drill History
            </h3>
            <span className="font-mono text-xs text-[#94A3B8] tabular-nums">{languageHistory.length} logged</span>
          </div>
          {languageHistory.length === 0 ? (
            <p className="text-xs text-[#7D8FA3]">
              Completed {LANGUAGE_LABELS[config.language]} OPIs, PREP monologues, Interp drills, and recall sessions
              will appear here.
            </p>
          ) : (
            <div className="max-h-36 overflow-y-auto divide-y divide-[#1D2835] border border-[#23303E] rounded-lg bg-[#0B1117]">
              {languageHistory.slice(0, 8).map((entry) => (
                <div key={entry.id} className="px-3 py-2 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <p className="text-[#E6EDF3] truncate">{entry.summary}</p>
                    <p className="text-[#7D8FA3]">
                      {LANGUAGE_LABELS[entry.language]} · {new Date(entry.completedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="font-mono text-[#F3C669] whitespace-nowrap shrink-0 tabular-nums">
                    {entry.scoreLabel}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* PWA Install + Reset Local Data */}
        <div className="pt-4 border-t border-[#23303E] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <PWAInstallButton compact />
            <button
              type="button"
              onClick={onResetAllData}
              className="flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-lg border border-red-500/35 text-xs font-medium text-red-300 hover:bg-red-950/30 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Local Data</span>
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 min-h-[40px] rounded-lg bg-[#D99B26] text-[#0B1117] text-xs font-semibold hover:bg-[#E5AE42]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
