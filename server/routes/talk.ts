import {Type} from '@google/genai';
import type {Router} from 'express';
import type {TalkHowDoLocalsSayOption, TalkWrapUpItem} from '../../src/types.ts';
import {isValidTalkVocabKind} from '../../src/utils/talkLogic.ts';
import {MODELS} from '../config.ts';
import {buildErrorReportingInstruction, extractReportedErrors, REPORTED_ERRORS_SCHEMA} from '../errorReporting.ts';
import {handleAsync, UserFacingError} from '../errors.ts';
import {BUDGETS, ThinkingLevel} from '../gemini.ts';
import {resolveTalkSessionContext} from '../talkPrompt.ts';
import {
  asRecordArray,
  assertUnclassifiedText,
  formatTranscript,
  sanitizeString,
  sanitizeStringArray,
} from '../validation.ts';
import type {RouteDeps} from './types.ts';
import {createUntrustedFence} from '../untrustedContent.ts';

export function registerTalkRoutes(router: Router, {generate}: RouteDeps): void {
  // 1. "How do locals say..." lookup tailored to tutor's city, dialect, and slang level
  router.post(
    '/talk/how-do-locals-say',
    handleAsync(async (req, res, signal) => {
      const ctx = resolveTalkSessionContext(req.body);
      const englishQuery = sanitizeString(req.body?.englishQuery, 400);
      if (!englishQuery) {
        throw new UserFacingError(400, 'Please type or speak what you want to say in English.');
      }

      assertUnclassifiedText(englishQuery);

      const {tutor, langName, slangLevel, workTalk, domainLabel} = ctx;
      const fence = createUntrustedFence();
      const systemInstruction = `${fence.notice}

You are ${tutor.name} from ${tutor.city}, helping a learner speak natural ${tutor.regionTag} ${langName}.
Given an English thought or phrase, provide 1 or 2 authentic ways locals in ${tutor.city} actually say this at slang level ${slangLevel}/4 (0 = textbook, 4 = full street slang).
${
  workTalk && domainLabel
    ? `Keep context grounded in practical "${domainLabel}" work coordination if relevant, using natural ${tutor.city} phrasing.`
    : 'Keep expressions grounded in everyday civilian life; NEVER use military or test-prep jargon unless the learner explicitly asked a work question.'
}
Rules:
- Return 1 to 2 distinct options in ${langName} (${tutor.regionTag}, "${tutor.defaultRegister}" register).
- Each option has: expression (the ${langName} word/phrase), literalOrContext (short literal translation or English meaning), nuance (1 crisp sentence on tone or when locals use it), example (natural 1-sentence ${langName} example in ${tutor.city} style), kind ("word" | "phrase").
- Never mention ILR levels, scores, or exams.`;

      const data = await generate({
        model: MODELS.chat,
        contents: `How would locals in ${tutor.city} say the following (Slang level ${slangLevel}/4)?\n${fence.wrap('ENGLISH_QUERY', englishQuery)}`,
        systemInstruction,
        thinkingLevel: ThinkingLevel.LOW,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            versions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  expression: {type: Type.STRING},
                  literalOrContext: {type: Type.STRING},
                  nuance: {type: Type.STRING},
                  example: {type: Type.STRING},
                  kind: {type: Type.STRING},
                },
                required: ['expression', 'literalOrContext', 'nuance', 'example', 'kind'],
              },
            },
          },
          required: ['versions'],
        },
        emptyMessage: 'Could not retrieve local expressions.',
        budget: BUDGETS.fast,
        signal,
      });

      const versions: TalkHowDoLocalsSayOption[] = asRecordArray(data.versions)
        .slice(0, 2)
        .map((v): TalkHowDoLocalsSayOption | null => {
          const expression = sanitizeString(v.expression, 180);
          const literalOrContext = sanitizeString(v.literalOrContext, 200);
          if (!expression || !literalOrContext) return null;
          return {
            expression,
            literalOrContext,
            nuance: sanitizeString(v.nuance, 240) || `Natural ${tutor.city} phrasing`,
            example: sanitizeString(v.example, 400) || expression,
            kind: isValidTalkVocabKind(v.kind) ? v.kind : expression.includes(' ') ? 'phrase' : 'word',
          };
        })
        .filter((x): x is TalkHowDoLocalsSayOption => x !== null);

      if (versions.length === 0) {
        throw new UserFacingError(502, 'No local phrasing came back. Please try rewording your phrase.');
      }

      res.json({
        tutorName: tutor.name,
        city: tutor.city,
        regionTag: tutor.regionTag,
        versions,
      });
    })
  );

  // 2. Wrap-up review: returns up to 8 takeaway words, phrases, or regional patterns (NO scores or ILR levels)
  router.post(
    '/talk/wrap-up',
    handleAsync(async (req, res, signal) => {
      const ctx = resolveTalkSessionContext(req.body);
      const {tutor, langName, workTalk, domainLabel, scene, correctionMode} = ctx;

      const transcriptBlock = formatTranscript(req.body?.messages, {
        maxTurns: 40,
        maxCharsPerTurn: 1000,
        label: (role) => (role === 'assistant' ? tutor.name.toUpperCase() : 'LEARNER'),
      });

      if (!transcriptBlock.trim()) {
        throw new UserFacingError(400, 'Have at least one exchange before wrapping up.');
      }

      assertUnclassifiedText(transcriptBlock);

      const endNoteRule =
        correctionMode === 'end_only'
          ? `endNotes: Because the learner chose "At the end only" feedback, provide 1 to 3 brief, warm habit observations from their lines (friendly coaching, NEVER a score or grade).`
          : 'endNotes: Return an empty array [].';

      const domainLine =
        workTalk && domainLabel
          ? `Conversation context: Work talk (${domainLabel}). Prioritize practical workplace phrases used in the chat alongside natural ${tutor.regionTag} flow.`
          : `Conversation context: Casual ${tutor.city} chat (${scene.label}). Do NOT turn takeaways into military/test terms.`;

      const systemInstruction = `You are ${tutor.name} from ${tutor.city}, wrapping up a casual ${langName} (${tutor.regionTag}) conversation.
${domainLine}

CRITICAL RULES:
- ZERO scores, ZERO grades, ZERO ILR numbers, ZERO exam/test language anywhere. Keep it warm, practical, and encouraging.
- items: Select up to 8 high-value takeaways from the actual conversation transcript, mixing:
  * "word": regional or useful standalone words ${tutor.name} used or the learner searched for
  * "phrase": natural conversational chunks/idioms from the conversation
  * "pattern": recurring dialect/grammar habits spotted in the learner's speech (for example: term "vos tenés · vos andás", meaning "you used tú 4 times — in Buenos Aires locals use vos", exampleFromConversation showing a natural reply from the chat).
- Keep items capped at 8 max.
- Each item requires:
  * term (target ${langName} word, phrase, or short pattern like "vos tenés · vos andás")
  * meaning (concise English meaning or habit explanation)
  * exampleFromConversation (short quote or natural line from this conversation)
  * regionTag ("${tutor.regionTag}", "Widespread", etc.)
  * kind ("word" | "phrase" | "pattern")
- summary: 1–2 warm, casual sentences recapping what you chatted about.
- ${endNoteRule}
- Background habit log (NEVER mention in summary/items/endNotes): ${buildErrorReportingInstruction(ctx.language, ['grammar', 'register'])}`;

      const data = await generate({
        model: MODELS.chat,
        contents: `CONVERSATION TRANSCRIPT:\n${transcriptBlock}`,
        systemInstruction,
        thinkingLevel: ThinkingLevel.LOW,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: {type: Type.STRING},
            endNotes: {type: Type.ARRAY, items: {type: Type.STRING}},
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  term: {type: Type.STRING},
                  meaning: {type: Type.STRING},
                  exampleFromConversation: {type: Type.STRING},
                  regionTag: {type: Type.STRING},
                  kind: {type: Type.STRING},
                },
                required: ['term', 'meaning', 'exampleFromConversation', 'regionTag', 'kind'],
              },
            },
            errors: REPORTED_ERRORS_SCHEMA,
          },
          required: ['summary', 'endNotes', 'items', 'errors'],
        },
        emptyMessage: 'Could not summarize this conversation.',
        budget: BUDGETS.standard,
        signal,
      });

      const summary =
        sanitizeString(data.summary, 600) ||
        `Great ${scene.label.toLowerCase()} chat with ${tutor.name} in ${tutor.city}.`;
      const endNotes = correctionMode === 'end_only' ? sanitizeStringArray(data.endNotes, 4, 240) : [];
      const items: TalkWrapUpItem[] = asRecordArray(data.items)
        .slice(0, 8)
        .map((item): TalkWrapUpItem | null => {
          const term = sanitizeString(item.term, 140);
          const meaning = sanitizeString(item.meaning, 240);
          if (!term || !meaning) return null;
          return {
            term,
            meaning,
            exampleFromConversation: sanitizeString(item.exampleFromConversation, 400) || term,
            regionTag: sanitizeString(item.regionTag, 48) || tutor.regionTag,
            kind: isValidTalkVocabKind(item.kind) ? item.kind : term.includes(' ') ? 'phrase' : 'word',
          };
        })
        .filter((x): x is TalkWrapUpItem => x !== null);

      const errors = extractReportedErrors(data.errors, ctx.language);

      res.json({summary, endNotes, items, errors});
    })
  );
}
