/**
 * Deterministic detector for classification and control markings in banner or portion-mark form.
 *
 * Used by server routes before calling Gemini so controlled or work material is rejected with
 * HTTP 422 instead of leaving the server. Designed to avoid false positives on normal English,
 * Spanish, and Portuguese prose (e.g., lowercase "secret", "secreto", "confidencial", "sí",
 * "relido", "(c)" copyright notices, "vessel(s)", "(A)… (B)… (C)" option lists, "Copyright (C)",
 * or "CUI" as the Guatemalan ID number).
 *
 * Ambiguous tokens only count as markings in marking context (REVIEW M-6):
 * - single-letter portion marks "(S)" / "(C)" and "(TS)", "(CUI)", "(SBU)" must sit where a portion
 *   mark goes (start of a line or right after a sentence end), and single letters are ignored when
 *   the text also uses other lettered labels like "(A)" or "(B)";
 * - a bare uppercase "CUI" counts only as a banner line of its own;
 * - uppercase "SECRET"/"CONFIDENTIAL" count except mid-line inside capitalized prose ("THE SECRET LIFE");
 * - "RELIDO"/"PROPIN" (Portuguese "relido", Spanish "propina") and "For Official Use Only" only in
 *   marking case.
 */

export interface ClassificationMatch {
  matchedText: string;
  category: 'classification_banner' | 'control_marking' | 'portion_marking' | 'classification_block';
}

interface MarkingRule {
  category: ClassificationMatch['category'];
  /** Must carry the `g` flag: every occurrence is checked against `accept`. */
  pattern: RegExp;
  /** Extra context check for ambiguous tokens; the match counts only when this returns true. */
  accept?: (text: string, match: RegExpExecArray) => boolean;
}

/** Words that make up classification banners and caveat lines. */
const BANNER_VOCABULARY = new Set([
  'TOP',
  'SECRET',
  'CONFIDENTIAL',
  'UNCLASSIFIED',
  'CLASSIFICATION',
  'CLASSIFIED',
  'RESTRICTED',
  'CUI',
  'NOFORN',
  'NF',
  'FOUO',
  'ORCON',
  'PROPIN',
  'RELIDO',
  'IMCON',
  'LIMDIS',
  'EXDIS',
  'NODIS',
  'REL',
  'TO',
  'USA',
  'FVEY',
  'NATO',
  'SI',
  'TK',
  'HCS',
  'SCI',
  'SAP',
  'TS',
  'S',
  'C',
  'U',
  'SP',
  'MIL',
  'SBU',
  'LES',
]);

function lineAround(text: string, index: number): {line: string; column: number} {
  const start = Math.max(text.lastIndexOf('\n', index - 1) + 1, text.lastIndexOf('\r', index - 1) + 1);
  const nl = text.slice(index).search(/[\r\n]/);
  const end = nl === -1 ? text.length : index + nl;
  return {line: text.slice(start, end), column: index - start};
}

/** Start of the text or a line (after an optional bullet), or right after a sentence end. */
function atPortionPosition(text: string, index: number): boolean {
  const before = text.slice(0, index).replace(/[ \t]+$/, '');
  if (before === '') return true;
  if (/(?:^|[\r\n])[ \t]*[-*•·]?$/.test(before)) return true;
  return /[.!?]["'”»]?$/.test(before);
}

/** Lettered labels other than the S/C/U portion letters, as in "(A)… (B)… (C)". */
function hasLetteredOptionLabels(text: string): boolean {
  return /\((?![SCU]\))[A-Z]\)/.test(text);
}

/** A line made only of banner words and separators, e.g. "CUI", "TOP SECRET", "SECRET - NOFORN". */
function isBannerLine(line: string): boolean {
  const words = line.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return words.length > 0 && words.every((w) => BANNER_VOCABULARY.has(w));
}

/**
 * Inside a run of capitalized prose ("THE SECRET LIFE OF PETS", "el documental TOP SECRET ROSIES"),
 * as opposed to a banner: the uppercase words around the match include a non-marking word.
 */
function inCapitalizedProse(line: string, column: number, length: number): boolean {
  const left = /[\p{Lu}\d'’ \t,.!?¡¿-]*$/u.exec(line.slice(0, column))?.[0] ?? '';
  const right = /^[\p{Lu}\d'’ \t,.!?¡¿-]*/u.exec(line.slice(column + length))?.[0] ?? '';
  const words = `${left} ${right}`.match(/\p{Lu}{2,}/gu) ?? [];
  return words.some((w) => !BANNER_VOCABULARY.has(w));
}

const portionMarkInPosition = (text: string, m: RegExpExecArray): boolean => {
  if (!atPortionPosition(text, m.index)) return false;
  const after = text.slice(m.index + m[0].length);
  if (after !== '' && !/^\s/.test(after)) return false;
  const inner = m[0].slice(1, -1);
  if (inner.length === 1) {
    if (hasLetteredOptionLabels(text)) return false;
    // "(C) 2026 Open Maritime Atlas" is a copyright line.
    if (inner === 'C' && /^\s*\d{4}\b/.test(after)) return false;
  }
  return true;
};

const MARKING_RULES: readonly MarkingRule[] = [
  // Portion markings with caveats: (TS//SI//NOFORN), (S//NF), (C//REL TO USA), (U//FOUO), (U//CUI), (CUI//SP-MIL)
  {
    category: 'portion_marking',
    pattern:
      /(?<![A-Za-zÀ-ÿ])\((?:TS|S|C|U|CUI|TOP\s+SECRET|SECRET|CONFIDENTIAL)\s*\/\/\s*[A-Za-z0-9\s,/-]{1,64}\)(?![A-Za-zÀ-ÿ])/gi,
  },
  // Unambiguous standalone portion markings: (FOUO), (NOFORN), (ORCON), (REL TO ...)
  {
    category: 'portion_marking',
    pattern: /(?<![A-Za-zÀ-ÿ])\((?:FOUO|NOFORN|ORCON|PROPIN|RELIDO|REL\s+TO(?:\s+[A-Z0-9,\s-]+)?)\)(?![A-Za-zÀ-ÿ])/g,
  },
  {
    category: 'portion_marking',
    pattern: /(?<![A-Za-zÀ-ÿ])\((?:FOUO|NOFORN|ORCON)\)(?![A-Za-zÀ-ÿ])/gi,
  },
  // Ambiguous standalone portion markings, only where a portion mark goes: (TS), (S), (C), (CUI), (SBU)
  {
    category: 'portion_marking',
    pattern: /(?<![A-Za-zÀ-ÿ])\((?:TS|S|C|CUI|SBU)\)(?![A-Za-zÀ-ÿ])/g,
    accept: portionMarkInPosition,
  },
  // Slash-delimited banners: TOP SECRET//..., SECRET//..., CONFIDENTIAL//..., UNCLASSIFIED//FOUO, TS//SI, S//NF, C//NOFORN, U//FOUO, CUI//...
  {
    category: 'classification_banner',
    pattern:
      /\b(?:TOP\s+SECRET|SECRET|CONFIDENTIAL|TS|S|C)\s*\/\/\s*(?:SI|TK|HCS|SCI|SAP|NF|NOFORN|ORCON|PROPIN|REL\s+TO|RELIDO|FVEY|EYES\s+ONLY|IMCON|LIMDIS|EXDIS|NODIS|FOUO|CUI)\b/gi,
  },
  {
    category: 'classification_banner',
    pattern: /\b(?:UNCLASSIFIED|U)\s*\/\/\s*(?:FOUO|FOR\s+OFFICIAL\s+USE\s+ONLY|CUI|LES|SBU)\b/gi,
  },
  {
    category: 'classification_banner',
    pattern: /\bCUI\s*\/\/\s*[A-Z0-9-]{2,}\b/gi,
  },
  // Uppercase classification banner words (case-sensitive to avoid normal lowercase prose), except
  // mid-line inside capitalized prose such as a shouted sentence or a title.
  {
    category: 'classification_banner',
    pattern: /\b(?:TOP\s+SECRET|SECRET|CONFIDENTIAL)\b/g,
    accept: (text, m) => {
      const {line, column} = lineAround(text, m.index);
      if (/^[\s\p{P}]*$/u.test(line.slice(0, column))) return true;
      return !inCapitalizedProse(line, column, m[0].length);
    },
  },
  // Control & dissemination markings that are not words in English, Spanish, or Portuguese
  {
    category: 'control_marking',
    pattern: /\b(?:NOFORN|FOUO|ORCON|IMCON|LIMDIS|EXDIS|NODIS)\b/gi,
  },
  // "relido" (pt "reread") and "propin(a)" are real words; only the uppercase caveat counts.
  {
    category: 'control_marking',
    pattern: /\b(?:PROPIN|RELIDO)\b/g,
  },
  {
    category: 'control_marking',
    pattern: /\b(?:FOR\s+OFFICIAL\s+USE\s+ONLY|For\s+Official\s+Use\s+Only)\b/g,
  },
  {
    category: 'control_marking',
    pattern: /\bCONTROLLED\s+UNCLASSIFIED\s+INFORMATION\b/gi,
  },
  // A bare "CUI" is also the Guatemalan ID number ("Mi CUI es…"); it counts only as a banner line.
  {
    category: 'control_marking',
    pattern: /\bCUI\b/g,
    accept: (text, m) => isBannerLine(lineAround(text, m.index).line),
  },
  // Uppercase REL TO control marking
  {
    category: 'control_marking',
    pattern: /\bREL\s+TO\b/g,
  },
  // REL TO in any case when followed by a releasability code (e.g. "rel to usa", "Rel To FVEY", "rel to GBR")
  {
    category: 'control_marking',
    pattern: /\bREL\s+TO\s+(?:USA|FVEY|NATO)\b/gi,
  },
  {
    category: 'control_marking',
    pattern: /\b[Rr][Ee][Ll]\s+[Tt][Oo]\s+[A-Z]{3}(?:\s*,\s*[A-Z]{3})*\b/g,
  },
  // Classification authority block lines ("Classified By: …", "Derived From: …", "Declassify On: …",
  // "CUI Category: …") at the start of a line.
  {
    category: 'classification_block',
    pattern: /^[ \t]*(?:Classified\s+By|CLASSIFIED\s+BY|Derived\s+From|DERIVED\s+FROM|CUI\s+Categor(?:y|ies))\s*:/gm,
  },
  {
    category: 'classification_block',
    pattern: /^[ \t]*Declassify\s+On\s*:/gim,
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
    for (const match of text.matchAll(rule.pattern)) {
      if (rule.accept && !rule.accept(text, match)) continue;
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
