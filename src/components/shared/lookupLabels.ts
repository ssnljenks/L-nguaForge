import type {LookupSource} from '../../utils/localDictionary';

/** Where a word lookup came from, shown under the word in the popover. */
export const WORD_SOURCE_LABELS: Record<LookupSource, string> = {
  vault: 'In Vault · Offline',
  military_dict: 'Military Dict · Offline',
  dictionary: 'Local Dict · Offline',
  cache: 'Cached · Offline',
  ai: 'AI Context · Cached',
};

/** Source label for "how do I say…" phrase results; `aiLabel` is used when the phrase came from the AI. */
export function totSourceLabel(source: 'dictionary' | 'cache' | 'ai', aiLabel: string): string {
  if (source === 'dictionary') return 'Instant Dictionary (0 API)';
  if (source === 'cache') return 'Cached (0 API)';
  return aiLabel;
}
