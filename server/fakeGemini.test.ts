import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type {AddressInfo} from 'node:net';
import {Type} from '@google/genai';
import {createApp, jsonErrorHandler} from './app.ts';
import {globalBriefService, type StoredBriefItem} from './briefService.ts';
import {GEMINI_FAKE_IN_PRODUCTION_MESSAGE, loadConfig} from './config.ts';
import {checkAgainstSchema, createFakeGenerator, FIXTURE_BY_CALL, FIXTURES_DIR, loadFixture} from './fakeGemini.ts';
import type {GenerateStructured} from './gemini.ts';

console.error = () => {};

const servers: http.Server[] = [];
after(() => servers.forEach((s) => s.close()));

test('GEMINI_FAKE=1 is refused in production', () => {
  assert.throws(() => loadConfig({NODE_ENV: 'production', GEMINI_FAKE: '1'}), {
    message: GEMINI_FAKE_IN_PRODUCTION_MESSAGE,
  });
  assert.equal(loadConfig({NODE_ENV: 'production'}).geminiFake, false);
  assert.equal(loadConfig({NODE_ENV: 'test', GEMINI_FAKE: '1'}).geminiFake, true);
  assert.equal(loadConfig({NODE_ENV: 'test', SERVE_DIST: '1'}).serveDist, true);
  assert.equal(loadConfig({}).serveDist, false);
});

test('every call site has a loadable fixture', () => {
  for (const file of new Set(Object.values(FIXTURE_BY_CALL))) {
    assert.ok(loadFixture(file).responses.length > 0, file);
  }
  assert.ok(fs.existsSync(path.join(FIXTURES_DIR, 'brief-items.json')));
  assert.ok(fs.existsSync(path.join(FIXTURES_DIR, 'media', 'clip-es.wav')));
});

test('checkAgainstSchema reports type, required and unknown-field problems', () => {
  const schema = {
    type: Type.OBJECT,
    properties: {
      a: {type: Type.STRING},
      n: {type: Type.INTEGER},
      list: {type: Type.ARRAY, items: {type: Type.BOOLEAN}},
    },
    required: ['a', 'n'],
  };
  assert.deepEqual(checkAgainstSchema({a: 'x', n: 1, list: [true]}, schema), []);
  assert.deepEqual(checkAgainstSchema({a: 1, list: ['no'], extra: 1}, schema), [
    '$.n: required',
    '$.a: expected string',
    '$.list[0]: expected boolean',
    '$.extra: not in schema',
  ]);
});

async function startFakeApp() {
  const fake = createFakeGenerator();
  let calls = 0;
  const generate: GenerateStructured = (req) => {
    calls++;
    return fake(req);
  };
  const app = createApp({config: {...loadConfig({TRUST_PROXY: '0', API_RATE_LIMIT_PER_MINUTE: '1000'})}, generate});
  app.use(jsonErrorHandler);
  const server = http.createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address() as AddressInfo;
  const post = async (route: string, body: unknown) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/${route}`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    });
    return {status: res.status, body: (await res.json()) as Record<string, unknown>};
  };
  return {post, calls: () => calls};
}

test('every fixture passes its real route: schema check, validation and post-processing', async () => {
  globalBriefService.useFixtureItems(
    JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'brief-items.json'), 'utf8')) as StoredBriefItem[]
  );
  const {post} = await startFakeApp();
  const es = {language: 'es', dialect: 'neutral_latam'};
  const ok = async (route: string, body: unknown) => {
    const res = await post(route, body);
    assert.equal(res.status, 200, `${route}: ${JSON.stringify(res.body)}`);
    return res.body;
  };

  const opening = await ok('opi/turn', {...es, isOpening: true, topicSource: 'examiner_choice'});
  assert.match(String(opening.examinerText), /día típico/);
  await ok('opi/turn', {...es, userMessage: 'Trabajo en una oficina.', history: [{role: 'examiner', text: 'Hola'}]});
  await ok('opi/redo-turn', {
    ...es,
    examinerPrompt: '¿Qué pasaría?',
    originalAnswer: 'Si cierran, es difícil.',
    redoAnswer: 'Si cerraran, sería difícil.',
    failedFunction: 'l3_hypothesize',
  });
  const debrief = await ok('debrief/analyze', {
    ...es,
    assessments: [
      {functionKey: 'l2_facts', outcome: 'sustained', evidence: 'ok', phase: 'level_check', targetLevel: 2},
    ],
    messages: [
      {role: 'examiner', text: 'Hola'},
      {role: 'candidate', text: 'Hola, trabajo en una oficina.'},
    ],
  });
  assert.ok(debrief.ceilingMoment, 'debrief keeps the fixture ceiling moment');

  const scenario = await ok('opi/roleplay/scenario', {...es, level: 2});
  assert.equal(JSON.stringify(scenario).includes('original receipt'), false, 'hidden goal stays server-side');
  await ok('opi/roleplay/turn', {
    ...es,
    scenarioId: scenario.scenarioId,
    scenarioToken: scenario.scenarioToken,
    level: 2,
    isOpening: true,
    history: [],
  });
  const rpDebrief = await ok('opi/roleplay/debrief', {
    ...es,
    scenarioId: scenario.scenarioId,
    scenarioToken: scenario.scenarioToken,
    level: 2,
    messages: [{role: 'candidate', text: 'Compré este teléfono ayer.'}],
  });
  assert.match(String(rpDebrief.hiddenGoal), /original receipt/);

  await ok('chat/turn', {...es, tutorId: 'es-cdmx-sofia', userMessage: 'Hola'});
  await ok('talk/how-do-locals-say', {...es, tutorId: 'es-cdmx-sofia', englishQuery: 'cool'});
  await ok('talk/wrap-up', {...es, tutorId: 'es-cdmx-sofia', messages: [{role: 'user', text: 'Hola'}]});
  await ok('vocab/lookup', {...es, word: 'chido', contextSentence: 'Qué chido.'});
  await ok('vocab/tot', {...es, englishQuery: 'nevertheless'});
  await ok('vocab/evaluate-sentence', {
    language: 'es',
    targetTerm: 'no obstante',
    userSentence: 'No obstante, seguimos.',
  });
  await ok('lab/prep-prompt', {language: 'es'});
  await ok('lab/grade-prep', {language: 'es', promptTarget: '¿Debería…?', transcript: 'Creo que sí, porque…'});
  await ok('lab/interp-briefing', {language: 'es'});
  await ok('lab/grade-interp', {briefingText: 'Fuente', candidateRendition: 'Render'});
  const fix = await ok('fix/generate', {...es, errorKey: 'si_clause_present_for_subjunctive'});
  assert.equal((fix.prompts as unknown[]).length, 8);
  await ok('fix/grade', {
    ...es,
    errorKey: 'si_clause_present_for_subjunctive',
    promptTarget: '¿Qué harías?',
    userAnswer: 'Si tuviera tiempo, viajaría.',
  });

  // Brief: quotes are grounded in the real fixture transcript, so DLPT validation keeps the items.
  const drill = await ok('brief/drill', {briefId: 'e2e-es-audio-1'});
  assert.equal((drill.questions as unknown[]).length, 3, 'listening drills keep 3 verified questions');
  const reading = await ok('brief/drill', {briefId: 'es-seed-maritime-01'});
  assert.ok((reading.questions as unknown[]).length >= 1);
  const gist = await ok('brief/grade-gist', {briefId: 'e2e-es-audio-1', summary: 'It is because of the war.'});
  assert.equal((gist.additions as {learnerSpan: string}[])[0].learnerSpan, 'because of the war');
});

test('in fake mode the classification guard still blocks before any model call', async () => {
  const {post, calls} = await startFakeApp();
  const before = calls();
  const res = await post('chat/turn', {language: 'es', userMessage: 'SECRET//NOFORN resumen'});
  assert.equal(res.status, 422);
  assert.equal(calls(), before);
  const fine = await post('chat/turn', {
    language: 'es',
    tutorId: 'es-cdmx-sofia',
    userMessage: 'Option (A) is cheaper.',
  });
  assert.equal(fine.status, 200);
});
