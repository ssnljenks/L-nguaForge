/**
 * Guards the startup bundle (REVIEW M-7): walks the static import graph from src/main.tsx (dynamic
 * `import()` and type-only imports are split points) and checks that heavy, on-demand modules are
 * not reachable. The main bundle had grown from ~260 kB to ~554 kB through eager imports of these.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.dirname(new URL(import.meta.url).pathname);

function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.'))
    return `npm:${spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]}`;
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Static, value-level imports and re-exports of a module. */
function staticImports(file: string): string[] {
  const code = fs.readFileSync(file, 'utf8');
  const specs: string[] = [];
  const re = /^\s*(import|export)\s+(type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm;
  for (const m of code.matchAll(re)) {
    if (m[5]) {
      specs.push(m[5]);
      continue;
    }
    if (m[2]) continue; // import type / export type
    const clause = m[3].replace(/\s+/g, ' ');
    // `import {type A, type B} from` is type-only too.
    const named = /^\{(.*)\}$/.exec(clause.trim());
    if (named && named[1].split(',').every((part) => !part.trim() || part.trim().startsWith('type '))) continue;
    specs.push(m[4]);
  }
  return specs;
}

export function startupModules(entry = path.join(SRC, 'main.tsx')): Map<string, string> {
  const parentOf = new Map<string, string>([[entry, '']]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (file.startsWith('npm:') || !/\.(ts|tsx)$/.test(file)) continue;
    for (const spec of staticImports(file)) {
      const target = resolveImport(file, spec);
      if (!target || parentOf.has(target)) continue;
      parentOf.set(target, file);
      queue.push(target);
    }
  }
  return parentOf;
}

const MUST_BE_LAZY = [
  'npm:ts-fsrs',
  'utils/vocabFsrs.ts',
  'utils/localDictionary.ts',
  'data/militaryDictionary.ts',
  'services/dictionaryApi.ts',
  'components/today/TodayModule.tsx',
  'components/today/FixDrillModal.tsx',
  'components/today/VocabWarmupModal.tsx',
  'components/today/RecurringErrorsModal.tsx',
  'utils/todayPlan.ts',
];

test('heavy on-demand modules stay out of the startup bundle (REVIEW M-7)', () => {
  const graph = startupModules();
  for (const mod of MUST_BE_LAZY) {
    const hit = [...graph.keys()].find((f) => f === mod || f.endsWith(`/${mod}`));
    const chain: string[] = [];
    for (let f = hit; f; f = graph.get(f) || undefined) chain.unshift(path.relative(SRC, f));
    assert.equal(hit, undefined, `${mod} is statically reachable from main.tsx: ${chain.join(' -> ')}`);
  }
});
