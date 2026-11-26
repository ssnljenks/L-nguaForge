/**
 * Deterministic detector for classification and control markings in banner or portion-mark form.
 *
 * Used by server routes before calling Gemini so controlled or work material is rejected with
 * HTTP 422 instead of leaving the server. Designed to avoid false positives on normal English,
 * Spanish, and Portuguese prose (e.g., lowercase "secret", "secreto", "confidencial", "sí",
 * "(c)" copyright notices, or "vessel(s)").
 */

export interface ClassificationMatch {
  matchedText: string;
  category: 'classification_banner' | 'control_marking' | 'portion_marking' | 'classification_block';
}

interface MarkingRule {
  category: ClassificationMatch['category'];
  pattern: RegExp;
}

const MARKING_RULES: readonly MarkingRule[] = [
  // Portion markings with caveats: (TS//SI//NOFORN), (S//NF), (C//REL TO USA), (U//FOUO), (U//CUI), (CUI//SP-MIL)
  {
    category: 'portion_marking',
    pattern:
      /(?<![A-Za-zÀ-ÿ])\((?:TS|S|C|U|CUI|TOP\s+SECRET|SECRET|CONFIDENTIAL)\s*\/\/\s*[A-Za-z0-9\s,/-]{1,64}\)(?![A-Za-zÀ-ÿ])/i,
  },
  // Standalone portion markings: (TS), (S), (C), (CUI), (FOUO), (SBU), (NOFORN), (ORCON), (REL TO ...)
  {
    category: 'portion_marking',
    pattern: /(?<![A-Za-zÀ-ÿ])\((?:TS|S|C|CUI|FOUO|SBU|NOFORN|ORCON|PROPIN|RELIDO)\)(?![A-Za-zÀ-ÿ])/,
  },
  {
    category: 'portion_marking',
    pattern: /(?<![A-Za-zÀ-ÿ])\((?:CUI|FOUO|NOFORN|ORCON|REL\s+TO(?:\s+[A-Z0-9,\s-]+)?)\)(?![A-Za-zÀ-ÿ])/i,
  },
  // Slash-delimited banners: TOP SECRET//..., SECRET//..., CONFIDENTIAL//..., UNCLASSIFIED//FOUO, TS//SI, S//NF, C//NOFORN, U//FOUO, CUI//...
  {
    category: 'classification_banner',
    pattern:
      /\b(?:TOP\s+SECRET|SECRET|CONFIDENTIAL|TS|S|C)\s*\/\/\s*(?:SI|TK|HCS|SCI|SAP|NF|NOFORN|ORCON|PROPIN|REL\s+TO|RELIDO|FVEY|EYES\s+ONLY|IMCON|LIMDIS|EXDIS|NODIS|FOUO|CUI)\b/i,
  },
  {
    category: 'classification_banner',
    pattern: /\b(?:UNCLASSIFIED|U)\s*\/\/\s*(?:FOUO|FOR\s+OFFICIAL\s+USE\s+ONLY|CUI|LES|SBU)\b/i,
  },
  {
    category: 'classification_banner',
    pattern: /\bCUI\s*\/\/\s*[A-Z0-9-]{2,}\b/i,
  },
  // Uppercase classification banner words (case-sensitive to avoid normal lowercase prose)
  {
    category: 'classification_banner',
    pattern: /\b(?:TOP\s+SECRET|SECRET|CONFIDENTIAL)\b/,
  },
  // Control & dissemination markings (unambiguous words/phrases)
  {
    category: 'control_marking',
    pattern: /\b(?:NOFORN|FOUO|ORCON|PROPIN|RELIDO|IMCON|LIMDIS|EXDIS|NODIS)\b/i,
  },
  {
    category: 'control_marking',
    pattern: /\b(?:FOR\s+OFFICIAL\s+USE\s+ONLY|CONTROLLED\s+UNCLASSIFIED\s+INFORMATION)\b/i,
  },
  // Uppercase CUI and REL TO control markings
  {
    category: 'control_marking',
    pattern: /\b(?:CUI|REL\s+TO)\b/,
  },
  // Classification authority block headers
  {
    category: 'classification_block',
    pattern: /\b(?:CLASSIFIED\s+BY|DERIVED\s+FROM|DECLASSIFY\s+ON)\s*:/i,
  },
];

export const DATA_SAFETY_SHORT_NOTICE = "Unclassified, open-source material only. Don't paste work material.";

export const CLASSIFICATION_REJECT_MESSAGE =
  "Unclassified, open-source material only. It looks like your text contains classification or control markings — please remove them and don't paste work material.";

/**
 * Inspects a single string for classification or control markings.
 * Returns the first detected match, or null if the text appears clean.
 */
export function detectClassificationMarking(text: string): ClassificationMatch | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  for (const rule of MARKING_RULES) {
    const match = rule.pattern.exec(text);
    if (match) {
      return {
        matchedText: match[0],
        category: rule.category,
      };
    }
  }
  return null;
}

/**
 * Checks an array of free-text inputs and returns the first classification match found.
 */
export function findClassificationMarkingInTexts(texts: readonly unknown[]): ClassificationMatch | null {
  for (const value of texts) {
    if (typeof value !== 'string') continue;
    const found = detectClassificationMarking(value);
    if (found) return found;
  }
  return null;
}
