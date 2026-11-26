import type {IncomingMessage, Server} from 'http';
import {type GoogleGenAI, type LiveServerMessage, Modality} from '@google/genai';
import {type RawData, WebSocket, WebSocketServer} from 'ws';
import type {ChatRegisterMode} from '../src/types.ts';
import {CLASSIFICATION_REJECT_MESSAGE, findClassificationMarkingInTexts} from '../src/utils/classificationGuard.ts';
import {mergeTranscriptChunk} from '../src/utils/liveAudio.ts';
import {LIVE_WS_MAX_PAYLOAD_BYTES, MODELS, type ServerConfig, VALID_LIVE_VOICES} from './config.ts';
import {toPublicError} from './errors.ts';
import {createGeminiGenerator, getAiClient, getLiveAiClient} from './gemini.ts';
import {getClientIp, isAllowedWebSocketOrigin, rejectUpgrade} from './security.ts';
import {
  analyzeLiveTalkTurn,
  buildTalkSystemPrompt,
  type LiveTalkTurnNote,
  resolveTalkSessionContext,
  type TalkSessionContext,
} from './talkPrompt.ts';
import {resolveTrainingContext, sanitizeString, validateRegisterMode} from './validation.ts';

/**
 * Real-time Gemini Live bidirectional voice bridge on /ws/live.
 *
 * Protocol (client -> server):
 *   {type:'start', language, dialect, domain?, tutorId?, sceneId?, workTalk?, slangLevel?, correctionMode?, registerMode?, voiceName, binaryAudio?}
 *   binary frame                     16 kHz mono Int16 little-endian PCM (mic audio)
 *   {type:'audio', data:<base64>}    legacy mic audio (older cached clients)
 *   {type:'text', text}              typed turn
 *   {type:'stop'}
 * Protocol (server -> client):
 *   {type:'ready'|'input_transcript'|'output_transcript'|'talk_note'|'interrupted'|'turn_complete'|'error'|'closed', ...}
 *   binary frame (if start.binaryAudio) or {type:'audio', data:<base64>}: 24 kHz mono Int16 PCM
 */

type LiveSession = Awaited<ReturnType<GoogleGenAI['live']['connect']>>;

const LIVE_REGISTER_GUIDANCE: Record<ChatRegisterMode, string> = {
  everyday:
    'Keep your speech relaxed, warm, and natural for everyday back-and-forth conversation, using authentic regional phrasing.',
  debate: 'Engage in natural, thought-provoking discussion with nuanced perspectives and hypothetical follow-ups.',
  professional: 'Maintain a natural, collegial conversational tone, like talking with a fluent partner.',
};

const START_TIMEOUT_MS = 30_000;

export interface LiveBridgeDeps {
  getClient: () => GoogleGenAI;
  analyzeTalkTurn?: (ctx: TalkSessionContext, userText: string, tutorText: string) => Promise<LiveTalkTurnNote>;
}

function buildSessionInstruction(msg: Record<string, unknown>): {
  systemInstruction: string;
  voiceName: string;
  talkContext: TalkSessionContext | null;
} {
  const rawVoice = sanitizeString(msg.voiceName, 40);
  const voiceName = (VALID_LIVE_VOICES as readonly string[]).includes(rawVoice) ? rawVoice : 'Zephyr';

  if (typeof msg.tutorId === 'string' && msg.tutorId.trim()) {
    const talkContext = resolveTalkSessionContext(msg);
    return {
      systemInstruction: buildTalkSystemPrompt(talkContext, {channel: 'live'}),
      voiceName,
      talkContext,
    };
  }

  const {langName, dialectLabel, domainLabel} = resolveTrainingContext(msg);
  const registerMode = validateRegisterMode(msg.registerMode);
  const systemInstruction = `You are a natural, warm, native ${langName} (${dialectLabel}) voice conversation partner.
Speak strictly in ${langName} (${dialectLabel}) in a natural, conversational spoken cadence (2 to 4 crisp sentences per turn) so the back-and-forth flows just like a real phone call or live chat.
${LIVE_REGISTER_GUIDANCE[registerMode]}
The user's current operational domain context is "${domainLabel}", which you can touch on if they bring it up, or follow any topic they want to talk about.
If the user asks how to say something in ${langName} or slips into English for a word, smoothly give them the natural ${langName} expression in-voice and keep the conversation moving naturally without lecturing.
Greet the user briefly in ${langName} as soon as they speak, and always invite their next reply.`;
  return {systemInstruction, voiceName, talkContext: null};
}

const defaultAnalyzeTalkTurn: NonNullable<LiveBridgeDeps['analyzeTalkTurn']> = (ctx, userText, tutorText) =>
  analyzeLiveTalkTurn({
    ctx,
    userText,
    tutorText,
    generate: createGeminiGenerator(getAiClient),
  });

export function attachLiveBridge(
  httpServer: Server,
  config: ServerConfig,
  deps: LiveBridgeDeps = {getClient: getLiveAiClient, analyzeTalkTurn: defaultAnalyzeTalkTurn}
): WebSocketServer {
  const liveWss = new WebSocketServer({noServer: true, maxPayload: LIVE_WS_MAX_PAYLOAD_BYTES});
  const connectionsByIp = new Map<string, number>();
  let connectionCount = 0;

  httpServer.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname !== '/ws/live') {
      // Non-/ws/live upgrade requests (such as Vite dev HMR) are left untouched
      return;
    }
    if (!isAllowedWebSocketOrigin(request, config)) {
      console.warn('[live] rejected WebSocket upgrade from origin:', request.headers.origin ?? '(none)');
      rejectUpgrade(socket, 403, 'Forbidden');
      return;
    }
    liveWss.handleUpgrade(request, socket, head, (ws) => {
      liveWss.emit('connection', ws, request);
    });
  });

  liveWss.on('connection', (clientWs: WebSocket, request: IncomingMessage) => {
    const clientIp = getClientIp(request, config.trustProxyHops);
    let liveSession: LiveSession | null = null;
    let isClosing = false;
    let sessionStarted = false;
    let binaryAudio = false;
    let sessionTimer: NodeJS.Timeout | null = null;
    let activeTalkContext: TalkSessionContext | null = null;
    let currentUserTranscript = '';
    let currentTutorTranscript = '';

    const sendJson = (payload: Record<string, unknown>) => {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify(payload));
    };

    const sendAudio = (base64Pcm: string) => {
      if (clientWs.readyState !== WebSocket.OPEN) return;
      if (binaryAudio) clientWs.send(Buffer.from(base64Pcm, 'base64'), {binary: true});
      else clientWs.send(JSON.stringify({type: 'audio', data: base64Pcm}));
    };

    // Concurrency caps protect the Gemini quota: live audio sessions are the most expensive calls.
    const ipCount = connectionsByIp.get(clientIp) ?? 0;
    if (connectionCount >= config.maxLiveSessions || ipCount >= config.maxLiveSessionsPerIp) {
      sendJson({
        type: 'error',
        error:
          ipCount >= config.maxLiveSessionsPerIp
            ? 'You already have the maximum number of live voice sessions open. Close another session and try again.'
            : 'Live voice is at capacity right now. Please try again in a few minutes.',
      });
      clientWs.close(1013, 'Try again later');
      return;
    }
    connectionCount += 1;
    connectionsByIp.set(clientIp, ipCount + 1);
    let released = false;
    const releaseSlot = () => {
      if (released) return;
      released = true;
      connectionCount = Math.max(0, connectionCount - 1);
      const remaining = (connectionsByIp.get(clientIp) ?? 1) - 1;
      if (remaining > 0) connectionsByIp.set(clientIp, remaining);
      else connectionsByIp.delete(clientIp);
    };

    // Drop sockets that never send a start message.
    const startTimeout = setTimeout(() => {
      if (!sessionStarted) clientWs.close(1008, 'Session start timeout');
    }, START_TIMEOUT_MS);

    const closeLiveSession = () => {
      if (isClosing) return;
      isClosing = true;
      clearTimeout(startTimeout);
      if (sessionTimer) {
        clearTimeout(sessionTimer);
        sessionTimer = null;
      }
      releaseSlot();
      if (liveSession) {
        try {
          liveSession.close();
        } catch {
          // Ignore close errors
        }
        liveSession = null;
      }
    };

    const forwardAudio = (base64Pcm: string) => {
      if (!liveSession || !base64Pcm) return;
      try {
        liveSession.sendRealtimeInput({audio: {data: base64Pcm, mimeType: 'audio/pcm;rate=16000'}});
      } catch {
        // Ignore frames sent during teardown
      }
    };

    const maybeEmitTalkNote = () => {
      const ctx = activeTalkContext;
      const analyzer = deps.analyzeTalkTurn ?? defaultAnalyzeTalkTurn;
      const userSnap = currentUserTranscript.trim();
      const tutorSnap = currentTutorTranscript.trim();
      if (!tutorSnap) return;
      currentUserTranscript = '';
      currentTutorTranscript = '';
      if (!ctx || isClosing) return;

      void analyzer(ctx, userSnap, tutorSnap)
        .then((note) => {
          if (isClosing || clientWs.readyState !== WebSocket.OPEN) return;
          if (note.recastNote || note.pickedUp.length > 0) {
            sendJson({
              type: 'talk_note',
              ...(note.recastNote ? {recastNote: note.recastNote} : {}),
              pickedUp: note.pickedUp,
            });
          }
        })
        .catch(() => {
          // Side-note extraction is best-effort and must never disrupt the voice stream
        });
    };

    const startSession = async (msg: Record<string, unknown>) => {
      if (liveSession || sessionStarted || isClosing) return;
      sessionStarted = true;
      binaryAudio = msg.binaryAudio === true;
      clearTimeout(startTimeout);
      try {
        const {systemInstruction, voiceName, talkContext} = buildSessionInstruction(msg);
        activeTalkContext = talkContext;
        const session = await deps.getClient().live.connect({
          model: MODELS.live,
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {voiceConfig: {prebuiltVoiceConfig: {voiceName}}},
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            systemInstruction,
          },
          callbacks: {
            onmessage: (message: LiveServerMessage) => {
              const content = message.serverContent;
              if (content?.inputTranscription?.text) {
                currentUserTranscript = mergeTranscriptChunk(currentUserTranscript, content.inputTranscription.text);
                sendJson({type: 'input_transcript', text: content.inputTranscription.text});
              }
              if (content?.outputTranscription?.text) {
                currentTutorTranscript = mergeTranscriptChunk(currentTutorTranscript, content.outputTranscription.text);
                sendJson({type: 'output_transcript', text: content.outputTranscription.text});
              }
              for (const part of content?.modelTurn?.parts ?? []) {
                if (part.inlineData?.data) sendAudio(part.inlineData.data);
              }
              if (content?.interrupted) sendJson({type: 'interrupted'});
              if (content?.turnComplete) {
                sendJson({type: 'turn_complete'});
                maybeEmitTalkNote();
              }
            },
            onerror: (err) => {
              sendJson({type: 'error', error: toPublicError(err).message});
            },
            onclose: (event) => {
              const rawEvent = event as {code?: number; reason?: string} | undefined;
              liveSession = null;
              if (rawEvent?.reason) {
                // Upstream close reasons can contain provider details; log them, don't forward them.
                console.warn('[live] Gemini session closed:', rawEvent.code, rawEvent.reason);
              }
              sendJson({type: 'closed', code: typeof rawEvent?.code === 'number' ? rawEvent.code : undefined});
            },
          },
        });

        if (isClosing) {
          session.close();
          return;
        }
        liveSession = session;
        if (config.maxLiveSessionMinutes > 0) {
          sessionTimer = setTimeout(() => {
            sendJson({
              type: 'error',
              error: `Live voice sessions are limited to ${config.maxLiveSessionMinutes} minutes. Tap Start Live Voice to begin a new one.`,
            });
            closeLiveSession();
            clientWs.close(1000, 'Session time limit reached');
          }, config.maxLiveSessionMinutes * 60_000);
        }
        sendJson({type: 'ready', voiceName});
      } catch (err) {
        sendJson({type: 'error', error: toPublicError(err).message});
        closeLiveSession();
      }
    };

    clientWs.on('message', (rawData: RawData, isBinary: boolean) => {
      if (isBinary) {
        const bytes = Array.isArray(rawData) ? Buffer.concat(rawData) : Buffer.from(rawData as ArrayBuffer);
        // PCM16 frames must have an even byte length.
        if (bytes.length > 0 && bytes.length % 2 === 0) forwardAudio(bytes.toString('base64'));
        return;
      }

      let msg: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(rawData.toString());
        if (!parsed || typeof parsed !== 'object') return;
        msg = parsed as Record<string, unknown>;
      } catch {
        return;
      }

      switch (msg.type) {
        case 'start':
          void startSession(msg);
          return;
        case 'audio':
          if (typeof msg.data === 'string') forwardAudio(msg.data);
          return;
        case 'text': {
          const cleanText = sanitizeString(msg.text, 2000);
          // Typed text goes straight to Gemini, so it gets the same guard as REST (REVIEW H-4).
          // Rejection is non-fatal: the voice session keeps running.
          if (cleanText && findClassificationMarkingInTexts([cleanText])) {
            sendJson({type: 'text_rejected', error: CLASSIFICATION_REJECT_MESSAGE});
            return;
          }
          if (cleanText && liveSession) {
            currentUserTranscript = cleanText;
            try {
              liveSession.sendClientContent({turns: [{role: 'user', parts: [{text: cleanText}]}], turnComplete: true});
            } catch {
              // Ignore errors during teardown
            }
          }
          return;
        }
        case 'stop':
          closeLiveSession();
          return;
        default:
          return;
      }
    });

    clientWs.on('close', closeLiveSession);
    clientWs.on('error', closeLiveSession);
  });

  return liveWss;
}
