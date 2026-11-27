/**
 * Measures the size of the prompt each Gemini-backed route sends for a typical request, using the real route
 * code and prompt builders (answers come from the fixtures, so nothing leaves the machine).
 *
 *   npx tsx scripts/prompt-sizes.ts
 *
 * Input tokens are estimated as characters ÷ 4 (a rough rule for English/Spanish/Portuguese; real counts differ by
 * about ±25%). Real numbers come from the `gemini_call` log lines once the app is running (READINESS.md §3).
 */
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {createApp, jsonErrorHandler} from '../server/app.ts';
import {loadConfig} from '../server/config.ts';
import {createFakeGenerator} from '../server/fakeGemini.ts';
import type {GenerateStructured} from '../server/gemini.ts';
import {setLogSink} from '../server/logger.ts';
import {createRoleplayTokenSealer} from '../server/roleplayToken.ts';
import {analyzeLiveTalkTurn, resolveTalkSessionContext} from '../server/talkPrompt.ts';

const es = {language: 'es', dialect: 'neutral_latam'};
const sentence =
  'El fin de semana pasado fui al mercado con mi familia y compramos fruta, pan y un poco de queso para la cena.';
const examiner = '¿Y qué hicieron después de volver a casa? Cuénteme con detalle lo que pasó esa tarde.';
const turns = (n: number, a: string, b: string, roleA = 'examiner', roleB = 'candidate') =>
  Array.from({length: n}, (_, i) => ({role: i % 2 === 0 ? roleA : roleB, text: i % 2 === 0 ? a : b}));

const sealer = createRoleplayTokenSealer(['sizes']);
const token = sealer.seal({
  scenarioId: 'rp-sizes',
  level: 2,
  language: 'es',
  dialect: 'neutral_latam',
  situationEnglish: 'Your hotel lost your reservation on a busy weekend and you need a room tonight.',
  learnerGoal: 'Get a room for tonight.',
  register: 'usted',
  characterRole: 'Hotel desk clerk',
  hiddenGoal: 'Needs the guest to accept a room under another name.',
  complication: 'The booking exists only under another surname.',
});

const cases: {name: string; path: string; body: unknown}[] = [
  {
    name: 'OPI turn (turn 6, 10-message history)',
    path: 'opi/turn',
    body: {
      ...es,
      phase: 'probe',
      workingLevel: 2,
      probeLevel: 3,
      elapsedSeconds: 420,
      candidateTurnCount: 6,
      history: turns(10, examiner, sentence),
      userMessage: sentence,
    },
  },
  {
    name: 'OPI debrief (12-turn transcript)',
    path: 'debrief/analyze',
    body: {...es, sessionType: 'opi', messages: turns(24, examiner, sentence), assessments: []},
  },
  {name: 'Role-play scenario', path: 'opi/roleplay/scenario', body: {...es, level: 2}},
  {
    name: 'Role-play turn (turn 4)',
    path: 'opi/roleplay/turn',
    body: {
      ...es,
      level: 2,
      scenarioToken: token,
      candidateTurnCount: 4,
      elapsedSeconds: 150,
      history: turns(8, examiner, sentence),
      userMessage: sentence,
    },
  },
  {
    name: 'Role-play debrief',
    path: 'opi/roleplay/debrief',
    body: {...es, level: 2, scenarioToken: token, messages: turns(10, examiner, sentence)},
  },
  {
    name: 'Talk text turn (10-message history)',
    path: 'chat/turn',
    body: {
      ...es,
      tutorId: 'es-cdmx-sofia',
      sceneId: 'tacos',
      history: turns(10, examiner, sentence, 'assistant', 'user'),
      userMessage: sentence,
    },
  },
  {
    name: 'Talk note (after each live turn)',
    path: 'chat/turn',
    body: {...es, tutorId: 'es-cdmx-sofia', userMessage: sentence},
  },
  {
    name: 'Talk wrap-up (20 messages)',
    path: 'talk/wrap-up',
    body: {...es, tutorId: 'es-cdmx-sofia', messages: turns(20, examiner, sentence, 'assistant', 'user')},
  },
  {
    name: 'How do locals say…',
    path: 'talk/how-do-locals-say',
    body: {...es, tutorId: 'es-cdmx-sofia', englishQuery: 'that is awesome'},
  },
  {name: 'Word lookup (tap a word)', path: 'vocab/lookup', body: {...es, word: 'compramos', contextSentence: sentence}},
  {
    name: 'Try-it-out sentence check',
    path: 'vocab/evaluate-sentence',
    body: {...es, targetTerm: 'no obstante', userSentence: sentence},
  },
  {name: '2-min fix: generate 8 prompts', path: 'fix/generate', body: {...es, errorKey: 'por_para'}},
  {
    name: '2-min fix: grade one answer',
    path: 'fix/grade',
    body: {
      ...es,
      errorKey: 'por_para',
      promptTarget: 'La fiesta ___ en mi casa.',
      userAnswer: 'La fiesta es en mi casa.',
    },
  },
  {name: 'PREP prompt', path: 'lab/prep-prompt', body: {...es}},
  {
    name: 'PREP monologue grade',
    path: 'lab/grade-prep',
    body: {
      ...es,
      promptText: 'Describe un problema reciente y cómo lo resolviste.',
      transcript: `${sentence} ${sentence} ${sentence}`,
    },
  },
];

async function main() {
  setLogSink(() => {});
  const fake = createFakeGenerator();
  const sizes: {input: number}[] = [];
  const generate: GenerateStructured = (req) => {
    sizes.push({input: req.contents.length + (req.systemInstruction?.length ?? 0)});
    return fake(req);
  };
  const app = createApp({
    config: {...loadConfig({TRUST_PROXY: '0'}), apiRateLimitPerMinute: 1e6, apiDailyLimitPerIp: 0},
    generate,
    roleplayTokens: sealer,
  });
  app.use(jsonErrorHandler);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address() as AddressInfo;
  console.log('| Call | Input chars | Input tokens (≈ chars ÷ 4) |\n|---|---:|---:|');
  for (const c of cases) {
    sizes.length = 0;
    const res = await fetch(`http://127.0.0.1:${port}/api/${c.path}`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(c.body),
    });
    const input = sizes[0]?.input;
    console.log(
      `| ${c.name} | ${input ?? `(HTTP ${res.status}, no model call)`} | ${input ? Math.round(input / 4) : ''} |`
    );
  }
  // The note written after each Live Talk turn does not go through a route.
  sizes.length = 0;
  await analyzeLiveTalkTurn({
    ctx: resolveTalkSessionContext({...es, tutorId: 'es-cdmx-sofia', sceneId: 'tacos'}),
    userText: sentence,
    tutorText: examiner,
    generate,
  });
  console.log(`| Talk note (after each live voice turn) | ${sizes[0].input} | ${Math.round(sizes[0].input / 4)} |`);
  server.close();
}
void main();
