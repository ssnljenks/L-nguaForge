import React, {useMemo} from 'react';
import {tokenizeTranscript} from '../../utils/ilrLogic';

interface TappableTextProps {
  text: string;
  /** The currently looked-up word in this message, highlighted. */
  activeWord?: string;
  onWordTap: (cleanWord: string) => void;
  hoverClassName?: string;
}

/** Renders a sentence with every word as a button that opens a contextual lookup. */
export const TappableText: React.FC<TappableTextProps> = ({
  text,
  activeWord,
  onWordTap,
  hoverClassName = 'hover:text-[#F8FAFC]',
}) => {
  const tokens = useMemo(() => tokenizeTranscript(text), [text]);
  return (
    <p>
      {tokens.map((tok, i) =>
        tok.isWord ? (
          <button
            // Tokens are derived from immutable message text, so position is a stable key.
            key={i}
            type="button"
            onClick={() => onWordTap(tok.cleanWord)}
            aria-pressed={activeWord === tok.cleanWord}
            className={`inline rounded px-0.5 transition-colors hover:bg-[#D99B26]/25 ${hoverClassName} focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#D99B26] ${
              activeWord === tok.cleanWord ? 'bg-[#D99B26]/30 text-[#F3C669] underline decoration-[#D99B26]' : ''
            }`}
          >
            {tok.text}
          </button>
        ) : (
          <span key={i}>{tok.text}</span>
        )
      )}
    </p>
  );
};
