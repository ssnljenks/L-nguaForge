import {useEffect, useState} from 'react';
import type {Sanitizer} from '../utils/storageSchemas';

/** Reads and validates a stored JSON value (falling back across optional legacyKeys); returns `fallback` when missing, unparsable or invalid. */
export function readStoredValue<T>(
  key: string,
  fallback: T,
  sanitize?: Sanitizer<T>,
  legacyKeys: readonly string[] = []
): T {
  if (typeof window === 'undefined') return fallback;
  const candidateKeys = [key, ...legacyKeys];
  for (const candidateKey of candidateKeys) {
    try {
      const raw = window.localStorage.getItem(candidateKey);
      if (raw === null) continue;
      const parsed: unknown = JSON.parse(raw);
      if (!sanitize) return parsed as T;
      const sanitized = sanitize(parsed);
      if (sanitized === undefined) {
        console.warn(`[storage] Ignoring invalid data in "${candidateKey}"; using defaults.`);
        continue;
      }
      return sanitized;
    } catch {
      console.warn(`[storage] Could not parse "${candidateKey}"; using defaults.`);
    }
  }
  return fallback;
}

/**
 * useState persisted to localStorage. Pass a sanitizer so corrupted or outdated stored data is
 * repaired (or replaced by `initialValue`) instead of crashing the component that reads it.
 * Optional `legacyKeys` are consulted on initial mount so versioned keys migrate without data loss.
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T | (() => T),
  sanitize?: Sanitizer<T>,
  legacyKeys: readonly string[] = []
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    const missing = Symbol('missing');
    const stored = readStoredValue<T | typeof missing>(key, missing, sanitize, legacyKeys);
    if (stored !== missing) return stored;
    return initialValue instanceof Function ? initialValue() : initialValue;
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // Ignore storage quota errors gracefully
    }
  }, [key, state]);

  return [state, setState];
}
