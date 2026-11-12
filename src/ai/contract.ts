export type ContextSource = { id: string; text: string };
export const kinds = ['allocation', 'conditional_fund', 'action_conflict'] as const;
export type Proposal = {
  kind: (typeof kinds)[number];
  evidence: {
    sourceId: string;
    quote: string;
    target: string;
    number: string | null;
    unit: string | null;
    action: string | null;
    timing: string | null;
  }[];
  uncertainty: string;
  certainty: 'confirmed' | 'conditional' | 'unknown';
};
export const MAX_BYTES = 16000;
export const MAX_SOURCES = 8;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, names: string[]) => Object.keys(v).length === names.length && names.every((n) => n in v);
/** 전송 대상은 파일명 없는 선택 문장으로 제한하며 동의를 서버에서도 확인한다. */
export function readRequest(value: unknown): ContextSource[] {
  if (
    !object(value) ||
    !keys(value, ['consent', 'sources']) ||
    value.consent !== true ||
    !Array.isArray(value.sources) ||
    !value.sources.length ||
    value.sources.length > MAX_SOURCES
  )
    throw new Error('INVALID_REQUEST');
  const ids = new Set<string>();
  return value.sources.map((s: unknown) => {
    if (
      !object(s) ||
      !keys(s, ['id', 'text']) ||
      typeof s.id !== 'string' ||
      !/^s\d{1,4}$/.test(s.id) ||
      ids.has(s.id) ||
      typeof s.text !== 'string' ||
      !s.text.trim() ||
      s.text.length > 1200
    )
      throw new Error('INVALID_SOURCE');
    ids.add(s.id);
    return { id: s.id, text: s.text };
  });
}
/** 구조화 응답도 신뢰하지 않고 출처·인용·숫자·행동의 원문 일치를 재검사한다. */
export function readProposals(value: unknown, sources: ContextSource[]): Proposal[] {
  if (!object(value) || !keys(value, ['proposals']) || !Array.isArray(value.proposals) || value.proposals.length > 12)
    throw new Error('INVALID_OUTPUT');
  return value.proposals.map((p: unknown) => {
    if (
      !object(p) ||
      !keys(p, ['kind', 'evidence', 'uncertainty', 'certainty']) ||
      !['confirmed', 'conditional', 'unknown'].includes(p.certainty as string) ||
      !kinds.includes(p.kind as Proposal['kind']) ||
      typeof p.uncertainty !== 'string' ||
      p.uncertainty.length > 500 ||
      !Array.isArray(p.evidence) ||
      !p.evidence.length ||
      p.evidence.length > 8
    )
      throw new Error('INVALID_PROPOSAL');
    const evidence = p.evidence.map((e: unknown) => {
      if (
        !object(e) ||
        !keys(e, ['sourceId', 'quote', 'target', 'number', 'unit', 'action', 'timing']) ||
        typeof e.sourceId !== 'string' ||
        typeof e.quote !== 'string' ||
        !e.quote ||
        typeof e.target !== 'string' ||
        !e.target
      )
        throw new Error('INVALID_EVIDENCE');
      const source = sources.find((s) => s.id === e.sourceId);
      if (!source?.text.includes(e.quote) || !e.quote.includes(e.target)) throw new Error('UNSUPPORTED_SOURCE');
      for (const field of ['number', 'unit', 'action', 'timing'])
        if (e[field] !== null && (typeof e[field] !== 'string' || !e[field] || !e.quote.includes(e[field] as string)))
          throw new Error('UNSUPPORTED_LITERAL');
      if (
        e.number !== null &&
        (typeof e.number !== 'string' || ![...e.quote.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)].some((m) => m[0] === e.number))
      )
        throw new Error('UNSUPPORTED_NUMBER');
      if (
        (e.number === null) !== (e.unit === null) ||
        (e.unit !== null && !['원', '만원', '만 원', '억원', '억 원', '%', '개월', '년'].includes(e.unit as string))
      )
        throw new Error('INVALID_UNIT');
      if (typeof e.number === 'string' && typeof e.unit === 'string') {
        const compact = e.quote.replace(/\s/g, '');
        const literal = `${e.number}${e.unit.replace(/\s/g, '')}`;
        const index = compact.indexOf(literal);
        if (
          index < 0 ||
          (index > 0 && /[\d,.]/.test(compact[index - 1])) ||
          ![...source.text.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)].some((m) => m[0] === e.number)
        )
          throw new Error('UNSUPPORTED_AMOUNT_UNIT');
      }
      if (
        e.action !== null &&
        (!['유지', '중단', '시작', '증액', '감액'].includes(e.action as string) || /하지|않|말고|말아/.test(e.quote))
      )
        throw new Error('AMBIGUOUS_ACTION');
      const quote = e.quote;
      if (e.action !== null && ['유지', '중단', '시작', '증액', '감액'].filter((a) => quote.includes(a)).length !== 1)
        throw new Error('AMBIGUOUS_ACTION');
      return e as Proposal['evidence'][number];
    });
    return { kind: p.kind as Proposal['kind'], evidence, uncertainty: p.uncertainty, certainty: p.certainty as Proposal['certainty'] };
  });
}
const nullable = { type: ['string', 'null'] };
export const outputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['proposals'],
  properties: {
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'evidence', 'uncertainty', 'certainty'],
        properties: {
          certainty: { type: 'string', enum: ['confirmed', 'conditional', 'unknown'] },
          kind: { type: 'string', enum: kinds },
          uncertainty: { type: 'string' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['sourceId', 'quote', 'target', 'number', 'unit', 'action', 'timing'],
              properties: {
                sourceId: { type: 'string' },
                quote: { type: 'string' },
                target: { type: 'string' },
                number: nullable,
                unit: nullable,
                action: { type: ['string', 'null'], enum: ['유지', '중단', '시작', '증액', '감액', null] },
                timing: nullable,
              },
            },
          },
        },
      },
    },
  },
};
