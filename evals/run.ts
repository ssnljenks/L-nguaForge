import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {getAiClient} from '../server/gemini.ts';
import {Budget, BudgetExceededError, estimateCostUsd} from './lib/budget.ts';
import {createFileCache} from './lib/cache.ts';
import {FatalEvalError} from './lib/harness.ts';
import {createLiveGenerator, type Runtime} from './lib/llm.ts';
import {buildMeta, readRun, renderReport, writeRun, type SavedRun} from './lib/report.ts';
import type {FeatureResult, PlanBlock, RunOptions} from './lib/types.ts';
import {casePassed} from './lib/types.ts';
import {FEATURES} from './features/index.ts';

const EVAL_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MAX_CALLS = 1200;
const DEFAULT_MAX_COST_USD = 8;

const {values: args} = parseArgs({
  options: {
    only: {type: 'string'},
    sample: {type: 'string', default: '0'},
    concurrency: {type: 'string', default: '4'},
    'max-calls': {type: 'string'},
    'max-cost': {type: 'string'},
    label: {type: 'string', default: 'latest'},
    compare: {type: 'string'},
    'no-cache': {type: 'boolean', default: false},
    'dry-run': {type: 'boolean', default: false},
    'allow-truncated': {type: 'boolean', default: false},
    strict: {type: 'boolean', default: false},
    help: {type: 'boolean', default: false},
  },
});

if (args.help) {
  console.log(`bun run eval [options]

  --only a,b           feature ids: ${FEATURES.map((f) => f.id).join(', ')}
  --sample N           smoke run: cap each dataset at N items (0 = full)
  --max-calls N        hard cap on live API calls (default ${DEFAULT_MAX_CALLS}, env EVAL_MAX_CALLS)
  --max-cost USD       hard cap on ESTIMATED cost (default ${DEFAULT_MAX_COST_USD}, env EVAL_MAX_COST_USD)
  --concurrency N      parallel items per feature (default 4)
  --label NAME         saves evals/results/NAME.json (default latest)
  --compare FILE       render before/after against a saved run
  --no-cache           ignore and do not write the response cache
  --dry-run            print the plan and exit without any API call
  --allow-truncated    run even if the worst-case plan exceeds the caps
  --strict             exit 1 if any threshold fails`);
  process.exit(0);
}

const opts: RunOptions = {sample: Number(args.sample), concurrency: Math.max(1, Number(args.concurrency))};
const only = args.only ? new Set(args.only.split(',').map((s) => s.trim())) : null;
const selected = FEATURES.filter((f) => !only || only.has(f.id));
if (selected.length === 0) {
  console.error(`No matching features. Available: ${FEATURES.map((f) => f.id).join(', ')}`);
  process.exit(2);
}

const maxCalls = Number(args['max-calls'] ?? process.env.EVAL_MAX_CALLS ?? DEFAULT_MAX_CALLS);
const maxCostUsd = Number(args['max-cost'] ?? process.env.EVAL_MAX_COST_USD ?? DEFAULT_MAX_COST_USD);

function planFor(blocks: PlanBlock[]) {
  const calls = blocks.reduce((n, b) => n + b.calls, 0);
  const cost = blocks.reduce(
    (n, b) => n + estimateCostUsd(b.role, b.calls * b.avgInTokens, b.calls * b.avgOutTokens),
    0
  );
  return {calls, cost};
}

console.log('\nAI quality eval: PLAN (worst case, nothing cached)\n');
console.log('feature'.padEnd(52), 'calls'.padStart(6), 'est. USD'.padStart(9));
let planCalls = 0;
let planCost = 0;
for (const f of selected) {
  const p = planFor(f.plan(opts));
  planCalls += p.calls;
  planCost += p.cost;
  console.log(f.title.slice(0, 51).padEnd(52), String(p.calls).padStart(6), `$${p.cost.toFixed(2)}`.padStart(9));
}
console.log('-'.repeat(68));
console.log('TOTAL'.padEnd(52), String(planCalls).padStart(6), `$${planCost.toFixed(2)}`.padStart(9));
console.log(`CAPS  (hard)`.padEnd(52), String(maxCalls).padStart(6), `$${maxCostUsd.toFixed(2)}`.padStart(9));
console.log(
  '\nCost is an estimate (token counts x the price table in evals/lib/budget.ts). Cached responses are free; the cache lives in evals/.cache.'
);

if (planCalls > maxCalls || planCost > maxCostUsd) {
  console.log('\nWARNING: the worst-case plan exceeds a cap.');
  if (!args['allow-truncated'] && !args['dry-run']) {
    console.log(
      'Nothing was run. Raise the caps, use --only/--sample, or pass --allow-truncated (features run in priority order and later ones are marked NOT RUN when a cap is hit).'
    );
    process.exit(2);
  }
}
if (args['dry-run']) process.exit(0);

if (!process.env.GEMINI_API_KEY?.trim()) {
  console.error('\nGEMINI_API_KEY is not set (put it in .env or the environment). Nothing was run.');
  process.exit(1);
}

const budget = new Budget({maxCalls, maxCostUsd});
const rt: Runtime = {
  budget,
  cache: createFileCache(path.join(EVAL_DIR, '.cache'), !args['no-cache']),
  live: createLiveGenerator(getAiClient, budget),
};

const results: FeatureResult[] = [];
const skipped: {id: string; reason: string}[] = [];
console.log('');
for (const f of selected) {
  const t0 = Date.now();
  process.stdout.write(`running ${f.id} ... `);
  try {
    const r = await f.run(rt, opts);
    results.push(r);
    const run = r.cases.filter((c) => !c.notRun);
    console.log(
      `${run.filter(casePassed).length}/${run.length} cases passed${r.cases.length > run.length ? `, ${r.cases.length - run.length} not run` : ''} (${((Date.now() - t0) / 1000).toFixed(0)}s; ${budget.calls} live calls so far)`
    );
  } catch (err) {
    if (err instanceof FatalEvalError) {
      console.log('ABORTED');
      console.error(`\n${err.message}`);
      process.exit(1);
    }
    if (err instanceof BudgetExceededError) {
      console.log(`stopped: ${err.message}`);
      skipped.push({id: f.id, reason: err.message});
      continue;
    }
    console.log(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
    skipped.push({id: f.id, reason: `crashed: ${err instanceof Error ? err.message : String(err)}`});
  }
}

const run: SavedRun = {meta: buildMeta(args.label!, opts.sample, budget, skipped), features: results};
const file = writeRun(path.join(EVAL_DIR, 'results'), run);
const baseline = args.compare ? readRun(args.compare) : undefined;
fs.writeFileSync(path.join(EVAL_DIR, 'REPORT.md'), renderReport(run, baseline));
console.log(
  `\nspent: ${Math.max(budget.calls, budget.attempts)} live calls, ${budget.cacheHits} cache hits, est. $${budget.costUsd.toFixed(2)}`
);
console.log(`wrote ${path.relative(process.cwd(), file)} and evals/REPORT.md`);
const failed = results.some((r) => r.thresholds.some((t) => !t.passed));
process.exit(args.strict && failed ? 1 : 0);
