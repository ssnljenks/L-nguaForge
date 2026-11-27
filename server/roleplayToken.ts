import crypto from 'node:crypto';
import type {IlrBaseLevel} from '../src/data/ilrSpeakingLevels.ts';
import type {RoleplayRegister, TargetLanguage} from '../src/types.ts';
import {log} from './logger.ts';

/**
 * Sealed role-play scenarios (REVIEW M-3).
 *
 * The scenario's secrets (hiddenGoal, complication) used to live in per-instance memory, so a restart,
 * a second Cloud Run instance or the 45-minute TTL silently swapped the scenario for a generic one
 * mid-conversation. Now the whole record is encrypted into a token the browser stores and sends back
 * with each turn. The browser can't read or alter it (AES-256-GCM), any instance holding the key can
 * open it, and a token that can't be opened is reported as "expired" instead of being replaced.
 *
 * Format: `v1.<base64url(iv ‖ ciphertext ‖ tag)>`;
 */

export const ROLEPLAY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const ROLEPLAY_TOKEN_MAX_LENGTH = 4096;
const VERSION_PREFIX = 'v1.';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const AAD = Buffer.from('linguaforge-roleplay-v1');

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
}

export type OpenResult =
  {ok: true; record: RoleplaySecretRecord} | {ok: false; reason: 'missing' | 'malformed' | 'expired' | 'unreadable'};

export interface RoleplayTokenSealer {
  seal(record: RoleplaySecretRecord, nowMs?: number): string;
  open(token: unknown, nowMs?: number): OpenResult;
  /** True when the key was generated at startup, so tokens do not survive a restart or span instances. */
  readonly ephemeral: boolean;
}

function deriveKey(secret: string): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', secret, 'linguaforge-roleplay-salt', 'roleplay-token-v1', 32));
}

/**
 * `secrets` are comma/space separated: the first seals new tokens, every one can open (rotation).
 * With no secret a random key is generated; fine for one process, but tokens then die with it.
 */
export function createRoleplayTokenSealer(secrets: readonly string[]): RoleplayTokenSealer {
  const cleaned = secrets.map((s) => s.trim()).filter(Boolean);
  const ephemeral = cleaned.length === 0;
  const keys = (ephemeral ? [crypto.randomBytes(32).toString('base64')] : cleaned).map(deriveKey);

  return {
    ephemeral,
    seal(record, nowMs = Date.now()) {
      const iv = crypto.randomBytes(IV_BYTES);
      const cipher = crypto.createCipheriv('aes-256-gcm', keys[0], iv);
      cipher.setAAD(AAD);
      const payload = JSON.stringify({r: record, exp: nowMs + ROLEPLAY_TOKEN_TTL_MS});
      const body = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
      return VERSION_PREFIX + Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64url');
    },
    open(token, nowMs = Date.now()) {
      if (typeof token !== 'string' || !token) return {ok: false, reason: 'missing'};
      if (token.length > ROLEPLAY_TOKEN_MAX_LENGTH || !token.startsWith(VERSION_PREFIX)) {
        return {ok: false, reason: 'malformed'};
      }
      const raw = Buffer.from(token.slice(VERSION_PREFIX.length), 'base64url');
      if (raw.length < IV_BYTES + TAG_BYTES + 2) return {ok: false, reason: 'malformed'};
      const iv = raw.subarray(0, IV_BYTES);
      const tag = raw.subarray(raw.length - TAG_BYTES);
      const body = raw.subarray(IV_BYTES, raw.length - TAG_BYTES);
      for (const key of keys) {
        try {
          const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
          decipher.setAAD(AAD);
          decipher.setAuthTag(tag);
          const json = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
          const parsed = JSON.parse(json) as {r?: RoleplaySecretRecord; exp?: number};
          if (!parsed.r || typeof parsed.exp !== 'number') return {ok: false, reason: 'malformed'};
          if (parsed.exp <= nowMs) return {ok: false, reason: 'expired'};
          return {ok: true, record: parsed.r};
        } catch {
          // Wrong key (or tampered token): try the next key.
        }
      }
      // Sealed by another key (a restart with a random key, or a rotated-out secret) or altered.
      return {ok: false, reason: 'unreadable'};
    },
  };
}

/** Builds the process-wide sealer from ROLEPLAY_TOKEN_SECRET and warns when running with a throwaway key. */
export function createRoleplayTokenSealerFromEnv(env: Record<string, string | undefined> = process.env) {
  const sealer = createRoleplayTokenSealer((env.ROLEPLAY_TOKEN_SECRET ?? '').split(/[,\s]+/));
  if (sealer.ephemeral) {
    log.warn('roleplay_token_key_ephemeral', {
      hint: 'ROLEPLAY_TOKEN_SECRET is not set: role-play scenarios will expire whenever this process restarts.',
    });
  }
  return sealer;
}
