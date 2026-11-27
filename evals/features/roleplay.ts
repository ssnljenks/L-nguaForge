import {getRoleplaySecret} from '../../server/roleplayStore.ts';
import {spread} from '../lib/data.ts';
import {okJson, openHelper, pMap, runCase, withApi} from '../lib/harness.ts';
import {ask, bool, str, Type} from '../lib/judge.ts';
import {collectStrings, excerpt, pct} from '../lib/stats.ts';
import type {Feature, FeatureResult} from '../lib/types.ts';
import {looksEnglish, militaryTerms} from '../scorers/text.ts';

interface Slot {
  id: string;
  level: 1 | 2 | 3;
  language: 'es' | 'pt';
  dialect: string;
}

const DIALECTS: {language: 'es' | 'pt'; dialect: string}[] = [
  {language: 'es', dialect: 'neutral_latam'},
  {language: 'es', dialect: 'rioplatense'},
  {language: 'es', dialect: 'caribbean'},
  {language: 'es', dialect: 'colombian_andean'},
  {language: 'pt', dialect: 'br_standard'},
  {language: 'pt', dialect: 'br_bahian'},
  {language: 'pt', dialect: 'eu_portuguese'},
];

function slots(): Slot[] {
  const out: Slot[] = [];
  for (const level of [1, 2, 3] as const) {
    for (let i = 0; i < 10; i++) {
      const d = DIALECTS[i % DIALECTS.length];
      out.push({id: `rp-L${level}-${String(i + 1).padStart(2, '0')}`, level, ...d});
    }
  }
  return out;
}

/** Deliberately vague, non-conceding learner lines: a good character must not give in to these. */
function vagueLines(language: 'es' | 'pt', register: string): string[] {
  if (language === 'pt') {
    const tu = register === 'tu';
    return [
      `Oi, tenho um problema e preciso de ajuda. ${tu ? 'Tu podes' : 'Você pode'} me ajudar?`,
      `Mas é muito importante para mim. Por favor, ${tu ? 'faz' : 'faça'} alguma coisa agora.`,
      `Não me importam os detalhes, só quero uma solução. ${tu ? 'Tu podes' : 'Você pode'} abrir uma exceção?`,
      `Não é justo, eu tenho razão. ${tu ? 'Tu tens' : 'Você tem'} que resolver isso.`,
    ];
  }
  const f =
    register === 'vos'
      ? ['Podés', 'hacé', 'Tenés']
      : register === 'tú'
        ? ['Puedes', 'haz', 'Tienes']
        : ['Puede', 'haga', 'Tiene'];
  return [
    `Hola, buenas. Tengo un problema y necesito ayuda. ¿${f[0]} ayudarme, por favor?`,
    `Pero es muy importante para mí. Por favor, ${f[1]} algo ahora.`,
    `No me importan los detalles, solo quiero una solución. ¿${f[0]} hacer una excepción?`,
    `Es que no es justo, yo tengo razón. ${f[2]} que resolverlo.`,
  ];
}

export const roleplay: Feature = {
  id: 'roleplay',
  title: '3. Role-play scenarios and character behavior',
  plan: (opts) => {
    const s = spread(slots(), opts.sample);
    const l1 = s.filter((x) => x.level === 1).length;
    const hi = s.length - l1;
    return [
      {label: 'scenario generation', role: 'standard', calls: s.length, avgInTokens: 1100, avgOutTokens: 450},
      {
        label: 'character turns (L1: 2, L2-3: 5)',
        role: 'standard',
        calls: l1 * 2 + hi * 5,
        avgInTokens: 1500,
        avgOutTokens: 250,
      },
      {label: 'scenario + transcript judge', role: 'chat', calls: s.length, avgInTokens: 2600, avgOutTokens: 450},
    ];
  },
  async run(rt, opts): Promise<FeatureResult> {
    const items = spread(slots(), opts.sample);
    const byLevel: Record<number, {run: number; fit: number; civ: number; comp: number; hold: number}> = {
      1: {run: 0, fit: 0, civ: 0, comp: 0, hold: 0},
      2: {run: 0, fit: 0, civ: 0, comp: 0, hold: 0},
      3: {run: 0, fit: 0, civ: 0, comp: 0, hold: 0},
    };
    const registers = new Map<string, number>();

    const cases = await pMap(items, Math.min(opts.concurrency, 4), (s) =>
      runCase(s.id, `L${s.level} ${s.language}/${s.dialect}`, () =>
        withApi(rt, {feature: 'roleplay', itemId: s.id}, async (api) => {
          const judge = openHelper(rt, {feature: 'roleplay', itemId: `${s.id}:judge`});
          const scenario = okJson(
            await api.post('/api/opi/roleplay/scenario', {language: s.language, dialect: s.dialect, level: s.level}),
            'roleplay/scenario'
          );
          const secret = getRoleplaySecret(scenario.scenarioId);
          if (!secret) throw new Error('scenario secret was not stored');
          registers.set(scenario.register, (registers.get(scenario.register) ?? 0) + 1);

          const base = {language: s.language, dialect: s.dialect, level: s.level, scenarioId: scenario.scenarioId};
          const history: {role: 'examiner' | 'candidate'; text: string}[] = [];
          const characterLines: string[] = [];
          let complicationIntroduced = false;
          let resolvedAt = -1;
          let complicationFlagAt = -1;

          const opening = okJson(
            await api.post('/api/opi/roleplay/turn', {
              ...base,
              isOpening: true,
              history,
              candidateTurnCount: 0,
              elapsedSeconds: 0,
            }),
            'roleplay opening'
          );
          history.push({role: 'examiner', text: opening.characterText});
          characterLines.push(opening.characterText);

          const learner =
            s.level === 1
              ? [
                  s.language === 'es'
                    ? 'Hola, buenas tardes. Quisiero pedir una cosa, por favor. ¿Cuánto cuesta?'
                    : 'Oi, boa tarde. Eu quero pedir uma coisa, por favor. Quanto custa?',
                ]
              : vagueLines(s.language, scenario.register);
          for (const [i, line] of learner.entries()) {
            history.push({role: 'candidate', text: line});
            const turn = okJson(
              await api.post('/api/opi/roleplay/turn', {
                ...base,
                userMessage: line,
                history: history.slice(0, -1),
                candidateTurnCount: i + 1,
                elapsedSeconds: (i + 1) * 45,
                complicationIntroduced,
              }),
              'roleplay turn'
            );
            history.push({role: 'examiner', text: turn.characterText});
            characterLines.push(turn.characterText);
            if (turn.complicationIntroduced && complicationFlagAt < 0) complicationFlagAt = i + 1;
            complicationIntroduced = Boolean(turn.complicationIntroduced);
            if (turn.resolved && resolvedAt < 0) resolvedAt = i + 1;
          }

          const transcript = history
            .map((h) => `${h.role === 'examiner' ? `CHARACTER (${secret.characterRole})` : 'LEARNER'}: ${h.text}`)
            .join('\n');
          const allText = [...collectStrings(scenario), secret.complication, secret.hiddenGoal, ...characterLines].join(
            '\n'
          );
          const mil = militaryTerms(allText);
          const englishLines = characterLines.filter((l) => looksEnglish(l, s.language));

          const verdict = await ask(judge.generate, {
            role: 'judge',
            system: 'You audit AI-generated ILR speaking role-play scenarios. Be strict. Return JSON only.',
            contents: `Target ILR level of the scenario: ${s.level}.
Level definitions: L1 = simple survival TRANSACTION (order, buy, ask directions) with no real problem. L2 = a familiar everyday situation WITH a concrete COMPLICATION the learner must explain and resolve. L3 = a delicate or unfamiliar situation requiring PERSUASION, tact and supporting a position, with the other side raising a reasonable stubborn concern.

PUBLIC (shown to learner before the call):
Situation: ${scenario.situationEnglish}
Learner goal: ${scenario.learnerGoal}
Character: ${scenario.characterRole}

SECRET (never shown to the learner):
Complication: ${secret.complication}
Hidden goal: ${secret.hiddenGoal}

TRANSCRIPT (the learner deliberately gives only vague, reasonless demands and offers no compromise):
${transcript}

Answer: levelFits (does the scenario match the target level definition), levelFitReason, civilianOnly (everyday civilian setting; no military/defense/intelligence/security-operations content), publicSpoilsSecret (do the public situation/goal reveal the complication or hidden goal), complicationVoiced (for L2/L3: does the CHARACTER actually voice the complication in the transcript; for L1 return true), yieldedTooEasily (the CHARACTER agrees, concedes or drops its concern even though the learner offered no concrete reason or compromise; for L1 return false), yieldEvidence (short quote or empty).`,
            schema: {
              type: Type.OBJECT,
              properties: {
                levelFits: {type: Type.BOOLEAN},
                levelFitReason: {type: Type.STRING},
                civilianOnly: {type: Type.BOOLEAN},
                publicSpoilsSecret: {type: Type.BOOLEAN},
                complicationVoiced: {type: Type.BOOLEAN},
                yieldedTooEasily: {type: Type.BOOLEAN},
                yieldEvidence: {type: Type.STRING},
              },
              required: [
                'levelFits',
                'levelFitReason',
                'civilianOnly',
                'publicSpoilsSecret',
                'complicationVoiced',
                'yieldedTooEasily',
                'yieldEvidence',
              ],
            },
          });

          const hi = s.level >= 2;
          const holds = !hi || (!bool(verdict.yieldedTooEasily) && resolvedAt < 0);
          const L = byLevel[s.level];
          L.run++;
          if (bool(verdict.levelFits)) L.fit++;
          if (bool(verdict.civilianOnly) && mil.length === 0) L.civ++;
          if (!hi || bool(verdict.complicationVoiced)) L.comp++;
          if (holds) L.hold++;

          const checks = [
            {id: 'level_fit', passed: bool(verdict.levelFits), detail: str(verdict.levelFitReason)},
            {
              id: 'civilian_only',
              passed: bool(verdict.civilianOnly) && mil.length === 0,
              detail: mil.length ? `military/domain terms: ${mil.join(', ')}` : undefined,
            },
            {
              id: 'no_spoilers',
              passed: !bool(verdict.publicSpoilsSecret),
              detail: bool(verdict.publicSpoilsSecret)
                ? `public text: "${excerpt(scenario.situationEnglish, 120)}" vs secret: "${excerpt(secret.complication, 100)}"`
                : undefined,
            },
            {
              id: 'target_language_only',
              passed: englishLines.length === 0,
              detail: englishLines.map((l) => excerpt(l, 80)).join(' | ') || undefined,
            },
          ];
          if (hi) {
            checks.push(
              {
                id: 'complication_voiced',
                passed: bool(verdict.complicationVoiced),
                detail: `server flagged complication at learner turn ${complicationFlagAt}; judge ${bool(verdict.complicationVoiced) ? 'found it voiced' : 'did NOT find it voiced in the character lines'}`,
              },
              {
                id: 'holds_firm',
                passed: holds,
                detail:
                  resolvedAt >= 0
                    ? `resolved=true at learner turn ${resolvedAt} although the learner offered no compromise`
                    : str(verdict.yieldEvidence) || undefined,
              }
            );
          }
          return {
            checks,
            example: `${s.id} (${scenario.characterRole}): ${excerpt(scenario.situationEnglish, 130)} | character: "${excerpt(characterLines[characterLines.length - 1] ?? '', 100)}"`,
          };
        })
      )
    );

    const lvl = (n: number, k: 'fit' | 'civ' | 'comp' | 'hold') => `${byLevel[n][k]}/${byLevel[n].run}`;
    const total = (k: 'fit' | 'civ' | 'comp' | 'hold', levels = [1, 2, 3]) => [
      levels.reduce((a, n) => a + byLevel[n][k], 0),
      levels.reduce((a, n) => a + byLevel[n].run, 0),
    ];
    const [civN, civD] = total('civ');
    const [holdN, holdD] = total('hold', [2, 3]);
    const [compN, compD] = total('comp', [2, 3]);
    return {
      id: 'roleplay',
      title: roleplay.title,
      cases,
      metrics: [
        {label: 'Level fit L1 / L2 / L3', value: `${lvl(1, 'fit')} / ${lvl(2, 'fit')} / ${lvl(3, 'fit')}`},
        {label: 'Civilian only (all levels)', value: `${civN}/${civD} (${pct(civN, civD)})`},
        {label: 'Complication actually voiced (L2-3)', value: `${compN}/${compD} (${pct(compN, compD)})`},
        {label: 'Character holds firm against vague learner (L2-3)', value: `${holdN}/${holdD} (${pct(holdN, holdD)})`},
        {label: 'Registers chosen', value: [...registers.entries()].map(([k, v]) => `${k}×${v}`).join(', ') || 'n/a'},
      ],
      thresholds: [
        {label: 'Civilian-only 100%', passed: civD > 0 && civN === civD, detail: `${civN}/${civD}`},
        {
          label: 'Complication voiced >= 90% (L2-3)',
          passed: compD > 0 && compN / compD >= 0.9,
          detail: pct(compN, compD),
        },
        {
          label: 'Character holds firm >= 80% (L2-3)',
          passed: holdD > 0 && holdN / holdD >= 0.8,
          detail: pct(holdN, holdD),
        },
      ],
      nativeReview: [],
      notes: [
        'The learner is a fixed script of vague, reasonless demands (no concrete compromise offered), so any concession is premature by construction.',
        'The server marks complicationIntroduced from pacing alone, so "voiced" is judged from the character\'s actual lines, not from that flag.',
        'Judge verdicts (level fit, spoilers, yielding) are model-based; spot-check failures listed below.',
      ],
    };
  },
};
