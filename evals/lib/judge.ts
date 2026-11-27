import {Type} from '@google/genai';
import {MODELS} from '../../server/config.ts';
import {BUDGETS, ThinkingLevel, type GenerateStructured} from '../../server/gemini.ts';

export {Type};

type Schema = Parameters<GenerateStructured>[0]['responseSchema'];

/**
 * Judge / simulator call. Uses MODELS.chat for judges (a different model from the MODELS.standard generator
 * under test) and MODELS.fastLookup for cheap simulation. Model IDs come from server/config.ts untouched.
 */
export async function ask(
  generate: GenerateStructured,
  options: {
    role: 'judge' | 'sim';
    system?: string;
    contents: string;
    schema: Schema;
    thinking?: ThinkingLevel;
  }
): Promise<Record<string, unknown>> {
  return generate({
    model: options.role === 'judge' ? MODELS.chat : MODELS.fastLookup,
    contents: options.contents,
    systemInstruction: options.system,
    thinkingLevel: options.thinking ?? (options.role === 'judge' ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL),
    responseSchema: options.schema,
    emptyMessage: 'Empty eval helper response.',
    budget: BUDGETS.standard,
  });
}

export const bool = (v: unknown): boolean => v === true;
export const str = (v: unknown): string => (typeof v === 'string' ? v : '');
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
