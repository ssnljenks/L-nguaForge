import {Type} from '@google/genai';
import {
  type ErrorTaxonomyCategory,
  formatTaxonomyKeysForPrompt,
  type ReportedErrorItem,
  sanitizeReportedErrors,
} from '../src/data/errorTaxonomy.ts';

export const REPORTED_ERRORS_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      key: {type: Type.STRING},
      wrong: {type: Type.STRING},
      fix: {type: Type.STRING},
      quote: {type: Type.STRING},
    },
    required: ['key', 'wrong', 'fix', 'quote'],
  },
};

export function buildErrorReportingInstruction(
  language: 'es' | 'pt',
  categories: readonly ErrorTaxonomyCategory[]
): string {
  const list = formatTaxonomyKeysForPrompt(language, categories);
  return `errors: Return up to 5 specific recurring or notable learner errors observed in this transcript as [{ key, wrong, fix, quote }].
- You MUST choose "key" ONLY from this fixed list (never invent new keys; return [] if no clear error fits):
${list}
- "wrong": the exact short erroneous phrase from the learner (max 140 chars).
- "fix": the concise corrected target-language phrasing (max 140 chars).
- "quote": the brief surrounding sentence/utterance from the learner (max 200 chars).`;
}

/**
 * Strictly filters model-returned errors against the fixed taxonomy for the active language,
 * dropping any unknown or mismatched keys server-side.
 */
export function extractReportedErrors(rawErrors: unknown, language: 'es' | 'pt', maxItems = 8): ReportedErrorItem[] {
  return sanitizeReportedErrors(rawErrors, language, maxItems);
}
