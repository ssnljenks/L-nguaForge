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

// REVIEW M-6: one table of real markings that must be caught and one of realistic learner text that
// must never get a 422. Ambiguous tokens ("(C)", "CUI", "relido") only count in marking context.
const TRUE_POSITIVES: readonly string[] = [
  'TOP SECRET',
  'SECRET',
  'CONFIDENTIAL',
  'SECRET//NOFORN',
  'TOP SECRET//SI//TK//NOFORN',
  'CONFIDENTIAL//REL TO USA, GBR',
  'UNCLASSIFIED//FOUO',
  'UNCLASSIFIED//FOR OFFICIAL USE ONLY',
  'CUI',
  'CUI//SP-PRVCY',
  'CUI\nControlled by: Division X',
  'CUI Category: PRVCY',
  'Resumen del informe\nSECRET\nEl buque zarpó a las 0400.',
  'SECRET SECTION 01 OF 02',
  'The file was marked SECRET and sent.',
  '(S) El patrullaje conjunto se realizó en la zona norte.',
  '(C) A delegação chegou na terça-feira.',
  '(TS) The exercise began at 0400Z.',
  'Primer párrafo sin marca. (S) Segundo párrafo con detalles.',
  '- (C) Item de lista com marca.',
  '(CUI) Budget projections for next quarter.',
  '(SBU) Contact roster.',
  '(S//NF) Operational readiness metrics.',
  '(U//FOUO) Internal logistics schedule.',
  '(FOUO) Draft memo.',
  'Originator controlled (ORCON)',
  'Distribution limited: NOFORN',
  'RELIDO authorized',
  'PROPIN data attached',
  'For Official Use Only — internal draft',
  'Controlled Unclassified Information',
  'Marking: REL TO USA, FVEY',
  'rel to usa',
  'Classified By: 1234567',
  'Derived From: Multiple Sources',
  'declassify on: 20501231',
  '(S) Primer párrafo.\n(C) Segundo párrafo.\n(U) Tercer párrafo.',
];

const LEARNER_SENTENCES: readonly string[] = [
  // Option lists
  'Las opciones son (A) ir al mercado, (B) quedarse en casa y (C) visitar a la abuela.',
  '(A) Hablo español.\n(B) Hablo inglés.\n(C) Hablo portugués.',
  '(A) Concordo. (B) Discordo. (C) Não sei.',
  'Respuesta: (C)',
  'Prefiero la opción (C) porque es más barata.',
  'Eu escolheria (B) ou (C), dependendo do preço.',
  'Option (S) is for small and option (M) is for medium.',
  // Copyright
  'Copyright (C) 2026 Editorial Planeta.',
  '(C) 2026 Open Maritime Atlas. Todos los derechos reservados.',
  'El texto tiene Copyright (C) de la editorial.',
  // CUI as the Guatemalan ID and as a name
  'Mi CUI es 2345 67890 0101 y lo necesito para el trámite.',
  'CUI: 2345 67890 0101',
  'En Guatemala, el Código Único de Identificación (CUI) aparece en el DPI.',
  'El CUI de mi madre está vencido.',
  'Mi amigo CUI Jian toca rock en Pekín.',
  'Perdí mi DPI y no recuerdo mi CUI.',
  // Spanish/Portuguese words with marking-like substrings
  'O livro foi relido três vezes antes da prova.',
  'Relido o contrato, assinamos sem problemas.',
  'Dejé una buena propina al mesero.',
  'La SECRETARÍA DE MARINA publicó un comunicado.',
  'A Secretaria de Educação anunciou novas regras.',
  'Es un secreto a voces; la reunión fue confidencial.',
  'O segredo é confidencial, mas não é secreto.',
  'La información es CONFIDENCIAL según el abogado.',
  'Vivo en la C/ Mayor, s/n, cerca del centro.',
  'TypeScript (TS) es mi lenguaje favorito.',
  'Trabajo en una SBU (unidad estratégica de negocio).',
  'Los barco(s) llegaron a tiempo.',
  // Shouting and titles
  'MI PELÍCULA FAVORITA ES THE SECRET LIFE OF PETS.',
  'IT IS A BIG SECRET, DON T TELL ANYONE!',
  'Vi el documental TOP SECRET ROSIES ayer.',
  // Lowercase phrases that only count in marking case
  'Estos coches son for official use only, dijo el guardia.',
  'The word is derived from: Latin secretus.',
  'Los animales son classified by: tamaño y color.',
  'Eu relato ao chefe; the rel to the budget is unclear.',
];

test('classification guard catches real markings (REVIEW M-6 table)', () => {
  assert.ok(TRUE_POSITIVES.length >= 30);
  for (const text of TRUE_POSITIVES) {
    assert.ok(detectClassificationMarking(text), `should detect ${JSON.stringify(text)}`);
  }
});

test('classification guard never rejects realistic learner text (REVIEW M-6 table)', () => {
  assert.ok(LEARNER_SENTENCES.length >= 30);
  for (const text of LEARNER_SENTENCES) {
    const match = detectClassificationMarking(text);
    assert.equal(match, null, `false positive on ${JSON.stringify(text)} -> ${JSON.stringify(match)}`);
  }
});
