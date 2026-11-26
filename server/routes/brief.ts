import type {Router} from 'express';
import {isBriefIlrLevel, isBriefTopic} from '../../src/utils/briefLogic.ts';
import {isMilitaryDomain} from '../../src/utils/ilrLogic.ts';
import type {BriefIlrLevel, BriefMediaType, BriefTopic, MilitaryDomain, TargetLanguage} from '../../src/types.ts';
import {BriefService, globalBriefService} from '../briefService.ts';
import {handleAsync, UserFacingError} from '../errors.ts';
import {assertUnclassifiedText, sanitizeString, validateLanguage} from '../validation.ts';
import type {RouteDeps} from './types.ts';

export function registerBriefRoutes(router: Router, deps: RouteDeps, service: BriefService = globalBriefService): void {
  /**
   * Returns filtered open-source brief items with scrubbed public fields.
   */
  router.get(
    '/brief/feed',
    handleAsync(async (req, res) => {
      const language: TargetLanguage = validateLanguage(req.query.language);
      const mediaType: BriefMediaType = req.query.mediaType === 'text' ? 'text' : 'audio';

      const levelParam = sanitizeString(req.query.level, 10);
      const level: BriefIlrLevel | 'all' = isBriefIlrLevel(levelParam) ? levelParam : 'all';

      const topicParam = sanitizeString(req.query.topic, 20);
      const topic: BriefTopic | 'all' = isBriefTopic(topicParam) ? topicParam : 'all';

      const workFilter = req.query.workFilter === 'true';
      const domainParam = sanitizeString(req.query.userDomain, 40);
      const userDomain: MilitaryDomain | undefined = isMilitaryDomain(domainParam) ? domainParam : undefined;
      const searchQuery = sanitizeString(req.query.q || req.query.search, 100);

      const result = service.getFeed({
        language,
        mediaType,
        level,
        topic,
        workFilter,
        userDomain,
        searchQuery: searchQuery || undefined,
      });

      res.json(result);
    })
  );

  /**
   * Generates 3 DLPT-style multiple-choice questions for a specific brief item.
   */
  router.post(
    '/brief/drill',
    handleAsync(async (req, res) => {
      const briefId = sanitizeString(req.body?.briefId, 100);
      if (!briefId) {
        throw new UserFacingError(400, 'Missing briefId in request body.');
      }

      const item = service.getItemById(briefId);
      if (!item) {
        throw new UserFacingError(404, `Brief item "${briefId}" not found.`);
      }

      const drill = await service.generateDrill(briefId, deps.generate);
      res.json(drill);
    })
  );

  /**
   * Grades a learner's 3-sentence English gist against a cached audio item's source transcript.
   */
  router.post(
    '/brief/grade-gist',
    handleAsync(async (req, res) => {
      const briefId = sanitizeString(req.body?.briefId, 100);
      if (!briefId) {
        throw new UserFacingError(400, 'Missing briefId in request body.');
      }

      const summary = sanitizeString(req.body?.summary, 2000);
      assertUnclassifiedText(summary);

      const item = service.getItemById(briefId);
      if (!item) {
        throw new UserFacingError(404, `Brief item "${briefId}" not found.`);
      }

      const grade = await service.gradeGist(briefId, summary, deps.generate);
      res.json(grade);
    })
  );

  /**
   * Retrieves a short study excerpt with vocabulary for review.
   */
  router.get(
    '/brief/study-excerpt',
    handleAsync(async (req, res) => {
      const briefId = sanitizeString(req.query.briefId, 100);
      if (!briefId) {
        throw new UserFacingError(400, 'Missing briefId in query.');
      }

      const study = service.getStudyExcerpt(briefId);
      if (!study) {
        throw new UserFacingError(404, `Brief item "${briefId}" not found.`);
      }

      res.json(study);
    })
  );

  /**
   * Triggers a feed refresh from open-source RSS sources.
   */
  router.post(
    '/brief/refresh',
    handleAsync(async (_req, res) => {
      const outcome = await service.refreshFeeds(deps.generate);
      res.json({
        ok: true,
        lastRefreshedAt: service.getLastRefreshedAt(),
        newItemsCount: outcome.newItemsCount,
      });
    })
  );
}
