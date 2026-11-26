import React, {useState} from 'react';
import {Download, WifiOff, X} from 'lucide-react';
import {useOnlineStatus, usePWAInstall} from '../hooks/usePWAInstall';
import {Dialog} from './shared/Dialog';

export const PWAInstallButton: React.FC<{compact?: boolean}> = ({compact = false}) => {
  const {isInstallable, isInstalled, isIOS, install} = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className={`flex items-center justify-center gap-2 rounded-lg border border-[#D99B26]/40 bg-[#D99B26]/12 text-[#F3C669] hover:bg-[#D99B26]/20 transition-colors whitespace-nowrap shrink-0 min-h-[44px] ${
          compact ? 'px-3 py-1.5 text-xs font-medium' : 'w-full px-4 py-2 text-sm font-medium'
        }`}
      >
        <Download className="w-4 h-4 shrink-0" />
        <span>Install App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowGuide(true)}
          className={`flex items-center justify-center gap-2 rounded-lg border border-[#23303E] bg-[#16202B] text-[#C9D4E0] hover:text-white hover:border-[#35495E] transition-colors whitespace-nowrap shrink-0 min-h-[44px] ${
            compact ? 'px-3 py-1.5 text-xs font-medium' : 'w-full px-4 py-2 text-sm font-medium'
          }`}
        >
          <Download className="w-4 h-4 shrink-0" />
          <span>Install on iOS</span>
        </button>

        {showGuide && (
          <Dialog
            labelledBy="ios-install-title"
            onClose={() => setShowGuide(false)}
            closeOnBackdrop
            overlayClassName="bg-black/70"
            className="w-full max-w-sm rounded-xl border border-[#23303E] bg-[#111922] p-6"
          >
            <div className="flex items-center justify-between gap-4">
              <h3 id="ios-install-title" className="text-lg font-semibold text-[#F1F5F9]">
                Install LinguaForge on iOS
              </h3>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Close install instructions"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-[#94A3B8] hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <ol className="mt-4 space-y-2.5 text-sm text-[#CBD5E1] list-decimal list-inside leading-relaxed">
              <li>Tap the Share icon in Safari&apos;s bottom toolbar.</li>
              <li>Scroll down and tap Add to Home Screen.</li>
              <li>Tap Add to launch LinguaForge ILR in standalone mode.</li>
            </ol>
            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="min-h-[52px] mt-6 w-full rounded-lg bg-[#D99B26] py-2.5 text-sm font-semibold text-[#0B1117] hover:bg-[#E5AE42] transition-colors"
            >
              Got it
            </button>
          </Dialog>
        )}
      </>
    );
  }

  return null;
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-20 md:bottom-5 left-4 z-50 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-[#1B1710] px-3.5 py-2 text-xs font-medium text-amber-300 shadow-lg"
    >
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>Offline Mode — Local Vocab &amp; cached drills active</span>
    </div>
  );
};
