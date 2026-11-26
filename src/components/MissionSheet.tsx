import React from 'react';
import {Volume2, X} from 'lucide-react';
import type {GeminiLiveVoice, MilitaryDomain, MissionConfig, TargetLanguage} from '../types';
import {
  DIALECTS_BY_LANGUAGE,
  getDefaultDialect,
  getDialectInfo,
  getDomainInfo,
  LANGUAGE_LABELS,
  MILITARY_DOMAINS,
} from '../utils/ilrLogic';
import {useSpeechSynthesis} from '../hooks/useSpeech';
import {Dialog} from './shared/Dialog';

interface MissionSheetProps {
  open: boolean;
  onClose: () => void;
  config: MissionConfig;
  onUpdateConfig: (patch: Partial<MissionConfig>) => void;
}

const LIVE_VOICE_OPTIONS: {id: GeminiLiveVoice; label: string; hint: string}[] = [
  {id: 'Zephyr', label: 'Zephyr', hint: 'Bright'},
  {id: 'Kore', label: 'Kore', hint: 'Firm'},
  {id: 'Puck', label: 'Puck', hint: 'Upbeat'},
  {id: 'Fenrir', label: 'Fenrir', hint: 'Warm'},
  {id: 'Charon', label: 'Charon', hint: 'Steady'},
];

export const MissionSheet: React.FC<MissionSheetProps> = ({open, onClose, config, onUpdateConfig}) => {
  const tts = useSpeechSynthesis();

  if (!open) return null;

  const dialects = DIALECTS_BY_LANGUAGE[config.language];
  const dialectInfo = getDialectInfo(config.language, config.dialect);
  const domainInfo = getDomainInfo(config.domain);
  const matchingVoices = tts.voices.filter((v) => v.lang.toLowerCase().startsWith(config.language));

  const handleLanguageChange = (lang: TargetLanguage) => {
    if (lang === config.language) return;
    onUpdateConfig({
      language: lang,
      dialect: getDefaultDialect(lang),
      voiceURI: '',
    });
  };

  return (
    <Dialog
      variant="sheet"
      labelledBy="mission-sheet-title"
      onClose={onClose}
      closeOnBackdrop
      className="w-full sm:max-w-lg max-h-[88vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-[#23303E] bg-[#111922] shadow-2xl pb-safe"
    >
      {/* Mobile Sheet Handle */}
      <div className="sm:hidden flex justify-center pt-2.5 pb-1" aria-hidden="true">
        <div className="w-10 h-1 rounded-full bg-[#35495E]" />
      </div>

      {/* Header */}
      <div className="px-5 pt-3 sm:pt-5 pb-3.5 border-b border-[#23303E] flex items-center justify-between gap-3">
        <div>
          <h2 id="mission-sheet-title" className="font-display text-lg font-semibold text-[#F8FAFC]">
            Mission Context
          </h2>
          <p className="text-xs text-[#94A3B8] mt-0.5">
            Set target language, regional dialect, and partner voice. Work focus adds a work domain.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close mission selector"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-[#94A3B8] hover:text-white hover:bg-[#192533] transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="p-5 space-y-5">
        {/* Language */}
        <div className="space-y-2">
          <span className="block text-xs font-medium text-[#CBD5E1]">Target Language</span>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Target language">
            {(['es', 'pt'] as const).map((lang) => {
              const active = config.language === lang;
              return (
                <button
                  key={lang}
                  type="button"
                  onClick={() => handleLanguageChange(lang)}
                  aria-pressed={active}
                  className={`min-h-[44px] rounded-xl border text-sm font-semibold transition-colors ${
                    active
                      ? 'border-[#D99B26] bg-[#D99B26] text-[#0B1117]'
                      : 'border-[#23303E] bg-[#0B1117] text-[#CBD5E1] hover:border-[#35495E] hover:text-white'
                  }`}
                >
                  {lang === 'es' ? 'Spanish (ES)' : 'Portuguese (PT)'}
                </button>
              );
            })}
          </div>
        </div>

        {/* Dialect */}
        <div className="space-y-1.5">
          <label htmlFor="mission-sheet-dialect" className="block text-xs font-medium text-[#CBD5E1]">
            Regional Dialect ({LANGUAGE_LABELS[config.language]})
          </label>
          <select
            id="mission-sheet-dialect"
            value={config.dialect}
            onChange={(e) => onUpdateConfig({dialect: e.target.value})}
            className="w-full min-h-[44px] rounded-xl border border-[#23303E] bg-[#0B1117] px-3 py-2.5 text-sm text-[#E6EDF3] focus:outline-none focus:border-[#D99B26]"
          >
            {dialects.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </div>

        {/* Domain & Work focus */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-[#23303E] bg-[#0B1117] px-3.5 py-2.5">
            <div className="space-y-0.5">
              <label htmlFor="mission-sheet-work-focus" className="text-xs font-semibold text-[#F8FAFC] cursor-pointer">
                Work focus
              </label>
              <p className="text-[11px] text-[#94A3B8]">Enable &ldquo;Work talk&rdquo; scene in Talk</p>
            </div>
            <button
              id="mission-sheet-work-focus"
              type="button"
              role="switch"
              aria-checked={config.workFocusEnabled}
              onClick={() => onUpdateConfig({workFocusEnabled: !config.workFocusEnabled})}
              className="relative inline-flex h-11 w-14 shrink-0 items-center justify-center rounded-full"
            >
              <span className="sr-only">Toggle Work focus</span>
              {/* 44 px hit area around the visual track (REVIEW M-12). */}
              <span
                aria-hidden="true"
                className={`relative inline-flex h-7 w-12 items-center rounded-full border transition-colors ${
                  config.workFocusEnabled ? 'border-[#D99B26] bg-[#D99B26]' : 'border-[#35495E] bg-[#16202B]'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full transition-transform ${
                    config.workFocusEnabled ? 'translate-x-6 bg-[#0B1117]' : 'translate-x-1 bg-[#94A3B8]'
                  }`}
                />
              </span>
            </button>
          </div>

          {/* The work domain only applies with Work focus ON (REVIEW H-3). */}
          {config.workFocusEnabled && (
            <div className="space-y-1.5">
              <label htmlFor="mission-sheet-domain" className="block text-xs font-medium text-[#CBD5E1]">
                Operational Domain
              </label>
              <select
                id="mission-sheet-domain"
                value={config.domain}
                onChange={(e) => onUpdateConfig({domain: e.target.value as MilitaryDomain})}
                className="w-full min-h-[44px] rounded-xl border border-[#23303E] bg-[#0B1117] px-3 py-2.5 text-sm text-[#E6EDF3] focus:outline-none focus:border-[#D99B26]"
              >
                {MILITARY_DOMAINS.map((dom) => (
                  <option key={dom.id} value={dom.id}>
                    {dom.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-[#94A3B8] leading-relaxed">{domainInfo.description}</p>
            </div>
          )}
        </div>

        {/* Live AI Voice */}
        <div className="space-y-2 pt-3 border-t border-[#23303E]">
          <label htmlFor="mission-sheet-live-voice" className="block text-xs font-medium text-[#CBD5E1]">
            Live Voice Partner
          </label>
          <select
            id="mission-sheet-live-voice"
            value={config.liveVoice}
            onChange={(e) => onUpdateConfig({liveVoice: e.target.value as GeminiLiveVoice})}
            className="w-full min-h-[44px] rounded-xl border border-[#23303E] bg-[#0B1117] px-3 py-2.5 text-sm text-[#E6EDF3] focus:outline-none focus:border-[#D99B26]"
          >
            {LIVE_VOICE_OPTIONS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label} — {v.hint}
              </option>
            ))}
          </select>
        </div>

        {/* Browser TTS Voice (used by OPI / Interp / Recall audio playback) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="mission-sheet-tts-voice" className="text-xs font-medium text-[#CBD5E1]">
              Examiner &amp; Playback Voice ({dialectInfo.bcp47})
            </label>
            <button
              type="button"
              onClick={() =>
                tts.speak(config.language === 'es' ? 'Prueba de audio operativa.' : 'Teste de áudio operacional.', {
                  lang: dialectInfo.bcp47,
                  rate: config.speechRate,
                  voiceURI: config.voiceURI,
                })
              }
              className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg border border-[#23303E] bg-[#0B1117] text-xs font-medium text-[#CBD5E1] hover:text-white transition-colors"
            >
              <Volume2 className="w-3.5 h-3.5 text-[#D99B26]" />
              <span>Test</span>
            </button>
          </div>
          <select
            id="mission-sheet-tts-voice"
            value={config.voiceURI}
            onChange={(e) => onUpdateConfig({voiceURI: e.target.value})}
            className="w-full min-h-[44px] rounded-xl border border-[#23303E] bg-[#0B1117] px-3 py-2.5 text-sm text-[#E6EDF3] focus:outline-none focus:border-[#D99B26]"
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

      <div className="px-5 py-4 border-t border-[#23303E] bg-[#0D141C]">
        <button
          type="button"
          onClick={onClose}
          className="w-full min-h-[52px] rounded-xl bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] transition-colors"
        >
          Apply Mission Context
        </button>
      </div>
    </Dialog>
  );
};
