/**
 * Hard spend cap for live eval runs. Every live (uncached) Gemini call must pass through `reserve()`,
 * which throws BudgetExceededError instead of exceeding either cap. Costs are ESTIMATES: token counts come
 * from the API's usageMetadata when present (else chars/3.5) and prices come from the table below, which
 * you should check against current Google pricing (override per model with EVAL_PRICE_<ROLE>="in,out" in USD per 1M tokens).
 */
import {MODELS} from '../../server/config.ts';

export type ModelRole = 'standard' | 'chat' | 'fast';

export interface Price {
  inPerM: number;
  outPerM: number;
}

const DEFAULT_PRICES: Record<ModelRole, Price> = {
  standard: {inPerM: 0.3, outPerM: 2.5},
  chat: {inPerM: 1.25, outPerM: 10},
  fast: {inPerM: 0.1, outPerM: 0.4},
};

export function roleOfModel(model: string): ModelRole {
  if (model === MODELS.chat) return 'chat';
  if (model === MODELS.fastLookup) return 'fast';
  return 'standard';
}

export function priceFor(role: ModelRole, env: Record<string, string | undefined> = process.env): Price {
  const raw = env[`EVAL_PRICE_${role.toUpperCase()}`];
  if (raw) {
    const [i, o] = raw.split(',').map(Number);
    if (Number.isFinite(i) && Number.isFinite(o)) return {inPerM: i, outPerM: o};
  }
  return DEFAULT_PRICES[role];
}

export function estimateCostUsd(role: ModelRole, inTokens: number, outTokens: number): number {
  const p = priceFor(role);
  return (inTokens * p.inPerM + outTokens * p.outPerM) / 1_000_000;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

export interface FeatureSpend {
  calls: number;
  cacheHits: number;
  costUsd: number;
}

export interface BudgetLimits {
  maxCalls: number;
  maxCostUsd: number;
}

export class Budget {
  readonly limits: BudgetLimits;
  calls = 0;
  /** Raw HTTP attempts (>= calls when the SDK retried). The call cap applies to whichever is larger. */
  attempts = 0;
  cacheHits = 0;
  costUsd = 0;
  /** Cost reserved for calls that have started but not finished. */
  private inFlightUsd = 0;
  readonly byFeature = new Map<string, FeatureSpend>();

  constructor(limits: BudgetLimits) {
    this.limits = limits;
  }

  private feature(name: string): FeatureSpend {
    let f = this.byFeature.get(name);
    if (!f) {
      f = {calls: 0, cacheHits: 0, costUsd: 0};
      this.byFeature.set(name, f);
    }
    return f;
  }

  /** Reserves one live call. Throws (and records nothing) if it would break either cap. */
  reserve(feature: string, estCostUsd: number): void {
    if (Math.max(this.calls, this.attempts) + 1 > this.limits.maxCalls) {
      throw new BudgetExceededError(`call cap reached (${this.limits.maxCalls} live calls)`);
    }
    if (this.costUsd + this.inFlightUsd + estCostUsd > this.limits.maxCostUsd) {
      throw new BudgetExceededError(`cost cap reached (est. $${this.limits.maxCostUsd.toFixed(2)})`);
    }
    this.calls += 1;
    this.inFlightUsd += estCostUsd;
    this.feature(feature).calls += 1;
  }

  settle(feature: string, reservedUsd: number, actualUsd: number): void {
    this.inFlightUsd = Math.max(0, this.inFlightUsd - reservedUsd);
    this.costUsd += actualUsd;
    this.feature(feature).costUsd += actualUsd;
  }

  recordCacheHit(feature: string): void {
    this.cacheHits += 1;
    this.feature(feature).cacheHits += 1;
  }
}
