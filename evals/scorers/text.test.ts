import assert from 'node:assert/strict';
import test from 'node:test';
import {DIALECTS, matches, slangDensity} from './dialects.ts';
import {containsNorm, looksEnglish, militaryTerms, tokenOverlap, workTerms} from './text.ts';
import {omissionHits, spanHits} from '../features/gist.ts';

test('language detection', () => {
  assert.equal(looksEnglish('Sure, I can help you with that and we will start now.', 'es'), true);
  assert.equal(looksEnglish('Claro, ¿qué hiciste el fin de semana pasado con tu familia?', 'es'), false);
  assert.equal(looksEnglish('Claro, o que você fez no fim de semana com a sua família?', 'pt'), false);
});

test('military terms: detects es/pt/en, ignores civilian text, respects word boundaries', () => {
  assert.deepEqual(militaryTerms('Sirvió en el ejército y luego estudió.'), ['ejército']);
  assert.deepEqual(militaryTerms('O exército e a marinha de guerra'), ['exército', 'marinha de guerra']);
  assert.deepEqual(militaryTerms('Fuimos al mercado y compramos frutas.'), []);
  assert.deepEqual(militaryTerms('Una armadura medieval'), []);
});

test('work terms', () => {
  assert.ok(workTerms('¿En qué trabajas?').length > 0);
  assert.equal(workTerms('¿Qué haces los fines de semana?').length, 0);
});

test('overlap helpers', () => {
  assert.ok(containsNorm('El Ejército llegó', 'ejercito'));
  assert.ok(tokenOverlap('water supply cut', 'the water supply will be cut') > 0.9);
});

test('gist span matching', () => {
  assert.ok(
    spanHits(
      'Experts said the project should be copied in every school',
      'Experts said the project should be copied in every school in the country.'
    )
  );
  assert.ok(!spanHits('Attendance rose', 'The prize was presented by the president.'));
  assert.ok(
    omissionHits(
      {description: 'Missing the tanker trucks', sourceQuote: 'La empresa repartirá agua en camiones cisterna'},
      {
        type: 'omission',
        sourceSentence:
          'La empresa repartirá agua en camiones cisterna y habilitará dos puntos de entrega en la plaza central y en el polideportivo.',
        keyTerms: ['cisterna'],
      }
    )
  );
});

test('dialect markers: voseo vs tuteo, European vs Brazilian Portuguese', () => {
  const mateo = DIALECTS['es-ba-mateo'];
  assert.ok(mateo.required.flatMap((r) => matches('¿Vos tenés planes? Contame.', r.patterns)).length >= 3);
  assert.ok(mateo.forbidden.flatMap((f) => matches('¿Tú tienes planes?', f.patterns)).length >= 1);
  const tiago = DIALECTS['pt-lis-tiago'];
  assert.ok(
    tiago.required.flatMap((r) => matches('Estou a pensar em ir ao café. Diz-me, tu queres vir?', r.patterns)).length >=
      2
  );
  assert.ok(tiago.forbidden.flatMap((f) => matches('Estou estudando e vou pegar o ônibus.', f.patterns)).length >= 1);
  const lucas = DIALECTS['pt-rio-lucas'];
  assert.ok(lucas.forbidden.flatMap((f) => matches('Estou a fazer o pequeno-almoço, pá.', f.patterns)).length >= 1);
  assert.equal(lucas.forbidden.flatMap((f) => matches('Tô fazendo café, cara, vem pra cá.', f.patterns)).length, 0);
  assert.ok(
    slangDensity('parce qué bacano', DIALECTS['es-med-valeria']) >
      slangDensity('hola qué tal amigo mío', DIALECTS['es-med-valeria'])
  );
});
