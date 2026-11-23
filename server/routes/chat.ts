import {Type} from '@google/genai';
import type {Router} from 'express';
import type {ChatRegisterMode} from '../../src/types.ts';
import {MODELS} from '../config.ts';
import {handleAsync, UserFacingError} from '../errors.ts';
import {BUDGETS, ThinkingLevel} from '../gemini.ts';
import {
  asRecordArray,
  formatTranscript,
  pickVocabCategory,
  resolveTrainingContext,
  sanitizeString,
  validateRegisterMode,
} from '../validation.ts';
import type {RouteDeps} from './types.ts';

const TEXT_REGISTER_GUIDANCE: Record<ChatRegisterMode, string> = {
  everyday: 'Keep the tone relaxed, warm, and natural for everyday conversation, using authentic regional idioms.',
  debate:
    'Engage in thoughtful ILR Level 3 discussion with nuanced perspectives, systemic causes, and hypothetical follow-ups.',
  professional:
    'Keep a natural, collegial ILR 2+ professional conversational tone that feels like chatting with a sharp bilingual partner.',
};

export function registerChatRoutes(router: Router, {generate}: RouteDeps): void {
  // Free conversation turn + automatic struggle-word capture
  router.post(
    '/chat/turn',
    handleAsync(async (req, res, signal) => {
      const {langName, dialectLabel, domainLabel} = resolveTrainingContext(req.body);
      const registerMode = validateRegisterMode(req.body?.registerMode);
      const userMessage = sanitizeString(req.body?.userMessage, 2500);

      if (!userMessage) {
        throw new UserFacingError(400, 'Message text is required.');
      }

      const systemInstruction = `You are a natural, engaging native ${langName} (${dialectLabel}) conversation partner inside LinguaForge ILR.
The user wants an open, free-flowing back-and-forth conversation (just like chatting with an intelligent partner on any topic they choose; their active domain context is "${domainLabel}", which you can reference naturally only if relevant).
${TEXT_REGISTER_GUIDANCE[registerMode]}

CRITICAL RULES:
1. replyText MUST be strictly in ${langName} (${dialectLabel}), warm, conversational, and 2–5 sentences long, ending with a natural follow-up question or thought to keep the dialogue flowing. Do NOT break character or lecture about grammar inside replyText.
2. struggleSuggestions: Silently inspect the user's latest message for 0 to 3 high-value words or phrases they struggled with, hesitated over, code-switched into English (e.g. "schedule", "budget", "deal with"), phrased awkwardly, or could naturally upgrade to sound more native.
   - If the user asked how to say something or mixed English into ${langName}, definitely capture the clean ${langName} equivalent in struggleSuggestions.
   - Even if their sentence was understandable, offer 1–2 genuinely useful native expressions or connectors from their topic so they can build their vocabulary vault effortlessly.
   - Each suggestion must include: targetPhrase (${langName}), englishConcept (concise English meaning), contextSentence (natural ${langName} sentence showing usage), reasonTag (short label like "Code-switch fix", "Natural phrasing", "Register upgrade", or "Useful expression"), note (1 brief helpful English tip), and suggestedCategory ("High-Register Connectors" | "Operational/Military Terms" | "Regional Idioms" | "False Friends").`;

      const transcriptBlock = formatTranscript(req.body?.history, {
        maxTurns: 16,
        maxCharsPerTurn: 1000,
        label: (role) => (role === 'assistant' ? 'PARTNER' : 'USER'),
      });

      const contents = transcriptBlock
        ? `Conversation history:\n${transcriptBlock}\n\nUSER'S LATEST MESSAGE:\n${userMessage}`
        : `USER'S OPENING MESSAGE:\n${userMessage}`;

      const data = await generate({
        model: MODELS.chat,
        contents,
        systemInstruction,
        thinkingLevel: ThinkingLevel.LOW,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            replyText: {type: Type.STRING},
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
          required: ['replyText', 'struggleSuggestions'],
        },
        emptyMessage: 'Empty response from conversation partner.',
        budget: BUDGETS.standard,
        signal,
      });

      const replyText = sanitizeString(data.replyText, 4000);
      if (!replyText) {
        throw new UserFacingError(502, 'Conversation partner returned an empty reply. Please try sending again.');
      }

      const struggleSuggestions = asRecordArray(data.struggleSuggestions)
        .slice(0, 3)
        .map((item) => ({
          targetPhrase: sanitizeString(item.targetPhrase, 240),
          englishConcept: sanitizeString(item.englishConcept, 240),
          contextSentence: sanitizeString(item.contextSentence, 600) || replyText,
          reasonTag: sanitizeString(item.reasonTag, 80) || 'Useful expression',
          note: sanitizeString(item.note, 400),
          suggestedCategory: pickVocabCategory(item.suggestedCategory, 'Regional Idioms'),
        }))
        .filter((item) => Boolean(item.targetPhrase && item.englishConcept));

      res.json({replyText, struggleSuggestions});
    })
  );
}
