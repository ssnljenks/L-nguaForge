import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type {AddressInfo} from 'net';
import type {GoogleGenAI} from '@google/genai';
import {WebSocket} from 'ws';
import {loadConfig, type ServerConfig} from './config.ts';
import {attachLiveBridge, type LiveBridgeDeps, TALK_NOTE_LIMITS, TalkNoteBudget} from './live.ts';

interface FakeLive {
  connectCalls: Array<{config: {systemInstruction?: string}}>;
  sentAudio: string[];
  sentText: string[];
  emit: (message: unknown) => void;
}

const servers: http.Server[] = [];
after(() => servers.forEach((s) => s.close()));

async function startBridge(overrides: Partial<ServerConfig> = {}, analyzeTalkTurn?: LiveBridgeDeps['analyzeTalkTurn']) {
  const fake: FakeLive = {connectCalls: [], sentAudio: [], sentText: [], emit: () => {}};
  const client = {
    live: {
      connect: async (params: {config: {systemInstruction?: string}; callbacks: {onmessage: (m: unknown) => void}}) => {
        fake.connectCalls.push(params);
        fake.emit = params.callbacks.onmessage;
        return {
          sendRealtimeInput: (input: {audio: {data: string}}) => fake.sentAudio.push(input.audio.data),
          sendClientContent: (c: {turns: {parts: {text: string}[]}[]}) => fake.sentText.push(c.turns[0].parts[0].text),
          close: () => {},
        };
      },
    },
  } as unknown as GoogleGenAI;
  const server = http.createServer();
  servers.push(server);
  const config = {...loadConfig({TRUST_PROXY: '0'}), ...overrides};
  attachLiveBridge(server, config, {getClient: () => client, analyzeTalkTurn});
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address() as AddressInfo;
  return {fake, url: `ws://127.0.0.1:${port}/ws/live`, origin: `http://127.0.0.1:${port}`};
}

interface Received {
  json: Record<string, unknown>[];
  binary: Buffer[];
}

function connect(url: string, origin?: string): Promise<{ws: WebSocket; received: Received}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, origin ? {headers: {Origin: origin}} : {});
    const received: Received = {json: [], binary: []};
    ws.on('message', (data, isBinary) => {
      if (isBinary) received.binary.push(data as Buffer);
      else received.json.push(JSON.parse(String(data)));
    });
    ws.once('open', () => resolve({ws, received}));
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.once('error', reject);
  });
}

async function waitFor(check: () => boolean, label: string) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail(`timed out waiting for ${label}`);
}

test('rejects upgrades from other origins', async () => {
  const {url} = await startBridge();
  await assert.rejects(connect(url), /HTTP 403/);
  await assert.rejects(connect(url, 'https://evil.example'), /HTTP 403/);
});

test('binary mic frames are forwarded and binary audio is returned when requested', async () => {
  const {fake, url, origin} = await startBridge();
  const {ws, received} = await connect(url, origin);
  ws.send(JSON.stringify({type: 'start', language: 'es', dialect: 'rioplatense', binaryAudio: true}));
  await waitFor(() => received.json.some((m) => m.type === 'ready'), 'ready');
  assert.match(fake.connectCalls[0].config.systemInstruction ?? '', /Rioplatense/);

  const pcm = Buffer.from(new Int16Array([1, -2, 300]).buffer);
  ws.send(pcm, {binary: true});
  ws.send(Buffer.from([1, 2, 3]), {binary: true}); // odd length: not valid PCM16, dropped
  await waitFor(() => fake.sentAudio.length === 1, 'forwarded audio');
  assert.equal(fake.sentAudio[0], pcm.toString('base64'));

  const modelPcm = Buffer.from([10, 0, 20, 0]);
  fake.emit({serverContent: {modelTurn: {parts: [{inlineData: {data: modelPcm.toString('base64')}}]}}});
  await waitFor(() => received.binary.length === 1, 'binary audio');
  assert.deepEqual(received.binary[0], modelPcm);
  ws.close();
});

test('legacy clients still get JSON/base64 audio', async () => {
  const {fake, url, origin} = await startBridge();
  const {ws, received} = await connect(url, origin);
  ws.send(JSON.stringify({type: 'start', language: 'pt'}));
  await waitFor(() => received.json.some((m) => m.type === 'ready'), 'ready');
  ws.send(JSON.stringify({type: 'audio', data: 'AAAA'}));
  await waitFor(() => fake.sentAudio.length === 1, 'legacy audio');
  fake.emit({serverContent: {modelTurn: {parts: [{inlineData: {data: 'BBBB'}}]}}});
  await waitFor(() => received.json.some((m) => m.type === 'audio'), 'json audio');
  assert.equal(received.binary.length, 0);
  ws.close();
});

test('enforces the per-IP concurrent session cap', async () => {
  const {url, origin} = await startBridge({maxLiveSessionsPerIp: 1});
  const first = await connect(url, origin);
  const second = await connect(url, origin);
  const closeCode = await new Promise<number>((resolve) => second.ws.once('close', resolve));
  assert.equal(closeCode, 1013);
  assert.match(String(second.received.json[0]?.error), /maximum number of live voice sessions/);
  first.ws.close();
});

test('Talk live session builds tutor system prompt and emits talk_note on turnComplete', async () => {
  const {fake, url, origin} = await startBridge({maxLiveSessionsPerIp: 4}, async (_ctx, userText, tutorText) => ({
    recastNote:
      userText.includes('trabajo') && tutorText.includes('laburo')
        ? 'He recast you: porteños say laburo for trabajo.'
        : undefined,
    pickedUp: [{term: 'laburo', meaning: 'work / job', regionTag: 'Rioplatense', kind: 'word'}],
  }));
  const {ws, received} = await connect(url, origin);
  ws.send(
    JSON.stringify({
      type: 'start',
      language: 'es',
      dialect: 'rioplatense',
      tutorId: 'es-ba-mateo',
      sceneId: 'asado',
      workTalk: false,
      domain: 'maritime_surveillance',
      slangLevel: 3,
      correctionMode: 'recast',
      binaryAudio: true,
    })
  );
  await waitFor(() => received.json.some((m) => m.type === 'ready'), 'ready');
  const prompt = fake.connectCalls[0].config.systemInstruction ?? '';
  assert.match(prompt, /Mateo/);
  assert.match(prompt, /Buenos Aires/);
  assert.ok(!prompt.includes('Maritime Surveillance'));

  fake.emit({serverContent: {inputTranscription: {text: 'Tengo mucho trabajo hoy.'}}});
  fake.emit({serverContent: {outputTranscription: {text: '¡Qué laburo, che!'}}});
  fake.emit({serverContent: {turnComplete: true}});

  await waitFor(() => received.json.some((m) => m.type === 'talk_note'), 'talk_note');
  const note = received.json.find((m) => m.type === 'talk_note');
  assert.match(String(note?.recastNote), /laburo/);
  assert.equal((note?.pickedUp as unknown[])?.length, 1);
  ws.close();
});

test('typed live text with classification markings is rejected without ending the call (REVIEW H-4)', async () => {
  const {fake, url, origin} = await startBridge();
  const {ws, received} = await connect(url, origin);
  ws.send(JSON.stringify({type: 'start', language: 'es'}));
  await waitFor(() => received.json.some((m) => m.type === 'ready'), 'ready');

  ws.send(JSON.stringify({type: 'text', text: 'Resumen SECRET//NOFORN del informe'}));
  await waitFor(() => received.json.some((m) => m.type === 'text_rejected'), 'text_rejected');
  assert.equal(fake.sentText.length, 0, 'marked text never reaches Gemini');
  assert.ok(!received.json.some((m) => m.type === 'error' || m.type === 'closed'), 'session stays open');

  ws.send(JSON.stringify({type: 'text', text: 'Hola, ¿qué tal?'}));
  await waitFor(() => fake.sentText.length === 1, 'clean text forwarded');
  assert.equal(fake.sentText[0], 'Hola, ¿qué tal?');
  ws.close();
});

test('TalkNoteBudget allows a burst, refills slowly and has a hard cap (REVIEW M-8)', () => {
  let now = 0;
  const budget = new TalkNoteBudget({burst: 2, refillMs: 1000, maxPerSession: 3}, () => now);
  assert.equal(budget.tryTake(), true);
  assert.equal(budget.tryTake(), true);
  assert.equal(budget.tryTake(), false, 'burst spent');
  now = 999;
  assert.equal(budget.tryTake(), false, 'not refilled yet');
  now = 1000;
  assert.equal(budget.tryTake(), true, 'one refilled');
  now = 100_000;
  assert.equal(budget.tryTake(), false, 'hard cap per session');
});

async function startTalk(analyzeTalkTurn: LiveBridgeDeps['analyzeTalkTurn']) {
  const bridge = await startBridge({maxLiveSessionsPerIp: 8}, analyzeTalkTurn);
  const {ws, received} = await connect(bridge.url, bridge.origin);
  ws.send(JSON.stringify({type: 'start', language: 'es', dialect: 'rioplatense', tutorId: 'es-ba-mateo'}));
  await waitFor(() => received.json.some((m) => m.type === 'ready'), 'ready');
  const turn = (user: string, tutor = '¡Qué bueno, che! Contame más.') => {
    bridge.fake.emit({serverContent: {inputTranscription: {text: user}}});
    bridge.fake.emit({serverContent: {outputTranscription: {text: tutor}}});
    bridge.fake.emit({serverContent: {turnComplete: true}});
  };
  return {ws, received, turn};
}

test('very short learner turns get no Talk note model call (REVIEW M-8)', async () => {
  let calls = 0;
  const {ws, turn} = await startTalk(async () => {
    calls++;
    return {pickedUp: []};
  });
  for (const short of ['Sí.', 'Ok', 'No sé', '  ', '¡Claro!']) turn(short);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls, 0);
  turn('Ayer fui al mercado con mi hermana.');
  await waitFor(() => calls === 1, 'note for a real turn');
  ws.close();
});

test('Talk notes are capped per connection, with one in flight at a time (REVIEW M-8)', async () => {
  let calls = 0;
  let release: () => void = () => {};
  const {ws, turn} = await startTalk(async () => {
    calls++;
    await new Promise<void>((r) => (release = r));
    return {pickedUp: []};
  });
  turn('Primera frase bastante larga.');
  turn('Segunda frase bastante larga.');
  await waitFor(() => calls === 1, 'first note');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls, 1, 'second turn skipped while a note is in flight');

  // Rapid turns: only the burst is spent, however many turns arrive.
  for (let i = 0; i < 20; i++) {
    release();
    await new Promise((r) => setTimeout(r, 2));
    turn(`Otra frase número ${i} con varias palabras.`);
    await new Promise((r) => setTimeout(r, 2));
  }
  release();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls, TALK_NOTE_LIMITS.burst);
  ws.close();
});
