import {Type} from '@google/genai';
import {
  DEFAULT_SCENE_ID,
  getDefaultTutor,
  getTutorById,
  WORK_TALK_SCENE_ID,
  type TutorPersona,
  type TutorScene,
} from '../src/data/tutors.ts';
import type {MilitaryDomain, TalkCorrectionMode, TalkPickedUpItem, TargetLanguage} from '../src/types.ts';
import {clampSlangLevel, isValidTalkVocabKind} from '../src/utils/talkLogic.ts';
import {MODELS} from './config.ts';
import {BUDGETS, type GenerateStructured, ThinkingLevel} from './gemini.ts';
import {asRecord, asRecordArray, resolveTrainingContext, sanitizeString} from './validation.ts';

export interface TalkSessionContext {
  language: TargetLanguage;
  langName: 'Spanish' | 'Portuguese';
  dialectId: string;
  dialectLabel: string;
  tutor: TutorPersona;
  workTalk: boolean;
  domainId?: MilitaryDomain;
  domainLabel?: string;
  scene: TutorScene;
  slangLevel: 0 | 1 | 2 | 3 | 4;
  correctionMode: TalkCorrectionMode;
}

const SLANG_LEVEL_INSTRUCTIONS: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: 'Slang level 0 (Textbook): Use clean, natural, textbook-clear phrasing with minimal regional slang so every word is easy to follow.',
  1: 'Slang level 1 (Polite casual): Speak warmly and conversationally with light, widely understood everyday expressions.',
  2: 'Slang level 2 (Everyday local): Sound like a relaxed local friend with natural regional idioms and authentic city cadence.',
  3: 'Slang level 3 (Colloquial): Lean into authentic local slang, conversational contractions, and colorful neighborhood expressions.',
  4: 'Slang level 4 (Full street): Go full local street register with rich regional slang, humor, clipped endings, and playful local filler words (while staying kind and conversational).',
};

const CORRECTION_INSTRUCTIONS: Record<TalkCorrectionMode, string> = {
  recast:
    'Correction style (Recast as you go): When the user slips on grammar or uses a stiff/non-local word, naturally echo the corrected or local form inside your reply without interrupting the flow or lecturing. Never give explicit grammar explanations aloud.',
  end_only:
    'Correction style (At the end only): Do NOT correct or mention language mistakes during the chat. Let the conversation flow completely naturally and save brief habit notes for when the user wraps up.',
  off: 'Correction style (Off): Pure conversation with zero corrections, zero recasting feedback, and zero language commentary.',
};

export function validateTalkCorrectionMode(val: unknown): TalkCorrectionMode {
  if (val === 'end_only' || val === 'off' || val === 'recast') return val;
  return 'recast';
}

/**
 * Resolves all Talk settings strictly against server-known tutor/scene/domain definitions.
 * Client-supplied free-text labels are never interpolated into prompts.
 */
export function resolveTalkSessionContext(source: unknown): TalkSessionContext {
  const body = asRecord(source);
  const training = resolveTrainingContext(body);
  const requestedTutor = getTutorById(sanitizeString(body.tutorId, 60));
  const tutor =
    requestedTutor && requestedTutor.language === training.language
      ? requestedTutor
      : getDefaultTutor(training.language, training.dialectId);

  const requestedSceneId = sanitizeString(body.sceneId, 60);
  const workTalk = body.workTalk === true || requestedSceneId === WORK_TALK_SCENE_ID;

  const scene =
    tutor.scenes.find((s) => s.id === requestedSceneId) ??
    tutor.scenes.find((s) => s.id === DEFAULT_SCENE_ID) ??
    tutor.scenes[0];

  const slangLevel = clampSlangLevel(typeof body.slangLevel === 'number' ? body.slangLevel : Number(body.slangLevel));
  const correctionMode = validateTalkCorrectionMode(body.correctionMode);

  return {
    language: training.language,
    langName: training.langName,
    dialectId: tutor.dialectId,
    dialectLabel: training.dialectLabel,
    tutor,
    workTalk,
    ...(workTalk ? {domainId: training.domainId, domainLabel: training.domainLabel} : {}),
    scene,
    slangLevel,
    correctionMode,
  };
}

/**
 * Shared system prompt used by BOTH /ws/live voice sessions and /api/chat/turn typed fallback.
 */
export function buildTalkSystemPrompt(ctx: TalkSessionContext, options: {channel: 'live' | 'text'}): string {
  const {tutor, langName, workTalk, domainLabel, scene, slangLevel, correctionMode} = ctx;
  const examplesLine = tutor.slangExamples
    .slice(0, 5)
    .map((e) => `"${e.term}" (${e.meaning})`)
    .join(', ');

  const topicBlock = workTalk
    ? `SCENE & TOPIC (Work talk — ${domainLabel}):
Hold a focused work conversation in your natural ${tutor.city} (${tutor.regionTag}) dialect about job duties, equipment, procedures, logistics, and day-to-day coordination in "${domainLabel}".
Keep a collegial, professional register by default while retaining your authentic ${tutor.city} accent, pronouns (${tutor.defaultRegister}), and cadence.`
    : `SCENE & TOPIC (${scene.label}):
${scene.promptHint}
IMPORTANT TOPIC BOUNDARY: Stay 100% in everyday civilian life and this scene. NEVER bring up or steer toward military, defense, intelligence, or work/operational topics on your own.`;

  const channelGuidance =
    options.channel === 'live'
      ? `Speak strictly in ${langName} (${tutor.city} / ${tutor.regionTag}) in a crisp, natural spoken cadence (2 to 4 short sentences per turn) so it feels like a real phone call or café chat. Invite the user's reply naturally. When the session starts and the user says hello (or speaks), greet them warmly as ${tutor.name} from ${tutor.city}.`
      : `Your replyText MUST be strictly in ${langName} (${tutor.city} / ${tutor.regionTag}), warm and conversational (2 to 5 sentences), ending with a natural follow-up comment or question.`;

  return `You are ${tutor.name}, a friendly local tutor from ${tutor.city} (${tutor.bio}).
You speak ${langName} in the authentic ${tutor.regionTag} dialect of ${tutor.city}, using "${tutor.defaultRegister}" naturally.
Signature features of your speech: ${tutor.signatureFeatures.join('; ')}.
Natural local expressions you weave in when appropriate: ${examplesLine}.

${SLANG_LEVEL_INSTRUCTIONS[slangLevel]}
${CORRECTION_INSTRUCTIONS[correctionMode]}

${topicBlock}

STRICT NO-EXAM / NO-SCORE RULE:
Never mention ILR levels, scores, ratings, tests, exams, rubrics, or "floor/ceiling" anywhere in your speech or notes. This is relaxed conversation practice with a local friend/tutor.

${channelGuidance}`;
}

export interface LiveTalkTurnNote {
  recastNote?: string;
  pickedUp: TalkPickedUpItem[];
}

export interface AnalyzeLiveTalkTurnParams {
  ctx: TalkSessionContext;
  userText: string;
  tutorText: string;
  generate: GenerateStructured;
}

/**
 * Lightweight background analysis of one completed voice exchange for Talk side notes:
 * detects gentle recast notes (only in 'recast' mode) and 0-2 regional expressions used by the tutor.
 */
export async function analyzeLiveTalkTurn({
  ctx,
  userText,
  tutorText,
  generate,
}: AnalyzeLiveTalkTurnParams): Promise<LiveTalkTurnNote> {
  const cleanTutor = sanitizeString(tutorText, 2000);
  const cleanUser = sanitizeString(userText, 1500);
  if (!cleanTutor) return {pickedUp: []};

  const wantRecast = ctx.correctionMode === 'recast' && cleanUser.length > 0;
  const systemInstruction = `You inspect a single casual ${ctx.langName} (${ctx.tutor.city} / ${ctx.tutor.regionTag}) voice exchange between a learner and tutor ${ctx.tutor.name}.
1. pickedUp: Extract 0 to 2 notable colloquial words or regional expressions actually spoken by ${ctx.tutor.name} in their reply (such as "${ctx.tutor.slangExamples
    .slice(0, 3)
    .map((e) => e.term)
    .join(
      '", "'
    )}" or natural local idioms). Do NOT invent words not present in ${ctx.tutor.name}'s reply. Include concise English meaning and regionTag ("${ctx.tutor.regionTag}" or "Widespread").
2. recastNote: ${
    wantRecast
      ? `If ${ctx.tutor.name} subtly recast a stiff phrase, grammar slip, or non-local word from the learner's line, write ONE brief, encouraging plain-English side note naming ${ctx.tutor.name} or local speakers (e.g., "${ctx.tutor.name} recast you: locals in ${ctx.tutor.city} say laburo for trabajo."). If no recast happened, return "".`
      : 'Always return "" for recastNote.'
  }
Never mention ILR levels, scores, or test grading.`;

  const data = await generate({
    model: MODELS.chat,
    thinkingLevel: ThinkingLevel.MINIMAL,
    systemInstruction,
    contents: `Learner said: ${cleanUser || '(opening greeting)'}\n${ctx.tutor.name} replied: ${cleanTutor}`,
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        recastNote: {type: Type.STRING},
        pickedUp: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              term: {type: Type.STRING},
              meaning: {type: Type.STRING},
              regionTag: {type: Type.STRING},
              kind: {type: Type.STRING},
            },
            required: ['term', 'meaning', 'regionTag', 'kind'],
          },
        },
      },
      required: ['recastNote', 'pickedUp'],
    },
    emptyMessage: 'Empty turn note.',
    budget: BUDGETS.fast,
  });

  const recastNote = wantRecast ? sanitizeString(data.recastNote, 240) : '';
  const pickedUp: TalkPickedUpItem[] = asRecordArray(data.pickedUp)
    .slice(0, 2)
    .map((item): TalkPickedUpItem | null => {
      const term = sanitizeString(item.term, 80);
      const meaning = sanitizeString(item.meaning, 160);
      if (!term || !meaning) return null;
      return {
        term,
        meaning,
        regionTag: sanitizeString(item.regionTag, 40) || ctx.tutor.regionTag,
        example: cleanTutor,
        kind: isValidTalkVocabKind(item.kind) ? item.kind : term.includes(' ') ? 'phrase' : 'word',
      };
    })
    .filter((x): x is TalkPickedUpItem => x !== null);

  return {
    ...(recastNote ? {recastNote} : {}),
    pickedUp,
  };
}
