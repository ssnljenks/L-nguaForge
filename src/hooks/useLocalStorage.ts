import {useEffect, useState} from 'react';
import type {Sanitizer} from '../utils/storageSchemas';

/** Reads and validates a stored JSON value; returns `fallback` when missing, unparsable or invalid. */
export function readStoredValue<T>(key: string, fallback: T, sanitize?: Sanitizer<T>): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (!sanitize) return parsed as T;
    const sanitized = sanitize(parsed);
    if (sanitized === undefined) {
      console.warn(`[storage] Ignoring invalid data in "${key}"; using defaults.`);
      return fallback;
    }
    return sanitized;
  } catch {
    console.warn(`[storage] Could not parse "${key}"; using defaults.`);
    return fallback;
  }
}

/**
 * useState persisted to localStorage. Pass a sanitizer so corrupted or outdated stored data is
 * repaired (or replaced by `initialValue`) instead of crashing the component that reads it.
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T,
  sanitize?: Sanitizer<T>
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => readStoredValue(key, initialValue, sanitize));

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // Ignore storage quota errors gracefully
    }
  }, [key, state]);

  return [state, setState];
}
