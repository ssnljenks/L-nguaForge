import React, {useState} from 'react';
import {X} from 'lucide-react';
import type {MissionConfig, VocabCategory} from '../../types';
import type {SaveVocabFn} from '../../hooks/useWordLookup';
import {LANGUAGE_LABELS, VALID_VOCAB_CATEGORIES} from '../../utils/ilrLogic';

interface AddVocabFormProps {
  config: MissionConfig;
  onAdd: SaveVocabFn;
  onClose: () => void;
}

/** Manual "Add Entry" form for the vault. */
export const AddVocabForm: React.FC<AddVocabFormProps> = ({config, onAdd, onClose}) => {
  const [newTerm, setNewTerm] = useState('');
  const [newEnglish, setNewEnglish] = useState('');
  const [newContext, setNewContext] = useState('');
  const [newRegister, setNewRegister] = useState('Formal / Operational');
  const [newCategory, setNewCategory] = useState<VocabCategory>('High-Register Connectors');
  const [formError, setFormError] = useState<string | null>(null);

  const handleManualAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTerm.trim() || !newEnglish.trim()) {
      setFormError('Both the target term and the English concept are required.');
      return;
    }
    onAdd({
      term: newTerm.trim(),
      englishConcept: newEnglish.trim(),
      contextSentence: newContext.trim() || `Example using "${newTerm.trim()}".`,
      registerTag: newRegister.trim() || 'Formal / Operational',
      category: newCategory,
      language: config.language,
      dialect: config.dialect,
      ...(config.workFocusEnabled ? {domain: config.domain} : {}),
      source: 'manual',
    });
    onClose();
  };

  return (
    <form onSubmit={handleManualAdd} className="rounded-xl border border-[#D99B26]/35 bg-[#111922] p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[#F8FAFC]">Add to {LANGUAGE_LABELS[config.language]} Vocab</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close add entry form"
          className="text-[#94A3B8] hover:text-white p-1"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {formError && (
        <p className="text-xs text-red-300" role="alert">
          {formError}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1">
          <label htmlFor="vocab-term" className="text-xs text-[#94A3B8]">
            Target Phrase ({LANGUAGE_LABELS[config.language]})
          </label>
          <input
            id="vocab-term"
            type="text"
            value={newTerm}
            onChange={(e) => setNewTerm(e.target.value)}
            placeholder="e.g., cabe destacar que"
            className="w-full min-h-[44px] rounded-lg border border-[#23303E] bg-[#0B1117] px-3 py-2 text-sm text-[#E6EDF3] focus:outline-none focus:border-[#D99B26]"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="vocab-english" className="text-xs text-[#94A3B8]">
            English Concept / Operational Scenario
          </label>
          <input
            id="vocab-english"
            type="text"
            value={newEnglish}
            onChange={(e) => setNewEnglish(e.target.value)}
            placeholder="e.g., it should be highlighted that (formal framing)"
            className="w-full min-h-[44px] rounded-lg border border-[#23303E] bg-[#0B1117] px-3 py-2 text-sm text-[#E6EDF3] focus:outline-none focus:border-[#D99B26]"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="vocab-category" className="text-xs text-[#94A3B8]">
            Category
          </label>
          <select
            id="vocab-category"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value as VocabCategory)}
            className="w-full min-h-[44px] rounded-lg border border-[#23303E] bg-[#0B1117] px-3 py-2 text-sm text-[#E6EDF3] focus:outline-none focus:border-[#D99B26]"
          >
            {VALID_VOCAB_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="vocab-register" className="text-xs text-[#94A3B8]">
            Register Tag
          </label>
          <input
            id="vocab-register"
            type="text"
            value={newRegister}
            onChange={(e) => setNewRegister(e.target.value)}
            className="w-full min-h-[44px] rounded-lg border border-[#23303E] bg-[#0B1117] px-3 py-2 text-sm text-[#E6EDF3] focus:outline-none focus:border-[#D99B26]"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="vocab-context" className="text-xs text-[#94A3B8]">
          Sentence Context
        </label>
        <input
          id="vocab-context"
          type="text"
          value={newContext}
          onChange={(e) => setNewContext(e.target.value)}
          placeholder="Full operational sentence illustrating usage…"
          className="w-full min-h-[44px] rounded-lg border border-[#23303E] bg-[#0B1117] px-3 py-2 text-sm text-[#E6EDF3] focus:outline-none focus:border-[#D99B26]"
        />
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 rounded-lg text-xs font-medium text-[#94A3B8] hover:text-white"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="min-h-[52px] px-4 py-2 rounded-lg bg-[#D99B26] text-[#0B1117] text-xs font-semibold hover:bg-[#E5AE42]"
        >
          Save to Vocab
        </button>
      </div>
    </form>
  );
};
