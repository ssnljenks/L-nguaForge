import fs from 'node:fs';
import {execSync} from 'node:child_process';
import {MODELS} from '../../server/config.ts';
import {priceFor, type Budget} from './budget.ts';
import {REMEDIATION} from './remediation.ts';
import {pct} from './stats.ts';
import type {CaseResult, FeatureResult} from './types.ts';
import {casePassed} from './types.ts';

export interface RunMeta {
  label: string;
  startedAt: string;
  gitSha: string;
  sample: number;
  models: typeof MODELS;
  budget: {
    maxCalls: number;
    maxCostUsd: number;
    calls: number;
    attempts: number;
    cacheHits: number;
    estCostUsd: number;
  };
  byFeature: Record<string, {calls: number; cacheHits: number; costUsd: number}>;
  skipped: {id: string; reason: string}[];
}

export interface SavedRun {
  meta: RunMeta;
  features: FeatureResult[];
}

export function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', {encoding: 'utf8'}).trim();
  } catch {
    return 'unknown';
  }
}

export function buildMeta(label: string, sample: number, budget: Budget, skipped: RunMeta['skipped']): RunMeta {
  return {
    label,
    startedAt: new Date().toISOString(),
    gitSha: gitSha(),
    sample,
    models: MODELS,
    budget: {
      maxCalls: budget.limits.maxCalls,
      maxCostUsd: budget.limits.maxCostUsd,
      calls: budget.calls,
      attempts: budget.attempts,
      cacheHits: budget.cacheHits,
      estCostUsd: budget.costUsd,
    },
    byFeature: Object.fromEntries(budget.byFeature),
    skipped,
  };
}

const rate = (cases: CaseResult[]) => {
  const run = cases.filter((c) => !c.notRun);
  const passed = run.filter(casePassed).length;
  return {passed, run: run.length, notRun: cases.length - run.length};
};

function failureGroups(cases: CaseResult[]) {
  const groups = new Map<string, {count: number; examples: {id: string; detail: string; example?: string}[]}>();
  for (const c of cases) {
    if (c.notRun) continue;
    for (const k of c.checks) {
      if (k.passed) continue;
      const g = groups.get(k.id) ?? {count: 0, examples: []};
      g.count++;
      g.examples.push({id: c.id, detail: k.detail ?? '', example: c.example});
      groups.set(k.id, g);
    }
  }
  return [...groups.entries()].sort((a, b) => b[1].count - a[1].count);
}

function checkTotals(cases: CaseResult[]): Map<string, {failed: number; total: number}> {
  const m = new Map<string, {failed: number; total: number}>();
  for (const c of cases) {
    if (c.notRun) continue;
    for (const k of c.checks) {
      const e = m.get(k.id) ?? {failed: 0, total: 0};
      e.total++;
      if (!k.passed) e.failed++;
      m.set(k.id, e);
    }
  }
  return m;
}

const esc = (s: string) => s.replace(/\|/g, '/').replace(/\n/g, ' ');

export function renderReport(current: SavedRun, baseline?: SavedRun): string {
  const {meta, features} = current;
  const L: string[] = [];
  L.push('# AI quality eval report', '');
  L.push(
    `_Run \`${meta.label}\` · ${meta.startedAt} · commit \`${meta.gitSha}\`${meta.sample ? ` · SAMPLED (--sample ${meta.sample}), not the full datasets` : ''}_`,
    ''
  );
  L.push(
    'These evals call the real Gemini API through the production routes and prompts. They are not part of CI (`bun run eval`).',
    ''
  );
  L.push('## Budget', '');
  L.push(`| | used | cap |`, '|---|---|---|');
  L.push(`| Live calls | ${Math.max(meta.budget.calls, meta.budget.attempts)} | ${meta.budget.maxCalls} |`);
  L.push(
    `| Estimated cost (USD, see note) | $${meta.budget.estCostUsd.toFixed(2)} | $${meta.budget.maxCostUsd.toFixed(2)} |`
  );
  L.push(`| Cache hits (free) | ${meta.budget.cacheHits} | |`, '');
  L.push(
    `Models (unchanged from \`server/config.ts\`): standard \`${meta.models.standard}\`, chat \`${meta.models.chat}\`, fast \`${meta.models.fastLookup}\`. Cost is an ESTIMATE from token counts and the price table in \`evals/lib/budget.ts\` (standard $${priceFor('standard').inPerM}/$${priceFor('standard').outPerM}, chat $${priceFor('chat').inPerM}/$${priceFor('chat').outPerM}, fast $${priceFor('fast').inPerM}/$${priceFor('fast').outPerM} per 1M in/out tokens); verify against current pricing.`,
    ''
  );
  if (meta.skipped.length) L.push(`**Not run:** ${meta.skipped.map((s) => `${s.id} (${s.reason})`).join('; ')}`, '');

  L.push('## Pass rate per feature', '');
  L.push('| Feature | Cases passed | Pass rate | Thresholds | |', '|---|---|---|---|---|');
  for (const f of features) {
    const r = rate(f.cases);
    const thr = f.thresholds.filter((t) => t.passed).length;
    const status = r.notRun ? 'INCOMPLETE' : f.thresholds.every((t) => t.passed) ? 'PASS' : 'FAIL';
    L.push(
      `| ${f.title} | ${r.passed}/${r.run}${r.notRun ? ` (+${r.notRun} not run)` : ''} | ${pct(r.passed, r.run)} | ${thr}/${f.thresholds.length} | **${status}** |`
    );
  }
  L.push(
    '',
    'A case passes only if every one of its checks passes, so pass rates are strict; thresholds are the headline requirements per feature.',
    ''
  );

  if (baseline) {
    L.push(
      '## Before / after',
      '',
      `Baseline \`${baseline.meta.label}\` (commit \`${baseline.meta.gitSha}\`) vs this run \`${meta.label}\` (commit \`${meta.gitSha}\`).`,
      ''
    );
    L.push('| Feature | Before | After | Δ |', '|---|---|---|---|');
    for (const f of features) {
      const b = baseline.features.find((x) => x.id === f.id);
      const a = rate(f.cases);
      if (!b) {
        L.push(`| ${f.title} | n/a | ${pct(a.passed, a.run)} | |`);
        continue;
      }
      const br = rate(b.cases);
      const d = a.run && br.run ? Math.round((100 * a.passed) / a.run - (100 * br.passed) / br.run) : 0;
      L.push(
        `| ${f.title} | ${br.passed}/${br.run} (${pct(br.passed, br.run)}) | ${a.passed}/${a.run} (${pct(a.passed, a.run)}) | ${d > 0 ? '+' : ''}${d} pts |`
      );
    }
    L.push(
      '',
      '**Check-level changes** (failing cases per check):',
      '',
      '| Feature | Check | Before | After |',
      '|---|---|---|---|'
    );
    for (const f of features) {
      const b = baseline.features.find((x) => x.id === f.id);
      if (!b) continue;
      const bt = checkTotals(b.cases);
      const at = checkTotals(f.cases);
      for (const id of new Set([...bt.keys(), ...at.keys()])) {
        const x = bt.get(id);
        const y = at.get(id);
        if ((x?.failed ?? 0) === (y?.failed ?? 0)) continue;
        L.push(
          `| ${f.id} | ${id} | ${x ? `${x.failed}/${x.total}` : 'n/a'} | ${y ? `${y.failed}/${y.total}` : 'n/a'} |`
        );
      }
    }
    L.push(
      '',
      'Cases are sampled from live model output, so small differences (a point or two) are within run-to-run noise; only changes concentrated in the targeted check should be read as effects.',
      ''
    );
  }

  const review: string[] = [];
  for (const f of features) {
    L.push(`## ${f.title}`, '');
    const r = rate(f.cases);
    L.push(
      `**Pass rate: ${r.passed}/${r.run} (${pct(r.passed, r.run)})**${r.notRun ? ` · ${r.notRun} case(s) not run (budget)` : ''}`,
      ''
    );
    if (f.metrics.length)
      L.push('| Metric | Value |', '|---|---|', ...f.metrics.map((m) => `| ${m.label} | ${esc(m.value)} |`), '');
    L.push(
      '| Threshold | Result | Detail |',
      '|---|---|---|',
      ...f.thresholds.map((t) => `| ${t.label} | ${t.passed ? 'pass' : '**FAIL**'} | ${esc(t.detail)} |`),
      ''
    );
    const groups = failureGroups(f.cases);
    if (groups.length) {
      L.push('### Worst failures', '');
      for (const [id, g] of groups.slice(0, 5)) {
        const t = checkTotals(f.cases).get(id)!;
        L.push(`- **\`${id}\`** failed in ${g.count}/${t.total} cases`);
        for (const ex of g.examples.slice(0, 3)) L.push(`  - \`${ex.id}\`: ${esc(ex.detail || ex.example || '')}`);
      }
      L.push('', '### Suggested prompt / schema changes', '');
      const seen = new Set<string>();
      for (const [id] of groups) {
        const fix = REMEDIATION[id];
        if (fix && !seen.has(fix)) {
          seen.add(fix);
          L.push(`- \`${id}\`: ${fix}`);
        }
      }
      L.push('');
    } else if (r.run) {
      L.push('No failing checks.', '');
    }
    if (f.extraMarkdown) L.push(f.extraMarkdown, '');
    if (f.notes.length)
      L.push('<details><summary>Method notes</summary>', '', ...f.notes.map((n) => `- ${n}`), '', '</details>', '');
    review.push(...f.nativeReview.map((n) => `- (${f.id}) ${n}`));
  }

  if (review.length) {
    L.push(
      '## Needs a native speaker',
      '',
      'Nothing below was decided automatically; confirm before acting on a dialect finding.',
      '',
      ...review,
      ''
    );
  }
  return `${L.join('\n')}\n`;
}

export function writeRun(dir: string, run: SavedRun): string {
  fs.mkdirSync(dir, {recursive: true});
  const file = `${dir}/${run.meta.label}.json`;
  fs.writeFileSync(file, JSON.stringify(run, null, 1));
  return file;
}

export function readRun(file: string): SavedRun {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as SavedRun;
}
