import React, {useRef, useState} from 'react';
import type {AppendErrorEventsFn, DrillHistoryEntry, MissionConfig, OpiSession} from '../types';
import {getDialectInfo, getDomainInfo, LANGUAGE_LABELS} from '../utils/ilrLogic';
import {type LabPanelHandle, PrepMonologuePanel} from './lab/PrepMonologuePanel';
import {InterpretationPanel} from './lab/InterpretationPanel';

interface PrepInterpLabModuleProps {
  config: MissionConfig;
  onSaveMonologueSession: (session: OpiSession) => void;
  onLogHistory: (entry: DrillHistoryEntry) => void;
  onAppendErrorEvents?: AppendErrorEventsFn;
}

type LabMode = 'prep' | 'interp';

const LAB_MODES: {id: LabMode; label: string}[] = [
  {id: 'prep', label: '90s PREP Monologue'},
  {id: 'interp', label: 'Consecutive Interp & Chunking'},
];

export const PrepInterpLabModule: React.FC<PrepInterpLabModuleProps> = ({
  config,
  onSaveMonologueSession,
  onLogHistory,
  onAppendErrorEvents,
}) => {
  const dialectInfo = getDialectInfo(config.language, config.dialect);
  const domainInfo = getDomainInfo(config.domain);
  const [subMode, setSubMode] = useState<LabMode>('prep');
  const prepRef = useRef<LabPanelHandle>(null);
  const interpRef = useRef<LabPanelHandle>(null);

  const switchMode = (next: LabMode) => {
    if (next === subMode) return;
    // Both panels stay mounted (so switching back keeps your work); stop audio in the one being hidden.
    (next === 'prep' ? interpRef : prepRef).current?.stop();
    setSubMode(next);
  };

  return (
    <div className="space-y-6">
      {/* Header + Sub-mode Segmented Control */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-5 border-b border-[#23303E]">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-[#94A3B8]">
            Structured Discourse &amp; Briefing Drills · {LANGUAGE_LABELS[config.language]} ({dialectInfo.short}) ·{' '}
            {domainInfo.shortLabel}
          </p>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#F8FAFC]">
            PREP Monologue &amp; Consecutive Interp Lab
          </h1>
        </div>

        <div
          className="grid grid-cols-2 sm:inline-flex items-center p-1 rounded-lg bg-[#111922] border border-[#23303E] w-full sm:w-auto"
          role="tablist"
          aria-label="Lab mode"
        >
          {LAB_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              role="tab"
              id={`lab-tab-${mode.id}`}
              aria-controls={`lab-panel-${mode.id}`}
              aria-selected={subMode === mode.id}
              onClick={() => switchMode(mode.id)}
              className={`min-h-[44px] px-2.5 sm:px-4 py-2 text-xs font-medium rounded-md transition-colors text-center leading-tight sm:whitespace-nowrap ${
                subMode === mode.id ? 'bg-[#D99B26] text-[#0B1117] font-semibold' : 'text-[#94A3B8] hover:text-white'
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      <div id="lab-panel-prep" role="tabpanel" aria-labelledby="lab-tab-prep" hidden={subMode !== 'prep'}>
        <PrepMonologuePanel
          key={config.domain}
          ref={prepRef}
          config={config}
          onSaveMonologueSession={onSaveMonologueSession}
          onLogHistory={onLogHistory}
        />
      </div>
      <div id="lab-panel-interp" role="tabpanel" aria-labelledby="lab-tab-interp" hidden={subMode !== 'interp'}>
        <InterpretationPanel
          key={`${config.dialect}:${config.domain}`}
          ref={interpRef}
          config={config}
          onLogHistory={onLogHistory}
          onAppendErrorEvents={onAppendErrorEvents}
        />
      </div>
    </div>
  );
};
