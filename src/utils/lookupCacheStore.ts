/**
 * Persistence for lookup caches and counters (word cache, "how do I say" cache, Lab prompt cache,
 * API-calls-saved counter). Deliberately free of dictionary data so the app shell can import it
 * without pulling the large offline dictionaries into the main bundle.
 */
import type {InterpBriefing, PrepPromptItem, TargetLanguage, WordLookupResult} from '../types';

export interface CachedWordRecord {
  result: WordLookupResult;
  cachedAt: number;
  lastAccessedAt: number;
  hits: number;
}

const LEGACY_WORD_CACHE_KEY = 'linguaforge_word_cache_v1';
export const WORD_CACHE_KEY = 'linguaforge_word_cache_v2';
export const TOT_CACHE_KEY = 'linguaforge_tot_cache_v1';
const LAB_CACHE_KEY = 'linguaforge_lab_cache_v1';
const API_SAVED_COUNT_KEY = 'linguaforge_api_saved_count_v1';
const MAX_CACHED_WORDS = 500;
export const API_SAVED_EVENT = 'linguaforge-api-saved';
export const WORD_CACHE_EVENT = 'linguaforge-word-cache-updated';

export function getStorage(): Storage | null {
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

export function dispatchBrowserEvent(eventName: string, detail?: unknown): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent(eventName, {detail}));
  }
}

export function readStorageJson<T>(key: string, fallback: T): T {
  const storage = getStorage();
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    // Stored values must have the same shape as the fallback (plain object vs. number etc.);
    // otherwise a corrupted entry such as `null` would crash the first property access.
    const isPlainObject = (v: unknown) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
    if (isPlainObject(fallback) ? !isPlainObject(parsed) : typeof parsed !== typeof fallback) return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

export function writeStorageJson<T>(key: string, val: T): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(val));
    return true;
  } catch {
    return false;
  }
}

// Fast in-memory LRU mirror hydrated lazily once from localStorage so repeated word taps are O(1)
let wordCacheMemory: Map<string, CachedWordRecord> | null = null;

export function hydrateWordCache(): Map<string, CachedWordRecord> {
  if (wordCacheMemory) return wordCacheMemory;
  const map = new Map<string, CachedWordRecord>();
  const now = Date.now();

  // Read v2 records first
  const storedV2 = readStorageJson<Record<string, CachedWordRecord>>(WORD_CACHE_KEY, {});
  for (const [k, rec] of Object.entries(storedV2)) {
    if (rec && rec.result && typeof rec.result.contextualMeaning === 'string' && rec.result.contextualMeaning.trim()) {
      map.set(k, {
        result: rec.result,
        cachedAt: typeof rec.cachedAt === 'number' ? rec.cachedAt : now,
        lastAccessedAt: typeof rec.lastAccessedAt === 'number' ? rec.lastAccessedAt : now,
        hits: typeof rec.hits === 'number' ? rec.hits : 0,
      });
    }
  }

  // Seamlessly migrate legacy v1 cache entries if present
  const storage = getStorage();
  if (storage) {
    const legacyV1 = readStorageJson<Record<string, WordLookupResult>>(LEGACY_WORD_CACHE_KEY, {});
    let migrated = false;
    for (const [k, res] of Object.entries(legacyV1)) {
      if (!map.has(k) && res && typeof res.contextualMeaning === 'string' && res.contextualMeaning.trim()) {
        map.set(k, {
          result: res,
          cachedAt: now,
          lastAccessedAt: now,
          hits: 0,
        });
        migrated = true;
      }
    }
    if (migrated) {
      persistWordCache(map);
      try {
        storage.removeItem(LEGACY_WORD_CACHE_KEY);
      } catch {
        // Ignore storage errors
      }
    }
  }

  wordCacheMemory = map;
  return map;
}

export function persistWordCache(map: Map<string, CachedWordRecord>): void {
  // Enforce LRU cap
  if (map.size > MAX_CACHED_WORDS) {
    const sorted = Array.from(map.entries()).sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);
    const excess = map.size - MAX_CACHED_WORDS;
    for (let i = 0; i < excess; i += 1) {
      map.delete(sorted[i][0]);
    }
  }

  const serialized = Object.fromEntries(map.entries());
  const ok = writeStorageJson(WORD_CACHE_KEY, serialized);
  if (!ok && map.size > 100) {
    // Quota fallback: prune oldest half and retry once
    const sorted = Array.from(map.entries()).sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);
    const pruneCount = Math.floor(map.size / 2);
    for (let i = 0; i < pruneCount; i += 1) {
      map.delete(sorted[i][0]);
    }
    writeStorageJson(WORD_CACHE_KEY, Object.fromEntries(map.entries()));
  }
}

export function resetInMemoryCacheForTests(): void {
  wordCacheMemory = null;
}

export function getApiSavedCount(): number {
  const n = readStorageJson<number>(API_SAVED_COUNT_KEY, 0);
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

export function incrementApiSavedCount(by = 1): number {
  const next = getApiSavedCount() + by;
  writeStorageJson(API_SAVED_COUNT_KEY, next);
  dispatchBrowserEvent(API_SAVED_EVENT, next);
  return next;
}

export function clearWordCacheOnly(): void {
  wordCacheMemory = new Map();
  const storage = getStorage();
  if (storage) {
    try {
      storage.removeItem(WORD_CACHE_KEY);
      storage.removeItem(LEGACY_WORD_CACHE_KEY);
      storage.removeItem(TOT_CACHE_KEY);
    } catch {
      // Ignore storage errors
    }
  }
  dispatchBrowserEvent(WORD_CACHE_EVENT);
}

function isValidPrepPrompt(item: unknown): item is PrepPromptItem {
  const rec = item as Partial<PrepPromptItem> | null;
  return (
    Boolean(rec) &&
    typeof rec?.promptTarget === 'string' &&
    typeof rec.promptEnglish === 'string' &&
    Array.isArray(rec.recommendedConnectors)
  );
}

function isValidInterpBriefing(item: unknown): item is InterpBriefing {
  const rec = item as Partial<InterpBriefing> | null;
  return Boolean(rec) && typeof rec?.briefingText === 'string' && Array.isArray(rec.keyFacts);
}

interface LabCacheStore {
  prep?: Record<string, PrepPromptItem>;
  interp?: Record<string, InterpBriefing>;
}

export function getCachedPrepPrompt(language: TargetLanguage, domain: string): PrepPromptItem | null {
  const store = readStorageJson<LabCacheStore>(LAB_CACHE_KEY, {});
  const item: unknown = store.prep?.[`${language}:${domain}`];
  return isValidPrepPrompt(item) ? item : null;
}

export function savePrepPromptCache(language: TargetLanguage, domain: string, item: PrepPromptItem): void {
  const store = readStorageJson<LabCacheStore>(LAB_CACHE_KEY, {});
  store.prep = {...(store.prep ?? {}), [`${language}:${domain}`]: item};
  writeStorageJson(LAB_CACHE_KEY, store);
}

export function getCachedInterpBriefing(
  language: TargetLanguage,
  dialect: string,
  domain: string
): InterpBriefing | null {
  const store = readStorageJson<LabCacheStore>(LAB_CACHE_KEY, {});
  const item: unknown = store.interp?.[`${language}:${dialect}:${domain}`];
  return isValidInterpBriefing(item) ? item : null;
}

export function saveInterpBriefingCache(
  language: TargetLanguage,
  dialect: string,
  domain: string,
  briefing: InterpBriefing
): void {
  const store = readStorageJson<LabCacheStore>(LAB_CACHE_KEY, {});
  store.interp = {...(store.interp ?? {}), [`${language}:${dialect}:${domain}`]: briefing};
  writeStorageJson(LAB_CACHE_KEY, store);
}

export function clearLocalLookupCaches(): void {
  wordCacheMemory = new Map();
  const storage = getStorage();
  if (storage) {
    try {
      storage.removeItem(WORD_CACHE_KEY);
      storage.removeItem(LEGACY_WORD_CACHE_KEY);
      storage.removeItem(TOT_CACHE_KEY);
      storage.removeItem(LAB_CACHE_KEY);
      storage.removeItem(API_SAVED_COUNT_KEY);
    } catch {
      // Ignore storage errors
    }
  }
  dispatchBrowserEvent(API_SAVED_EVENT, 0);
  dispatchBrowserEvent(WORD_CACHE_EVENT);
}
