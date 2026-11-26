import test from 'node:test';
import assert from 'node:assert/strict';
import {detectClassificationMarking, findClassificationMarkingInTexts} from './classificationGuard.ts';

test('detects banner classification markings', () => {
  const positives = [
    'TOP SECRET',
    'SECRET',
    'CONFIDENTIAL',
    'TOP SECRET//SI//TK//NOFORN',
    'SECRET//NOFORN',
    'SECRET//REL TO USA, GBR',
    'CONFIDENTIAL//ORCON',
    'UNCLASSIFIED//FOUO',
    'UNCLASSIFIED//FOR OFFICIAL USE ONLY',
    'CUI',
    'CUI//SP-MIL',
    'TS//SI//NF',
    'S//NF',
    'C//NOFORN',
    'U//FOUO',
    'U//CUI',
  ];

  for (const sample of positives) {
    const match = detectClassificationMarking(sample);
    assert.ok(match, `Expected banner marking to be detected: "${sample}"`);
  }
});

test('detects control and dissemination caveats', () => {
  const positives = [
    'Distribution limited: NOFORN',
    'Handle as FOUO only',
    'For Official Use Only — internal draft',
    'Controlled Unclassified Information',
    'Marking: REL TO USA, FVEY',
    'Originator controlled (ORCON)',
    'PROPIN data attached',
    'RELIDO authorized',
    'Classified By: 1234567',
    'Derived From: Multiple Sources',
    'Declassify On: 20501231',
  ];

  for (const sample of positives) {
    const match = detectClassificationMarking(sample);
    assert.ok(match, `Expected control marking to be detected: "${sample}"`);
  }
});

test('detects portion markings in paragraphs', () => {
  const positives = [
    '(TS) The exercise began at 0400Z.',
    '(S) El patrullaje conjunto se realizó en la zona norte.',
    '(C) A delegação chegou na terça-feira.',
    '(S//NF) Operational readiness metrics.',
    '(TS//SI//NOFORN) Signal intercept summary.',
    '(C//REL TO USA, GBR) Shared maritime update.',
    '(U//FOUO) Internal logistics schedule.',
    '(U//CUI) Training roster.',
    '(CUI) Budget projections for next quarter.',
    '(FOUO) Draft memo.',
    '(REL TO USA) Bilateral summary.',
  ];

  for (const sample of positives) {
    const match = detectClassificationMarking(sample);
    assert.ok(match, `Expected portion marking to be detected: "${sample}"`);
    assert.equal(match.category, 'portion_marking');
  }
});

test('does not false-positive on normal English, Spanish, and Portuguese prose', () => {
  const negatives = [
    'Es un secreto a voces que la cooperación marítima mejora la seguridad regional.',
    'Sí, creo que sería conveniente ampliar el intercambio de información pública.',
    'A reunião confidencial dos ministros foi noticiada pela imprensa internacional.',
    'O cuidado com a manutenção preventiva garante a prontidão operacional.',
    'It is no secret that bilateral exercises strengthen regional trust.',
    'Please keep our conversation confidential when discussing study habits.',
    'Inspect the vessel(s) near the port (c) 2026 Open Maritime Atlas.',
    'En relación con el acuerdo, cada país conserva su soberanía jurisdiccional.',
    'Este exercício utiliza apenas material aberto e UNCLASSIFIED.',
    'Si se redujera el presupuesto, las armadas tendrían que priorizar sensores.',
    'No obstante, persisten desafíos logísticos en la zona económica exclusiva.',
  ];

  for (const sample of negatives) {
    const match = detectClassificationMarking(sample);
    assert.equal(match, null, `Unexpected false positive on: "${sample}" -> ${JSON.stringify(match)}`);
  }
});

test('findClassificationMarkingInTexts scans mixed inputs and stops on first hit', () => {
  assert.equal(findClassificationMarkingInTexts([null, 42, 'Hola, ¿cómo estás?', 'Tudo bem.']), null);

  const hit = findClassificationMarkingInTexts([
    'Normal opening message',
    'Here is a line with (S//NF) inside it',
    'Another line',
  ]);
  assert.ok(hit);
  assert.equal(hit.matchedText, '(S//NF)');
});

test('obfuscated markings are still detected (REVIEW H-5)', () => {
  const obfuscated = [
    'SEC​RET', // zero-width space
    'NO­FORN', // soft hyphen
    'ＳＥＣＲＥＴ', // fullwidth
    'ЅECRET', // Cyrillic S
    'NОFORN', // Cyrillic O
    'N.O.F.O.R.N',
    'S E C R E T',
    'T-O-P S-E-C-R-E-T',
    '( S )',
    '( TS//SI )',
    'rel to usa',
    'Rel To FVEY',
  ];
  for (const text of obfuscated) {
    assert.ok(detectClassificationMarking(text), `should detect ${JSON.stringify(text)}`);
  }
});

test('normalization adds no false positives on prose with abbreviations (REVIEW H-5)', () => {
  const prose = [
    'La O.N.U. y la O.E.A. se reunieron en EE. UU. con representantes de la U.E.',
    'A C.I.A. e o F.B.I. aparecem no filme; a S.A. anunciou lucros.',
    'T. S. Eliot escribió poemas; el 1º de mayo hubo desfile.',
    'Los barco(s) llegaron ( a tiempo ) al puerto.',
    'O segredo está na preparação; el secreto es practicar.',
    'Eu relato ao chefe; the relation to the budget is unclear.',
  ];
  for (const text of prose) {
    assert.equal(detectClassificationMarking(text), null, `false positive on ${JSON.stringify(text)}`);
  }
});
