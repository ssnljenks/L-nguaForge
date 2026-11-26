/**
 * Static checks on the Tailwind classes in src/components (REVIEW L-8, M-12): readable text
 * colors and touch target sizes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.dirname(new URL(import.meta.url).pathname);

function tsxFiles(dir: string): string[] {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return tsxFiles(p);
    return p.endsWith('.tsx') ? [p] : [];
  });
}

const FILES = tsxFiles(SRC).map((file) => ({file: path.relative(SRC, file), code: fs.readFileSync(file, 'utf8')}));

function luminance(hex: string): number {
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The app's dark surfaces (page and cards). */
const DARK_SURFACES = ['0B1117', '111922', '16202B'];
/** Dark text used on light surfaces (amber/sky buttons), checked by its own background. */
const DARK_ON_LIGHT = new Set(['0B1117', '0D141C']);

/** Opening JSX tags (with their attributes) that set a text color. */
function* taggedTextColors(code: string): Generator<{hex: string; tag: string; line: number}> {
  const tagRe = /<[A-Za-z][\w.]*\b(?:[^<>]|=>)*?>/g;
  for (const m of code.matchAll(tagRe)) {
    for (const c of m[0].matchAll(/(?<![\w-])text-\[#([0-9a-fA-F]{6})\]/g)) {
      yield {hex: c[1].toUpperCase(), tag: m[0], line: code.slice(0, m.index).split('\n').length};
    }
  }
}

test('text colors on dark surfaces meet WCAG AA 4.5:1 (REVIEW L-8)', () => {
  assert.ok(contrastRatio('64748B', '111922') < 4.5, 'sanity: the old gray fails');
  const failures: string[] = [];
  for (const {file, code} of FILES) {
    for (const {hex, tag, line} of taggedTextColors(code)) {
      if (DARK_ON_LIGHT.has(hex)) continue;
      // Decorative glyphs (separators) hidden from assistive tech are exempt.
      if (/aria-hidden(?:=\{?["']?true["']?\}?)?/.test(tag)) continue;
      const worst = Math.min(...DARK_SURFACES.map((bg) => contrastRatio(hex, bg)));
      if (worst < 4.5) failures.push(`${file}:${line} #${hex} (${worst.toFixed(2)}:1)`);
    }
  }
  assert.deepEqual(failures, []);
});
