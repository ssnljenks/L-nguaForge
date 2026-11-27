import fs from 'node:fs';

const DATA_DIR = new URL('../data/', import.meta.url);

export function readJson<T>(name: string): T {
  return JSON.parse(fs.readFileSync(new URL(name, DATA_DIR), 'utf8')) as T;
}

export interface OpiTranscript {
  id: string;
  language: 'es' | 'pt';
  dialect: string;
  expected: string;
  tags: string[];
  rationale: string;
  turns: {role: 'examiner' | 'candidate'; text: string}[];
}

/** Parses the human-readable transcript format (see the header of evals/data/opi_transcripts_*.txt). */
export function parseTranscripts(file: string, language: 'es' | 'pt'): OpiTranscript[] {
  const raw = fs.readFileSync(new URL(file, DATA_DIR), 'utf8');
  return raw
    .split(/^### /m)
    .slice(1)
    .map((block) => {
      const [header, ...lines] = block.split('\n');
      const [id, dialect, expected, tags = ''] = header.split('|').map((s) => s.trim());
      const turns: OpiTranscript['turns'] = [];
      let rationale = '';
      for (const line of lines) {
        if (line.startsWith('> ')) rationale = line.slice(2).trim();
        else if (line.startsWith('E: ')) turns.push({role: 'examiner', text: line.slice(3).trim()});
        else if (line.startsWith('C: ')) turns.push({role: 'candidate', text: line.slice(3).trim()});
      }
      return {
        id,
        language,
        dialect,
        expected,
        tags: tags
          .split(/[\s,]+/)
          .map((t) => t.replace(/^(tricky|tags)=/, ''))
          .filter(Boolean),
        rationale,
        turns,
      };
    });
}

export function loadOpiTranscripts(): OpiTranscript[] {
  return [...parseTranscripts('opi_transcripts_es.txt', 'es'), ...parseTranscripts('opi_transcripts_pt.txt', 'pt')];
}

/** Takes the first `n` items (n=0 means all). Used by --sample for cheap smoke runs. */
export function take<T>(items: readonly T[], n: number): T[] {
  return n > 0 ? items.slice(0, n) : [...items];
}

/** Takes up to `n` items spread across the list so every group stays represented. */
export function spread<T>(items: readonly T[], n: number): T[] {
  if (n <= 0 || n >= items.length) return [...items];
  const step = items.length / n;
  return Array.from({length: n}, (_, i) => items[Math.floor(i * step)]);
}
