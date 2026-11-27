import type {GoogleGenAI} from '@google/genai';
import {MODELS} from '../../server/config.ts';
import {createGeminiGenerator, type GenerateStructured, type StructuredPromptRequest} from '../../server/gemini.ts';
import {Budget, BudgetExceededError, estimateCostUsd, estimateTokens, roleOfModel} from './budget.ts';
import {hashInput, type ResponseCache} from './cache.ts';

export {BudgetExceededError};

/** What a feature needs to talk to models. Tests inject a fake `live`. */
export interface Runtime {
  budget: Budget;
  cache: ResponseCache;
  /** Performs one real (or fake, in tests) structured generation. Only called on cache misses. */
  live: GenerateStructured;
}

export interface CallContext {
  feature: string;
  /** Distinguishes intentionally repeated samples of an identical prompt (e.g. 10 scenarios per level). */
  itemId: string;
}

export interface CallRecord {
  model: string;
  cached: boolean;
  /** The raw parsed model JSON, before any server-side sanitising. */
  raw: Record<string, unknown>;
  request: Pick<StructuredPromptRequest, 'model' | 'contents' | 'systemInstruction'>;
}

const THINKING_OUT_TOKENS: Record<string, number> = {MINIMAL: 0, LOW: 300, MEDIUM: 1200, HIGH: 3000};

/**
 * Wraps a generator with the response cache and budget. The wrapped function is what gets handed to the
 * app's routes (as `generate`) and to eval-side helper calls (candidate simulator, judges, blind answerers).
 */
export function createEvalGenerator(rt: Runtime, ctx: CallContext, records?: CallRecord[]): GenerateStructured {
  return async (request) => {
    const key = hashInput({
      model: request.model,
      system: request.systemInstruction ?? '',
      contents: request.contents,
      thinking: String(request.thinkingLevel),
      schema: request.responseSchema,
      item: ctx.itemId,
    });
    const record = (raw: Record<string, unknown>, cached: boolean) =>
      records?.push({
        model: request.model,
        cached,
        raw,
        request: {model: request.model, contents: request.contents, systemInstruction: request.systemInstruction},
      });

    const hit = rt.cache.get(key);
    if (hit) {
      rt.budget.recordCacheHit(ctx.feature);
      record(hit, true);
      return hit;
    }

    const role = roleOfModel(request.model);
    const inTok = estimateTokens(`${request.systemInstruction ?? ''}${request.contents}`) + 150;
    const outTok = 700 + (THINKING_OUT_TOKENS[String(request.thinkingLevel).toUpperCase()] ?? 300);
    const reserved = estimateCostUsd(role, inTok, outTok);
    rt.budget.reserve(ctx.feature, reserved);
    try {
      const result = await rt.live(request);
      const actualOut =
        estimateTokens(JSON.stringify(result)) +
        (THINKING_OUT_TOKENS[String(request.thinkingLevel).toUpperCase()] ?? 300);
      rt.budget.settle(ctx.feature, reserved, estimateCostUsd(role, inTok, actualOut));
      rt.cache.set(key, result);
      record(result, false);
      return result;
    } catch (err) {
      rt.budget.settle(ctx.feature, reserved, reserved * 0.25);
      throw err;
    }
  };
}

/**
 * The real generator: the server's own createGeminiGenerator (same retry/timeout/parse path as production).
 * The client is wrapped so every HTTP attempt, including retries, counts against the call cap.
 */
export function createLiveGenerator(getClient: () => GoogleGenAI, budget: Budget): GenerateStructured {
  const counted = () => {
    const ai = getClient();
    return {
      models: {
        generateContent: (params: Parameters<GoogleGenAI['models']['generateContent']>[0]) => {
          budget.attempts += 1;
          return ai.models.generateContent(params);
        },
      },
    } as unknown as GoogleGenAI;
  };
  return createGeminiGenerator(counted);
}

export type ModelName = (typeof MODELS)[keyof typeof MODELS];
