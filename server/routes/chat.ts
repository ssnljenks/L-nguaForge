import {Type} from '@google/genai';
import type {Router} from 'express';
import type {TalkPickedUpItem} from '../../src/types.ts';
import {isValidTalkVocabKind} from '../../src/utils/talkLogic.ts';
import {MODELS} from '../config.ts';
import {handleAsync, UserFacingError} from '../errors.ts';
import {BUDGETS, ThinkingLevel} from '../gemini.ts';
import {buildTalkSystemPrompt, resolveTalkSessionContext} from '../talkPrompt.ts';
import {
  asRecordArray,
  assertUnclassifiedText,
  formatTranscript,
  pickVocabCategory,
  sanitizeString,
} from '../validation.ts';
import type {RouteDeps} from './types.ts';
import {createUntrustedFence} from '../untrustedContent.ts';

export function registerChatRoutes(router: Router, {generate}: RouteDeps): void {
  // Typed Talk conversation turn sharing the exact persona/scene/slang/correction prompt as /ws/live
  router.post(
    '/chat/turn',
    handleAsync(async (req, res, signal) => {
      const talkCtx = resolveTalkSessionContext(req.body);
      const userMessage = sanitizeString(req.body?.userMessage, 2500);

      if (!userMessage) {
        throw new UserFacingError(400, 'Message text is required.');
      }

      const transcriptBlock = formatTranscript(req.body?.history, {
        maxTurns: 16,
        maxCharsPerTurn: 1000,
        label: (role) => (role === 'assistant' ? talkCtx.tutor.name.toUpperCase() : 'USER'),
      });

      assertUnclassifiedText(userMessage, transcriptBlock);

      // The learner's text (and history) is data: fenced so "ignore your instructions" inside it is not obeyed.
      const fence = createUntrustedFence();
      const basePrompt = buildTalkSystemPrompt(talkCtx, {channel: 'text'});
      const wantRecast = talkCtx.correctionMode === 'recast';

      const systemInstruction = `${basePrompt}

${fence.notice}

OUTPUT FIELDS:
1. replyText: Your natural conversational reply in ${talkCtx.langName} (${talkCtx.tutor.city}).
2. recastNote: ${
        wantRecast
          ? `If you gently recast a stiff phrase, grammar slip, or non-local word from the user's message inside replyText, write ONE brief plain-English side note (e.g., "${talkCtx.tutor.name} recast you: locals in ${talkCtx.tutor.city} say laburo for trabajo."). If nothing needed recasting, return "".`
          : 'Always return "" for recastNote.'
      }
3. pickedUp: Extract 0 to 2 regional/colloquial words or phrases you actually used in replyText (e.g. local idioms or natural expressions) with: term (exact word/phrase in replyText), meaning (short English gloss), regionTag ("${talkCtx.tutor.regionTag}" or "Widespread"), kind ("word" | "phrase").
4. struggleSuggestions: Silently identify 0 to 2 helpful phrases if the user slipped into English or phrased something awkwardly, with targetPhrase, englishConcept, contextSentence, reasonTag, note, suggestedCategory ("High-Register Connectors" | "Operational/Military Terms" | "Regional Idioms" | "False Friends").`;

      const contents = transcriptBlock
        ? `Conversation history:\n${fence.wrap('HISTORY', transcriptBlock)}\n\nUSER'S LATEST MESSAGE:\n${fence.wrap('USER_MESSAGE', userMessage)}`
        : `USER'S OPENING MESSAGE:\n${fence.wrap('USER_MESSAGE', userMessage)}`;

      const data = await generate({
        model: MODELS.chat,
        contents,
        systemInstruction,
        thinkingLevel: ThinkingLevel.LOW,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            replyText: {type: Type.STRING},
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
            struggleSuggestions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  targetPhrase: {type: Type.STRING},
                  englishConcept: {type: Type.STRING},
                  contextSentence: {type: Type.STRING},
                  reasonTag: {type: Type.STRING},
                  note: {type: Type.STRING},
                  suggestedCategory: {type: Type.STRING},
                },
                required: [
                  'targetPhrase',
                  'englishConcept',
                  'contextSentence',
                  'reasonTag',
                  'note',
                  'suggestedCategory',
                ],
              },
            },
          },
          required: ['replyText', 'recastNote', 'pickedUp', 'struggleSuggestions'],
        },
        emptyMessage: 'Empty response from conversation partner.',
        budget: BUDGETS.standard,
        signal,
      });

      const replyText = sanitizeString(data.replyText, 4000);
      if (!replyText) {
        throw new UserFacingError(502, 'Conversation partner returned an empty reply. Please try sending again.');
      }

      const recastNote = wantRecast ? sanitizeString(data.recastNote, 240) : '';

      const pickedUp: TalkPickedUpItem[] = asRecordArray(data.pickedUp)
        .slice(0, 3)
        .map((item): TalkPickedUpItem | null => {
          const term = sanitizeString(item.term, 80);
          const meaning = sanitizeString(item.meaning, 160);
          if (!term || !meaning) return null;
          return {
            term,
            meaning,
            regionTag: sanitizeString(item.regionTag, 40) || talkCtx.tutor.regionTag,
            example: replyText,
            kind: isValidTalkVocabKind(item.kind) ? item.kind : term.includes(' ') ? 'phrase' : 'word',
          };
        })
        .filter((x): x is TalkPickedUpItem => x !== null)
        // The prompt asks for terms actually used in replyText; enforce it so the tray never shows invented words.
        .filter((x) => replyText.toLowerCase().includes(x.term.toLowerCase()));

      const struggleSuggestions = asRecordArray(data.struggleSuggestions)
        .slice(0, 3)
        .map((item) => ({
          targetPhrase: sanitizeString(item.targetPhrase, 240),
          englishConcept: sanitizeString(item.englishConcept, 240),
          contextSentence: sanitizeString(item.contextSentence, 600) || replyText,
          reasonTag: sanitizeString(item.reasonTag, 80) || 'Useful expression',
          note: sanitizeString(item.note, 400),
          suggestedCategory: pickVocabCategory(
            item.suggestedCategory,
            talkCtx.workTalk ? 'Operational/Military Terms' : 'Regional Idioms'
          ),
        }))
        .filter((item) => Boolean(item.targetPhrase && item.englishConcept));

      res.json({
        replyText,
        ...(recastNote ? {recastNote} : {}),
        pickedUp,
        struggleSuggestions,
      });
    })
  );
}
