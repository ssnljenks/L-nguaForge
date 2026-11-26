import {CHAT_REGISTER_MODES, getDialectInfo, getDomainInfo, isVocabCategory} from '../src/utils/ilrLogic.ts';
import {CLASSIFICATION_REJECT_MESSAGE, findClassificationMarkingInTexts} from '../src/utils/classificationGuard.ts';
import type {ChatRegisterMode, MilitaryDomain, TargetLanguage, VocabCategory} from '../src/types.ts';
import {UserFacingError} from './errors.ts';

/** Trims and truncates; anything that isn't a string becomes ''. */
export function sanitizeString(val: unknown, maxLen = 4000): string {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

/**
 * Rejects free-text payloads that contain classification or control markings with HTTP 422
 * before any outbound Gemini call occurs.
 */
export function assertUnclassifiedText(...texts: unknown[]): void {
  const match = findClassificationMarkingInTexts(texts);
  if (match) {
    throw new UserFacingError(422, CLASSIFICATION_REJECT_MESSAGE);
  }
}

export function sanitizeStringArray(val: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(val)) return [];
  return val
    .map((item) => sanitizeString(item, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

export function clampNumber(val: unknown, min: number, max: number, fallback: number): number {
  if (val === null || val === undefined || val === '') return fallback;
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function clampScore(val: unknown): number {
  return clampNumber(val, 0, 100, 0);
}

export function asRecord(val: unknown): Record<string, unknown> {
  return val && typeof val === 'object' && !Array.isArray(val) ? (val as Record<string, unknown>) : {};
}

export function asRecordArray(val: unknown): Record<string, unknown>[] {
  return Array.isArray(val) ? val.map(asRecord) : [];
}

export function validateLanguage(val: unknown): TargetLanguage {
  return val === 'pt' ? 'pt' : 'es';
}

export function validateRegisterMode(val: unknown): ChatRegisterMode {
  return (CHAT_REGISTER_MODES as readonly unknown[]).includes(val) ? (val as ChatRegisterMode) : 'professional';
}

export function pickVocabCategory(val: unknown, fallback: VocabCategory): VocabCategory {
  const cleaned = sanitizeString(val, 80);
  return isVocabCategory(cleaned) ? cleaned : fallback;
}

/** Formats a client-supplied chat history as a labelled transcript, bounded in size. */
export function formatTranscript(
  history: unknown,
  options: {maxTurns: number; maxCharsPerTurn: number; label: (role: unknown) => string}
): string {
  return asRecordArray(history)
    .slice(-options.maxTurns)
    .map((m) => `${options.label(m.role)}: ${sanitizeString(m.text, options.maxCharsPerTurn)}`)
    .join('\n');
}

export interface TrainingContext {
  language: TargetLanguage;
  langName: 'Spanish' | 'Portuguese';
  dialectId: string;
  dialectLabel: string;
  domainId: MilitaryDomain;
  domainLabel: string;
}

/**
 * Resolves language/dialect/domain from client-supplied IDs into server-owned labels.
 * Free-text labels from the client are never interpolated into prompts.
 */
export function resolveTrainingContext(source: unknown): TrainingContext {
  const body = asRecord(source);
  const language = validateLanguage(body.language);
  const dialect = getDialectInfo(language, typeof body.dialect === 'string' ? body.dialect : '');
  const domain = getDomainInfo((typeof body.domain === 'string' ? body.domain : '') as MilitaryDomain);
  return {
    language,
    langName: language === 'es' ? 'Spanish' : 'Portuguese',
    dialectId: dialect.id,
    dialectLabel: dialect.label,
    domainId: domain.id,
    domainLabel: domain.label,
  };
}
