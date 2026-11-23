import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearWordCacheOnly,
  getCandidateLookupKeys,
  getLocalCacheStats,
  getOfflineMilitaryEntries,
  lookupLocalTotPhrase,
  lookupLocalWord,
  normalizeLookupKey,
  resetInMemoryCacheForTests,
  saveWordToLocalCache,
} from './localDictionary';
import type {VocabItem} from '../types';

function installMockLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  const mockStorage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage,
    configurable: true,
    writable: true,
  });
  resetInMemoryCacheForTests();
  return mockStorage;
}

test('normalizeLookupKey strips accents, punctuation, and extra whitespace', () => {
  assert.equal(normalizeLookupKey('  ¡Misión! '), 'mision');
  assert.equal(normalizeLookupKey('¿Empezar?'), 'empezar');
  assert.equal(normalizeLookupKey('  Cooperação '), 'cooperacao');
});

test('getCandidateLookupKeys generates accurate Spanish and Portuguese singular/gender lemmas', () => {
  assert.ok(getCandidateLookupKeys('es', 'fragatas').includes('fragata'));
  assert.ok(getCandidateLookupKeys('es', 'misiones').includes('mision'));
  assert.ok(getCandidateLookupKeys('es', 'estrategicas').includes('estrategico'));
  assert.ok(getCandidateLookupKeys('pt', 'operacoes').includes('operacao'));
  assert.ok(getCandidateLookupKeys('pt', 'oficiais').includes('oficial'));
  assert.ok(getCandidateLookupKeys('pt', 'ordens').includes('ordem'));
  assert.ok(getCandidateLookupKeys('pt', 'diretrizes').includes('diretriz'));
});

test('lookupLocalWord resolves military vocabulary and inflected plurals offline with source=military_dict', () => {
  installMockLocalStorage();

  const esFragatas = lookupLocalWord('es', 'fragatas');
  assert.ok(esFragatas);
  assert.equal(esFragatas.source, 'military_dict');
  assert.ok(esFragatas.contextualMeaning.toLowerCase().includes('frigate'));

  const esInter = lookupLocalWord('es', 'interoperabilidad');
  assert.ok(esInter);
  assert.equal(esInter.source, 'military_dict');
  assert.ok(esInter.contextualMeaning.toLowerCase().includes('interoperability'));

  const esMisiones = lookupLocalWord('es', 'Misiones');
  assert.ok(esMisiones);
  assert.equal(esMisiones.source, 'military_dict');

  const ptEmbarcacoes = lookupLocalWord('pt', 'embarcações');
  assert.ok(ptEmbarcacoes);
  assert.equal(ptEmbarcacoes.source, 'military_dict');
  assert.ok(ptEmbarcacoes.contextualMeaning.toLowerCase().includes('vessel'));

  const ptAdidos = lookupLocalWord('pt', 'adidos');
  assert.ok(ptAdidos);
  assert.equal(ptAdidos.source, 'military_dict');
  assert.ok(ptAdidos.contextualMeaning.toLowerCase().includes('attach'));

  const ptProntidao = lookupLocalWord('pt', 'prontidão');
  assert.ok(ptProntidao);
  assert.equal(ptProntidao.source, 'military_dict');
  assert.ok(ptProntidao.contextualMeaning.toLowerCase().includes('readiness'));
});

test('lookupLocalWord resolves basic Spanish and Portuguese words instantly with 0 API calls', () => {
  installMockLocalStorage();

  const esWord = lookupLocalWord('es', 'empezar');
  assert.ok(esWord);
  assert.equal(esWord.source, 'dictionary');
  assert.ok(esWord.contextualMeaning.toLowerCase().includes('start'));

  const ptWord = lookupLocalWord('pt', 'embora');
  assert.ok(ptWord);
  assert.equal(ptWord.source, 'dictionary');
  assert.ok(ptWord.contextualMeaning.toLowerCase().includes('although'));

  const unknown = lookupLocalWord('es', 'termino_desconocido_xyz');
  assert.equal(unknown, null);
});

test('lookupLocalWord prioritizes user Vocab Vault over military dict, core dict, and localStorage cache', () => {
  installMockLocalStorage();

  const customVault: VocabItem[] = [
    {
      id: 'v-1',
      term: 'fragata',
      englishConcept: 'custom unit frigate callsign definition',
      contextSentence: 'La fragata zarpa al amanecer.',
      registerTag: 'Custom Tactical',
      category: 'Operational/Military Terms',
      language: 'es',
      dialect: 'neutral_latam',
      domain: 'maritime_surveillance',
      createdAt: '2026-11-22T00:00:00Z',
      mastery: 'practicing',
      reviewCount: 1,
    },
  ];
  const hit = lookupLocalWord('es', 'fragatas', customVault);
  assert.ok(hit);
  assert.equal(hit.source, 'vault');
  assert.equal(hit.contextualMeaning, 'custom unit frigate callsign definition');
});

test('saveWordToLocalCache persists raw and lemmatized keys in localStorage and survives reload', () => {
  const storage = installMockLocalStorage();

  saveWordToLocalCache(
    'es',
    {
      word: 'acarrear',
      contextualMeaning: 'to entail / bring about (consequences)',
      registerTag: 'Formal / Diplomatic',
      grammarNote: 'Common ILR 3 policy verb.',
      suggestedCategory: 'High-Register Connectors',
    },
    'acarrearía'
  );

  // Verify persisted to v2 storage key
  const rawStored = storage.getItem('linguaforge_word_cache_v2');
  assert.ok(rawStored);
  assert.ok(rawStored.includes('es:acarrear'));
  assert.ok(rawStored.includes('es:acarrearia'));

  // Simulate fresh browser reload by clearing in-memory cache
  resetInMemoryCacheForTests();

  const hitInflected = lookupLocalWord('es', 'acarrearía');
  assert.ok(hitInflected);
  assert.equal(hitInflected.source, 'cache');
  assert.ok(hitInflected.contextualMeaning.includes('entail'));

  const hitBase = lookupLocalWord('es', 'acarrear');
  assert.ok(hitBase);
  assert.equal(hitBase.source, 'cache');

  // Verify stats and selective cache clearing
  const statsBefore = getLocalCacheStats('es');
  assert.ok(statsBefore.militaryCount >= 90);
  assert.equal(statsBefore.cachedWordCount, 2);

  clearWordCacheOnly();
  const statsAfter = getLocalCacheStats('es');
  assert.equal(statsAfter.cachedWordCount, 0);
  assert.equal(lookupLocalWord('es', 'acarrear'), null);
  // Built-in military dictionary still works after clearing dynamic word cache
  assert.equal(lookupLocalWord('es', 'fragata')?.source, 'military_dict');
});

test('legacy v1 localStorage word cache migrates seamlessly into v2 on first read', () => {
  const storage = installMockLocalStorage({
    linguaforge_word_cache_v1: JSON.stringify({
      'pt:semissubmersivel': {
        word: 'semissubmersível',
        contextualMeaning: 'semi-submersible craft',
        registerTag: 'Operational / Naval',
        grammarNote: 'Used in maritime counter-narcotics.',
        suggestedCategory: 'Operational/Military Terms',
      },
    }),
  });

  const migratedHit = lookupLocalWord('pt', 'semissubmersível');
  assert.ok(migratedHit);
  assert.equal(migratedHit.source, 'cache');
  assert.equal(migratedHit.contextualMeaning, 'semi-submersible craft');
  assert.equal(storage.getItem('linguaforge_word_cache_v1'), null);
  assert.ok(storage.getItem('linguaforge_word_cache_v2'));
});

test('getOfflineMilitaryEntries returns sorted, language-isolated military lexicons', () => {
  const esList = getOfflineMilitaryEntries('es');
  const ptList = getOfflineMilitaryEntries('pt');
  assert.ok(esList.length >= 90);
  assert.ok(ptList.length >= 90);
  assert.ok(esList.some((e) => e.term === 'patrullaje'));
  assert.ok(!esList.some((e) => e.term === 'prontidão'));
  assert.ok(ptList.some((e) => e.term === 'prontidão'));
  assert.ok(!ptList.some((e) => e.term === 'patrullaje'));
});

test('lookupLocalTotPhrase resolves common English concepts offline', () => {
  installMockLocalStorage();
  const esSchedule = lookupLocalTotPhrase('es', 'schedule');
  assert.ok(esSchedule);
  assert.equal(esSchedule.source, 'dictionary');
  assert.ok(esSchedule.targetPhrase.includes('cronograma'));

  const ptFollowUp = lookupLocalTotPhrase('pt', 'to follow up');
  assert.ok(ptFollowUp);
  assert.equal(ptFollowUp.source, 'dictionary');
  assert.ok(ptFollowUp.targetPhrase.includes('seguimento'));
});
