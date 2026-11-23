import type {GenerateStructured} from '../gemini.ts';

export interface RouteDeps {
  /** Structured-JSON model call; injected so routes can be tested without Gemini. */
  generate: GenerateStructured;
}
