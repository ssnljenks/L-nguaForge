import type {RoleplayRegister, TargetLanguage} from '../types.ts';

export interface TutorScene {
  id: string;
  label: string;
  promptHint: string;
}

export interface TutorColloquialExample {
  term: string;
  meaning: string;
  example: string;
}

export interface TutorPersona {
  id: string;
  name: string;
  city: string;
  regionTag: string;
  language: TargetLanguage;
  dialectId: string;
  bio: string;
  defaultRegister: RoleplayRegister;
  signatureFeatures: string[];
  slangExamples: TutorColloquialExample[];
  scenes: TutorScene[];
}

export const WORK_TALK_SCENE_ID = 'work_talk';
export const DEFAULT_SCENE_ID = 'just_chatting';

export const TUTORS: readonly TutorPersona[] = [
  {
    id: 'es-ba-mateo',
    name: 'Mateo',
    city: 'Buenos Aires',
    regionTag: 'Rioplatense',
    language: 'es',
    dialectId: 'rioplatense',
    bio: 'Sound engineer & neighborhood café regular from Villa Crespo.',
    defaultRegister: 'vos',
    signatureFeatures: [
      'Voseo verbs (vos tenés, vos hablás, decime)',
      'Sheísmo ("sh" sound for ll and y)',
      'Lunfardo & River Plate fillers (che, dale, re)',
    ],
    slangExamples: [
      {term: 'laburo', meaning: 'work / job', example: '¿Cómo estuvo el laburo hoy, che?'},
      {term: 're copado', meaning: 'really cool / great', example: 'Ese lugar del barrio está re copado.'},
      {term: 'bondi', meaning: 'city bus', example: 'Me tomé el bondi temprano para esquivar el tránsito.'},
      {term: 'posta', meaning: 'for real / seriously', example: '¿Posta me decís? Qué buena noticia.'},
      {term: 'bárbaro', meaning: 'awesome / sounds great', example: 'Dale, nos vemos el sábado, ¡bárbaro!'},
      {term: 'quilombo', meaning: 'mess / hassle', example: 'El centro a las cinco es un quilombo bárbaro.'},
      {term: 'che', meaning: 'hey / buddy', example: 'Che, ¿probaste las empanadas de la esquina?'},
    ],
    scenes: [
      {
        id: DEFAULT_SCENE_ID,
        label: 'Just chatting',
        promptHint: 'Casual catch-up between friends about daily life, weekend plans, food, or music.',
      },
      {
        id: 'asado',
        label: 'Asado with friends',
        promptHint: 'Hanging out around a Sunday asado grill in Buenos Aires, trading stories and music picks.',
      },
      {
        id: 'taxi_bondi',
        label: 'Taxi / bondi ride',
        promptHint: 'Chatting with a local Porteño about traffic, neighborhoods, and getting around the city.',
      },
      {
        id: 'futbol',
        label: 'Fútbol match',
        promptHint: 'Discussing last weekend’s football match, neighborhood rivalries, and stadium atmosphere.',
      },
      {
        id: 'cafe_porteño',
        label: 'Corner café',
        promptHint: 'Over coffee and medialunas at a classic Buenos Aires café, talking culture and travel.',
      },
    ],
  },
  {
    id: 'es-med-valeria',
    name: 'Valeria',
    city: 'Medellín',
    regionTag: 'Colombian Paisa',
    language: 'es',
    dialectId: 'colombian_andean',
    bio: 'Industrial designer who loves mountain biking and coffee farms in Antioquia.',
    defaultRegister: 'vos',
    signatureFeatures: [
      'Paisa "pues" cadence and warm politeness',
      'Regional voseo & friendly usted blend',
      'Local Paisa words (parce, bacano, tinto, camello)',
    ],
    slangExamples: [
      {term: 'parce', meaning: 'friend / buddy', example: '¡Qué más, parce! ¿Cómo va todo por allá?'},
      {
        term: 'qué más pues',
        meaning: 'hey, how are you doing?',
        example: 'Hola, qué más pues, hace rato no charlábamos.',
      },
      {term: 'bacano', meaning: 'cool / nice', example: 'Qué plan tan bacano para el domingo.'},
      {term: 'camello', meaning: 'work / hustle', example: 'Esta semana estuve con bastante camello.'},
      {term: 'tinto', meaning: 'small black coffee', example: '¿Nos tomamos un tintico antes de seguir?'},
      {term: 'charro', meaning: 'funny / odd (in Paisa Spanish)', example: 'Me pasó algo súper charro en el metro.'},
      {term: 'amañado', meaning: 'feeling comfortable / settled in', example: 'Uno queda muy amañado en este clima.'},
    ],
    scenes: [
      {
        id: DEFAULT_SCENE_ID,
        label: 'Just chatting',
        promptHint: 'Friendly, unhurried Paisa conversation about life, hobbies, food, and recent trips.',
      },
      {
        id: 'tinto_terraza',
        label: 'Morning tinto',
        promptHint: 'Sharing a black coffee on a balcony overlooking the Aburrá Valley.',
      },
      {
        id: 'mercado_paisa',
        label: 'Street market',
        promptHint: 'Walking past fruit stalls and talking fresh mangos, arepas, and neighborhood life.',
      },
      {
        id: 'taxi_subida',
        label: 'Taxi ride',
        promptHint: 'Chatting in traffic up toward El Poblado or Laureles about local spots to visit.',
      },
      {
        id: 'pueblo_fin',
        label: 'Weekend pueblo trip',
        promptHint: 'Planning a relaxing Saturday trip out to Santa Fe de Antioquia or Guatapé.',
      },
    ],
  },
  {
    id: 'es-sj-carlos',
    name: 'Carlos',
    city: 'San Juan',
    regionTag: 'Caribbean',
    language: 'es',
    dialectId: 'caribbean',
    bio: 'Music producer & weekend surfer from Santurce.',
    defaultRegister: 'tú',
    signatureFeatures: [
      'Aspirated or soft final -s in fast speech',
      'Pre-verbal subject questions (¿Qué tú dices?)',
      'Boricua expressions (corillo, janguear, brutal)',
    ],
    slangExamples: [
      {term: 'janguear', meaning: 'to hang out', example: 'Vamos a janguear un rato por Santurce.'},
      {term: 'corillo', meaning: 'crew / group of friends', example: 'El corillo se reúne hoy en la playa.'},
      {term: 'brutal', meaning: 'awesome / intense', example: 'Ese concierto estuvo brutal, de verdad.'},
      {term: 'chévere', meaning: 'cool / great', example: '¡Qué chévere que pudiste venir hoy!'},
      {term: 'tapón', meaning: 'traffic jam', example: 'Cogí un tapón enorme saliendo de Carolina.'},
      {term: 'guagua', meaning: 'bus / SUV / van', example: 'La guagua se tardó veinte minutos más.'},
      {term: 'wepa', meaning: 'expression of excitement / cheer', example: '¡Wepa! Ahí viene la comida.'},
    ],
    scenes: [
      {
        id: DEFAULT_SCENE_ID,
        label: 'Just chatting',
        promptHint: 'Laid-back Puerto Rican conversation about music, daily routine, and local culture.',
      },
      {
        id: 'chinchorro',
        label: 'Beach chinchorro',
        promptHint: 'Hanging out at a coastal food stand talking about mofongo, ocean breeze, and music.',
      },
      {
        id: 'placita',
        label: 'La Placita market',
        promptHint: 'Browsing fresh fruit vendors in Santurce as the evening salsa crowd warms up.',
      },
      {
        id: 'tapon_autopista',
        label: 'Stuck in traffic',
        promptHint: 'Passing the time chatting on the road about local radio, coffee stops, and shortcuts.',
      },
      {
        id: 'dominoes',
        label: 'Dominoes on the porch',
        promptHint: 'Casual banter over afternoon dominoes with neighbors and cold drinks.',
      },
    ],
  },
  {
    id: 'es-cdmx-sofia',
    name: 'Sofía',
    city: 'Mexico City',
    regionTag: 'Mexican (CDMX)',
    language: 'es',
    dialectId: 'neutral_latam',
    bio: 'Illustrator & street-food enthusiast in Roma Norte.',
    defaultRegister: 'tú',
    signatureFeatures: [
      'Everyday CDMX idioms (chamba, qué padre, chido)',
      'Expressive diminutives (ahorita, cafecito, ratito)',
      'Polite "mande" and conversational "órale / qué onda"',
    ],
    slangExamples: [
      {term: 'chamba', meaning: 'job / work', example: 'Ando con mucha chamba esta semana.'},
      {term: 'qué padre', meaning: 'how cool / awesome', example: '¡Qué padre que vas a conocer Oaxaca!'},
      {term: 'chido', meaning: 'cool / nice', example: 'Ese parque queda súper chido en la tarde.'},
      {term: 'ahorita', meaning: 'right now / in a bit', example: 'Ahorita te cuento qué pasó ayer.'},
      {term: 'órale', meaning: 'alright / wow / go ahead', example: '¡Órale! No sabía que cocinabas tan bien.'},
      {term: 'qué onda', meaning: 'what’s up / how is it going', example: '¿Qué onda? ¿Cómo te fue hoy?'},
      {term: 'mande', meaning: 'pardon? / yes? (polite CDMX)', example: '¿Mande? No te escuché bien.'},
    ],
    scenes: [
      {
        id: DEFAULT_SCENE_ID,
        label: 'Just chatting',
        promptHint: 'Warm Mexico City conversation about daily habits, street food, movies, or travel.',
      },
      {
        id: 'tacos_esquina',
        label: 'Street tacos',
        promptHint: 'Standing by a taco al pastor cart in Roma talking salsas and late-night favorites.',
      },
      {
        id: 'mercado_coyoacan',
        label: 'Coyoacán market',
        promptHint: 'Wandering a bustling neighborhood market picking out agua fresca and artisan crafts.',
      },
      {
        id: 'metro_cdmx',
        label: 'City commute',
        promptHint: 'Swapping stories about navigating traffic, bikes, and Metrobus lines in CDMX.',
      },
      {
        id: 'sobremesa',
        label: 'Sunday sobremesa',
        promptHint: 'Lingering after a long family lunch with coffee, jokes, and neighborhood gossip.',
      },
    ],
  },
  {
    id: 'pt-rio-lucas',
    name: 'Lucas',
    city: 'Rio de Janeiro',
    regionTag: 'Carioca',
    language: 'pt',
    dialectId: 'br_standard',
    bio: 'Surf instructor & acoustic guitar player in Zona Sul.',
    defaultRegister: 'você',
    signatureFeatures: [
      'Carioca "sh" sound on final -s (dois, pois é)',
      'Conversational reductions (tá, tô, cê, pra)',
      'Natural Rio fillers (cara, beleza, maneiro, pô)',
    ],
    slangExamples: [
      {term: 'maneiro', meaning: 'cool / awesome', example: 'Esse som ficou muito maneiro, cara.'},
      {term: 'cara', meaning: 'dude / buddy', example: 'E aí, cara, tudo tranquilo hoje?'},
      {term: 'perrengue', meaning: 'tight spot / hassle', example: 'Passei um perrengue para achar o endereço.'},
      {term: 'rolê', meaning: 'outing / hangout', example: 'Bora dar um rolê na orla depois?'},
      {term: 'beleza', meaning: 'all good / sounds great', example: 'Beleza, então a gente combina amanhã.'},
      {term: 'tranquilo', meaning: 'chill / no problem', example: 'Fica tranquilo, dá tempo sim.'},
      {term: 'fala aí', meaning: 'hey, what’s up', example: 'Fala aí! Como foi o fim de semana?'},
    ],
    scenes: [
      {
        id: DEFAULT_SCENE_ID,
        label: 'Just chatting',
        promptHint: 'Easygoing Carioca conversation about music, weekend plans, and daily life.',
      },
      {
        id: 'praia_posto',
        label: 'Beach at Posto 9',
        promptHint: 'Catching up near the boardwalk with coconut water and watching the ocean.',
      },
      {
        id: 'boteco',
        label: 'Boteco with friends',
        promptHint: 'Sitting at an open-air Rio boteco sharing petiscos and stories.',
      },
      {
        id: 'futebol_pelada',
        label: 'Neighborhood match',
        promptHint: 'Talking post-game highlights from a casual neighborhood soccer or futevôlei game.',
      },
      {
        id: 'feira_rio',
        label: 'Sunday street market',
        promptHint: 'Picking tropical fruit and pastel at a lively neighborhood feira.',
      },
    ],
  },
  {
    id: 'pt-ssa-camila',
    name: 'Camila',
    city: 'Salvador',
    regionTag: 'Bahian',
    language: 'pt',
    dialectId: 'br_bahian',
    bio: 'Cultural event coordinator living near Barra in Bahia.',
    defaultRegister: 'você',
    signatureFeatures: [
      'Warm, melodic Bahian intonation',
      'Interjections like oxe / oxente and visse',
      'Local slang (massa, barril, de boa, arretado)',
    ],
    slangExamples: [
      {term: 'oxe', meaning: 'whoa / wait / really?', example: 'Oxe, você nunca provou acarajé quentinho?'},
      {term: 'massa', meaning: 'great / cool', example: 'Que ideia massa para o feriado!'},
      {term: 'barril', meaning: 'intense / tough situation', example: 'O trânsito na Paralela hoje estava barril.'},
      {term: 'de boa', meaning: 'relaxed / all good', example: 'Hoje estou bem de boa em casa.'},
      {term: 'arretado', meaning: 'awesome / impressive', example: 'Esse show no Pelourinho foi arretado.'},
      {term: 'bora', meaning: 'let’s go / come on', example: 'Bora tomar um suco de cajá ali na esquina.'},
    ],
    scenes: [
      {
        id: DEFAULT_SCENE_ID,
        label: 'Just chatting',
        promptHint: 'Expressive, friendly Bahian conversation about daily life, culture, and food.',
      },
      {
        id: 'acaraje_barra',
        label: 'Acarajé by the bay',
        promptHint: 'Grabbing street food near Farol da Barra at sunset and chatting with locals.',
      },
      {
        id: 'pelourinho',
        label: 'Pelourinho music',
        promptHint: 'Listening to street samba-reggae rehearsals and talking local arts.',
      },
      {
        id: 'feira_baiana',
        label: 'Coastal market',
        promptHint: 'Chatting with vendors over fresh fruit, dendê spices, and weekend plans.',
      },
      {
        id: 'onibus_orla',
        label: 'Coastal bus ride',
        promptHint: 'Making easy conversation while riding along the Salvador coastline.',
      },
    ],
  },
  {
    id: 'pt-lis-tiago',
    name: 'Tiago',
    city: 'Lisbon',
    regionTag: 'Lisbon',
    language: 'pt',
    dialectId: 'eu_portuguese',
    bio: 'Architect & espresso connoisseur from Alfama.',
    defaultRegister: 'tu',
    signatureFeatures: [
      'European tu conjugation & enclitic pronouns (diz-me)',
      '"estar a + infinitive" (estou a pensar) instead of -ndo',
      'Lisbon vocabulary (fixe, giro, bica, autocarro, comboio)',
    ],
    slangExamples: [
      {term: 'fixe', meaning: 'cool / great', example: 'Isso parece mesmo fixe, pá!'},
      {term: 'giro', meaning: 'neat / lovely / charming', example: 'Aquele café na esquina é muito giro.'},
      {term: 'pá', meaning: 'man / mate (conversational filler)', example: 'Olha, pá, nem imaginas o que aconteceu.'},
      {term: 'bica', meaning: 'Lisbon espresso shot', example: 'Vou só beber uma bica rápida antes de sair.'},
      {term: 'desenrascar', meaning: 'improvise a clever fix', example: 'Não te preocupes, a gente desenrasca isso.'},
      {term: 'autocarro', meaning: 'city bus', example: 'Apanhei o autocarro mesmo à hora.'},
    ],
    scenes: [
      {
        id: DEFAULT_SCENE_ID,
        label: 'Just chatting',
        promptHint: 'Authentic Lisbon conversation using European phrasing about daily routine and travel.',
      },
      {
        id: 'esplanada',
        label: 'Bica at a terrace',
        promptHint: 'Having an espresso and pastel de nata outdoors at a Lisbon miradouro.',
      },
      {
        id: 'comboio_lisboa',
        label: 'Train & tram ride',
        promptHint: 'Chatting during the morning commute along the Tagus toward Cascais.',
      },
      {
        id: 'mercado_bairro',
        label: 'Neighborhood market',
        promptHint: 'Shopping for fresh bread, olives, and seasonal fruit at a local market.',
      },
      {
        id: 'tasca_futebol',
        label: 'Match night at a tasca',
        promptHint: 'Friendly banter over dinner at a neighborhood tavern during a football match.',
      },
    ],
  },
];

export function getTutorsByLanguage(language: TargetLanguage): TutorPersona[] {
  return TUTORS.filter((t) => t.language === language);
}

export function getTutorById(id: string | undefined | null): TutorPersona | undefined {
  if (!id) return undefined;
  return TUTORS.find((t) => t.id === id);
}

export function getDefaultTutor(language: TargetLanguage, dialectId?: string): TutorPersona {
  const list = getTutorsByLanguage(language);
  if (dialectId) {
    const match = list.find((t) => t.dialectId === dialectId);
    if (match) return match;
  }
  return list[0];
}
