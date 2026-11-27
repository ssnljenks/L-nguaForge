import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Stable hash of everything that determines a model response. Any prompt/schema change is a new key. */
export function hashInput(parts: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

export interface ResponseCache {
  get(key: string): Record<string, unknown> | undefined;
  set(key: string, value: Record<string, unknown>): void;
}

export function createFileCache(dir: string, enabled = true): ResponseCache {
  if (enabled) fs.mkdirSync(dir, {recursive: true});
  const file = (key: string) => path.join(dir, `${key}.json`);
  return {
    get(key) {
      if (!enabled) return undefined;
      try {
        return JSON.parse(fs.readFileSync(file(key), 'utf8')) as Record<string, unknown>;
      } catch {
        return undefined;
      }
    },
    set(key, value) {
      if (!enabled) return;
      fs.writeFileSync(file(key), JSON.stringify(value));
    },
  };
}

export function createMemoryCache(): ResponseCache {
  const map = new Map<string, Record<string, unknown>>();
  return {get: (k) => map.get(k), set: (k, v) => void map.set(k, v)};
}
