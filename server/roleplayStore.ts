import type {IlrBaseLevel} from '../src/data/ilrSpeakingLevels.ts';
import type {RoleplayRegister, TargetLanguage} from '../src/types.ts';

export const DEFAULT_ROLEPLAY_TTL_MS = 45 * 60 * 1000;
export const MAX_ROLEPLAY_SCENARIOS = 500;

export interface RoleplaySecretRecord {
  scenarioId: string;
  level: IlrBaseLevel;
  language: TargetLanguage;
  dialect: string;
  situationEnglish: string;
  learnerGoal: string;
  register: RoleplayRegister;
  characterRole: string;
  hiddenGoal: string;
  complication: string;
  createdAtMs: number;
  expiresAtMs: number;
}

const store = new Map<string, RoleplaySecretRecord>();

export function clearExpiredRoleplaySecrets(nowMs = Date.now()): number {
  let removed = 0;
  for (const [id, rec] of store.entries()) {
    if (rec.expiresAtMs <= nowMs) {
      store.delete(id);
      removed += 1;
    }
  }
  return removed;
}

export function saveRoleplaySecret(
  record: Omit<RoleplaySecretRecord, 'createdAtMs' | 'expiresAtMs'>,
  ttlMs = DEFAULT_ROLEPLAY_TTL_MS,
  nowMs = Date.now()
): RoleplaySecretRecord {
  clearExpiredRoleplaySecrets(nowMs);

  while (store.size >= MAX_ROLEPLAY_SCENARIOS) {
    const oldestKey = store.keys().next().value;
    if (!oldestKey) break;
    store.delete(oldestKey);
  }

  const safeTtl = Math.max(1000, Math.floor(ttlMs));
  const fullRecord: RoleplaySecretRecord = {
    ...record,
    createdAtMs: nowMs,
    expiresAtMs: nowMs + safeTtl,
  };
  store.set(record.scenarioId, fullRecord);
  return fullRecord;
}

export function getRoleplaySecret(scenarioId: string, nowMs = Date.now()): RoleplaySecretRecord | null {
  if (!scenarioId || typeof scenarioId !== 'string') return null;
  const rec = store.get(scenarioId);
  if (!rec) return null;
  if (rec.expiresAtMs <= nowMs) {
    store.delete(scenarioId);
    return null;
  }
  return rec;
}

export function clearAllRoleplaySecrets(): void {
  store.clear();
}
