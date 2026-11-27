import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {GoogleGenAI, Schema} from '@google/genai';
import type {GenerateStructured, StructuredPromptRequest} from './gemini.ts';

/**
 * Deterministic stand-in for Gemini, used only when GEMINI_FAKE=1 (end-to-end tests; never in production,
 * see loadConfig). Only the model call is replaced: routes still validate requests, run the
 * classification guard and post-process the response, and the client parses it as usual.
 *
 * - Each generate() call is answered from server/fixtures/<file>.json, chosen by the call's
 *   `emptyMessage` (unique per call site). An unknown call site throws, so new routes must add a fixture.
 * - A fixture holds `responses`, used in turn (the last one repeats). Strings may contain
 *   `{{quote:LABEL}}`, replaced by the first words of the prompt's fenced LABEL block (so DLPT and gist
 *   quotes are grounded in the real passage).
 * - Every response is checked against the request's responseSchema before it is returned.
 * - /ws/live gets a fake Live client that plays the canned exchange in server/fixtures/live.json.
 */

export const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** Call site (emptyMessage) -> fixture file. */
export const FIXTURE_BY_CALL: Readonly<Record<string, string>> = {
  'Empty response from OPI examiner.': 'opi-turn.json',
  'Empty response while grading redo answer.': 'opi-redo.json',
  'Empty response while generating role-play scenario.': 'roleplay-scenario.json',
  'Empty response from role-play character.': 'roleplay-turn.json',
  'Empty response while grading role-play debrief.': 'roleplay-debrief.json',
  'Empty response from ILR debrief.': 'debrief.json',
  'Empty response from conversation partner.': 'chat-turn.json',
  'Could not retrieve local expressions.': 'talk-locals.json',
  'Could not summarize this conversation.': 'talk-wrap-up.json',
  'Empty turn note.': 'talk-note.json',
  'Empty response from vocabulary lookup.': 'vocab-lookup.json',
  'Empty response from TOT helper.': 'vocab-tot.json',
  'Empty response from sentence evaluator.': 'vocab-evaluate.json',
  'Empty response from PREP prompt generator.': 'lab-prep-prompt.json',
  'Empty response from PREP grader.': 'lab-prep-grade.json',
  'Empty response from briefing generator.': 'lab-interp-briefing.json',
  'Empty response from interpretation grader.': 'lab-interp-grade.json',
  'Empty response while generating 2-minute fix drill.': 'fix-generate.json',
  'Empty response while grading fix drill turn.': 'fix-grade.json',
  'Could not generate DLPT questions for this passage.': 'brief-drill.json',
  'Could not grade the gist summary right now.': 'brief-gist.json',
  'Brief analysis failed.': 'brief-analysis.json',
};

interface Fixture {
  responses: unknown[];
}

export function loadFixture(file: string, dir = FIXTURES_DIR): Fixture {
  const parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as Partial<Fixture>;
  if (!Array.isArray(parsed.responses) || parsed.responses.length === 0) {
    throw new Error(`Fixture ${file} needs a non-empty "responses" array.`);
  }
  return {responses: parsed.responses};
}

/** First `words` words of the prompt block fenced as `<<<BEGIN LABEL id>>> … <<<END LABEL id>>>`. */
function quoteFromPrompt(contents: string, label: string, words = 10): string {
  const block = new RegExp(`<<<BEGIN ${label} \\w+>>>\\n([\\s\\S]*?)\\n<<<END ${label} \\w+>>>`).exec(contents);
  if (!block) throw new Error(`Fake Gemini: prompt has no ${label} block to quote.`);
  return block[1].split(/\s+/).filter(Boolean).slice(0, words).join(' ');
}

function fillTemplates(value: unknown, request: StructuredPromptRequest): unknown {
  if (typeof value === 'string') {
    return value.replace(/\{\{quote:([A-Z_]+)\}\}/g, (_m, label: string) => quoteFromPrompt(request.contents, label));
  }
  if (Array.isArray(value)) return value.map((v) => fillTemplates(v, request));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillTemplates(v, request)]));
  }
  return value;
}

/** Returns schema violations (empty when `value` matches the Gemini response schema). */
export function checkAgainstSchema(value: unknown, schema: Schema, at = '$'): string[] {
  const type = String(schema.type ?? '').toUpperCase();
  switch (type) {
    case 'STRING':
      return typeof value === 'string' ? [] : [`${at}: expected string`];
    case 'INTEGER':
      return Number.isInteger(value) ? [] : [`${at}: expected integer`];
    case 'NUMBER':
      return typeof value === 'number' && Number.isFinite(value) ? [] : [`${at}: expected number`];
    case 'BOOLEAN':
      return typeof value === 'boolean' ? [] : [`${at}: expected boolean`];
    case 'ARRAY':
      if (!Array.isArray(value)) return [`${at}: expected array`];
      return schema.items ? value.flatMap((v, i) => checkAgainstSchema(v, schema.items as Schema, `${at}[${i}]`)) : [];
    case 'OBJECT': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${at}: expected object`];
      const rec = value as Record<string, unknown>;
      const problems = (schema.required ?? []).filter((k) => !(k in rec)).map((k) => `${at}.${k}: required`);
      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        if (key in rec) problems.push(...checkAgainstSchema(rec[key], sub, `${at}.${key}`));
      }
      const extra = Object.keys(rec).filter((k) => !(k in (schema.properties ?? {})));
      return [...problems, ...extra.map((k) => `${at}.${k}: not in schema`)];
    }
    default:
      return [];
  }
}

export type FakeGenerator = GenerateStructured & {
  /** Starts every fixture sequence over (POST /__fixtures/reset, called before each e2e test). */
  reset: () => void;
  /** Model calls answered since the last reset, by fixture file (GET /__fixtures/calls). */
  callCounts: () => Record<string, number>;
};

export function createFakeGenerator(dir = FIXTURES_DIR): FakeGenerator {
  const calls = new Map<string, number>();
  const generate: GenerateStructured = async (request) => {
    const file = FIXTURE_BY_CALL[request.emptyMessage];
    if (!file) throw new Error(`Fake Gemini: no fixture for call site "${request.emptyMessage}".`);
    const {responses} = loadFixture(file, dir);
    const n = calls.get(file) ?? 0;
    calls.set(file, n + 1);
    const response = fillTemplates(responses[Math.min(n, responses.length - 1)], request);
    const problems = checkAgainstSchema(response, request.responseSchema);
    if (problems.length > 0) {
      throw new Error(`Fake Gemini: ${file} does not match the response schema: ${problems.join('; ')}`);
    }
    return response as Record<string, unknown>;
  };
  return Object.assign(generate, {reset: () => calls.clear(), callCounts: () => Object.fromEntries(calls)});
}

// ---------------------------------------------------------------------------
// Live (/ws/live)
// ---------------------------------------------------------------------------

interface LiveTurnFixture {
  /** What the learner "said" (used for mic audio; typed text is echoed as-is). */
  user: string;
  tutor: string;
}

/** 16 kHz mono PCM16 mic audio needed before the fake tutor answers (~0.6 s). */
const MIC_BYTES_PER_TURN = 16_000 * 2 * 0.6;

/** 24 kHz mono PCM16 sine tone, base64 (what Gemini Live returns as model audio). */
export function cannedTutorAudio(seconds = 0.4): string {
  const samples = Math.round(24_000 * seconds);
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / 24_000) * 6000), i * 2);
  }
  return buf.toString('base64');
}

type LiveCallbacks = {onmessage: (message: unknown) => void; onclose?: (event: unknown) => void};

/** A minimal GoogleGenAI stand-in whose live.connect() replays server/fixtures/live.json. */
export function createFakeLiveClient(dir = FIXTURES_DIR): () => GoogleGenAI {
  const {responses} = loadFixture('live.json', dir);
  const turns = responses as LiveTurnFixture[];
  const client = {
    live: {
      connect: async ({callbacks}: {callbacks: LiveCallbacks}) => {
        let turn = 0;
        let micBytes = 0;
        let replying = false;
        let closed = false;
        const reply = (userText: string | null) => {
          if (replying || closed) return;
          replying = true;
          const script = turns[turn % turns.length];
          turn++;
          const emit = (message: unknown) => {
            if (!closed) callbacks.onmessage(message);
          };
          setTimeout(() => {
            if (userText !== null) emit({serverContent: {inputTranscription: {text: userText}}});
            emit({serverContent: {outputTranscription: {text: script.tutor}}});
            emit({
              serverContent: {modelTurn: {parts: [{inlineData: {data: cannedTutorAudio(), mimeType: 'audio/pcm'}}]}},
            });
            setTimeout(() => {
              emit({serverContent: {turnComplete: true}});
              replying = false;
              micBytes = 0;
            }, 400);
          }, 200);
        };
        return {
          sendRealtimeInput: ({audio}: {audio: {data: string}}) => {
            micBytes += Buffer.from(audio.data, 'base64').length;
            if (micBytes >= MIC_BYTES_PER_TURN) reply(turns[turn % turns.length].user);
          },
          // Typed turns: the bridge already records the learner's text; only the tutor answers.
          sendClientContent: () => reply(null),
          close: () => {
            closed = true;
            callbacks.onclose?.({code: 1000});
          },
        };
      },
    },
  };
  return () => client as unknown as GoogleGenAI;
}
