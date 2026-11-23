import {Type} from '@google/genai';
import type {Router} from 'express';
import {MODELS} from '../config.ts';
import {handleAsync, UserFacingError} from '../errors.ts';
import {BUDGETS, ThinkingLevel} from '../gemini.ts';
import {pickVocabCategory, resolveTrainingContext, sanitizeString} from '../validation.ts';
import type {RouteDeps} from './types.ts';

const CATEGORY_CHOICES =
  '"High-Register Connectors", "Operational/Military Terms", "Regional Idioms", or "False Friends"';

export function registerVocabRoutes(router: Router, {generate}: RouteDeps): void {
  // Tap-to-save contextual word/phrase lookup
  router.post(
    '/vocab/lookup',
    handleAsync(async (req, res, signal) => {
      const {langName, dialectLabel} = resolveTrainingContext(req.body);
      const word = sanitizeString(req.body?.word, 120);
      const contextSentence = sanitizeString(req.body?.contextSentence, 1200);

      if (!word || !contextSentence) {
        throw new UserFacingError(400, 'Word and context sentence are required.');
      }

      const data = await generate({
        model: MODELS.fastLookup,
        contents: `Explain the ${langName} (${dialectLabel}) word "${word}" in: "${contextSentence}".
Return concise contextual English meaning, crisp registerTag, 1-sentence grammarNote, and suggestedCategory (${CATEGORY_CHOICES}).`,
        thinkingLevel: ThinkingLevel.MINIMAL,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            contextualMeaning: {type: Type.STRING},
            registerTag: {type: Type.STRING},
            grammarNote: {type: Type.STRING},
            suggestedCategory: {type: Type.STRING},
          },
          required: ['contextualMeaning', 'registerTag', 'grammarNote', 'suggestedCategory'],
        },
        emptyMessage: 'Empty response from vocabulary lookup.',
        budget: BUDGETS.fast,
        signal,
      });

      const contextualMeaning = sanitizeString(data.contextualMeaning, 400);
      if (!contextualMeaning) {
        throw new UserFacingError(502, 'Could not retrieve a definition for that word. Please try again.');
      }
      res.json({
        word,
        contextualMeaning,
        registerTag: sanitizeString(data.registerTag, 80) || 'General Usage',
        grammarNote: sanitizeString(data.grammarNote, 400),
        suggestedCategory: pickVocabCategory(data.suggestedCategory, 'Regional Idioms'),
      });
    })
  );

  // Tip-of-the-tongue ("How do I say...?") helper
  router.post(
    '/vocab/tot',
    handleAsync(async (req, res, signal) => {
      const {langName, dialectLabel, domainLabel} = resolveTrainingContext(req.body);
      const englishQuery = sanitizeString(req.body?.englishQuery, 400);

      if (!englishQuery) {
        throw new UserFacingError(400, 'Please enter the English phrase or concept you want to express.');
      }

      const data = await generate({
        model: MODELS.fastLookup,
        contents: `A military linguist targeting ILR 2+/3 in ${langName} (${dialectLabel}) within "${domainLabel}" needs a natural, high-register way to say:
"${englishQuery}"
Return the strongest idiomatic high-register target phrase, an optional formal diplomatic alternative, a concise register/grammar note (mentioning subjunctive triggers if relevant), a natural operational example sentence, and the best category from: ${CATEGORY_CHOICES}.`,
        thinkingLevel: ThinkingLevel.MINIMAL,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            targetPhrase: {type: Type.STRING},
            alternativeFormal: {type: Type.STRING},
            registerNote: {type: Type.STRING},
            exampleSentence: {type: Type.STRING},
            category: {type: Type.STRING},
          },
          required: ['targetPhrase', 'registerNote', 'exampleSentence', 'category'],
        },
        emptyMessage: 'Empty response from TOT helper.',
        budget: BUDGETS.fast,
        signal,
      });

      const targetPhrase = sanitizeString(data.targetPhrase, 300);
      if (!targetPhrase) {
        throw new UserFacingError(502, 'TOT helper returned an empty phrase. Please try again.');
      }
      res.json({
        targetPhrase,
        alternativeFormal: sanitizeString(data.alternativeFormal, 300),
        registerNote: sanitizeString(data.registerNote, 400),
        exampleSentence: sanitizeString(data.exampleSentence, 800),
        category: pickVocabCategory(data.category, 'High-Register Connectors'),
      });
    })
  );

  // Active-recall sentence coach
  router.post(
    '/vocab/evaluate-sentence',
    handleAsync(async (req, res, signal) => {
      const {langName, domainLabel} = resolveTrainingContext(req.body);
      const targetTerm = sanitizeString(req.body?.targetTerm, 150);
      const userSentence = sanitizeString(req.body?.userSentence, 800);

      if (!targetTerm || !userSentence) {
        throw new UserFacingError(400, 'Target term and candidate sentence are required.');
      }

      const data = await generate({
        model: MODELS.chat,
        contents: `Evaluate whether the linguist used the ${langName} expression "${targetTerm}" accurately and at an ILR 2+/3 operational register in this sentence (domain: ${domainLabel}):
"${userSentence}"
Be concise and tactical.`,
        thinkingLevel: ThinkingLevel.LOW,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            isNatural: {type: Type.BOOLEAN},
            feedback: {type: Type.STRING},
            polishedVersion: {type: Type.STRING},
          },
          required: ['isNatural', 'feedback', 'polishedVersion'],
        },
        emptyMessage: 'Empty response from sentence evaluator.',
        budget: BUDGETS.standard,
        signal,
      });

      const feedback = sanitizeString(data.feedback, 1200);
      if (!feedback) {
        throw new UserFacingError(502, 'Sentence evaluator returned an empty response. Please try again.');
      }
      res.json({
        isNatural: data.isNatural === true,
        feedback,
        polishedVersion: sanitizeString(data.polishedVersion, 1200),
      });
    })
  );
}
