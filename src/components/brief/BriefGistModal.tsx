import React, {useMemo, useState} from 'react';
import {X} from 'lucide-react';
import type {
  AppendErrorEventsFn,
  BriefItem,
  DrillHistoryEntry,
  MissionConfig,
  RecordErrorLogFn,
  VocabItem,
} from '../../types';
import {pickNextAudioClip} from '../../utils/gistLogic';
import type {SaveVocabFn} from '../../hooks/useWordLookup';
import {GistClipSession} from './gist/GistClipSession';

interface BriefGistModalProps {
  item: BriefItem;
  audioPool: BriefItem[];
  config: MissionConfig;
  vocabItems: VocabItem[];
  onClose: () => void;
  onLogHistory: (entry: DrillHistoryEntry) => void;
  onRecordErrorLog: RecordErrorLogFn;
  onAppendErrorEvents?: AppendErrorEventsFn;
  onSaveVocab: SaveVocabFn;
}

/** Gist drill dialog: the clip header and the rotation through unseen clips; each clip runs in its own session. */
export const BriefGistModal: React.FC<BriefGistModalProps> = ({
  item,
  audioPool,
  config,
  vocabItems,
  onClose,
  onLogHistory,
  onRecordErrorLog,
  onAppendErrorEvents,
  onSaveVocab,
}) => {
  const [activeClip, setActiveClip] = useState<BriefItem>(item);
  const [seenIds, setSeenIds] = useState<Set<string>>(() => new Set([item.id]));

  const nextClip = useMemo(
    () => pickNextAudioClip(activeClip.id, audioPool, activeClip.language, seenIds),
    [activeClip.id, activeClip.language, audioPool, seenIds]
  );

  const handleOpenNextClip = () => {
    if (!nextClip) return;
    setActiveClip(nextClip);
    setSeenIds((prev) => new Set(prev).add(nextClip.id));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="brief-gist-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-5 bg-black/85 backdrop-blur-sm"
    >
      <div className="relative flex flex-col w-full max-w-2xl max-h-[94vh] rounded-2xl border border-[#23303E] bg-[#111922] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-4 sm:px-5 py-4 border-b border-[#23303E] bg-[#0B1117] space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs text-[#94A3B8]">
                <span className="font-mono font-semibold uppercase tracking-wider text-[#D99B26]">
                  Gist Drill · ILR {activeClip.ilrLevel}
                </span>
                <span aria-hidden="true">·</span>
                <span>{activeClip.sourceName}</span>
                <span aria-hidden="true">·</span>
                <span>{activeClip.lengthLabel}</span>
              </div>
              <h2
                id="brief-gist-title"
                className="text-base sm:text-lg font-semibold text-[#F8FAFC] mt-0.5 line-clamp-1"
              >
                {activeClip.title}
              </h2>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close gist drill"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[#94A3B8] hover:text-white rounded-xl hover:bg-[#16202B] transition-colors shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <p className="text-xs sm:text-sm italic text-[#94A3B8] leading-relaxed">{activeClip.orientationLine}</p>
        </div>

        <GistClipSession
          key={activeClip.id}
          activeClip={activeClip}
          config={config}
          vocabItems={vocabItems}
          hasNextClip={Boolean(nextClip)}
          onNextClip={handleOpenNextClip}
          onClose={onClose}
          onLogHistory={onLogHistory}
          onRecordErrorLog={onRecordErrorLog}
          onAppendErrorEvents={onAppendErrorEvents}
          onSaveVocab={onSaveVocab}
        />
      </div>
    </div>
  );
};
