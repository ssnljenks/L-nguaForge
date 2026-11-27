import type {VocabCategory, VocabItem} from '../types';
import {VALID_VOCAB_CATEGORIES} from './ilrLogic';

/**
 * Work focus gating for the Vocab tab. Military content is opt-in: with Work focus off the Vocab tab hides the
 * Military Dict view and the Operational/Military Terms filter. Saved items are never hidden by this: they keep
 * showing in "All Categories", whatever their category.
 */

export type VocabMode = 'browse' | 'recall' | 'glossary';
export type VocabCategoryFilter = 'all' | VocabCategory;

/** Categories that only get a filter chip while Work focus is on. */
export const WORK_ONLY_VOCAB_CATEGORIES: readonly VocabCategory[] = ['Operational/Military Terms'];

export function isWorkOnlyVocabCategory(category: VocabCategoryFilter): boolean {
  return (WORK_ONLY_VOCAB_CATEGORIES as readonly string[]).includes(category);
}

/** The category filter chips to show, in order, "all" first. */
export function visibleVocabCategoryFilters(workFocus: boolean): VocabCategoryFilter[] {
  return ['all', ...VALID_VOCAB_CATEGORIES.filter((category) => workFocus || !isWorkOnlyVocabCategory(category))];
}

/** Whether the Military Dict view is available. */
export function isGlossaryAvailable(workFocus: boolean): boolean {
  return workFocus;
}

/**
 * The mode and filter to actually use. Work focus can be switched off while the tab is open on the Military Dict or
 * on the Operational/Military Terms filter; both fall back to the normal list instead of staying on a hidden view.
 */
export function resolveVocabView(
  view: {mode: VocabMode; categoryFilter: VocabCategoryFilter},
  workFocus: boolean
): {mode: VocabMode; categoryFilter: VocabCategoryFilter} {
  if (workFocus) return view;
  return {
    mode: view.mode === 'glossary' ? 'browse' : view.mode,
    categoryFilter: isWorkOnlyVocabCategory(view.categoryFilter) ? 'all' : view.categoryFilter,
  };
}

/** Saved items matching a category filter and a search text (term, English meaning or example sentence). */
export function filterVocabItems(items: VocabItem[], categoryFilter: VocabCategoryFilter, query: string): VocabItem[] {
  const q = query.trim().toLowerCase();
  return items.filter((item) => {
    if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
    if (!q) return true;
    return (
      item.term.toLowerCase().includes(q) ||
      item.englishConcept.toLowerCase().includes(q) ||
      item.contextSentence.toLowerCase().includes(q)
    );
  });
}
