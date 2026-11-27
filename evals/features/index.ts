import type {Feature} from '../lib/types.ts';
import {dlpt} from './dlpt.ts';
import {errorTaxonomy} from './errorTaxonomy.ts';
import {gist} from './gist.ts';
import {opiExaminer} from './opiExaminer.ts';
import {opiRating} from './opiRating.ts';
import {roleplay} from './roleplay.ts';
import {safety} from './safety.ts';
import {talkDialect} from './talkDialect.ts';

/** Cheapest / most decisive first, so a tight budget still produces the most informative results. */
export const FEATURES: readonly Feature[] = [
  safety,
  opiRating,
  errorTaxonomy,
  gist,
  dlpt,
  roleplay,
  opiExaminer,
  talkDialect,
];
