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
  // REL TO in any case when followed by a releasability code (e.g. "rel to usa", "Rel To FVEY")
  {
    category: 'control_marking',
    pattern: /\bREL\s+TO\s+(?:USA|FVEY|NATO|[A-Z]{3}(?:\s*,\s*[A-Z]{3})*)\b/i,
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
  return matchRules(text) ?? matchRules(normalizeForMarkingDetection(text));
}

// Cyrillic and Greek letters that look like Latin ones, as used to dodge keyword filters.
const CONFUSABLES: Record<string, string> = {
  А: 'A',
  В: 'B',
  Е: 'E',
  К: 'K',
  М: 'M',
  Н: 'H',
  О: 'O',
  Р: 'P',
  С: 'C',
  Т: 'T',
  Х: 'X',
  Ѕ: 'S',
  І: 'I',
  Ј: 'J',
  У: 'Y',
  а: 'a',
  е: 'e',
  о: 'o',
  р: 'p',
  с: 'c',
  у: 'y',
  х: 'x',
  ѕ: 's',
  і: 'i',
  ј: 'j',
  Α: 'A',
  Β: 'B',
  Ε: 'E',
  Ζ: 'Z',
  Η: 'H',
  Ι: 'I',
  Κ: 'K',
  Μ: 'M',
  Ν: 'N',
  Ο: 'O',
  Ρ: 'P',
  Τ: 'T',
  Υ: 'Y',
  Χ: 'X',
  ο: 'o',
  ν: 'v',
};
const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLES).join('')}]`, 'g');

/**
 * Canonical form used to catch obfuscated markings (REVIEW H-5): NFKC (fullwidth -> ASCII), invisible
 * format characters removed (zero-width, soft hyphen), Cyrillic/Greek lookalikes mapped to Latin,
 * dotted or letter-spaced capitals collapsed ("N.O.F.O.R.N", "S E C R E T"), padded portion marks
 * trimmed ("( S )"). Lowercase prose is untouched, so ordinary words like "secreto" stay allowed.
 */
export function normalizeForMarkingDetection(text: string): string {
  return (
    text
      .normalize('NFKC')
      .replace(/\p{Cf}/gu, '')
      .replace(CONFUSABLE_RE, (ch) => CONFUSABLES[ch] ?? ch)
      .replace(/\b(?:[A-Z][\s.\-_·]{1,2}){2,}[A-Z]\b\.?/g, (run) => run.replace(/[^A-Z]/g, ''))
      // A spaced-out "T-O-P S-E-C-R-E-T" collapses to one run; restore the word gap.
      .replace(/\bTOPSECRET\b/g, 'TOP SECRET')
      .replace(/\(\s*([^()]{1,40}?)\s*\)/g, '($1)')
  );
}

function matchRules(text: string): ClassificationMatch | null {
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
