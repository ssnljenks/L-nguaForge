import type {GenerateStructured} from '../gemini.ts';
import type {RoleplayTokenSealer} from '../roleplayToken.ts';

export interface RouteDeps {
  /** Structured-JSON model call; injected so routes can be tested without Gemini. */
  generate: GenerateStructured;
  /** Seals and opens role-play scenario tokens (REVIEW M-3). */
  roleplayTokens: RoleplayTokenSealer;
}
