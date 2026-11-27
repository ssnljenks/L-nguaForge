import type {GenerateStructured} from '../../server/gemini.ts';

type SchemaNode = {type?: string; properties?: Record<string, SchemaNode>; items?: SchemaNode; enum?: string[]};

/** Builds schema-shaped dummy data. Used only by offline tests to exercise plumbing: its output carries no quality signal. */
export function dummyFromSchema(schema: SchemaNode | undefined, key = ''): unknown {
  if (!schema) return null;
  switch (String(schema.type).toUpperCase()) {
    case 'OBJECT':
      return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([k, v]) => [k, dummyFromSchema(v, k)]));
    case 'ARRAY':
      return schema.items ? [dummyFromSchema(schema.items, key)] : [];
    case 'INTEGER':
    case 'NUMBER':
      return 0;
    case 'BOOLEAN':
      return false;
    default:
      return key === 'text' ? 'respuesta de prueba del candidato' : 'texto de prueba suficientemente largo';
  }
}

/** Stub generator with a hook for call sites that need valid-looking structured data. */
export function createStubGenerator(calls: {model: string; contents: string}[] = []): GenerateStructured {
  return async (request) => {
    calls.push({model: request.model, contents: request.contents});
    const schema = request.responseSchema as SchemaNode;
    const base = dummyFromSchema(schema) as Record<string, unknown>;
    if (schema.properties?.questions?.items?.properties?.choices) {
      const passage =
        /<<<BEGIN SOURCE_PASSAGE \w+>>>\n([\s\S]*?)\n<<<END SOURCE_PASSAGE/.exec(request.contents)?.[1] ?? '';
      const quote = passage.split(/\s+/).slice(0, 10).join(' ');
      const trap = ['mentioned_not_answer', 'wrong_detail', 'over_inference'];
      base.questions = [0, 1].map((n) => ({
        questionEnglish: `According to the passage, what is item number ${n + 1} about?`,
        questionType: 'detail',
        correctIndex: n,
        sourceQuote: quote,
        choices: [0, 1, 2, 3].map((i) => ({
          text: `Option ${i} for question ${n}`,
          justification: 'Because the passage says so, quoting the text.',
          trapType: i === n ? 'none' : trap[(i + n) % 3],
        })),
        targetVocabulary: [{term: 'x', english: 'y'}],
      }));
    }
    return base;
  };
}
