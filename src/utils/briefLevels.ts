import type {BriefIlrLevel, BriefTopic} from '../types.ts';

/** Brief level/topic constants and guards, light enough for the startup storage sanitizers (REVIEW M-7). */
export const BRIEF_TOPICS: readonly {id: BriefTopic; label: string}[] = [
  {id: 'society', label: 'Society'},
  {id: 'politics', label: 'Politics'},
  {id: 'economy', label: 'Economy'},
  {id: 'culture', label: 'Culture'},
  {id: 'scitech', label: 'Sci/Tech'},
  {id: 'security', label: 'Security'},
];

export const BRIEF_ILR_LEVELS: readonly BriefIlrLevel[] = ['2', '2+', '3', '3+'];

export function isBriefTopic(val: unknown): val is BriefTopic {
  return (
    val === 'society' ||
    val === 'politics' ||
    val === 'economy' ||
    val === 'culture' ||
    val === 'scitech' ||
    val === 'security'
  );
}

export function isBriefIlrLevel(val: unknown): val is BriefIlrLevel {
  return val === '2' || val === '2+' || val === '3' || val === '3+';
}
