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
  for (const {tag, line} of jsxOpeningTags(code, /[A-Za-z][\w.]*/)) {
    for (const c of tag.matchAll(/(?<![\w-])text-\[#([0-9a-fA-F]{6})\]/g)) {
      yield {hex: c[1].toUpperCase(), tag, line};
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

/**
 * Opening JSX tags of the given element names, scanned with brace/string nesting so attribute
 * expressions like `onClick={() => n > 0 && …}` don't end the tag early.
 */
function* jsxOpeningTags(code: string, names: RegExp): Generator<{kind: string; tag: string; line: number}> {
  const start = new RegExp(`<(${names.source})\\b`, 'g');
  for (const m of code.matchAll(start)) {
    let depth = 0;
    let quote: string | null = null;
    let i = m.index + m[0].length;
    for (; i < code.length; i++) {
      const ch = code[i];
      if (quote) {
        if (ch === '\\') i++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth === 0) break;
    }
    yield {kind: m[1], tag: code.slice(m.index, i + 1), line: code.slice(0, m.index).split('\n').length};
  }
}

function interactiveTags(code: string) {
  return jsxOpeningTags(code, /button|a|select|input|textarea/);
}

/** Primary = a solid amber action button (amber in its static classes, or a text-sm amber CTA). */
function isPrimaryButton(tag: string): boolean {
  if (/aria-pressed|aria-selected|role="tab"|role="switch"/.test(tag)) return false;
  if (/\bh-11 w-11\b|\bw-11 h-11\b/.test(tag)) return false; // round icon buttons: 44 px
  const staticClasses = tag.replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, '');
  if (/bg-\[#D99B26\](?!\/)/.test(staticClasses)) return true;
  return /bg-\[#D99B26\](?!\/)/.test(tag) && /\btext-sm\b/.test(staticClasses);
}

test('controls are at least 44 px by default; inline words in running text are exempt (REVIEW M-12)', () => {
  const css = fs.readFileSync(path.join(SRC, 'index.css'), 'utf8');
  const base =
    /button:not\(\.inline\),\s*\[role='button'\],\s*a\[href\],\s*select,\s*textarea,[\s\S]*?\{\s*min-height:\s*44px;\s*\}/.exec(
      css
    );
  assert.ok(base, 'index.css sets a 44 px min-height on controls');
  assert.match(css, /button:not\(\.inline\),\s*\[role='button'\]\s*\{\s*min-width:\s*44px;\s*\}/);
  // Tappable words in running text keep the line height: <button> is inline-block even with
  // display:inline, so the 44 px floor must exclude them explicitly.
  for (const file of ['shared/TappableText.tsx', 'talk/ColloquialTranscriptText.tsx']) {
    const code = FILES.find((f) => f.file === path.join('components', file))?.code ?? '';
    assert.match(code, /className=\{?[`"]inline rounded/, `${file} word buttons use the "inline" class`);
  }

  const failures: string[] = [];
  for (const {file, code} of FILES) {
    for (const {tag, line} of interactiveTags(code)) {
      for (const m of tag.matchAll(/(?<![\w-])(min-h|min-w|max-h)-\[(\d+)px\]/g)) {
        if (Number(m[2]) < 44) failures.push(`${file}:${line} ${m[0]}`);
      }
    }
  }
  assert.deepEqual(failures, []);
});

test('primary buttons are at least 52 px tall (REVIEW M-12)', () => {
  const failures: string[] = [];
  let primaries = 0;
  for (const {file, code} of FILES) {
    for (const {kind, tag, line} of interactiveTags(code)) {
      if (kind !== 'button' || !isPrimaryButton(tag)) continue;
      primaries++;
      const minH = Math.max(0, ...[...tag.matchAll(/min-h-\[(\d+)px\]/g)].map((m) => Number(m[1])));
      if (minH < 52) failures.push(`${file}:${line} min-h ${minH}px`);
    }
  }
  assert.ok(primaries >= 25, `found ${primaries} primary buttons`);
  assert.deepEqual(failures, []);
});

test('toggle switches have a 44 px hit area around the visual track (REVIEW M-12)', () => {
  let switches = 0;
  for (const {code} of FILES) {
    for (const {tag} of interactiveTags(code)) {
      if (!tag.includes('role="switch"')) continue;
      switches++;
      assert.match(tag, /\bh-11\b/);
    }
  }
  assert.equal(switches, 3);
});
