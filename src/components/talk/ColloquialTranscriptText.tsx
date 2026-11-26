import React, {useMemo} from 'react';
import {tokenizeTranscript} from '../../utils/ilrLogic';
import {detectRegionalTermsInText, type RegionalTermCandidate} from '../../utils/talkLogic';

interface ColloquialTranscriptTextProps {
  text: string;
  candidates: readonly RegionalTermCandidate[];
  activeWord?: string;
  isPartner: boolean;
  onWordTap: (cleanWord: string) => void;
  onColloquialTap: (candidate: RegionalTermCandidate) => void;
}

/**
 * Renders Talk transcript text with regional/colloquial expressions underlined in dotted sky blue
 * so learners can tap them for quick meaning & Vocab saving, while individual words remain tappable.
 */
export const ColloquialTranscriptText: React.FC<ColloquialTranscriptTextProps> = ({
  text,
  candidates,
  activeWord,
  isPartner,
  onWordTap,
  onColloquialTap,
}) => {
  const segments = useMemo(() => detectRegionalTermsInText(text, candidates), [text, candidates]);

  return (
    <p>
      {segments.map((seg, segIdx) => {
        if (seg.match) {
          const match = seg.match;
          return (
            <button
              key={`col-${segIdx}`}
              type="button"
              onClick={() => onColloquialTap(match)}
              aria-label={`Local expression ${seg.text}: ${match.meaning}`}
              className="inline rounded px-0.5 font-medium text-[#BAE6FD] underline decoration-dotted decoration-[#7DD3FC] decoration-2 underline-offset-4 hover:bg-[#7DD3FC]/15 hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#7DD3FC] transition-colors"
            >
              {seg.text}
            </button>
          );
        }

        if (!isPartner) {
          return <span key={`usr-${segIdx}`}>{seg.text}</span>;
        }

        const tokens = tokenizeTranscript(seg.text);
        return (
          <React.Fragment key={`seg-${segIdx}`}>
            {tokens.map((tok, tokIdx) =>
              tok.isWord ? (
                <button
                  key={tokIdx}
                  type="button"
                  onClick={() => onWordTap(tok.cleanWord)}
                  aria-pressed={activeWord === tok.cleanWord}
                  className={`inline rounded px-0.5 transition-colors hover:bg-[#D99B26]/25 hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#D99B26] ${
                    activeWord === tok.cleanWord ? 'bg-[#D99B26]/30 text-[#F3C669] underline decoration-[#D99B26]' : ''
                  }`}
                >
                  {tok.text}
                </button>
              ) : (
                <span key={tokIdx}>{tok.text}</span>
              )
            )}
          </React.Fragment>
        );
      })}
    </p>
  );
};
