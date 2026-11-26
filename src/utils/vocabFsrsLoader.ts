import {SEED_VOCAB} from '../data/seedData.ts';
import {setLegacyFsrsMigrator, storedVocabNeedsFsrsMigration} from './storageSchemas.ts';

/** Current and legacy localStorage keys for the vocab deck, newest first. */
export const VOCAB_STORAGE_KEY = 'linguaforge_vocab_v2';
export const LEGACY_VOCAB_STORAGE_KEYS = ['linguaforge_vocab_v1'] as const;

/** Loads ts-fsrs (a separate chunk, REVIEW M-7) and installs the legacy vocab migrator. */
export async function loadLegacyFsrsMigrator(): Promise<void> {
  const {migrateVocabItemToFsrs} = await import('./vocabFsrs.ts');
  setLegacyFsrsMigrator((item) => migrateVocabItemToFsrs(item));
}

/**
 * Run before the first render: if the stored deck (or the seed deck, for a new user) has items
 * without FSRS state, load the migrator so they are scheduled from their mastery, as before.
 */
export async function prepareVocabFsrsMigration(storage: Pick<Storage, 'getItem'>): Promise<void> {
  let raw: unknown = SEED_VOCAB;
  for (const key of [VOCAB_STORAGE_KEY, ...LEGACY_VOCAB_STORAGE_KEYS]) {
    try {
      const stored = storage.getItem(key);
      if (stored === null) continue;
      raw = JSON.parse(stored);
      break;
    } catch {
      // Unparsable data is replaced by defaults when the app reads it.
    }
  }
  if (storedVocabNeedsFsrsMigration(raw)) await loadLegacyFsrsMigrator();
}

/** Applies an FSRS review; loads the scheduler on first use. */
export async function loadVocabReviewer(): Promise<typeof import('./vocabFsrs.ts').reviewVocabCardWithFsrs> {
  return (await import('./vocabFsrs.ts')).reviewVocabCardWithFsrs;
}
