import type {Runtime} from './llm.ts';
import type {ModelRole} from './budget.ts';

export interface RunOptions {
  /** Caps dataset size per feature (smoke runs). 0 = full dataset. */
  sample: number;
  concurrency: number;
}

export interface PlanBlock {
  label: string;
  role: ModelRole;
  calls: number;
  avgInTokens: number;
  avgOutTokens: number;
}

export interface Check {
  id: string;
  passed: boolean;
  detail?: string;
}

export interface CaseResult {
  id: string;
  label: string;
  /** Set when the case could not run (budget cap reached). Excluded from pass rate. */
  notRun?: string;
  checks: Check[];
  /** Short excerpt shown in the report when this case fails. */
  example?: string;
}

export interface Threshold {
  label: string;
  passed: boolean;
  detail: string;
}

export interface FeatureResult {
  id: string;
  title: string;
  cases: CaseResult[];
  /** Extra headline numbers (agreement %, off-by-one, detection rate ...). */
  metrics: {label: string; value: string}[];
  thresholds: Threshold[];
  /** Observations that need a native speaker to confirm (never auto-decided). */
  nativeReview: string[];
  notes: string[];
  /** Free-form markdown appended to the feature section (tables, misses). */
  extraMarkdown?: string;
}

export interface Feature {
  id: string;
  title: string;
  plan(opts: RunOptions): PlanBlock[];
  run(rt: Runtime, opts: RunOptions): Promise<FeatureResult>;
}

export const casePassed = (c: CaseResult): boolean => !c.notRun && c.checks.every((k) => k.passed);
