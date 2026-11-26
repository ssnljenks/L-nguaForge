import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type {AddressInfo} from 'net';
import type {GoogleGenAI} from '@google/genai';
import {WebSocket} from 'ws';
import {loadConfig, type ServerConfig} from './config.ts';
import {attachLiveBridge, type LiveBridgeDeps} from './live.ts';

interface FakeLive {
  connectCalls: Array<{config: {systemInstruction?: string}}>;
  sentAudio: string[];
  emit: (message: unknown) => void;
}

const servers: http.Server[] = [];
after(() => servers.forEach((s) => s.close()));

async function startBridge(overrides: Partial<ServerConfig> = {}, analyzeTalkTurn?: LiveBridgeDeps['analyzeTalkTurn']) {
  const fake: FakeLive = {connectCalls: [], sentAudio: [], emit: () => {}};
  const client = {
    live: {
      connect: async (params: {config: {systemInstruction?: string}; callbacks: {onmessage: (m: unknown) => void}}) => {
        fake.connectCalls.push(params);
        fake.emit = params.callbacks.onmessage;
        return {
          sendRealtimeInput: (input: {audio: {data: string}}) => fake.sentAudio.push(input.audio.data),
          sendClientContent: () => {},
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
